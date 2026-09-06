"""
face_db.py — Unified Face Embedding Database
Supports both local pickle (offline) and Firebase Firestore (cloud).
Controlled by config.USE_FIREBASE.
"""
import os
import pickle
import numpy as np
from scipy.spatial.distance import cosine
from config import FACE_DB_PATH, DATABASE_DIR, THRESHOLD, USE_FIREBASE

# In-memory cache to avoid re-fetching from Firestore on every frame
_cache = None
_cache_ts = 0
_CACHE_TTL = 30   # seconds


def _firestore_load():
    """Load embeddings from Firestore `embeddings` collection."""
    from firebase_client import get_db
    db = get_db()
    result = {}
    for doc in db.collection("embeddings").stream():
        data = doc.to_dict()
        # Convert lists/dicts → numpy arrays
        raw_embs = data.get("embeddings", [])
        data["embeddings"] = [
            np.array(e["data"] if isinstance(e, dict) else e)
            for e in raw_embs if e
        ]
        if "embedding" in data and data["embedding"]:
            data["embedding"] = np.array(data["embedding"])
        result[doc.id] = data
    return result


def _firestore_save(db_local):
    """Write all embeddings to Firestore."""
    from firebase_client import get_db
    db = get_db()
    for roll_no, data in db_local.items():
        serialized = dict(data)
        # Firestore doesn't allow nested arrays, wrap in dict
        if "embeddings" in serialized:
            serialized["embeddings"] = [
                {"data": e.tolist() if hasattr(e, "tolist") else e}
                for e in serialized["embeddings"]
            ]
        if "embedding" in serialized and serialized["embedding"] is not None:
            emb = serialized["embedding"]
            serialized["embedding"] = emb.tolist() if hasattr(emb, "tolist") else emb
        db.collection("embeddings").document(roll_no).set(serialized)


_last_mtime = 0

def load_face_db(force_refresh=False):
    global _cache, _cache_ts, _last_mtime
    import time

    if os.path.exists(FACE_DB_PATH):
        mtime = os.path.getmtime(FACE_DB_PATH)
    else:
        mtime = 0

    if not force_refresh and _cache is not None and mtime == _last_mtime:
        return _cache

    _last_mtime = mtime
    if USE_FIREBASE:
        try:
            _cache    = _firestore_load()
            _cache_ts = time.time()
            return _cache
        except Exception as e:
            print(f"[face_db] Firestore load failed: {e}. Falling back to local.")
            # Fall through to local

    # Local pickle fallback
    if os.path.exists(FACE_DB_PATH):
        with open(FACE_DB_PATH, "rb") as f:
            _cache = pickle.load(f)
            _cache_ts = time.time()
            return _cache
    _cache = {}
    return _cache


def save_face_db(db_local):
    global _cache, _cache_ts
    _cache    = db_local
    _cache_ts = __import__("time").time()
    clear_matrix_cache()

    if USE_FIREBASE:
        try:
            _firestore_save(db_local)
            return
        except Exception as e:
            print(f"[face_db] Firestore save failed: {e}. Saving locally.")

    # Local pickle fallback
    os.makedirs(DATABASE_DIR, exist_ok=True)
    with open(FACE_DB_PATH, "wb") as f:
        pickle.dump(db_local, f)


def delete_face_entry(roll_no):
    global _cache
    clear_matrix_cache()
    db = load_face_db()
    if roll_no in db:
        del db[roll_no]
        save_face_db(db)
        if _cache and roll_no in _cache:
            del _cache[roll_no]
        if USE_FIREBASE:
            try:
                from firebase_client import get_db
                get_db().collection("embeddings").document(roll_no).delete()
            except Exception as e:
                print(f"[face_db] Firestore delete failed: {e}")
        return True
    return False


_matrix_cache = None
_matrix_keys_hash = None

def clear_matrix_cache():
    global _matrix_cache, _matrix_keys_hash
    _matrix_cache = None
    _matrix_keys_hash = None

