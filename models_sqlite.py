"""
models_sqlite.py — VisionTrack SQLite Database Layer
4-table SQLite schema: students, subjects, sessions, attendance
"""
import sqlite3
import csv
import os
from datetime import datetime, date
from config import DB_FILE, DATABASE_DIR, EXPORT_DIR


# ── Connection helper ──────────────────────────────────────────────────────────
def get_conn():
    os.makedirs(DATABASE_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_FILE, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


# ── Schema init ────────────────────────────────────────────────────────────────
def init_db():
    """Create all tables if they do not exist."""
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS students (
            roll_no     TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            email       TEXT DEFAULT '',
            course      TEXT DEFAULT '',
            department  TEXT DEFAULT '',
            year        TEXT DEFAULT '',
            academic_year TEXT DEFAULT '',
            enrolled_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS subjects (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            code        TEXT NOT NULL UNIQUE,
            name        TEXT NOT NULL,
            department  TEXT DEFAULT '',
            credits     INTEGER DEFAULT 3,
            classes     TEXT DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_id  INTEGER NOT NULL,
            date        TEXT NOT NULL,
            start_time  TEXT NOT NULL,
            faculty     TEXT DEFAULT '',
            notes       TEXT DEFAULT '',
            department  TEXT DEFAULT '',
            year        TEXT DEFAULT '',
            academic_year TEXT DEFAULT '',
            FOREIGN KEY (subject_id) REFERENCES subjects(id)
        );

        CREATE TABLE IF NOT EXISTS attendance (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            roll_no     TEXT NOT NULL,
            session_id  INTEGER NOT NULL,
            date        TEXT NOT NULL,
            time        TEXT NOT NULL,
            confidence  REAL,
            UNIQUE(roll_no, session_id),
            FOREIGN KEY (roll_no)     REFERENCES students(roll_no),
            FOREIGN KEY (session_id)  REFERENCES sessions(id)
        );

        CREATE TABLE IF NOT EXISTS users (
            username      TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL,
            name          TEXT NOT NULL,
            reference_id  TEXT DEFAULT '',
            subjects      TEXT DEFAULT '[]',
            classes       TEXT DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS sections (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            course        TEXT NOT NULL DEFAULT '',
            department    TEXT NOT NULL,
            year          TEXT NOT NULL,
            academic_year TEXT NOT NULL,
            subjects      TEXT DEFAULT '[]',
            UNIQUE(course, department, year, academic_year)
        );

        CREATE TABLE IF NOT EXISTS departments (
            code          TEXT PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS academic_years (
            code          TEXT PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS courses (
            code            TEXT PRIMARY KEY,
            duration_years  INTEGER DEFAULT 4,
            years_list      TEXT DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS schedules (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            department    TEXT NOT NULL,
            year          TEXT NOT NULL,
            academic_year TEXT NOT NULL,
            subject_id    INTEGER NOT NULL,
            day_of_week   TEXT NOT NULL,
            start_time    TEXT NOT NULL,
            end_time      TEXT NOT NULL,
            classroom     TEXT DEFAULT '',
            specific_date TEXT DEFAULT '',
            FOREIGN KEY (subject_id) REFERENCES subjects(id)
        );

        CREATE TABLE IF NOT EXISTS notices (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            title         TEXT NOT NULL,
            message       TEXT NOT NULL,
            sender_role   TEXT NOT NULL,
            sender_name   TEXT NOT NULL,
            sender_id     TEXT NOT NULL,
            target_type   TEXT NOT NULL DEFAULT 'all',
            target_value  TEXT DEFAULT '',
            priority      TEXT NOT NULL DEFAULT 'normal',
            created_at    TEXT NOT NULL,
            expires_at    TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS notice_reads (
            notice_id     INTEGER NOT NULL,
            student_roll  TEXT NOT NULL,
            read_at       TEXT NOT NULL,
            PRIMARY KEY (notice_id, student_roll),
            FOREIGN KEY (notice_id) REFERENCES notices(id) ON DELETE CASCADE
        );
    """)
    # Safely alter tables for existing databases
    try:
        conn.execute("ALTER TABLE students ADD COLUMN course TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE sessions ADD COLUMN course TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE students ADD COLUMN academic_year TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE sessions ADD COLUMN department TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE sessions ADD COLUMN year TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE sessions ADD COLUMN academic_year TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE subjects ADD COLUMN classes TEXT DEFAULT '[]'")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE schedules ADD COLUMN specific_date TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE schedules ADD COLUMN course TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE schedules ADD COLUMN teacher_username TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE courses ADD COLUMN duration_years INTEGER DEFAULT 4")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE courses ADD COLUMN years_list TEXT DEFAULT '[]'")
    except sqlite3.OperationalError:
        pass

    # Ensure students with PG years are accurately categorized as M.Tech if marked B.Tech or empty
    try:
        conn.execute("UPDATE students SET course = 'M.Tech' WHERE (year LIKE 'PG%' OR year LIKE 'pg%') AND (course = 'B.Tech' OR course = '' OR course IS NULL)")
    except Exception as e:
        print(f"[SQLite] Auto-rectify PG students course: {e}")
    conn.commit()

    # Seed default departments if table is empty
    try:
        count = conn.execute("SELECT COUNT(*) FROM departments").fetchone()[0]
        if count == 0:
            for d in ["AIML", "CSE", "ECE", "EEE"]:
                conn.execute("INSERT INTO departments (code) VALUES (?)", (d,))
            conn.commit()
    except Exception as e:
        print(f"[SQLite] Failed to seed departments: {e}")

    # Seed default academic years if table is empty
    try:
        count = conn.execute("SELECT COUNT(*) FROM academic_years").fetchone()[0]
        if count == 0:
            for ay in ["2024-2025", "2025-2026", "2026-2027"]:
                conn.execute("INSERT INTO academic_years (code) VALUES (?)", (ay,))
            conn.commit()
    except Exception as e:
        print(f"[SQLite] Failed to seed academic years: {e}")

    # Seed default courses with course durations if table is empty
    try:
        default_courses = [
            ("B.Tech", 4, ["1st Year", "2nd Year", "3rd Year", "4th Year"]),
            ("M.Tech", 2, ["PG 1st Year", "PG 2nd Year"]),
        ]
        import json
        for code_val, dur_val, y_list in default_courses:
            conn.execute(
                "INSERT OR IGNORE INTO courses (code, duration_years, years_list) VALUES (?, ?, ?)",
                (code_val, dur_val, json.dumps(y_list))
            )
            # Ensure duration_years is updated if row existed with old default
            conn.execute(
                "UPDATE courses SET duration_years = ?, years_list = ? WHERE code = ? AND (duration_years IS NULL OR years_list = '[]' OR years_list IS NULL)",
                (dur_val, json.dumps(y_list), code_val)
            )
        conn.commit()
    except Exception as e:
        print(f"[SQLite] Failed to seed courses: {e}")

    # Seed default users if 'users' table is empty
    try:
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count == 0:
            from auth import get_password_hash
            conn.execute(
                "INSERT INTO users (username, password_hash, role, name, reference_id) VALUES (?, ?, ?, ?, ?)",
                ("admin", get_password_hash("admin123"), "admin", "System Administrator", "")
            )
            conn.commit()
    except Exception as e:
        print(f"[SQLite] Failed to seed users: {e}")

    # Ensure departments table has core M.Tech departments
    try:
        for d in ["CSE", "AI & ML", "Cyber Security"]:
            conn.execute("INSERT OR IGNORE INTO departments (code) VALUES (?)", (d,))
        conn.commit()
    except Exception as e:
        print(f"[SQLite] Failed to ensure departments: {e}")

    # Seed and map authentic M.Tech subjects for CSE, AI & ML, Cyber Security
    try:
        academic_years = ["2024-2025", "2025-2026", "2026-2027"]
        mtech_curriculum = {
            ("AI & ML", "PG 1st Year"): [
                ("MAI101", "Advanced Deep Learning Architectures", 4),
                ("PG502AI", "High Performance Deep Learning & GPU Computing", 4),
                ("PG503AI", "Advanced Computer Vision & Pattern Recognition", 4),
                ("PG504AI", "Natural Language Understanding & Generative Systems", 4),
            ],
            ("AI & ML", "PG 2nd Year"): [
                ("MAI201", "Research Methodologies in AI/ML", 4),
                ("PG601AI", "Autonomous Systems, Robotics & Control", 4),
                ("PG602AI", "Advanced Neural Information Processing Systems", 3),
                ("PG603AI", "AI Research Methodology, Patents & Dissertation", 3),
            ],
            ("CSE", "PG 1st Year"): [
                ("MCS101", "High-Performance Parallel Computing", 4),
                ("PG501CS", "Advanced Data Structures & Algorithms", 4),
                ("PG502CS", "High Performance Computer Architecture", 4),
                ("PG503CS", "Advanced Operating Systems & Distributed Systems", 4),
            ],
            ("CSE", "PG 2nd Year"): [
                ("MCS201", "Advanced Cloud & Container DevOps", 4),
                ("PG601CS", "Cloud Native Architecture & Microservices", 4),
                ("PG602CS", "Quantum Computing & Cryptography", 3),
                ("PG603CS", "Advanced Research Methodology & IPR", 3),
            ],
            ("Cyber Security", "PG 1st Year"): [
                ("MCY101", "Advanced Cryptography & Network Security", 4),
                ("PG501CY", "Threat Intelligence & Vulnerability Management", 4),
                ("PG502CY", "Cloud & Container Security Architecture", 4),
                ("PG503CY", "Cyber Forensics & Incident Response", 4),
            ],
            ("Cyber Security", "PG 2nd Year"): [
                ("MCY201", "Advanced Malware Analysis & Reverse Engineering", 4),
                ("PG601CY", "Blockchain Security & Zero Trust Architecture", 4),
                ("PG602CY", "Cyber Law, Ethics, Compliance & Risk Management", 3),
                ("PG603CY", "Cyber Security Research Dissertation", 3),
            ],
        }

        for (dept, year), subjects in mtech_curriculum.items():
            subject_codes = [s[0] for s in subjects]
            target_classes = [
                {"dept": dept, "year": year, "academic_year": ay, "course": "M.Tech"}
                for ay in academic_years
            ]
            for code, name, credits in subjects:
                row = conn.execute("SELECT id, classes FROM subjects WHERE code = ?", (code,)).fetchone()
                if row:
                    sub_id, classes_str = row[0], row[1]
                    try:
                        classes = json.loads(classes_str or "[]")
                    except Exception:
                        classes = []
                    for tc in target_classes:
                        if not any(c.get("dept") == tc["dept"] and c.get("year") == tc["year"] and c.get("academic_year") == tc["academic_year"] and c.get("course") == tc["course"] for c in classes):
                            classes.append(tc)
                    conn.execute("UPDATE subjects SET name = ?, department = ?, credits = ?, classes = ? WHERE id = ?",
                                 (name, dept, credits, json.dumps(classes), sub_id))
                else:
                    conn.execute("INSERT INTO subjects (code, name, department, credits, classes) VALUES (?, ?, ?, ?, ?)",
                                 (code, name, dept, credits, json.dumps(target_classes)))

            for ay in academic_years:
                sec_row = conn.execute(
                    "SELECT id, subjects FROM sections WHERE course = ? AND department = ? AND year = ? AND academic_year = ?",
                    ("M.Tech", dept, year, ay)
                ).fetchone()
                if sec_row:
                    sec_id, existing_subs_str = sec_row[0], sec_row[1]
                    try:
                        existing_subs = json.loads(existing_subs_str or "[]")
                    except Exception:
                        existing_subs = []
                    merged_subs = list(dict.fromkeys(existing_subs + subject_codes))
                    conn.execute("UPDATE sections SET subjects = ? WHERE id = ?", (json.dumps(merged_subs), sec_id))
                else:
                    conn.execute(
                        "INSERT INTO sections (course, department, year, academic_year, subjects) VALUES (?, ?, ?, ?, ?)",
                        ("M.Tech", dept, year, ay, json.dumps(subject_codes))
                    )
        conn.commit()
    except Exception as e:
        print(f"[SQLite] Failed to seed M.Tech subjects/sections: {e}")

    conn.commit()
    conn.close()


# ══════════════════════════════════════════════════════════════
# STUDENTS
# ══════════════════════════════════════════════════════════════
def normalize_course(course: str, year: str, department: str = "") -> str:
    """Intelligently normalize course to prevent accidental B.Tech assignment to PG students."""
    c = str(course or "").strip()
    y = str(year or "").strip().lower()
    d = str(department or "").strip()

    if y.startswith("pg"):
        if not c or c == "B.Tech":
            return "M.Tech"
        return c
    
    if not c:
        if d in ["Finance", "Marketing"]:
            return "MBA"
        return "B.Tech"
    return c


def add_student(roll_no, name, email="", department="", year="", academic_year="", course=""):
    course = normalize_course(course, year, department)
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO students (roll_no, name, email, course, department, year, academic_year, enrolled_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (roll_no, name, email, course, department, year, academic_year, datetime.now().isoformat())
        )
        conn.commit()
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

    # Automatically create user login credentials for new student
    try:
        from auth import get_password_hash
        pass_hash = get_password_hash(str(roll_no).strip())
        student_username = str(roll_no).strip().lower()
        add_user(
            username=student_username,
            password_hash=pass_hash,
            role="student",
            name=name.strip(),
            reference_id=str(roll_no).strip()
        )
        clean_name = "".join(e for e in name.lower() if e.isalnum())
        if clean_name and clean_name != student_username:
            add_user(
                username=clean_name,
                password_hash=pass_hash,
                role="student",
                name=name.strip(),
                reference_id=str(roll_no).strip()
            )
    except Exception as e:
        print(f"[Auto Credential Creation] Notice: {e}")

    return True


def update_student(roll_no, name, email="", department="", year="", academic_year="", course=""):
    course = normalize_course(course, year, department)
    conn = get_conn()
    conn.execute(
        "UPDATE students SET name=?, email=?, course=?, department=?, year=?, academic_year=? WHERE roll_no=?",
        (name, email, course, department, year, academic_year, roll_no)
    )
    conn.commit()
    conn.close()


def get_all_students():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM students ORDER BY roll_no ASC"
    ).fetchall()
    conn.close()
    students = [dict(r) for r in rows]
    def _sort_key(s):
        r = str(s.get("roll_no") or "")
        return (0, int(r)) if r.isdigit() else (1, r)
    students.sort(key=_sort_key)
    return students


def get_student(roll_no):
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM students WHERE roll_no=?", (roll_no,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def delete_student_record(roll_no):
    conn = get_conn()
    conn.execute("DELETE FROM attendance WHERE roll_no=?", (roll_no,))
    conn.execute("DELETE FROM students WHERE roll_no=?", (roll_no,))
    conn.commit()
    conn.close()


# ══════════════════════════════════════════════════════════════
# SUBJECTS
# ══════════════════════════════════════════════════════════════
def add_subject(code, name, department="", credits=3, classes=None):
    import json
    classes_str = json.dumps(classes or [])
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO subjects (code, name, department, credits, classes) VALUES (?,?,?,?,?)",
            (code.upper(), name, department, credits, classes_str)
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def get_all_subjects():
    import json
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM subjects ORDER BY code ASC"
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        try:
            d["classes"] = json.loads(d.get("classes") or "[]")
        except Exception:
            d["classes"] = []
        result.append(d)
    result.sort(key=lambda x: str(x.get("code") or "").lower())
    return result


def get_subject(subject_id):
    import json
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM subjects WHERE id=? OR code=?", (subject_id, subject_id)
    ).fetchone()
    conn.close()
    if row:
        d = dict(row)
        try:
            d["classes"] = json.loads(d.get("classes") or "[]")
        except Exception:
            d["classes"] = []
        return d
    return None


def update_subject_mappings(subject_id, classes):
    import json
    conn = get_conn()
    conn.execute(
        "UPDATE subjects SET classes=? WHERE id=? OR code=?",
        (json.dumps(classes), subject_id, subject_id)
    )
    conn.commit()
    conn.close()
    return True


def delete_subject(subject_id):
    conn = get_conn()
    conn.execute(
        "DELETE FROM attendance WHERE session_id IN "
        "(SELECT id FROM sessions WHERE subject_id=?)", (subject_id,)
    )
    conn.execute("DELETE FROM sessions WHERE subject_id=?", (subject_id,))
    conn.execute("DELETE FROM subjects WHERE id=?", (subject_id,))
    conn.commit()
    conn.close()


# ══════════════════════════════════════════════════════════════
# SECTIONS  (Section-to-Subject Mapping)
# ══════════════════════════════════════════════════════════════
def add_section(department, year, academic_year, subjects=None):
    import json
    subjects_str = json.dumps(subjects or [])
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO sections (department, year, academic_year, subjects) VALUES (?,?,?,?)",
            (department, year, academic_year, subjects_str)
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def get_all_sections():
    import json
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM sections ORDER BY department, year, academic_year"
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        try:
            d["subjects"] = json.loads(d.get("subjects") or "[]")
        except Exception:
            d["subjects"] = []
        result.append(d)
    return result


def get_section_by_id(section_id):
    import json
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM sections WHERE id=?", (section_id,)
    ).fetchone()
    conn.close()
    if row:
        d = dict(row)
        try:
            d["subjects"] = json.loads(d.get("subjects") or "[]")
        except Exception:
            d["subjects"] = []
        return d
    return None


def normalize_dept(dept: str) -> str:
    d = (dept or "").strip().upper()
    if d in ("AI/ML", "AIML", "AI-ML", "AI_ML", "ARTIFICIAL INTELLIGENCE"):
        return "AIML"
    if d in ("CSE", "CS", "COMPUTER SCIENCE"):
        return "CSE"
    if d in ("ECE", "EC", "ELECTRONICS"):
        return "ECE"
    if d in ("EEE", "EE", "ELECTRICAL"):
        return "EEE"
    return d


def get_section(department, year, academic_year, course=""):
    import json
    conn = get_conn()
    dept_norm = normalize_dept(department)
    
    variants = [department]
    if dept_norm not in variants:
        variants.append(dept_norm)
        
    row = None
    if course:
        for d in variants:
            row = conn.execute(
                "SELECT * FROM sections WHERE course=? AND department=? AND year=? AND academic_year=?",
                (course, d, year, academic_year)
            ).fetchone()
            if row:
                break
                
    if not row:
        for d in variants:
            row = conn.execute(
                "SELECT * FROM sections WHERE department=? AND year=? AND academic_year=?",
                (d, year, academic_year)
            ).fetchone()
            if row:
                break
            
    if not row:
        for d in variants:
            row = conn.execute(
                "SELECT * FROM sections WHERE department=? AND year=? ORDER BY id DESC LIMIT 1",
                (d, year)
            ).fetchone()
            if row:
                break
                
    conn.close()
    if row:
        d = dict(row)
        try:
            d["subjects"] = json.loads(d.get("subjects") or "[]")
        except Exception:
            d["subjects"] = []
        return d
    return None


def update_section_subjects(section_id, subjects):
    import json
    conn = get_conn()
    conn.execute(
        "UPDATE sections SET subjects=? WHERE id=?",
        (json.dumps(subjects or []), section_id)
    )
    conn.commit()
    conn.close()
    return True


def delete_section(section_id):
    conn = get_conn()
    conn.execute("DELETE FROM sections WHERE id=?", (section_id,))
    conn.commit()
    conn.close()
    return True


def get_subjects_for_class(department, year, academic_year):
    """Return subject codes mapped to the given class/section."""
    sec = get_section(department, year, academic_year)
    return sec["subjects"] if sec else []


# ══════════════════════════════════════════════════════════════
# SESSIONS
# ══════════════════════════════════════════════════════════════
def create_session(subject_id, faculty="", notes="", department="", year="", academic_year="", date_str=None):
    today = date_str if date_str else date.today().isoformat()
    now   = datetime.now().strftime("%H:%M:%S")
    conn  = get_conn()
    cur   = conn.execute(
        "INSERT INTO sessions (subject_id, date, start_time, faculty, notes, department, year, academic_year) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (subject_id, today, now, faculty, notes, department, year, academic_year)
    )
    session_id = cur.lastrowid
    conn.commit()
    conn.close()
    return session_id


def get_all_sessions():
    conn = get_conn()
    rows = conn.execute("""
        SELECT s.*, sub.code, sub.name AS subject_name
        FROM sessions s
        JOIN subjects sub ON s.subject_id = sub.id
        ORDER BY s.date DESC, s.start_time DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_sessions_for_subject(subject_id):
    conn = get_conn()
    rows = conn.execute("""
        SELECT s.*, sub.code, sub.name AS subject_name
        FROM sessions s
        JOIN subjects sub ON s.subject_id = sub.id
        WHERE s.subject_id=?
        ORDER BY s.date DESC, s.start_time DESC
    """, (subject_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def count_sessions(subject_id=None):
    conn = get_conn()
    if subject_id:
        n = conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE subject_id=?", (subject_id,)
        ).fetchone()[0]
    else:
        n = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    conn.close()
    return n


# ══════════════════════════════════════════════════════════════
# ATTENDANCE
# ══════════════════════════════════════════════════════════════
def mark_attendance(roll_no, session_id, confidence=None, date_override=None, force=False):
    import json
    now   = datetime.now().strftime("%H:%M:%S")
    conn  = get_conn()
    try:
        # Check student exists and get details
        student_row = conn.execute("SELECT department, year, academic_year FROM students WHERE roll_no = ?", (roll_no,)).fetchone()
        if not student_row:
            return "student_not_found"
        
        dept = student_row["department"]
        year = student_row["year"]
        ay   = student_row["academic_year"]
        
        # Check session exists and get subject_id and session date
        session_row = conn.execute("SELECT subject_id, date, department, year FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not session_row:
            return "session_not_found"
            
        sub_id = session_row["subject_id"]
        sess_date = date_override or (session_row["date"] if "date" in session_row.keys() and session_row["date"] else date.today().isoformat())
        
        subject_row = conn.execute("SELECT code FROM subjects WHERE id = ?", (sub_id,)).fetchone()
        if not subject_row:
            return "subject_not_found"
            
        sub_code = subject_row["code"]
        
        # Look up mapped subjects for student's section/cohort
        section_row = conn.execute(
            "SELECT id, subjects FROM sections WHERE department = ? AND year = ? AND academic_year = ?",
            (dept, year, ay)
        ).fetchone()
        
        is_allowed = force  # Skip subject mapping check when admin/teacher forces manual attendance
        if not is_allowed and section_row:
            try:
                mapped_subjects = json.loads(section_row["subjects"])
                if sub_code in mapped_subjects:
                    is_allowed = True
            except Exception:
                pass

        if not is_allowed:
            try:
                s_dept = session_row["department"] if "department" in session_row.keys() else ""
                if not s_dept or s_dept == dept:
                    is_allowed = True
            except Exception:
                is_allowed = True

        if not is_allowed:
            return "unmapped_subject"

        conn.execute(
            "INSERT INTO attendance (roll_no, session_id, date, time, confidence) "
            "VALUES (?,?,?,?,?)",
            (roll_no, session_id, sess_date, now, confidence)
        )
        conn.commit()
        return "marked"
    except sqlite3.IntegrityError:
        return "duplicate"
    except Exception as e:
        print(f"[ERROR] mark_attendance: {e}")
        return "error"
    finally:
        conn.close()


def get_session_attendance(session_id):
    conn = get_conn()
    rows = conn.execute("""
        SELECT a.*, st.name, st.department, st.year, st.academic_year
        FROM attendance a
        JOIN students st ON a.roll_no = st.roll_no
        WHERE a.session_id=?
        ORDER BY a.time ASC
    """, (session_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_today_attendance(subject_id=None):
    today = date.today().isoformat()
    conn  = get_conn()
    if subject_id:
        rows = conn.execute("""
            SELECT a.roll_no, st.name, st.department, st.year, st.academic_year,
                   sub.code, sub.name AS subject_name,
                   a.date, a.time, a.confidence, a.session_id
            FROM attendance a
            JOIN students st  ON a.roll_no    = st.roll_no
            JOIN sessions ses ON a.session_id = ses.id
            JOIN subjects sub ON ses.subject_id = sub.id
            WHERE a.date=? AND ses.subject_id=?
            ORDER BY a.time ASC
        """, (today, subject_id)).fetchall()
    else:
        rows = conn.execute("""
            SELECT a.roll_no, st.name, st.department, st.year, st.academic_year,
                   sub.code, sub.name AS subject_name,
                   a.date, a.time, a.confidence, a.session_id
            FROM attendance a
            JOIN students st  ON a.roll_no    = st.roll_no
            JOIN sessions ses ON a.session_id = ses.id
            JOIN subjects sub ON ses.subject_id = sub.id
            WHERE a.date=?
            ORDER BY a.time ASC
        """, (today,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_attendance_by_date(query_date, subject_id=None):
    conn = get_conn()
    if subject_id:
        rows = conn.execute("""
            SELECT a.roll_no, st.name, st.department, st.year, st.academic_year,
                   sub.code, sub.name AS subject_name,
                   a.date, a.time, a.confidence, a.session_id
            FROM attendance a
            JOIN students st  ON a.roll_no    = st.roll_no
            JOIN sessions ses ON a.session_id = ses.id
            JOIN subjects sub ON ses.subject_id = sub.id
            WHERE a.date=? AND ses.subject_id=?
            ORDER BY a.time ASC
        """, (query_date, subject_id)).fetchall()
    else:
        rows = conn.execute("""
            SELECT a.roll_no, st.name, st.department, st.year, st.academic_year,
                   sub.code, sub.name AS subject_name,
                   a.date, a.time, a.confidence, a.session_id
            FROM attendance a
            JOIN students st  ON a.roll_no    = st.roll_no
            JOIN sessions ses ON a.session_id = ses.id
            JOIN subjects sub ON ses.subject_id = sub.id
            WHERE a.date=?
            ORDER BY a.time ASC
        """, (query_date,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_student_history(roll_no):
    conn = get_conn()
    rows = conn.execute("""
        SELECT a.date, a.time, a.confidence, a.session_id,
               sub.code AS subject_code, sub.name AS subject_name
        FROM attendance a
        JOIN sessions ses ON a.session_id = ses.id
        JOIN subjects sub ON ses.subject_id = sub.id
        WHERE a.roll_no=?
        ORDER BY a.date DESC, a.time DESC
    """, (roll_no,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_attendance_summary(subject_id=None):
    """Per-student attendance stats with percentage, accurately scoped to each student's class cohort."""
    conn = get_conn()
    all_sessions = [dict(s) for s in conn.execute("SELECT id, subject_id, department, year, academic_year FROM sessions").fetchall()]

    if subject_id:
        rows = conn.execute("""
            SELECT st.roll_no, st.name, st.department, st.year, st.academic_year,
                   COUNT(a.id) AS days_present
            FROM students st
            LEFT JOIN attendance a  ON st.roll_no = a.roll_no
            LEFT JOIN sessions ses  ON a.session_id = ses.id
                                   AND ses.subject_id = ?
            GROUP BY st.roll_no
            ORDER BY days_present DESC
        """, (subject_id,)).fetchall()
    else:
        rows = conn.execute("""
            SELECT st.roll_no, st.name, st.department, st.year, st.academic_year,
                   COUNT(a.id) AS days_present
            FROM students st
            LEFT JOIN attendance a ON st.roll_no = a.roll_no
            GROUP BY st.roll_no
            ORDER BY days_present DESC
        """).fetchall()

    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        s_dept = d.get("department", "")
        s_year = d.get("year", "")
        
        cohort_sessions = [
            s for s in all_sessions
            if (not subject_id or s.get("subject_id") == subject_id) and
               (not s.get("department") or s.get("department") == s_dept) and
               (not s.get("year") or s.get("year") == s_year)
        ]
        total_for_student = len(cohort_sessions) if cohort_sessions else (len(all_sessions) if not (s_dept or s_year) else 0)
        d["total_sessions"] = total_for_student
        d["pct"] = round((d["days_present"] / total_for_student * 100) if total_for_student > 0 else 0.0, 1)
        result.append(d)
    return result


def get_daily_trend(subject_id):
    """Return list of {'date': 'YYYY-MM-DD', 'count': N} for a subject."""
    conn = get_conn()
    rows = conn.execute("""
        SELECT a.date, COUNT(a.id) as count
        FROM attendance a
        JOIN sessions ses ON a.session_id = ses.id
        WHERE ses.subject_id=?
        GROUP BY a.date
        ORDER BY a.date ASC
    """, (subject_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─── EXPORT ───
def _export_query(conn, from_date=None, to_date=None, subject_id=None):
    q = """
        SELECT st.roll_no, st.name, st.department, st.year, st.academic_year,
               sub.code AS subject_code, sub.name AS subject_name,
               a.date, a.time, ROUND(a.confidence,4) AS confidence
        FROM attendance a
        JOIN students st  ON a.roll_no    = st.roll_no
        JOIN sessions ses ON a.session_id = ses.id
        JOIN subjects sub ON ses.subject_id = sub.id
        WHERE 1=1
    """
    params = []
    if from_date:  q += " AND a.date >= ?"; params.append(from_date)
    if to_date:    q += " AND a.date <= ?"; params.append(to_date)
    if subject_id: q += " AND ses.subject_id = ?"; params.append(subject_id)
    q += " ORDER BY a.date DESC, a.time ASC"
    return conn.execute(q, params).fetchall()


def export_to_csv(output_path=None, from_date=None, to_date=None, subject_id=None):
    os.makedirs(EXPORT_DIR, exist_ok=True)
    if not output_path:
        output_path = os.path.join(EXPORT_DIR, f"attendance_{date.today().isoformat()}.csv")
    conn = get_conn()
    rows = _export_query(conn, from_date, to_date, subject_id)
    conn.close()
    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f)
        # #21 Fix: Added missing 'Academic Year' column header
        writer.writerow(["Roll No", "Name", "Department", "Year", "Academic Year",
                         "Subject Code", "Subject", "Date", "Time", "Confidence"])
        writer.writerows(rows)
    return output_path


def export_to_excel(output_path=None, from_date=None, to_date=None, subject_id=None):
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    os.makedirs(EXPORT_DIR, exist_ok=True)
    if not output_path:
        output_path = os.path.join(EXPORT_DIR, f"attendance_{date.today().isoformat()}.xlsx")

    conn = get_conn()
    rows = _export_query(conn, from_date, to_date, subject_id)
    conn.close()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Attendance"

    # #21 Fix: Added missing 'Academic Year' column header
    headers = ["Roll No", "Name", "Department", "Year", "Academic Year",
               "Subject Code", "Subject", "Date", "Time", "Confidence"]
    hfill = PatternFill(start_color="1E3A5F", end_color="1E3A5F", fill_type="solid")
    hfont = Font(color="FFFFFF", bold=True)
    thin  = Side(style="thin", color="D1D5DB")
    bdr   = Border(left=thin, right=thin, top=thin, bottom=thin)

    for col, h in enumerate(headers, 1):
        c = ws.cell(row=1, column=col, value=h)
        c.fill = hfill; c.font = hfont
        c.alignment = Alignment(horizontal="center")
        c.border = bdr

    for ri, row in enumerate(rows, 2):
        fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid") \
               if ri % 2 == 0 else None
        for ci, val in enumerate(row, 1):
            c = ws.cell(row=ri, column=ci, value=val)
            c.border = bdr
            if fill: c.fill = fill

    # #21 Fix: Added 'Academic Year' column (10 columns total, was 9)
    col_widths = [12, 22, 14, 14, 16, 14, 24, 12, 10, 12]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    wb.save(output_path)
    return output_path


def delete_attendance(roll_no, session_id):
    conn = get_conn()
    cur = conn.execute("DELETE FROM attendance WHERE roll_no=? AND session_id=?", (roll_no, session_id))
    conn.commit()
    deleted = cur.rowcount > 0  # #12 Fix: only True when a row was actually deleted
    conn.close()
    return deleted


def update_attendance(old_roll_no, session_id, new_roll_no, time_str):
    conn = get_conn()
    try:
        # Check if new student exists
        student = conn.execute("SELECT 1 FROM students WHERE roll_no=?", (new_roll_no,)).fetchone()
        if not student:
            return False

        # Check for duplicate if roll number is changing
        if old_roll_no != new_roll_no:
            dup = conn.execute(
                "SELECT 1 FROM attendance WHERE roll_no=? AND session_id=?",
                (new_roll_no, session_id)
            ).fetchone()
            if dup:
                return "duplicate"

        conn.execute(
            "UPDATE attendance SET roll_no = ?, time = ? WHERE roll_no = ? AND session_id = ?",
            (new_roll_no, time_str, old_roll_no, session_id)
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError as e:
        print(f"[SQLite] update_attendance integrity error: {e}")
        return False
    finally:
        conn.close()


# ══════════════════════════════════════════════════════════════
# USERS
# ══════════════════════════════════════════════════════════════
import json

def get_user(username):
    conn = get_conn()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    if row:
        d = dict(row)
        d["subjects"] = json.loads(d["subjects"]) if d.get("subjects") else []
        d["classes"] = json.loads(d["classes"]) if d.get("classes") else []
        return d
    return None

def add_user(username, password_hash, role, name, reference_id="", subjects=None, classes=None):
    conn = get_conn()
    subjects_str = json.dumps(subjects or [])
    classes_str = json.dumps(classes or [])
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, role, name, reference_id, subjects, classes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (username, password_hash, role, name, reference_id, subjects_str, classes_str)
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def update_user(username, data):
    conn = get_conn()
    keys = list(data.keys())
    if not keys:
        conn.close()
        return False
    set_clause = ", ".join([f"{k} = ?" for k in keys])
    params = []
    for k in keys:
        val = data[k]
        if k in ["subjects", "classes"]:
            val = json.dumps(val)
        params.append(val)
    params.append(username)
    conn.execute(f"UPDATE users SET {set_clause} WHERE username = ?", params)
    conn.commit()
    conn.close()
    return True

def delete_user(username):
    conn = get_conn()
    conn.execute("DELETE FROM users WHERE username = ?", (username,))
    conn.commit()
    conn.close()
    return True

def list_teachers():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM users WHERE role = 'teacher' ORDER BY name ASC, username ASC").fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d["subjects"] = json.loads(d["subjects"]) if d.get("subjects") else []
        d["classes"] = json.loads(d["classes"]) if d.get("classes") else []
        result.append(d)
    result.sort(key=lambda x: str(x.get("name") or x.get("username") or "").lower())
    return result

def get_all_departments():
    conn = get_conn()
    rows = conn.execute("SELECT code FROM departments ORDER BY code").fetchall()
    conn.close()
    return [r["code"] for r in rows]

def add_department(code):
    conn = get_conn()
    try:
        conn.execute("INSERT INTO departments (code) VALUES (?)", (code.strip().upper(),))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def delete_department(code):
    conn = get_conn()
    conn.execute("DELETE FROM departments WHERE code=?", (code,))
    conn.commit()
    conn.close()
    return True

def get_all_academic_years():
    conn = get_conn()
    rows = conn.execute("SELECT code FROM academic_years ORDER BY code").fetchall()
    conn.close()
    return [r["code"] for r in rows]

def add_academic_year(code):
    conn = get_conn()
    try:
        conn.execute("INSERT INTO academic_years (code) VALUES (?)", (code.strip(),))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def delete_academic_year(code):
    conn = get_conn()
    conn.execute("DELETE FROM academic_years WHERE code=?", (code,))
    conn.commit()
    conn.close()
    return True

def generate_course_years(duration_years: int = 4, code: str = ""):
    d = max(1, min(10, int(duration_years or 4)))
    c_lower = str(code or "").lower().strip()
    if "m.e" in c_lower or "m.tech" in c_lower or "mtech" in c_lower:
        return [f"PG {i}st Year" if i == 1 else f"PG {i}nd Year" if i == 2 else f"PG {i}rd Year" if i == 3 else f"PG {i}th Year" for i in range(1, d + 1)]
    res = []
    for i in range(1, d + 1):
        if i == 1: res.append("1st Year")
        elif i == 2: res.append("2nd Year")
        elif i == 3: res.append("3rd Year")
        else: res.append(f"{i}th Year")
    return res

def get_all_courses():
    conn = get_conn()
    rows = conn.execute("SELECT code, duration_years, years_list FROM courses ORDER BY code").fetchall()
    conn.close()
    res = []
    import json
    for r in rows:
        c_code = r["code"]
        dur = r["duration_years"] if r["duration_years"] is not None else 4
        try:
            y_list = json.loads(r["years_list"] or "[]")
        except Exception:
            y_list = []
        if not y_list:
            y_list = generate_course_years(dur, c_code)
        res.append({
            "code": c_code,
            "duration_years": dur,
            "years_list": y_list
        })
    return res

def add_course(code, duration_years=4, years_list=None):
    conn = get_conn()
    import json
    code_str = code.strip()
    dur = max(1, min(10, int(duration_years or 4)))
    if not years_list:
        years_list = generate_course_years(dur, code_str)
    try:
        conn.execute(
            "INSERT INTO courses (code, duration_years, years_list) VALUES (?, ?, ?)",
            (code_str, dur, json.dumps(years_list))
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def update_course_duration(code, duration_years, years_list=None):
    conn = get_conn()
    import json
    code_str = code.strip()
    dur = max(1, min(10, int(duration_years or 4)))
    if not years_list:
        years_list = generate_course_years(dur, code_str)
    conn.execute(
        "UPDATE courses SET duration_years = ?, years_list = ? WHERE code = ?",
        (dur, json.dumps(years_list), code_str)
    )
    conn.commit()
    conn.close()
    return True

def delete_course(code):
    conn = get_conn()
    conn.execute("DELETE FROM courses WHERE code=?", (code,))
    conn.commit()
    conn.close()
    return True

def derive_course(dept="", year=""):
    d = (dept or "").strip()
    y = (year or "").strip().lower()
    if y.startswith("pg"):
        return "M.Tech"
    if d in ("Finance", "Marketing"):
        return "MBA"
    if d in ("Web Development", "Mobile App Development", "Data Analytics"):
        return "BCA"
    return "B.Tech"

def parse_time_to_minutes(t_str):
    if not t_str:
        return 0
    s = str(t_str).strip().upper()
    is_pm = "PM" in s
    is_am = "AM" in s
    s = s.replace("AM", "").replace("PM", "").strip()
    parts = s.split(":")
    try:
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        if is_pm and h < 12:
            h += 12
        if is_am and h == 12:
            h = 0
        return h * 60 + m
    except Exception:
        return 0

def get_all_schedules():
    conn = get_conn()
    cursor = conn.execute("""
        SELECT s.*, sub.code as subject_code, sub.name as subject_name
        FROM schedules s
        JOIN subjects sub ON s.subject_id = sub.id
    """)
    rows = cursor.fetchall()
    conn.close()
    res = []
    for r in rows:
        d = dict(r)
        if not d.get("course"):
            d["course"] = derive_course(d.get("department"), d.get("year"))
        res.append(d)
    
    day_order = {'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6, 'Sunday': 7}
    res.sort(key=lambda x: (
        day_order.get(x.get('day_of_week'), 99),
        parse_time_to_minutes(x.get('start_time'))
    ))
    return res

def add_schedule(department, year, academic_year, subject_id, day_of_week, start_time, end_time, classroom="", specific_date="", course="", teacher_username=""):
    conn = get_conn()
    if not course:
        course = derive_course(department, year)
    try:
        conn.execute("""
            INSERT INTO schedules (department, year, academic_year, subject_id, day_of_week, start_time, end_time, classroom, specific_date, course, teacher_username)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (department, year, academic_year, int(subject_id), day_of_week, start_time, end_time, classroom, specific_date, course, teacher_username))
        conn.commit()
        return True
    except Exception as e:
        print(f"[SQLite] Failed to add schedule: {e}")
        return False
    finally:
        conn.close()

def delete_schedule(schedule_id):
    conn = get_conn()
    conn.execute("DELETE FROM schedules WHERE id = ?", (int(schedule_id),))
    conn.commit()
    conn.close()
    return True


# ── Notice Board Management ──────────────────────────────────────────────────
def create_notice(title, message, sender_role, sender_name, sender_id, target_type='all', target_value='', priority='normal', expires_at=''):
    """Create and broadcast a notice from Admin or Faculty."""
    conn = get_conn()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        cursor = conn.execute("""
            INSERT INTO notices (title, message, sender_role, sender_name, sender_id, target_type, target_value, priority, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (title.strip(), message.strip(), sender_role, sender_name, str(sender_id), target_type, str(target_value).strip(), priority, now_str, expires_at))
        conn.commit()
        notice_id = cursor.lastrowid
        return {"id": notice_id, "title": title, "created_at": now_str, "status": "issued"}
    except Exception as e:
        print(f"[SQLite] Failed to create notice: {e}")
        return None
    finally:
        conn.close()


def get_all_notices():
    """Retrieve all notices with read counts for Admin/Faculty."""
    conn = get_conn()
    try:
        cursor = conn.execute("""
            SELECT n.*, COUNT(nr.student_roll) as read_count
            FROM notices n
            LEFT JOIN notice_reads nr ON n.id = nr.notice_id
            GROUP BY n.id
            ORDER BY n.id DESC
        """)
        rows = [dict(r) for r in cursor.fetchall()]
        return rows
    except Exception as e:
        print(f"[SQLite] Failed to get notices: {e}")
        return []
    finally:
        conn.close()


def delete_notice(notice_id):
    """Delete a notice by ID."""
    conn = get_conn()
    try:
        conn.execute("DELETE FROM notice_reads WHERE notice_id = ?", (int(notice_id),))
        conn.execute("DELETE FROM notices WHERE id = ?", (int(notice_id),))
        conn.commit()
        return True
    except Exception as e:
        print(f"[SQLite] Failed to delete notice: {e}")
        return False
    finally:
        conn.close()


def get_student_notices(student_roll):
    """Retrieve notices matching the student's profile (All, Department, Year, Roll) with is_read status."""
    conn = get_conn()
    try:
        # Get student info
        c_student = conn.execute("SELECT * FROM students WHERE roll_no = ?", (str(student_roll),))
        student = c_student.fetchone()
        dept = student["department"] if student and "department" in student.keys() else ""
        year = student["year"] if student and "year" in student.keys() else ""

        cursor = conn.execute("""
            SELECT 
                n.*,
                CASE WHEN nr.student_roll IS NOT NULL THEN 1 ELSE 0 END as is_read,
                nr.read_at
            FROM notices n
            LEFT JOIN notice_reads nr 
                ON n.id = nr.notice_id AND nr.student_roll = ?
            WHERE 
                n.target_type = 'all'
                OR (n.target_type = 'department' AND (LOWER(n.target_value) = LOWER(?) OR n.target_value = ''))
                OR (n.target_type = 'year' AND (LOWER(n.target_value) = LOWER(?) OR n.target_value = ''))
                OR (n.target_type = 'student' AND LOWER(n.target_value) = LOWER(?))
            ORDER BY 
                is_read ASC,
                CASE n.priority
                    WHEN 'urgent' THEN 1
                    WHEN 'important' THEN 2
                    ELSE 3
                END ASC,
                n.id DESC
        """, (str(student_roll), dept, year, str(student_roll)))
        rows = [dict(r) for r in cursor.fetchall()]
        return rows
    except Exception as e:
        print(f"[SQLite] Failed to fetch student notices: {e}")
        return []
    finally:
        conn.close()


def mark_notice_read(notice_id, student_roll):
    """Record that a student has viewed/read a notice."""
    conn = get_conn()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        conn.execute("""
            INSERT OR IGNORE INTO notice_reads (notice_id, student_roll, read_at)
            VALUES (?, ?, ?)
        """, (int(notice_id), str(student_roll), now_str))
        conn.commit()
        return True
    except Exception as e:
        print(f"[SQLite] Failed to mark notice read: {e}")
        return False
    finally:
        conn.close()


def get_student_unread_notice_count(student_roll):
    """Return count of unread notices for this student."""
    notices = get_student_notices(student_roll)
    return sum(1 for n in notices if not n.get("is_read"))


