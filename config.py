"""
config.py — VisionTrack Central Configuration
All paths, thresholds, and constants live here.
Provides dynamic JSON-persisted settings that can be updated live from the UI.
"""
import os
import json
import shutil
from datetime import datetime

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
DATABASE_DIR  = os.path.join(BASE_DIR, "database")
BACKUP_DIR    = os.path.join(DATABASE_DIR, "backups")
FACES_DIR     = os.path.join(BASE_DIR, "faces")
DB_FILE       = os.path.join(DATABASE_DIR, "attendance.db")   # local fallback
FACE_DB_PATH  = os.path.join(DATABASE_DIR, "embeddings.pkl")  # local fallback
EXPORT_DIR    = os.path.join(BASE_DIR, "exports")
SETTINGS_FILE = os.path.join(DATABASE_DIR, "system_settings.json")

os.makedirs(DATABASE_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)
os.makedirs(FACES_DIR, exist_ok=True)
os.makedirs(EXPORT_DIR, exist_ok=True)

def create_auto_backup():
    """Automatically backs up attendance.db and embeddings.pkl to database/backups/."""
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        if os.path.exists(DB_FILE) and os.path.getsize(DB_FILE) > 0:
            dest = os.path.join(BACKUP_DIR, f"attendance_backup_{ts}.db")
            shutil.copy2(DB_FILE, dest)
        if os.path.exists(FACE_DB_PATH) and os.path.getsize(FACE_DB_PATH) > 0:
            dest_pkl = os.path.join(BACKUP_DIR, f"embeddings_backup_{ts}.pkl")
            shutil.copy2(FACE_DB_PATH, dest_pkl)
        
        # Keep only latest 10 backups of each
        for prefix in ["attendance_backup_", "embeddings_backup_"]:
            files = sorted([f for f in os.listdir(BACKUP_DIR) if f.startswith(prefix)])
            if len(files) > 10:
                for old_f in files[:-10]:
                    try:
                        os.remove(os.path.join(BACKUP_DIR, old_f))
                    except Exception:
                        pass
    except Exception as e:
        print(f"[Backup] Auto-backup skipped: {e}")

# ── Firebase ────────────────────────────────────────────────────────────────────
FIREBASE_KEY_PATH = os.path.join(BASE_DIR, "serviceAccountKey.json")
USE_FIREBASE      = False   # Set False to use local SQLite instead

# ── Default Settings ───────────────────────────────────────────────────────────
DEFAULT_SETTINGS = {
    "model_name": "ArcFace",
    "threshold": 0.53,              # cosine distance — 0.53 adjusted for distant face matching robustness
    "frame_skip": 4,                # run DeepFace every Nth frame
    "cooldown_sec": 10,             # seconds before re-trying same face
    "num_captures": 10,             # photos captured during enrollment
    "anti_spoofing": True,          # multi-cue liveness detection
    "liveness_strictness": "medium",# low, medium, high
    "camera_mode": "client",        # "client" (browser web camera) or "server" (hardware/usb)
    "attendance_threshold": 75,     # % below which student is flagged as defaulter
    "college_name": "VisionTrack University of Technology",
    "departments": ["CSE", "ECE", "MBA", "EEE", "MECH", "CIVIL"],
    "years": ["1st Year", "2nd Year", "3rd Year", "4th Year", "PG 1st Year", "PG 2nd Year"],
    "sound_enabled": True,
    "email_alerts_enabled": True
}

def load_settings():
    """Load settings from JSON file or create defaults."""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                merged = dict(DEFAULT_SETTINGS)
                merged.update(data)
                return merged
        except Exception:
            return dict(DEFAULT_SETTINGS)
    return dict(DEFAULT_SETTINGS)

def save_settings(new_settings: dict):
    """Save updated settings to JSON file."""
    current = load_settings()
    current.update(new_settings)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    return current

# Load active configuration
_cfg = load_settings()

MODEL_NAME           = _cfg.get("model_name", "ArcFace")
THRESHOLD            = float(_cfg.get("threshold", 0.48))
FRAME_SKIP           = int(_cfg.get("frame_skip", 4))
COOLDOWN_SEC         = int(_cfg.get("cooldown_sec", 10))
NUM_CAPTURES         = int(_cfg.get("num_captures", 10))
ANTI_SPOOFING        = bool(_cfg.get("anti_spoofing", True))
LIVENESS_STRICTNESS  = _cfg.get("liveness_strictness", "medium")
CAMERA_MODE          = _cfg.get("camera_mode", "client")
ATTENDANCE_THRESHOLD = int(_cfg.get("attendance_threshold", 75))
COLLEGE_NAME         = _cfg.get("college_name", "VisionTrack University of Technology")
DEPARTMENTS          = _cfg.get("departments", ["CSE", "ECE", "MBA", "EEE"])
YEARS                = _cfg.get("years", ["1st Year", "2nd Year", "3rd Year", "4th Year"])
