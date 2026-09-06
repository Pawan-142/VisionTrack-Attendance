"""
firebase_client.py - Firebase Admin SDK Initializer
Supports local JSON key file for authentication.
Streamlit-free version for FastAPI backend.
"""
import os
import json
import firebase_admin
from firebase_admin import credentials, firestore

_app = None
_db  = None

def _init():
    global _app, _db
    if _app is not None:
        return

    from config import FIREBASE_KEY_PATH

    # Try to use local JSON service account key
    if os.path.exists(FIREBASE_KEY_PATH):
        if not firebase_admin._apps:
            cred = credentials.Certificate(FIREBASE_KEY_PATH)
            _app = firebase_admin.initialize_app(cred)
        else:
            _app = firebase_admin.get_app()
    else:
        raise FileNotFoundError(
            f"[Firebase] Key not found at {FIREBASE_KEY_PATH}. "
            "Please ensure serviceAccountKey.json is in your project folder."
        )

    if _db is None:
        _db  = firestore.client()
        print("[Firebase] Firestore connected OK")

def get_db():
    _init()
    return _db
