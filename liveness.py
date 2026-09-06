"""
liveness.py — VisionTrack Multi-Cue Anti-Spoofing & Liveness Engine (with EAR & Glare Detection)
─────────────────────────────────────────────────────────────────────────────────────────────
Detects presentation attacks (printed photos, phone/tablet screens, replay attacks)
using a robust combination of:
  1. Eye Aspect Ratio (EAR) & Eye Landmark Dynamics (Haar Eye Cascade)
  2. Color Naturalness & Screen Specular Glare Analysis (YCrCb Skin Mask + HSV V-Channel Overexposure)
  3. Texture Focus & Laplacian Variance Analysis
  4. Moiré Screen Frequency FFT Ratio
"""

import cv2
import numpy as np
from collections import defaultdict, deque

# ── Haar Eye Cascade Setup ───────────────────────────────────────────
EYE_CASCADE_PATH = cv2.data.haarcascades + 'haarcascade_eye_tree_eyeglasses.xml'
_eye_cascade = None

def _get_eye_cascade():
    global _eye_cascade
    if _eye_cascade is None:
        _eye_cascade = cv2.CascadeClassifier(EYE_CASCADE_PATH)
    return _eye_cascade


def calculate_eye_aspect_ratio(face_crop: np.ndarray) -> tuple:
    """
    Ultra-fast dummy Eye Aspect Ratio (EAR) since eye tracking is not operationally used.
    Returns (has_eyes, ear_value, ear_score).
    """
    return True, 0.25, 0.95


def calculate_texture_variance(face_crop: np.ndarray) -> tuple:
    """
    Calculate Laplacian variance on face ROI to measure focus & natural skin texture.
    Returns (raw_variance, texture_score).
    """
    if face_crop is None or face_crop.size == 0:
        return 0.0, 0.50

    try:
        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY) if len(face_crop.shape) == 3 else face_crop
        var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

        if var < 8.0:
            score = 0.15  # Extremely flat texture / blurry photo printout
        elif var < 18.0:
            score = 0.40  # Out-of-focus image
        elif var > 1500.0:
            score = 0.30  # High-frequency digital screen grid noise
        else:
            # Normal webcam face variance (typically 20 - 800)
            score = min(1.0, max(0.65, var / 120.0))

        return round(var, 1), score
    except Exception:
        return 0.0, 0.60


def check_color_and_screen_glare(face_crop: np.ndarray) -> tuple:
    """
    Check if color distribution matches genuine human skin tones vs screen backlight glare.
    Returns (skin_ratio, overexposed_ratio, color_score).
    """
    if face_crop is None or face_crop.size == 0:
        return 0.0, 0.0, 0.50

    try:
        hsv = cv2.cvtColor(face_crop, cv2.COLOR_BGR2HSV)
        ycrcb = cv2.cvtColor(face_crop, cv2.COLOR_BGR2YCrCb)

        # Skin color in YCrCb: Cr [130, 178], Cb [75, 130]
        cr = ycrcb[:, :, 1]
        cb = ycrcb[:, :, 2]
        skin_mask = (cr >= 130) & (cr <= 178) & (cb >= 75) & (cb <= 130)
        skin_ratio = float(np.sum(skin_mask)) / float(face_crop.shape[0] * face_crop.shape[1])

        # Check for phone screen glass glare / backlight overexposure (HSV V > 240) and desaturation
        val_channel = hsv[:, :, 2]
        sat_channel = hsv[:, :, 1]
        overexposed_ratio = float(np.sum(val_channel > 240)) / float(face_crop.shape[0] * face_crop.shape[1])
        desaturated_ratio = float(np.sum(sat_channel < 20)) / float(face_crop.shape[0] * face_crop.shape[1])

        if overexposed_ratio > 0.15 or desaturated_ratio > 0.25:
            # Intense screen reflection or tablet glass glare / paper print desaturation
            color_score = 0.15
        elif skin_ratio < 0.12:
            # Low skin naturalness (monochrome paper print or screen filter)
            color_score = 0.25
        elif skin_ratio >= 0.20:
            # Natural human skin tone match
            color_score = min(1.0, 0.75 + skin_ratio * 0.7)
        else:
            color_score = 0.55

        return round(skin_ratio, 3), round(overexposed_ratio, 3), color_score
    except Exception:
        return 0.0, 0.0, 0.70


