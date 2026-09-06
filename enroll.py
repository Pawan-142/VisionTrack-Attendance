"""
enroll.py — Student Enrollment
Captures NUM_CAPTURES face photos → stores ALL embeddings individually
Uses face_db.py as single source of truth
"""
import cv2
import os
import time
import numpy as np
from deepface import DeepFace
from detect import detect_faces, crop_face
from face_db import load_face_db, save_face_db
from config import FACES_DIR, NUM_CAPTURES, MODEL_NAME


from recognize import get_embedding


def enroll_student(name, roll_no, force=False, stframe=None):
    """
    Enroll a student by capturing NUM_CAPTURES face images.

    Stores EACH embedding individually (not just mean) for better
    match accuracy across poses and lighting conditions.

    Returns:
        True       — success
        False      — incomplete capture / camera error
        "exists"   — already enrolled (and force=False)
    """
    db = load_face_db()
    if roll_no in db and not force:
        return "exists"

    student_dir = os.path.join(FACES_DIR, roll_no)
    os.makedirs(student_dir, exist_ok=True)

    # Try to open camera with retries (Windows sometimes takes a second to release)
    cam = None
    for _ in range(5):
        cam = cv2.VideoCapture(0, cv2.CAP_DSHOW)
        if cam.isOpened():
            break
        time.sleep(0.5)

    if not cam or not cam.isOpened():
        print("[ERROR] Cannot open camera")
        if stframe: stframe.error("Could not access camera. Please close other apps using it.")
        return False

    POSE_INSTRUCTIONS = [
        "Look STRAIGHT at the camera",
        "Turn face SLIGHTLY LEFT",
        "Turn face SLIGHTLY RIGHT",
        "Tilt head SLIGHTLY LEFT",
        "Tilt head SLIGHTLY RIGHT",
        "Look SLIGHTLY UP",
        "Look SLIGHTLY DOWN",
        "SMILE naturally",
        "NEUTRAL expression",
        "Look STRAIGHT again (final)",
    ]

    def draw_guide(frame, face_in_position):
        h, w = frame.shape[:2]
        cx, cy = w // 2, h // 2
        axes = (int(w * 0.18), int(h * 0.32))
        color = (0, 255, 80) if face_in_position else (0, 165, 255)
        overlay = frame.copy()
        cv2.ellipse(overlay, (cx, cy), (axes[0]+6, axes[1]+6), 0, 0, 360,
                    (0, 180, 60) if face_in_position else (0, 100, 180), 8)
        cv2.addWeighted(overlay, 0.3, frame, 0.7, 0, frame)
        cv2.ellipse(frame, (cx, cy), axes, 0, 0, 360, color, 3)
        for off in [(0, -axes[1]), (0, axes[1]), (axes[0], 0), (-axes[0], 0)]:
            cv2.circle(frame, (cx + off[0], cy + off[1]), 6, color, -1)
        return frame, cx, cy, axes

    def face_in_oval(box, cx, cy, axes):
        if not box:
            return False
        x, y, w, h = box
        dx = ((x + w // 2) - cx) / axes[0]
        dy = ((y + h // 2) - cy) / axes[1]
        return (dx * dx + dy * dy) <= 1.1

    embeddings = []
    count = 0

    import threading
    class AsyncDetector:
        def __init__(self):
            self.faces = []
            self.running = False
            self.lock = threading.Lock()
            
        def update(self, frame):
            with self.lock:
                current_faces = list(self.faces)
            if not self.running:
                self.running = True
                f = frame.copy()
                threading.Thread(target=self._run, args=(f,), daemon=True).start()
            return current_faces
            
        def _run(self, frame):
            # Speed Hack: Downscale frame for detection
            orig_h, orig_w = frame.shape[:2]
            target_w = 480
            scale = target_w / orig_w
            target_h = int(orig_h * scale)
            small_frame = cv2.resize(frame, (target_w, target_h))
            
            res = detect_faces(small_frame)
            
            # Scale boxes back
            for f in res:
                sx, sy, sw, sh = f['box']
                f['box'] = [int(sx/scale), int(sy/scale), int(sw/scale), int(sh/scale)]
                
            with self.lock:
                self.faces = res
            self.running = False

    detector = AsyncDetector()

    try:
        while count < NUM_CAPTURES:
            ret, frame = cam.read()
            if not ret:
                break

            faces = detector.update(frame)
            box   = faces[0]['box'] if faces else None
            fh, fw = frame.shape[:2]
            cx, cy = fw // 2, fh // 2
            axes   = (int(fw * 0.18), int(fh * 0.32))
            in_pos = face_in_oval(box, cx, cy, axes)

            frame, cx, cy, axes = draw_guide(frame, in_pos)

            # Top banner
            cv2.rectangle(frame, (0, 0), (fw, 52), (20, 20, 20), -1)
            cv2.putText(frame,
                        f"Step {count+1}/{NUM_CAPTURES}:  {POSE_INSTRUCTIONS[count]}",
                        (14, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.65,
                        (0, 255, 80) if in_pos else (0, 200, 255), 2)

            # Bottom bar + progress
            cv2.rectangle(frame, (0, fh - 50), (fw, fh), (20, 20, 20), -1)
            cv2.rectangle(frame, (0, fh - 6),
                          (int(fw * count / NUM_CAPTURES), fh), (0, 200, 80), -1)
            msg = "Face aligned! Hold still..." if in_pos else "Align your face inside the oval"
            cv2.putText(frame, f"{msg}   [{count}/{NUM_CAPTURES} captured]",
                        (10, fh - 18), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                        (0, 255, 80) if in_pos else (80, 80, 80), 2)

            # Capture when face is aligned
            if in_pos and box:
                # Use cached box to crop directly
                x, y, w, h = box
                padding = 20
                x1 = max(0, x - padding)
                y1 = max(0, y - padding)
                x2 = min(frame.shape[1], x + w + padding)
                y2 = min(frame.shape[0], y + h + padding)
                
                cropped = frame[y1:y2, x1:x2]
                face_crop = cv2.resize(cropped, (112, 112)) if cropped.size > 0 else None
                
                if face_crop is not None:
                    img_path = os.path.join(student_dir, f"{count}.jpg")
                    cv2.imwrite(img_path, face_crop)
                    emb = get_embedding(face_crop)
                    if emb is not None:
                        # Prevent duplicate enrollment of same face
                        if count == 0 and not force:
                            from face_db import match_face
                            name_match, roll_match, _ = match_face(emb, load_face_db())
                            if roll_match:
                                print(f"[WARN] Face already enrolled as {roll_match}")
                                if stframe is not None:
                                    stframe.error(f"This face is already registered under Roll No: {roll_match} ({name_match}). Select 'Overwrite existing' if you need to re-enroll.")
                                cam.release()
                                return "face_exists"

                        embeddings.append(emb)
                        count += 1
                        flash = frame.copy()
                        cv2.rectangle(flash, (0, 0), (fw, fh), (0, 255, 80), 8)
                        if stframe is not None:
                            stframe.image(flash)  # #14 Fix: pass BGR directly (no double conversion)
                        time.sleep(0.5)

            if stframe is not None:
                stframe.image(frame)  # #14 Fix: pass BGR directly (no double conversion)
                time.sleep(0.04)
            else:
                cv2.imshow("Enrollment — VisionTrack", frame)
                if cv2.waitKey(30) & 0xFF == ord('q'):
                    break
    finally:
        cam.release()
        if stframe is None:
            cv2.destroyAllWindows()

    if count < NUM_CAPTURES:
        print(f"[ERROR] Incomplete enrollment: {count}/{NUM_CAPTURES}")
        return False

    # Save ALL embeddings (not just mean) for better accuracy
    db = load_face_db()
    db[roll_no] = {
        "roll_no":      roll_no,
        "display_name": name,
        "embeddings":   embeddings,          # full list
        "embedding":    np.mean(embeddings, axis=0),  # kept for legacy compat
        "num_samples":  count,
    }
    save_face_db(db)
    print(f"[SUCCESS] Enrolled {name} ({roll_no}) — {count} embeddings saved")
    return True


def enroll_student_from_images(name, roll_no, image_list, force=False):
    """
    Enrolls a student using face images captured directly from browser/phone camera.
    Enforces strict 1-student-1-face rule across all IDs and courses.
    """
    from models import get_student
    from face_db import match_face

    db = load_face_db()
    clean_roll = str(roll_no).strip()

    # 1. Roll Number duplication check
    existing_by_roll = get_student(clean_roll)
    if existing_by_roll and not force:
        c_info = f" in {existing_by_roll.get('course', '')} ({existing_by_roll.get('department', '')})" if existing_by_roll.get('course') else ""
        return "exists", f"Student ID '{clean_roll}' is already registered to {existing_by_roll.get('name', 'Student')}{c_info}. Enable 'Overwrite existing' to update this student."

    student_dir = os.path.join(FACES_DIR, clean_roll)
    os.makedirs(student_dir, exist_ok=True)

    embeddings = []
    saved_count = 0

    for idx, frame in enumerate(image_list):
        if frame is None:
            continue
        try:
            faces = detect_faces(frame)
            if faces:
                box = faces[0]['box']
                x, y, w, h = box
                padding = 15
                x1 = max(0, x - padding)
                y1 = max(0, y - padding)
                x2 = min(frame.shape[1], x + w + padding)
                y2 = min(frame.shape[0], y + h + padding)
                cropped = frame[y1:y2, x1:x2]
                face_crop = cv2.resize(cropped, (112, 112)) if cropped.size > 0 else cv2.resize(frame, (112, 112))
            else:
                face_crop = cv2.resize(frame, (112, 112))

            img_path = os.path.join(student_dir, f"{saved_count}.jpg")
            cv2.imwrite(img_path, face_crop)
            emb = get_embedding(face_crop)
            if emb is not None:
                # 2. Biometric Duplicate Check (Must not match an existing different student)
                if saved_count == 0 and not force:
                    matched_name, matched_roll, distance = match_face(emb, db)
                    if matched_roll and str(matched_roll).lower() != clean_roll.lower():
                        existing_match = get_student(matched_roll)
                        c_info = f" in {existing_match.get('course', '')} - {existing_match.get('department', '')}" if existing_match else ""
                        print(f"[REJECT] Face duplicate detected! Already registered as {matched_name} ({matched_roll})")
                        # Clean up folder on rejection
                        try:
                            for f in os.listdir(student_dir):
                                os.remove(os.path.join(student_dir, f))
                            os.rmdir(student_dir)
                        except Exception:
                            pass
                        return "face_exists", f"Enrollment Rejected: This face is already registered to student '{matched_name}' (Roll No: {matched_roll}){c_info}. A student cannot register under multiple IDs or courses."

                embeddings.append(emb)
                saved_count += 1
        except Exception as e:
            print(f"[WARN] Error processing frame {idx}: {e}")

    if saved_count == 0:
        return "failed", "No clear face detected in captured images. Please align your face in camera view and try again."

    db[clean_roll] = {
        "roll_no": clean_roll,
        "display_name": name,
        "embeddings": embeddings,
        "embedding": np.mean(embeddings, axis=0),
        "num_samples": saved_count,
    }
    save_face_db(db)
    print(f"[SUCCESS] Enrolled {name} ({clean_roll}) via browser camera — {saved_count} face samples saved")
    return "success", f"Enrolled {name} ({clean_roll}) with {saved_count} face samples!"