def _get_db_matrix(db):
    global _matrix_cache, _matrix_keys_hash
    # Hash student roll numbers + total embedding count so new enrollments instantly invalidate matrix
    db_signature = tuple(
        (k, len(v.get("embeddings", [])) if isinstance(v, dict) and "embeddings" in v else 1)
        for k, v in sorted(db.items())
    )
    current_hash = hash(db_signature)
    if _matrix_cache is not None and _matrix_keys_hash == current_hash:
        return _matrix_cache
    
    vectors = []
    meta = []
    for roll_no, data in db.items():
        embs = data.get("embeddings", [])
        if not embs and "embedding" in data and data["embedding"] is not None:
            embs = [data["embedding"]]
        for e in embs:
            if e is not None:
                v = np.array(e, dtype=np.float32).flatten()
                norm = np.linalg.norm(v)
                if norm > 0:
                    vectors.append(v / norm)
                    meta.append((data.get("display_name", "Student"), roll_no))
    
    if len(vectors) == 0:
        _matrix_cache = (None, [])
        _matrix_keys_hash = current_hash
        return _matrix_cache
    
    _matrix_cache = (np.array(vectors, dtype=np.float32), meta)
    _matrix_keys_hash = current_hash
    return _matrix_cache


def match_face(query_embedding, db, threshold=None, return_diagnostics=False):
    """
    Match against all stored embeddings using ultra-fast BLAS matrix dot-product.
    Computes all student distances simultaneously in < 0.05ms.
    """
    if threshold is None:
        threshold = THRESHOLD

    if query_embedding is None or not db:
        if return_diagnostics:
            return {
                "name": "Unknown",
                "roll_no": None,
                "distance": 1.0,
                "second_name": None,
                "second_roll": None,
                "second_distance": 1.0
            }
        return "Unknown", None, 1.0

    try:
        matrix, meta = _get_db_matrix(db)
        if matrix is None or len(matrix) == 0:
            if return_diagnostics:
                return {
                    "name": "Unknown",
                    "roll_no": None,
                    "distance": 1.0,
                    "second_name": None,
                    "second_roll": None,
                    "second_distance": 1.0
                }
            return "Unknown", None, 1.0

        q_vec = np.array(query_embedding, dtype=np.float32).flatten()
        q_norm = np.linalg.norm(q_vec)
        if q_norm == 0:
            if return_diagnostics:
                return {
                    "name": "Unknown",
                    "roll_no": None,
                    "distance": 1.0,
                    "second_name": None,
                    "second_roll": None,
                    "second_distance": 1.0
                }
            return "Unknown", None, 1.0
        q_vec = q_vec / q_norm

        sims = np.dot(matrix, q_vec)
        sorted_idxs = np.argsort(sims)[::-1]
        
        best_idx = int(sorted_idxs[0])
        best_sim = float(sims[best_idx])
        best_distance = float(1.0 - best_sim)
        best_name, best_roll = meta[best_idx]
        
        second_name, second_roll = None, None
        second_distance = 1.0
        for idx in sorted_idxs[1:]:
            name, roll = meta[idx]
            if roll != best_roll:
                second_name, second_roll = name, roll
                second_distance = float(1.0 - sims[idx])
                break

        if return_diagnostics:
            matched_name = best_name if best_distance < threshold else "Unknown"
            matched_roll = best_roll if best_distance < threshold else None
            return {
                "name": matched_name,
                "roll_no": matched_roll,
                "distance": best_distance,
                "best_enrolled_name": best_name,
                "best_enrolled_roll": best_roll,
                "second_name": second_name,
                "second_roll": second_roll,
                "second_distance": second_distance
            }

        if best_distance < threshold:
            return best_name, best_roll, best_distance
    except Exception as e:
        print(f"[match_face] Error: {e}")

    if return_diagnostics:
        return {
            "name": "Unknown",
            "roll_no": None,
            "distance": 1.0 if 'best_distance' not in locals() else best_distance,
            "second_name": None,
            "second_roll": None,
            "second_distance": 1.0
        }
    return "Unknown", None, 1.0 if 'best_distance' not in locals() else best_distance


def list_enrolled():
    db = load_face_db()
    result = []
    for roll_no, data in db.items():
        embs = data.get("embeddings", [data.get("embedding")])
        result.append({
            "roll_no":      roll_no,
            "display_name": data.get("display_name", roll_no),
            "num_samples":  len([e for e in embs if e is not None]),
        })
    return result