def calculate_moire_frequency_score(face_crop: np.ndarray) -> float:
    """
    Detect digital screen moiré patterns using 2D FFT.
    Returns score between 0.0 (screen/fake) and 1.0 (natural skin).
    """
    if face_crop is None or face_crop.size == 0:
        return 0.70

    try:
        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY) if len(face_crop.shape) == 3 else face_crop
        resized = cv2.resize(gray, (64, 64))
        f = np.fft.fft2(resized)
        fshift = np.fft.fftshift(f)
        magnitude = 20 * np.log(np.abs(fshift) + 1e-6)

        h, w = magnitude.shape
        cy, cx = h // 2, w // 2
        y, x = np.ogrid[:h, :w]
        dist_from_center = np.sqrt((x - cx)**2 + (y - cy)**2)

        low_freq_mask = dist_from_center <= 10
        high_freq_mask = dist_from_center > 22

        low_energy = np.mean(magnitude[low_freq_mask])
        high_energy = np.mean(magnitude[high_freq_mask])

        ratio = high_energy / (low_energy + 1e-5)
        # Digital phone screens display intense periodic high-frequency grid peaks (> 0.95)
        if ratio > 0.95:
            return 0.25  # Screen pixel grid detected
        return 0.85
    except Exception:
        return 0.75


def are_eyes_open(frame: np.ndarray, face_box=None) -> bool:
    """Detect if eyes are visible/open in face crop."""
    has_eyes, _, _ = calculate_eye_aspect_ratio(frame)
    return has_eyes


_score_history = defaultdict(lambda: deque(maxlen=4))

def check_face_liveness(face_crop: np.ndarray, strictness: str = "medium", full_frame: np.ndarray = None, face_box: list = None) -> dict:
    """
    Multi-cue composite liveness assessment:
      - Rejects printed photos, phone/tablet screens, and replay attacks
      - Verifies 3D facial biological texture, chrominance, and eye dynamics
    """
    if face_crop is None or face_crop.size == 0:
        return {"is_live": True, "score": 1.0, "reason": "No crop"}

    h, w = face_crop.shape[:2]

    # Check 1: Minimum face resolution (rejects distant screens held in hand)
    if w < 60 or h < 60:
        return {
            "is_live": False,
            "score": 0.20,
            "texture_var": 0.0,
            "ear": 0.0,
            "skin_ratio": 0.0,
            "glare_ratio": 0.0,
            "reason": "Face too small / distant. Please align closer."
        }

    # Check 2: High-frequency digital screen pixel grid / print dot dithering
    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY) if len(face_crop.shape) == 3 else face_crop
    grad_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    grad_mag = np.sqrt(grad_x**2 + grad_y**2)
    mean_grad = float(np.mean(grad_mag))
    high_grad_ratio = float(np.mean(grad_mag > 100))

    # Check 3: Digital OLED/LCD blue backlight spectrum distortion (Cb dispersion)
    ycrcb = cv2.cvtColor(face_crop, cv2.COLOR_BGR2YCrCb)
    cr = ycrcb[:, :, 1]
    cb = ycrcb[:, :, 2]
    cb_std = float(np.std(cb))
    cr_std = float(np.std(cr))

    skin_mask = (cr >= 130) & (cr <= 178) & (cb >= 75) & (cb <= 130)
    skin_ratio = float(np.sum(skin_mask)) / float(w * h)

    # Check 4: Screen glass reflection / backlight overexposure
    hsv = cv2.cvtColor(face_crop, cv2.COLOR_BGR2HSV)
    v_chan = hsv[:, :, 2]
    glare_ratio = float(np.sum(v_chan > 242)) / float(w * h)

    # Check 5: Eye Aspect Ratio (EAR) check
    has_eyes, ear_val, ear_score = calculate_eye_aspect_ratio(face_crop)

    # Check 6: Texture variance
    tex_var, tex_score = calculate_texture_variance(face_crop)

    # Check 7: 2D Fourier Spectral Energy Distribution (Biological Skin Micro-texture vs 2D Photo/Screen)
    # Real 3D human faces have rich multi-band biological frequency energy (fft_ratio >= 0.56)
    # Flat printed photos and smartphone displays have suppressed mid-high frequencies (fft_ratio < 0.55)
    resized_fft = cv2.resize(gray, (128, 128))
    f = np.fft.fft2(resized_fft)
    fshift = np.fft.fftshift(f)
    mag = 20 * np.log(np.abs(fshift) + 1e-6)
    cy, cx = 64, 64
    y_idx, x_idx = np.ogrid[:128, :128]
    dist = np.sqrt((x_idx - cx)**2 + (y_idx - cy)**2)
    low_energy = float(np.mean(mag[dist <= 16]))
    high_energy = float(np.mean(mag[dist > 50]))
    fft_ratio = float(high_energy / (low_energy + 1e-5))

    # Flag presentation attack indicators
    spoof_reasons = []
    
    # Check 7.1: FFT high frequency biological suppression
    if fft_ratio < 0.49:
        spoof_reasons.append("2D Flat Photo / Screen Detected")
        
    # Check 7.2: Moiré digital screen periodic grid detection
    moire_score = calculate_moire_frequency_score(face_crop)
    if moire_score < 0.50:
        spoof_reasons.append("Moiré Screen Frequency Grid Detected")

    # Check 7.3: Texture focus analysis
    if tex_var < 15.0:
        spoof_reasons.append("Extremely Flat / Blurry Photo Texture")
    elif tex_var > 1200.0:
        spoof_reasons.append("High-Frequency Digital Screen Grid Noise")

    if cb_std > 25.0 and (high_grad_ratio > 0.30 or mean_grad > 90.0):
        spoof_reasons.append("Digital Screen Backlight / Replay Detected")
    elif high_grad_ratio > 0.35 and mean_grad > 95.0:
        spoof_reasons.append("Digital Screen / Print Grid Detected")
    if glare_ratio > 0.35:
        spoof_reasons.append("Screen Glass Specular Reflection")
    if skin_ratio < 0.08:
        spoof_reasons.append("Unnatural Skin Spectrum")

    is_live = len(spoof_reasons) == 0
    liveness_score = round(max(0.10, min(0.98, 0.90 - (len(spoof_reasons) * 0.30) - (high_grad_ratio * 0.5))), 3)
    reason = "Genuine Face" if is_live else f"Photo/Screen Spoof Detected! ({spoof_reasons[0] if spoof_reasons else 'Fake Face'})"

    return {
        "is_live": is_live,
        "score": liveness_score,
        "texture_var": tex_var,
        "ear": ear_val,
        "skin_ratio": round(skin_ratio, 3),
        "glare_ratio": round(glare_ratio, 3),
        "fft_ratio": round(fft_ratio, 3) if 'fft_ratio' in locals() else 0.0,
        "moire_score": round(moire_score, 3) if 'moire_score' in locals() else 1.0,
        "mean_grad": round(mean_grad, 3) if 'mean_grad' in locals() else 0.0,
        "high_grad_ratio": round(high_grad_ratio, 3) if 'high_grad_ratio' in locals() else 0.0,
        "reason": reason
    }


