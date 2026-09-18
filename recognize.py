"""
recognize.py — VisionTrack High-Performance Multi-Face Recognition & Anti-Spoofing
─────────────────────────────────────────────────────────────────────────────────
ArcFace embeddings + Multi-cue Liveness Detection.
Provides asynchronous streaming recognition and synchronous single-frame endpoints.
"""
import cv2
import numpy as np
import threading
import time
from deepface import DeepFace
from detect import detect_faces
from face_db import match_face
from liveness import check_face_liveness, track_eye_movement
from config import FRAME_SKIP, THRESHOLD, ANTI_SPOOFING, LIVENESS_STRICTNESS

_tf_lock = threading.Lock()
_arcface_client = None
_arcface_model = None
_arcface_ready = False

def _get_arcface_model():
    global _arcface_client, _arcface_model, _arcface_ready
    if _arcface_model is None:
        try:
            with _tf_lock:
                if _arcface_model is None:
                    _arcface_client = DeepFace.build_model("ArcFace")
                    _arcface_model = _arcface_client.model
                    dummy = np.zeros((1, 112, 112, 3), dtype=np.float32)
                    _ = _arcface_model(dummy, training=False)
                    _arcface_ready = True
        except Exception as e:
            print(f"[recognize] Direct model load failed: {e}")
    return _arcface_model


def warmup_arcface():
    """Pre-load ArcFace weights lazily without crashing low-memory environments."""
    def _do_warm():
        try:
            import os
            # If constrained container memory, let model load on demand
            if os.environ.get("RENDER") or os.environ.get("PORT"):
                print("[VisionTrack] Cloud container detected — ArcFace will load on-demand.")
                return
            _get_arcface_model()
            print("[VisionTrack] Fast direct ArcFace engine warmed up and ready.")
        except Exception as e:
            print(f"[VisionTrack] ArcFace background warmup deferred: {e}")
    t = threading.Thread(target=_do_warm, daemon=True)
    t.start()


def get_embedding(face_img: np.ndarray):
    """Extract ArcFace embedding from a pre-cropped face image with high-speed direct inference."""
    try:
        model = _get_arcface_model()
        if model is None:
            # Fallback to DeepFace represent
            with _tf_lock:
                res = DeepFace.represent(img_path=face_img, model_name="ArcFace", enforce_detection=False)
            if res and len(res) > 0 and "embedding" in res[0]:
                return np.array(res[0]["embedding"])
            return None

        # Direct high-speed Keras forward pass with exact ArcFace scaling (RGB, [-1, 1] normalization)
        img_rgb = cv2.cvtColor(face_img, cv2.COLOR_BGR2RGB)
        img_prep = cv2.resize(img_rgb, (112, 112)).astype(np.float32)
        img_prep = (img_prep - 127.5) / 128.0
        img_tensor = np.expand_dims(img_prep, axis=0)
        with _tf_lock:
            emb = model(img_tensor, training=False).numpy()[0]
        return np.array(emb, dtype=np.float32)
    except Exception as e:
        return None


