"""
models.py — VisionTrack Unified Database Layer Router
Dynamically routes requests to either Firebase Firestore or Local SQLite fallback.
"""
from config import USE_FIREBASE

if USE_FIREBASE:
    from firebase_db import *
else:
    from models_sqlite import *