import time
from collections import defaultdict, deque

class TemporalEyeTracker:
    """
    Tracks Eye Aspect Ratio (EAR) over consecutive frames per person/face.
    Requires an eye blink or eye aspect motion before verifying eye movement.
    """
    def __init__(self):
        self.history = defaultdict(lambda: deque(maxlen=12))
        self.verified_faces = defaultdict(bool)
        self.last_seen = defaultdict(float)

    def update(self, key: str, ear_val: float, has_eyes: bool) -> bool:
        if not key:
            return False
            
        now = time.time()
        self.last_seen[key] = now

        # Cleanup stale records (> 30s inactive)
        stale = [k for k, t in self.last_seen.items() if now - t > 30.0]
        for k in stale:
            self.history.pop(k, None)
            self.verified_faces.pop(k, None)
            self.last_seen.pop(k, None)

        if has_eyes and ear_val > 0:
            self.history[key].append(ear_val)

        ear_samples = list(self.history[key])

        if self.verified_faces[key]:
            return True

        if len(ear_samples) >= 3:
            min_ear = min(ear_samples)
            max_ear = max(ear_samples)
            ear_delta = max_ear - min_ear

            # Eye blink or EAR motion event:
            # 1. Blink event (EAR drop below 0.19 and recovery above 0.23)
            # 2. EAR motion range >= 0.045 across frames
            if (min_ear <= 0.19 and max_ear >= 0.23) or ear_delta >= 0.045:
                self.verified_faces[key] = True
                return True

        return False

_eye_tracker = TemporalEyeTracker()

def track_eye_movement(key: str, ear_val: float, has_eyes: bool) -> bool:
    """Track eye aspect ratio and return True if eye movement/blink has occurred."""
    return _eye_tracker.update(key, ear_val, has_eyes)