def recognize_single_frame(frame: np.ndarray, db: dict, threshold: float = None, 
                           anti_spoofing: bool = None, strictness: str = None) -> list:
    """
    Synchronously detect and recognize all faces in a single BGR frame.
    Ideal for browser webcam frame uploads (/api/session/client-frame).
    
    Returns list of dicts:
      [{
        "name": str,
        "roll_no": str,
        "distance": float,
        "box": [x, y, w, h],
        "confidence": float,
        "is_real": bool,
        "eye_verified": bool,
        "liveness_score": float,
        "liveness_reason": str
      }]
    """
    if frame is None or frame.size == 0:
        return []

    active_thresh = threshold if threshold is not None else THRESHOLD
    use_liveness  = anti_spoofing if anti_spoofing is not None else ANTI_SPOOFING
    strict_level  = strictness or LIVENESS_STRICTNESS

    orig_h, orig_w = frame.shape[:2]
    # Fast thumbnail only if frame is larger than 480px (avoids wasteful upscaling on 400px client frames)
    if orig_w > 480:
        scale = 480.0 / float(orig_w)
        small_frame = cv2.resize(frame, (480, int(orig_h * scale)))
    else:
        scale = 1.0
        small_frame = frame

    faces = detect_faces(small_frame)
    results = []

    for face in faces:
        if face.get('confidence', 1.0) < 0.35:
            continue

        sx, sy, sw, sh = face['box']
        x = max(0, int(sx / scale))
        y = max(0, int(sy / scale))
        w = int(sw / scale)
        h = int(sh / scale)

        # Precise, snug face crop for high-accuracy ArcFace embedding
        pad_x = max(6, int(w * 0.12))
        pad_y = max(6, int(h * 0.12))
        x1, y1 = max(0, x - pad_x), max(0, y - pad_y)
        x2, y2 = min(orig_w, x + w + pad_x), min(orig_h, y + h + pad_y)
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            continue

        # Reject heavily occluded or severely distorted crops
        aspect_ratio = float(w) / float(h) if h > 0 else 1.0
        if aspect_ratio < 0.50 or aspect_ratio > 1.50:
            continue

        # ── Liveness Verification ──
        liveness_meta = {"is_live": True, "score": 1.0, "reason": "Liveness disabled"}
        if use_liveness:
            liveness_meta = check_face_liveness(crop, strictness=strict_level, full_frame=frame, face_box=[x, y, w, h])

        is_real = liveness_meta["is_live"]

        # ── Face Embedding & Matching ──
        crop_resized = cv2.resize(crop, (112, 112))
        embedding = get_embedding(crop_resized)
        
        name = "Unknown"
        roll_no = None
        distance = 1.0
        
        matched_details = {}
        if embedding is not None:
            # Match face with diagnostics enabled to inspect match results
            matched_details = match_face(embedding, db, active_thresh, return_diagnostics=True)
            if is_real:
                name = matched_details.get("name", "Unknown")
                roll_no = matched_details.get("roll_no")
                distance = matched_details.get("distance", 1.0)
            else:
                # If spoofed, we still expose the best enrolled candidate name/roll for diagnostics
                name = "Photo / Spoof Detected"
                reason = liveness_meta.get("reason", "")
                if any(k in reason.lower() for k in ["small", "distant", "closer"]):
                    name = "Align Closer"
                roll_no = None
                distance = 1.0

        # ── Temporal Eye & Liveness Status ──
        eye_verified = is_real

        results.append({
            "name": name,
            "roll_no": roll_no,
            "distance": round(distance, 3),
            "box": [x, y, w, h],
            "confidence": round(face.get('confidence', 1.0), 3),
            "is_real": is_real,
            "eye_verified": eye_verified,
            "liveness_score": liveness_meta.get("score", 1.0),
            "liveness_reason": liveness_meta.get("reason", ""),
            # Diagnostic extensions
            "best_match_name": matched_details.get("best_enrolled_name", "Unknown") if embedding is not None else "Unknown",
            "best_match_roll": matched_details.get("best_enrolled_roll") if embedding is not None else None,
            "second_match_name": matched_details.get("second_name") if embedding is not None else None,
            "second_match_roll": matched_details.get("second_roll") if embedding is not None else None,
            "second_match_distance": round(matched_details.get("second_distance", 1.0), 3) if embedding is not None else 1.0,
            "liveness_details": {
                "fft_ratio": round(liveness_meta.get("fft_ratio", 0.0), 3),
                "moire_score": round(liveness_meta.get("moire_score", 1.0), 3),
                "texture_var": round(liveness_meta.get("texture_var", 0.0), 3),
                "skin_ratio": round(liveness_meta.get("skin_ratio", 0.0), 3),
                "glare_ratio": round(liveness_meta.get("glare_ratio", 0.0), 3),
                "mean_grad": round(liveness_meta.get("mean_grad", 0.0), 3),
                "high_grad_ratio": round(liveness_meta.get("high_grad_ratio", 0.0), 3)
            }
        })

    return results


class FrameSkipRecognizer:
    """
    Stateful recognizer that runs DeepFace inference asynchronously for smooth local video.
    """
    def __init__(self, threshold=None, anti_spoofing=None):
        self._cache         = []
        self._threshold     = threshold or THRESHOLD
        self._anti_spoofing = anti_spoofing if anti_spoofing is not None else ANTI_SPOOFING
        self._thread        = None
        self._lock          = threading.Lock()
        self._miss_count    = 0

    def process(self, frame, db):
        with self._lock:
            current_cache = list(self._cache)

        if self._thread is None or not self._thread.is_alive():
            frame_copy = frame.copy()
            self._thread = threading.Thread(
                target=self._run_inference,
                args=(frame_copy, db),
                daemon=True
            )
            self._thread.start()

        return current_cache

    def _run_inference(self, frame, db):
        results = recognize_single_frame(
            frame, 
            db, 
            threshold=self._threshold, 
            anti_spoofing=self._anti_spoofing
        )
        with self._lock:
            if results:
                self._cache = results
                self._miss_count = 0
            else:
                self._miss_count += 1
                if self._miss_count >= 3:
                    self._cache = []


def draw_recognition_results(frame, results):
    """Draw coloured bounding boxes, confidence badges, and liveness tags."""
    for r in results:
        x, y, w, h = r['box']
        if not r.get('is_real', True):
            reason = r.get("liveness_reason", "")
            if any(k in reason.lower() for k in ["small", "distant", "closer"]):
                color = (0, 180, 255)  # Amber
                label = "ALIGN CLOSER"
            else:
                color = (0, 69, 255)  # Bright Orange-Red (Spoof)
                label = f"FAKE FACE - PHOTO DETECTED ({int(r.get('liveness_score', 0)*100)}%)"
        elif r.get('roll_no'):
            status = r.get("status", "")
            pct = max(0, int((1.0 - r['distance']) * 100))
            if status == "wrong_class":
                color = (0, 0, 255)    # Red
                s_course = r.get("student_course", "")
                s_dept = r.get("student_dept", "")
                s_year = r.get("student_year", "")
                parts = [p for p in [s_course, s_dept, s_year] if p]
                c_info = f" [{ ' '.join(parts) }]" if parts else ""
                label = f"WRONG CLASS - {r['name']}{c_info} ({pct}%)"
            elif status in ("duplicate", "cooldown"):
                color = (0, 180, 255)  # Amber
                label = f"{r['name']} - Already Present ({pct}%)"
            else:
                color = (40, 200, 40)  # Green
                label = f"{r['name']} - Marked! ({pct}%)"
        else:
            color = (0, 0, 220)  # Red
            label = "Unknown Face"

        cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
        # Top pill tag
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
        cv2.rectangle(frame, (x, max(0, y - th - 12)), (x + tw + 8, y), color, -1)
        cv2.putText(frame, label, (x + 4, max(th, y - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)
    return frame
