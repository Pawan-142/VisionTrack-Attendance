"""
reset_data.py — Data Reset Script for VisionTrack Attendance System
Clears all students, attendance logs, sessions, timetables, subjects, and face embeddings.
Re-seeds clean default admin/faculty users and metadata options.
"""
import os
import shutil
import sqlite3
import pickle
from config import BASE_DIR, DATABASE_DIR, FACES_DIR, DB_FILE, FACE_DB_PATH
from auth import get_password_hash

def reset_all_data():
    print("[RESET] Wiping face image files...")
    if os.path.exists(FACES_DIR):
        for item in os.listdir(FACES_DIR):
            item_path = os.path.join(FACES_DIR, item)
            try:
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path)
                else:
                    os.remove(item_path)
            except Exception as e:
                print(f"[RESET] Error deleting {item_path}: {e}")

    print("[RESET] Wiping face embeddings...")
    for ext in ["embeddings.pkl", "face_db.pkl", "face_db.json"]:
        p = os.path.join(DATABASE_DIR, ext)
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception as e:
                print(f"[RESET] Error removing {p}: {e}")

    # Re-initialize empty embeddings dict in embeddings.pkl
    try:
        with open(FACE_DB_PATH, "wb") as f:
            pickle.dump({}, f)
    except Exception as e:
        print(f"[RESET] Error initializing empty embeddings.pkl: {e}")

    print("[RESET] Clearing SQLite database tables...")
    if os.path.exists(DB_FILE):
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        tables = ["attendance", "sessions", "schedules", "sections", "subjects", "students", "users", "departments", "academic_years", "courses"]
        for table in tables:
            try:
                cursor.execute(f"DELETE FROM {table}")
            except Exception as e:
                print(f"[RESET] Table {table} clear warning: {e}")

        try:
            cursor.execute("DELETE FROM sqlite_sequence")
        except Exception:
            pass

        # Seed default Admin user only
        admin_pass = get_password_hash("admin123")
        cursor.execute(
            "INSERT OR REPLACE INTO users (username, password_hash, role, name, reference_id, subjects, classes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("admin", admin_pass, "admin", "System Administrator", "", "[]", "[]")
        )

        # Seed default metadata
        default_depts = ["CSE", "ECE", "EEE", "ME"]
        for d in default_depts:
            cursor.execute("INSERT OR REPLACE INTO departments (code) VALUES (?)", (d,))

        default_ays = ["2025-2026", "2026-2027"]
        for ay in default_ays:
            cursor.execute("INSERT OR REPLACE INTO academic_years (code) VALUES (?)", (ay,))

        default_courses = [
            ("B.Tech", 4, ["1st Year", "2nd Year", "3rd Year", "4th Year"]),
            ("M.Tech", 2, ["PG 1st Year", "PG 2nd Year"]),
            ("BCA", 3, ["1st Year", "2nd Year", "3rd Year"]),
            ("MCA", 2, ["1st Year", "2nd Year"]),
            ("MBA", 2, ["1st Year", "2nd Year"]),
        ]
        import json
        for code_val, dur_val, y_list in default_courses:
            cursor.execute(
                "INSERT OR REPLACE INTO courses (code, duration_years, years_list) VALUES (?, ?, ?)",
                (code_val, dur_val, json.dumps(y_list))
            )

        conn.commit()
        conn.close()

        # Seed Osmania University Curriculum Subjects
        from seed_ou_subjects import seed_osmania_university_curriculum
        seed_osmania_university_curriculum()

        # Seed 10 Faculty Members with Mapped Subjects & Sections
        from seed_10_teachers import seed_10_teachers
        seed_10_teachers()

    print("[RESET] Wiping exported reports...")
    export_dir = os.path.join(BASE_DIR, "exports")
    if os.path.exists(export_dir):
        for item in os.listdir(export_dir):
            item_path = os.path.join(export_dir, item)
            try:
                if os.path.isfile(item_path):
                    os.remove(item_path)
            except Exception:
                pass

    print("[RESET] All data successfully reset!")

if __name__ == "__main__":
    reset_all_data()
