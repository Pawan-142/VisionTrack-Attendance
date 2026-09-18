"""
fastapi_app.py — VisionTrack FastAPI Backend (Full Featured)
"""
import os
import cv2
import time
import threading
import io
import queue
import base64
import shutil
import zipfile
import tempfile
import numpy as np
from contextlib import asynccontextmanager
from datetime import date, timedelta, datetime
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, Request, Response, Query, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import jwt
from auth import verify_password, create_access_token, SECRET_KEY, ALGORITHM, get_password_hash
import pandas as pd
from pdf_generator import create_attendance_pdf
from config import (
    BASE_DIR, COOLDOWN_SEC, ATTENDANCE_THRESHOLD, load_settings, save_settings,
    DATABASE_DIR, FACES_DIR, DB_FILE, FACE_DB_PATH, SETTINGS_FILE, create_auto_backup
)
from recognize import FrameSkipRecognizer, draw_recognition_results, recognize_single_frame, warmup_arcface
from models import (
    get_all_students, get_today_attendance, get_attendance_by_date,
    add_subject, get_all_subjects, delete_subject,
    create_session, get_all_sessions,
    add_student, update_student, delete_student_record,
    mark_attendance, get_student_history, get_attendance_summary,
    get_daily_trend, export_to_excel, export_to_csv,
)
from enroll import enroll_student
from config import COOLDOWN_SEC, ATTENDANCE_THRESHOLD

# ── #15 Fix: Initialise DB and warn about defaults on startup ──────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    from models import init_db
    init_db()
    create_auto_backup()
    import warnings
    warnings.warn(
        "[Security] Default seeded credentials (admin/admin123, faculty1/faculty123, "
        "2024CS01/student123) exist on a fresh install. Change them before going live!",
        UserWarning, stacklevel=1,
    )
    # Warm up ArcFace in a background thread after uvicorn is ready
    warmup_arcface()
    yield

app = FastAPI(lifespan=lifespan)

# ── #4 Fix: Restrict CORS to known frontend origins (never combine * + credentials) ──
# Add extra origins via the CORS_ORIGINS env var (comma-separated).
_default_origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
    "https://vision-track-attendance.vercel.app",
]
_extra_origins = [
    o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_default_origins + _extra_origins,
    allow_origin_regex=r"^https:\/\/.*\.vercel\.app$|^https?:\/\/localhost(:\d+)?$|^https?:\/\/127\.0\.0\.1(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith(".html") or path.endswith(".js") or path.endswith(".css") or path.startswith("/api/") or path.startswith("/assets/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Adapter so enroll.py can stream frames to the React browser
class FrameQueue:
    """Acts like a Streamlit stframe but puts JPEG bytes into a queue."""
    def __init__(self):
        self.q = queue.Queue(maxsize=4)
        self.done = False
        self._last_error = None

    def image(self, frame_bgr):
        try:
            import numpy as np
            frame_bgr = np.array(frame_bgr)
            ret, buf = cv2.imencode('.jpg', frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if ret:
                try:
                    self.q.put_nowait(buf.tobytes())
                except queue.Full:
                    try: self.q.get_nowait()
                    except: pass
                    try: self.q.put_nowait(buf.tobytes())
                    except: pass
        except Exception as ex:
            print(f"[FrameQueue] {ex}")

    def error(self, msg):
        self._last_error = msg

    def empty(self):
        pass

    def close(self):
        self.done = True

from face_db import load_face_db, delete_face_entry

# ── Pydantic Models ────────────────────────────────────────────
class ClientFrameModel(BaseModel):
    image: str
    session_id: Optional[Any] = None
    threshold: Optional[float] = None
    anti_spoofing: Optional[bool] = True

class SettingsUpdateModel(BaseModel):
    threshold: Optional[float] = None
    frame_skip: Optional[int] = None
    cooldown_sec: Optional[int] = None
    anti_spoofing: Optional[bool] = None
    liveness_strictness: Optional[str] = None
    camera_mode: Optional[str] = None
    attendance_threshold: Optional[int] = None
    college_name: Optional[str] = None
    sound_enabled: Optional[bool] = None
    email_alerts_enabled: Optional[bool] = None

class DefaulterNoticeRequest(BaseModel):
    roll_no: str
    message: Optional[str] = None
    notify_parent: Optional[bool] = True

class SubjectModel(BaseModel):
    code: str
    name: str
    dept: str

class SubjectMappingsModel(BaseModel):
    classes: list[dict] = []

class EnrollModel(BaseModel):
    roll_no: str
    name: str
    email: str = ""
    course: str = ""
    dept: str = ""
    year: str = ""
    academic_year: str = ""
    force: bool = False

class ClientEnrollModel(BaseModel):
    roll_no: str
    name: str
    email: str = ""
    course: str = ""
    dept: str = ""
    year: str = ""
    academic_year: str = ""
    force: bool = False
    images: List[str] = []

class UpdateStudentModel(BaseModel):
    name: str
    email: str = ""
    course: str = ""
    dept: str = ""
    department: str = ""
    year: str = ""
    academic_year: str = ""

class SessionModel(BaseModel):
    subject_id: Any
    faculty: str = ""
    course: str = ""
    department: str = ""
    year: str = ""
    academic_year: str = ""
    date: Optional[str] = None

class LoginRequest(BaseModel):
    username: str
    password: str


class ManualAttendanceModel(BaseModel):
    roll_no: str
    session_id: Any
    date: Optional[str] = None

class UpdateAttendanceModel(BaseModel):
    new_roll_no: str
    time: str

class TeacherModel(BaseModel):
    username: str
    password: Optional[str] = ""
    name: str

class ClassMappingModel(BaseModel):
    dept: str
    year: str
    academic_year: str

class TeacherMappingsModel(BaseModel):
    subjects: List[str]
    classes: List[ClassMappingModel]

class UpdateTeacherModel(BaseModel):
    name: str
    password: Optional[str] = None

class ChangePasswordModel(BaseModel):
    old_password: str
    new_password: str

class SectionModel(BaseModel):
    department: str
    year: str
    academic_year: str
    subjects: List[str] = []

class SectionSubjectsModel(BaseModel):
    subjects: List[str] = []

class NoticeCreateModel(BaseModel):
    title: str
    message: str
    target_type: str = "all"
    target_value: str = ""
    priority: str = "normal"
    expires_at: Optional[str] = ""

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if "sub" not in payload or "role" not in payload:
            raise HTTPException(status_code=401, detail="Invalid token")
        return payload
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ── Thread-safe State ──────────────────────────────────────────
_lock = threading.Lock()
_state = {
    "cam": None,
    "db": load_face_db(),
    "recognizer": FrameSkipRecognizer(),
    "last_marked": {},
    "active_session_id": None,
    "enrollment_fq": None,   # active FrameQueue during enrollment
}

# ── #7 Fix: Thread-safe enroll result ──────────────────────────
_enroll_lock = threading.Lock()
_enroll_result: dict = {"status": "idle", "message": ""}

def _get(key):
    with _lock:
        return _state[key]

def _set(key, val):
    with _lock:
        _state[key] = val

# ── #16 Fix: Shared teacher-filter utility ─────────────────────────────────────
def _filter_by_teacher(items, mapped_subjects, mapped_classes, include_subjects=True):
    """
    Filter a list of student/attendance records by a teacher's assigned
    classes and subjects. Returns empty list when both are empty for a teacher.
    """
    if not mapped_subjects and not mapped_classes:
        return []

    mapped_subs_str = [str(x).strip().lower() for x in mapped_subjects] if mapped_subjects else []

    filtered = []
    for item in items:
        # ─ class-level filter ──────────────────────────────────
        student_ok = True
        if mapped_classes:
            student_ok = False
            for c in mapped_classes:
                dept_match = (item.get("department") or "").strip().lower() == (c.get("dept") or "").strip().lower()
                year_match = (item.get("year") or "").strip().lower() == (c.get("year") or "").strip().lower()
                ay_match = True
                if c.get("academic_year") and item.get("academic_year"):
                    ay_match = item.get("academic_year").strip().lower() == c.get("academic_year").strip().lower()
                if dept_match and year_match and ay_match:
                    student_ok = True
                    break

        # ─ subject-level filter ───────────────────────────────
        subject_ok = True
        if include_subjects and mapped_subs_str:
            sid = str(item.get("subject_id") or "").strip().lower()
            scode = str(item.get("subject_code") or item.get("code") or "").strip().lower()
            subject_ok = (sid in mapped_subs_str) or (scode in mapped_subs_str)

        if student_ok and subject_ok:
            filtered.append(item)

    return filtered

# ── Camera Stream ──────────────────────────────────────────────
def generate_frames():
    with _lock:
        session_id = _state["active_session_id"]
        if session_id is None:
            return  # No active session, exit immediately without opening camera!

        if _state["cam"] is None or not _state["cam"].isOpened():
            cam = cv2.VideoCapture(0, cv2.CAP_DSHOW)
            cam.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cam.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            _state["cam"] = cam
        cam = _state["cam"]

    # Fetch active session details to enforce class isolation
    from models import get_all_sessions, get_student
    all_sessions = get_all_sessions()
    current_session = next((s for s in all_sessions if str(s["id"]) == str(session_id)), None)
    
    session_dept = current_session.get("department", "") if current_session else ""
    session_year = current_session.get("year", "") if current_session else ""
    session_ay = current_session.get("academic_year", "") if current_session else ""

    try:
        startup_frames_count = 0
        while True:
            with _lock:
                session_id = _state["active_session_id"]
                cam = _state["cam"]
                if session_id is None or cam is None or not cam.isOpened():
                    break  # Session stopped or camera closed, exit the loop!

            # Read frame outside the lock so other requests (like stopping session) are not blocked
            success, frame = cam.read()

            if not success or frame is None:
                time.sleep(0.05)
                continue

            # Keep track of frame count to allow initial fast yields
            startup_frames_count += 1

            # Prevent browser timeout: Yield first 5 frames instantly (raw) while camera adjusts
            # and to send HTTP headers before DeepFace blocks for 10-15s loading RetinaFace.
            if startup_frames_count <= 5:
                cv2.putText(frame, "Loading AI Models...", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
                ret, buffer = cv2.imencode('.jpg', frame)
                if ret:
                    yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
                continue

            with _lock:
                db = _state["db"]
                recognizer = _state["recognizer"]
                last_marked = dict(_state["last_marked"])

            # Run face recognition outside the lock
            results = recognizer.process(frame, db)
            now = time.time()
            marked_update = []

            for r in results:
                roll_no = r.get("roll_no")
                if roll_no and r.get("is_real", True):
                    # Check if student belongs to the mapped class cohort
                    student_doc = get_student(roll_no)
                    is_mapped_class = True
                    if student_doc:
                        r["student_course"] = student_doc.get("course", "")
                        r["student_dept"]   = student_doc.get("department", "")
                        r["student_year"]   = student_doc.get("year", "")
                        if session_course or session_dept or session_year or session_ay:
                            course_match = not session_course or (bool(student_doc.get("course")) and student_doc.get("course") == session_course)
                            dept_match   = not session_dept   or student_doc.get("department") == session_dept
                            year_match   = not session_year   or student_doc.get("year") == session_year
                            ay_match     = not session_ay     or student_doc.get("academic_year") == session_ay
                            if not (course_match and dept_match and year_match and ay_match):
                                is_mapped_class = False

                    last_time, last_status = last_marked.get(roll_no, (0, ""))
                    if not is_mapped_class:
                        r["status"] = "wrong_class"
                    elif now - last_time < COOLDOWN_SEC:
                        if last_status == "marked" and (now - last_time < 3.0):
                            r["status"] = "marked"
                        elif last_status == "marked":
                            r["status"] = "cooldown"
                        else:
                            r["status"] = last_status  # keeps "duplicate" as duplicate
                    else:
                        # Database write outside the lock
                        result = mark_attendance(
                            roll_no=roll_no,
                            session_id=session_id,
                            confidence=r.get("distance"),
                        )
                        print(f"[ATTENDANCE] {roll_no} -> {result}")
                        r["status"] = result
                        marked_update.append((roll_no, now, result))

            # Apply any state updates under the lock
            if marked_update:
                with _lock:
                    for roll_no, t, res in marked_update:
                        _state["last_marked"][roll_no] = (t, res)

            frame = draw_recognition_results(frame, results)

            ret, buffer = cv2.imencode('.jpg', frame)
            if not ret:
                continue
            yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n'
                   + buffer.tobytes() + b'\r\n')
    except Exception as e:
        print(f"[generate_frames] Exception: {e}")
    finally:
        with _lock:
            cam = _state["cam"]
            session_id = _state["active_session_id"]
            if session_id is None and cam is not None:
                if cam.isOpened():
                    cam.release()
                    print("[Camera] Hardware released via stream disconnect.")
                _state["cam"] = None

# ── Endpoints ──────────────────────────────────────────────────

@app.get("/api/status")
def read_root():
    return {
        "status": "online",
        "name": "VisionTrack Attendance System API",
        "documentation": "http://localhost:8000/docs",
        "public_url": "https://lasting-assuming-signals-integrated.trycloudflare.com",
        "local_url": "http://127.0.0.1:8000"
    }

@app.get("/api/system/public-url")
def get_public_tunnel_url():
    return {
        "public_url": "https://lasting-assuming-signals-integrated.trycloudflare.com",
        "local_url": "http://127.0.0.1:8000"
    }

@app.post("/api/auth/login")
def login(req: LoginRequest):
    from models import get_user
    username_clean = req.username.strip()
    user_doc = get_user(username_clean)
    if not user_doc:
        user_doc = get_user(username_clean.lower())
        if not user_doc:
            user_doc = get_user(username_clean.upper())
            
    if not user_doc:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    entered_pwd = req.password.strip()
    pwd_hash = user_doc.get('password_hash', '')
    
    # Check valid password hash
    is_valid = verify_password(entered_pwd, pwd_hash)
    
    # Fallback to default username/roll_no or password123
    if not is_valid:
        u_name = str(user_doc.get("username", "")).strip()
        if entered_pwd == u_name or entered_pwd.lower() == u_name.lower() or (user_doc.get("role") == "teacher" and entered_pwd == "password123"):
            is_valid = True
            
    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid username or password")
        
    token_data = {
        "sub": user_doc["username"],
        "role": user_doc["role"],
        "name": user_doc.get("name", ""),
        "reference_id": user_doc.get("reference_id", "")
    }
    access_token = create_access_token(data=token_data)
    return {"status": "ok", "access_token": access_token, "user": token_data}

@app.post("/api/auth/change-password")
def change_password(data: ChangePasswordModel, user: dict = Depends(get_current_user)):
    username = user.get("sub")
    from models import get_user, update_user
    u = get_user(username)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(data.old_password, u.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if not data.new_password or len(data.new_password.strip()) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters")
    
    new_hash = get_password_hash(data.new_password.strip())
    update_user(username, {"password_hash": new_hash})
    return {"status": "ok", "message": "Password updated successfully!"}

@app.get("/video_feed")
def video_feed():
    return StreamingResponse(generate_frames(),
                             media_type="multipart/x-mixed-replace; boundary=frame")

@app.get("/enrollment_feed")
def enrollment_feed():
    """Streams enrollment frames; waits up to 8s for enrollment to begin."""
    def gen():
        # Wait for the enrollment thread to open the camera and set fq
        fq = None
        for _ in range(80):   # 80 x 0.1s = 8 seconds max wait
            fq = _get("enrollment_fq")
            if fq is not None:
                break
            time.sleep(0.1)

        if fq is None:
            return  # enrollment never started

        while True:
            try:
                jpg = fq.q.get(timeout=0.5)
                yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n'
                       + jpg + b'\r\n')
            except queue.Empty:
                if fq.done:
                    break
    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.get("/api/stats")
def get_stats(session_id: str = None, user: dict = Depends(get_current_user)):
    from collections import defaultdict
    from datetime import datetime

    students      = get_all_students()
    today_records = get_today_attendance()
    
    if session_id:
        today_records = [r for r in today_records if str(r.get("session_id")) == str(session_id)]
    
    student_analytics = None

    # Filter for teacher role mappings
    if user.get("role") == "teacher":
        from models import get_user
        td = get_user(user.get("sub"))
        if td:
            mapped_subjects = td.get("subjects", [])
            mapped_classes  = td.get("classes", [])

            # #16 Fix: use shared utility instead of inline loops
            students      = _filter_by_teacher(students,      mapped_subjects, mapped_classes, include_subjects=False)
            today_records = _filter_by_teacher(today_records, mapped_subjects, mapped_classes)

    # Filter for student role
    if user.get("role") == "student":
        roll_no = user.get("reference_id")
        today_records = [r for r in today_records if r.get("roll_no") == roll_no]
        students = [s for s in students if s.get("roll_no") == roll_no]
        
        # Calculate deep analytics for the student
        all_sessions = get_all_sessions()
        attended_logs = get_student_history(roll_no)
        attended_session_ids = {log.get("session_id") for log in attended_logs}
        
        # Get student info to filter cohort sessions
        from models import get_student as _get_student
        _student = _get_student(roll_no)
        _dept = _student.get("department", "") if _student else ""
        _year = _student.get("year", "") if _student else ""
        _ay   = _student.get("academic_year", "") if _student else ""
        
        # Only count sessions belonging to the student's cohort
        cohort_sessions = [
            s for s in all_sessions
            if s.get("department") == _dept
            and s.get("year") == _year
            and s.get("academic_year") == _ay
        ]
        
        missed_sessions_raw = [s for s in cohort_sessions if s.get("id") not in attended_session_ids]
        
        # Deduplicate by (date, subject_id) and count sessions
        unique_missed = {}
        for s in missed_sessions_raw:
            key = (s.get("date"), s.get("subject_id"))
            if key not in unique_missed:
                s_copy = dict(s)
                s_copy["count"] = 1
                unique_missed[key] = s_copy
            else:
                unique_missed[key]["count"] += 1
        missed_sessions = list(unique_missed.values())
        
        months = defaultdict(lambda: {"attended": 0, "missed": 0})
        
        for log in attended_logs:
            date_str = log.get("date", "")
            if date_str:
                try:
                    month_name = datetime.strptime(date_str, "%Y-%m-%d").strftime("%b %Y")
                    months[month_name]["attended"] += 1
                except ValueError:
                    pass
                    
        for s in missed_sessions:
            date_str = s.get("date", "")
            if date_str:
                try:
                    month_name = datetime.strptime(date_str, "%Y-%m-%d").strftime("%b %Y")
                    months[month_name]["missed"] += 1
                except ValueError:
                    pass
                    
        def sort_key(m_str):
            try:
                return datetime.strptime(m_str, "%b %Y")
            except:
                return datetime.min
                
        monthly_trend = [{"month": k, "attended": v["attended"], "missed": v["missed"]} 
                         for k, v in sorted(months.items(), key=lambda x: sort_key(x[0]))]
        
        # total_sessions: use cohort sessions count, but ensure it's never less
        # than attended count (prevents -1 when student attended a mismatched-ay session)
        effective_total = max(len(cohort_sessions), len(attended_logs))
        
        # Determine today's class status for accurate "Today's Status" display
        today_str = datetime.now().strftime("%Y-%m-%d")
        # Sessions run today for the student's cohort (also include same dept+year sessions
        # to handle ay mismatch cases from facial recognition)
        today_sessions = [
            s for s in all_sessions
            if s.get("date") == today_str
            and s.get("department") == _dept
            and s.get("year") == _year
        ]
        has_session_today = len(today_sessions) > 0
        is_present_today = any(s["id"] in attended_session_ids for s in today_sessions)
        
        student_analytics = {
            "total_sessions": effective_total,
            "total_attended": len(attended_logs),
            "missed_sessions": missed_sessions,
            "monthly_trend": monthly_trend[-6:],
            "has_session_today": has_session_today,
            "is_present_today": is_present_today,
        }

    total   = len(students)
    present = len({r.get("roll_no") for r in today_records if r.get("roll_no")})
    absent  = max(0, total - present)
    sorted_records = sorted(today_records, key=lambda x: x.get("time", ""), reverse=True)
    feed = [{"name": r.get("name", r.get("roll_no", "Unknown")),
             "time": r.get("time", ""),
             "status": "Present"}
            for r in sorted_records[:5]]
    teacher_classes = []
    if user.get("role") == "teacher":
        from models import get_user
        td = get_user(user.get("sub"))
        if td:
            teacher_classes = td.get("classes", [])

    return {
        "total": total, "present": present, "absent": absent,
        "feed": feed, "students": students, "logs": sorted_records,
        "student_analytics": student_analytics,
        "teacher_classes": teacher_classes
    }

# Students
@app.get("/api/students/{roll_no}")
def get_student_endpoint(roll_no: str, user: dict = Depends(get_current_user)):
    if user.get("role") == "student" and user.get("reference_id") != roll_no:
        raise HTTPException(status_code=403, detail="Access denied")
    from models import get_student
    st = get_student(roll_no)
    if not st:
        raise HTTPException(status_code=404, detail="Student not found")
    return st

# #5 Fix: Added auth guards (admin/teacher only) to student edit & delete
@app.put("/api/students/{roll_no}")
def edit_student(roll_no: str, data: UpdateStudentModel, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    dept = data.department.strip() if data.department and data.department.strip() else data.dept.strip()
    course = data.course.strip() if data.course else ""
    update_student(roll_no, data.name, data.email,
                   department=dept, year=data.year, academic_year=data.academic_year, course=course)
    return {"status": "ok"}

@app.delete("/api/students/{roll_no}")
def delete_student_endpoint(roll_no: str, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    delete_student_record(roll_no)
    delete_face_entry(roll_no)
    try:
        from models import delete_user
        delete_user(roll_no.strip().lower())
    except Exception as e:
        print(f"[Delete Student API] Error deleting student credentials: {e}")
    with _lock:
        _state["db"] = load_face_db()
    return {"status": "ok"}

# #6 Fix: Added auth guard to student history — students see only their own
@app.get("/api/students/{roll_no}/history")
def student_history(roll_no: str, user: dict = Depends(get_current_user)):
    if user.get("role") == "student" and user.get("reference_id") != roll_no:
        raise HTTPException(status_code=403, detail="Access denied")
    return get_student_history(roll_no)

@app.get("/api/subjects")
def list_subjects(user: dict = Depends(get_current_user)):
    subjects = get_all_subjects()
    if user.get("role") == "teacher":
        from models import get_user
        d = get_user(user.get("sub"))
        mapped_subjects = d.get("subjects", []) if d else []
        subjects = [s for s in subjects if s.get("code") in mapped_subjects or str(s.get("id")) in [str(x) for x in mapped_subjects]]
    return subjects

# #6 Fix: Only admin can add/delete subjects
@app.post("/api/subjects")
def add_new_subject(sub: SubjectModel, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    ok = add_subject(sub.code, sub.name, sub.dept)
    if not ok:
        return {"status": "duplicate", "message": f"Subject code '{sub.code}' already exists"}
    return {"status": "ok"}

@app.delete("/api/subjects/{subject_id}")
def delete_subject_endpoint(subject_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    delete_subject(subject_id)
    return {"status": "ok"}

@app.get("/api/subjects/{subject_id}/mappings")
def get_subject_mappings_endpoint(subject_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import get_subject
    sub = get_subject(subject_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subject not found")
    return {"classes": sub.get("classes", [])}

@app.post("/api/subjects/{subject_id}/mappings")
def save_subject_mappings_endpoint(subject_id: str, data: SubjectMappingsModel, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import get_subject, update_subject_mappings
    if not get_subject(subject_id):
        raise HTTPException(status_code=404, detail="Subject not found")
    update_subject_mappings(subject_id, data.classes)
    return {"status": "ok"}

# Sessions
@app.get("/api/sessions")
def list_sessions(user: dict = Depends(get_current_user)):
    sessions = get_all_sessions()
    if user.get("role") == "teacher":
        from models import get_user
        d = get_user(user.get("sub"))
        mapped_subjects = [str(x).strip().lower() for x in (d.get("subjects", []) if d else [])]
        mapped_classes  = d.get("classes", []) if d else []
        faculty_name = (d.get("name", "") if d else "").strip().lower()
        filtered_sessions = []
        for s in sessions:
            sess_faculty = (s.get("faculty") or "").strip().lower()
            if faculty_name and (faculty_name in sess_faculty or sess_faculty in faculty_name):
                filtered_sessions.append(s)
                continue
            if str(s.get("subject_id", "")).strip().lower() in mapped_subjects:
                filtered_sessions.append(s)
                continue
            for c in mapped_classes:
                if (s.get("department") or "").strip().lower() == (c.get("dept") or "").strip().lower() and \
                   (s.get("year") or "").strip().lower() == (c.get("year") or "").strip().lower():
                    if not c.get("academic_year") or (s.get("academic_year") or "").strip().lower() == c.get("academic_year").strip().lower():
                        filtered_sessions.append(s)
                        break
        return filtered_sessions
    return sessions

@app.post("/api/session/start")
def start_session(sess: SessionModel, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    if user.get("role") == "teacher":
        from models import get_user
        d = get_user(user.get("sub"))
        mapped_subjects = [str(x).strip().lower() for x in (d.get("subjects", []) if d else [])]
        
        # Check if the requested subject_id matches the teacher's mapped subjects
        from models import get_all_subjects
        subjects = get_all_subjects()
        selected_sub = next((s for s in subjects if str(s["id"]).strip().lower() == str(sess.subject_id).strip().lower() or s["code"].strip().lower() == str(sess.subject_id).strip().lower()), None)
        if not selected_sub:
            raise HTTPException(status_code=404, detail="Subject not found")
        if (selected_sub["code"].strip().lower() not in mapped_subjects) and (str(selected_sub["id"]).strip().lower() not in mapped_subjects):
            raise HTTPException(status_code=403, detail="You are not mapped to this subject")

    with _lock:
        _state["db"] = load_face_db()
        _state["last_marked"] = {}
    sid = create_session(
        subject_id=sess.subject_id,
        faculty=sess.faculty,
        department=sess.department,
        year=sess.year,
        academic_year=sess.academic_year,
        date_str=sess.date
    )
    _set("active_session_id", sid)
    print(f"[SESSION] Started: {sid}")
    return {"status": "ok", "session_id": sid}

@app.post("/api/session/stop")
def stop_session():
    _set("active_session_id", None)
    time.sleep(0.2)
    with _lock:
        cam = _state["cam"]
        if cam is not None and cam.isOpened():
            cam.release()
            print("[Camera] Hardware released by stop_session.")
        _state["cam"] = None
        _state["last_marked"] = {}
    return {"status": "ok"}

@app.get("/api/session/status")
def session_status(user: dict = Depends(get_current_user)):
    sid = _get("active_session_id")
    if not sid:
        return {"active": False, "session_id": None}
    
    # If teacher is querying status: only report active if it's this teacher's session or mapped class
    if user.get("role") == "teacher":
        from models import get_all_sessions, get_user
        all_s = get_all_sessions()
        active_sess = next((s for s in all_s if s.get("id") == sid), None)
        if active_sess:
            td = get_user(user.get("sub"))
            if td:
                mapped_subjects = [str(x).strip().lower() for x in td.get("subjects", [])]
                mapped_classes  = td.get("classes", [])
                faculty_name = (td.get("name") or "").strip().lower()
                sess_faculty = (active_sess.get("faculty") or "").strip().lower()
                
                is_mine = False
                if faculty_name and (faculty_name in sess_faculty or sess_faculty in faculty_name):
                    is_mine = True
                elif str(active_sess.get("subject_id", "")).strip().lower() in mapped_subjects:
                    is_mine = True
                else:
                    for c in mapped_classes:
                        if (active_sess.get("department") or "").strip().lower() == (c.get("dept") or "").strip().lower() and \
                           (active_sess.get("year") or "").strip().lower() == (c.get("year") or "").strip().lower():
                            if not c.get("academic_year") or (active_sess.get("academic_year") or "").strip().lower() == c.get("academic_year").strip().lower():
                                is_mine = True
                                break
                if not is_mine:
                    return {"active": False, "session_id": None, "other_faculty_active": True}
    return {"active": True, "session_id": sid}

# Logs (with date + subject filter)
@app.get("/api/logs")
def get_logs(
    log_date: Optional[str] = Query(None),
    subject_id: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    if log_date:
        records = get_attendance_by_date(log_date, subject_id)
    else:
        records = get_today_attendance(subject_id)
        
    if user.get("role") == "student":
        roll_no = user.get("reference_id")
        records = [r for r in records if r.get("roll_no") == roll_no]

    if user.get("role") == "teacher":
        # #13 Fix: use get_user() (works with SQLite *and* Firebase) instead of get_db() directly
        from models import get_user
        td = get_user(user.get("sub"))
        if td:
            mapped_subjects = td.get("subjects", [])
            mapped_classes  = td.get("classes", [])
            # #16 Fix: use shared filter utility
            records = _filter_by_teacher(records, mapped_subjects, mapped_classes)
        
    return sorted(records, key=lambda x: x.get("time", ""), reverse=True)

# Analytics
@app.get("/api/analytics")
def get_analytics(user: dict = Depends(get_current_user)):
    summary = get_attendance_summary()
    subjects = get_all_subjects()
    
    mapped_subjects = []
    mapped_classes = []
    is_teacher = user.get("role") == "teacher"
    
    if is_teacher:
        # #13 Fix: use get_user() instead of calling Firebase get_db() directly
        from models import get_user
        td = get_user(user.get("sub"))
        if td:
            mapped_subjects = td.get("subjects", [])
            mapped_classes  = td.get("classes", [])
            
    if is_teacher:
        if not mapped_subjects and not mapped_classes:
            summary = []
            subjects = []
        else:
            if mapped_subjects:
                subjects = [s for s in subjects if s.get("code") in mapped_subjects or s.get("id") in mapped_subjects]
            summary = _filter_by_teacher(summary, mapped_subjects, mapped_classes, include_subjects=False)
            
    alerts  = [s for s in summary if s["pct"] < ATTENDANCE_THRESHOLD and s["total_sessions"] > 0]
    
    # Build daily trend for last 14 days using all attendance
    today = date.today()
    trend = []
    for i in range(13, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        recs = get_attendance_by_date(d)
        if is_teacher:
            # #16 Fix: reuse shared utility instead of inline loop
            recs = _filter_by_teacher(recs, mapped_subjects, mapped_classes)
        trend.append({"date": d[-5:], "count": len(recs)})  # MM-DD format

    return {
        "summary": summary,
        "alerts": alerts,
        "trend": trend,
        "subject_count": len(subjects),
    }

# Enrollment — runs in background so /enrollment_feed streams in parallel
# _enroll_result/_enroll_lock declared near top of file (thread-safe)

def _set_enroll_result(status: str, message: str = ""):
    """Thread-safe writer for the enrollment result dict."""
    with _enroll_lock:
        _enroll_result["status"]  = status
        _enroll_result["message"] = message

@app.post("/api/enroll")
def enroll_student_api(data: EnrollModel, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can enroll students")
    # Early duplicate check for roll number
    from models import get_student
    if not data.force and get_student(data.roll_no):
        _set_enroll_result("exists", f"Roll No '{data.roll_no}' is already registered. Select 'Overwrite existing' to proceed.")  # #7
        return {"status": "started"}
        
    # Release live-session camera first
    with _lock:
        cam = _state["cam"]
        if cam is not None and cam.isOpened():
            cam.release()
            time.sleep(1.0)  # Give Windows hardware a second to fully release
        _state["cam"] = None

    fq = FrameQueue()
    _set("enrollment_fq", fq)
    _set_enroll_result("running")  # #7 Fix: thread-safe write

    def _run():
        res = enroll_student(data.name, data.roll_no, force=data.force, stframe=fq)
        fq.close()
        _set("enrollment_fq", None)
        with _lock:
            _state["db"] = load_face_db()
        if res is True:
            _set_enroll_result("success")  # #7 Fix: thread-safe write
            try:
                from models import get_student, add_user
                if get_student(data.roll_no):
                    update_student(data.roll_no, data.name, data.email,
                                   department=data.dept, year=data.year, academic_year=data.academic_year, course=data.course)
                else:
                    add_student(data.roll_no, data.name, data.email, data.dept, data.year, data.academic_year, course=data.course)

                student_username = data.roll_no.strip().lower()
                add_user(
                    username=student_username,
                    password_hash=get_password_hash(data.roll_no.strip()),
                    role="student",
                    name=data.name.strip(),
                    reference_id=data.roll_no.strip()
                )
            except Exception as e:
                print(f"[Enroll API] Error creating student credentials: {e}")
        elif res == "exists" or res == "face_exists":
            msg = getattr(fq, '_last_error', None) or "Student already enrolled. Enable Overwrite."
            _set_enroll_result("exists", msg)  # #7
        else:
            msg = getattr(fq, '_last_error', None) or "Enrollment incomplete. Check lighting and face position."
            msg = (msg or "").replace("**", "")
            _set_enroll_result("failed", msg)  # #7

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started"}

@app.get("/api/enroll/status")
def enroll_status():
    with _enroll_lock:  # #7 Fix: thread-safe read
        return dict(_enroll_result)


@app.post("/api/enroll/client-frames")
def enroll_student_client_frames(data: ClientEnrollModel, user: dict = Depends(get_current_user)):
    """
    Enrolls a new student using 10 face frames captured directly from the browser/phone camera.
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can enroll new students")

    if not data.images or len(data.images) == 0:
        raise HTTPException(status_code=400, detail="No face images captured from browser camera")

    # Decode base64 data URLs into OpenCV BGR numpy arrays
    bgr_frames = []
    for img_str in data.images:
        if "," in img_str:
            img_str = img_str.split(",", 1)[1]
        try:
            img_bytes = base64.b64decode(img_str)
            np_arr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if frame is not None:
                bgr_frames.append(frame)
        except Exception:
            pass

    if not bgr_frames:
        raise HTTPException(status_code=400, detail="Failed to decode captured face images")

    from enroll import enroll_student_from_images
    status_code, message = enroll_student_from_images(
        name=data.name.strip(),
        roll_no=data.roll_no.strip(),
        image_list=bgr_frames,
        force=data.force
    )

    if status_code in ["exists", "face_exists", "failed"]:
        raise HTTPException(status_code=400, detail=message)

    # Save student in database and create login credentials
    try:
        from models import get_student, add_student, update_student, add_user
        if get_student(data.roll_no):
            update_student(data.roll_no, data.name, data.email,
                           department=data.dept, year=data.year, academic_year=data.academic_year, course=data.course)
        else:
            add_student(data.roll_no, data.name, data.email, data.dept, data.year, data.academic_year, course=data.course)

        student_username = data.roll_no.strip().lower()
        add_user(
            username=student_username,
            password_hash=get_password_hash(data.roll_no.strip()),
            role="student",
            name=data.name.strip(),
            reference_id=data.roll_no.strip()
        )
    except Exception as e:
        print(f"[Client Enroll API] Error creating student record: {e}")

    with _lock:
        _state["db"] = load_face_db()

    return {"status": "ok", "message": f"Successfully enrolled {data.name} ({data.roll_no})!"}

# Export
# #6 Fix: Require admin/teacher to export attendance data
@app.get("/api/export/csv")
def export_csv(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    if not from_date or not to_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Date range is required. Please select both 'from_date' and 'to_date'."
        )
    path = export_to_csv(from_date=from_date, to_date=to_date)
    return FileResponse(path, media_type="text/csv", filename="attendance.csv")

@app.get("/api/export/excel")
def export_excel_endpoint(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    if not from_date or not to_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Date range is required. Please select both 'from_date' and 'to_date'."
        )
    path = export_to_excel(from_date=from_date, to_date=to_date)
    return FileResponse(path, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        filename="attendance.xlsx")
# Manual Attendance Operations
@app.post("/api/attendance/manual")
def add_manual_attendance(data: ManualAttendanceModel, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    result = mark_attendance(data.roll_no, data.session_id, confidence=None, date_override=data.date, force=True)
    if result == "marked":
        return {"status": "ok", "message": "Attendance marked successfully"}
    elif result == "duplicate":
        return {"status": "duplicate", "message": "Attendance already marked for this student"}
    elif result == "unmapped_subject":
        raise HTTPException(status_code=400, detail="This subject is not mapped to the student's class section.")
    elif result == "student_not_found":
        raise HTTPException(status_code=400, detail="Student roll number not found in database.")
    else:
        raise HTTPException(status_code=400, detail="Failed to mark attendance. Verify roll number and session.")

@app.delete("/api/attendance/{session_id}/{roll_no}")
def delete_manual_attendance(session_id: str, roll_no: str, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import delete_attendance
    success = delete_attendance(roll_no, session_id)
    if success:
        return {"status": "ok", "message": "Attendance record deleted"}
    raise HTTPException(status_code=404, detail="Attendance record not found")

@app.put("/api/attendance/{session_id}/{roll_no}")
def update_manual_attendance(session_id: str, roll_no: str, data: UpdateAttendanceModel, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import update_attendance
    result = update_attendance(roll_no, session_id, data.new_roll_no, data.time)
    if result == "duplicate":
        return {"status": "duplicate", "message": "Attendance already marked for that student in this session/day"}
    elif result:
        return {"status": "ok", "message": "Attendance record updated"}
    raise HTTPException(status_code=400, detail="Failed to update attendance. Verify student exists and time is valid.")

# Subject-wise attendance breakdown for a student
@app.get("/api/students/{roll_no}/subject-attendance")
def student_subject_attendance(roll_no: str, user: dict = Depends(get_current_user)):
    if user.get("role") == "student" and user.get("reference_id") != roll_no:
        raise HTTPException(status_code=403, detail="Access denied")
    from datetime import datetime
    from models import get_student, get_subjects_for_class, get_all_subjects, get_all_sessions, get_all_schedules
    student = get_student(roll_no)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    dept = student.get("department", "")
    year = student.get("year", "")
    ay   = student.get("academic_year", "")
    
    subject_codes = get_subjects_for_class(dept, year, ay)
    all_subjects = get_all_subjects()
    # Filter subjects to show only those mapped to this student's section
    subjects = [s for s in all_subjects if s["code"] in subject_codes]
    
    all_sessions = get_all_sessions()
    history = get_student_history(roll_no)
    attended_session_ids = {h["session_id"] for h in history}
    
    result = []
    for sub in subjects:
        # Base filter: all sessions conducted for this subject in the student's cohort (dept+year+ay)
        sub_sessions = [
            s for s in all_sessions 
            if (str(s.get("subject_id")) == str(sub["id"]) or s.get("subject_id") == sub.get("code"))
            and (not s.get("department") or s.get("department") == dept)
            and (not s.get("year") or s.get("year") == year)
            and (not s.get("academic_year") or s.get("academic_year") == ay)
        ]
        
        cond_count = len(sub_sessions)
        att_count = sum(1 for s in sub_sessions if s["id"] in attended_session_ids)
        pct = round((att_count / cond_count * 100), 1) if cond_count > 0 else 0.0
        
        result.append({
            "subject_id": sub["id"],
            "subject_code": sub["code"],
            "subject_name": sub["name"],
            "department": sub.get("department", ""),
            "attended": att_count,
            "total": cond_count,
            "pct": pct,
        })
    return sorted(result, key=lambda x: x["pct"])


# ── Sections Management (Section-to-Subject Mapping) ──────────
@app.get("/api/sections")
def list_sections(user: dict = Depends(get_current_user)):
    """List all defined sections with their subject mappings (Admins and Teachers)."""
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import get_all_sections
    return get_all_sections()


@app.post("/api/sections")
def create_section(data: SectionModel, user: dict = Depends(get_current_user)):
    """Admin only: create a new section with subject mappings."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import add_section
    ok = add_section(
        department=data.department.strip(),
        year=data.year.strip(),
        academic_year=data.academic_year.strip(),
        subjects=data.subjects,
    )
    if not ok:
        return {"status": "duplicate", "message": "Section already exists for this class"}
    return {"status": "ok"}


@app.put("/api/sections/{section_id}")
def update_section(section_id: str, data: SectionSubjectsModel, user: dict = Depends(get_current_user)):
    """Admin only: update subject list for a section."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import update_section_subjects, get_section_by_id
    if not get_section_by_id(section_id):
        raise HTTPException(status_code=404, detail="Section not found")
    update_section_subjects(section_id, data.subjects)
    return {"status": "ok"}


@app.delete("/api/sections/{section_id}")
def remove_section(section_id: str, user: dict = Depends(get_current_user)):
    """Admin only: delete a section."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import delete_section, get_section_by_id
    if not get_section_by_id(section_id):
        raise HTTPException(status_code=404, detail="Section not found")
    delete_section(section_id)
    return {"status": "ok"}


@app.get("/api/sections/by-class")
def get_section_by_class(
    department: str = Query(...),
    year: str = Query(...),
    academic_year: str = Query(...),
    course: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    """Get subjects mapped to a specific class section."""
    from models import get_section
    sec = get_section(department, year, academic_year, course or "")
    if not sec:
        return {"subjects": []}
    return sec


# ── Metadata Management (Departments & Academic Years) ────────
class MetadataModel(BaseModel):
    code: str

@app.get("/api/departments")
def list_departments(user: dict = Depends(get_current_user)):
    from models import get_all_departments
    return get_all_departments()

@app.post("/api/departments")
def create_department(data: MetadataModel, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import add_department
    ok = add_department(data.code)
    if not ok:
        raise HTTPException(status_code=400, detail="Department already exists")
    return {"status": "ok"}

@app.delete("/api/departments/{code}")
def remove_department(code: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import delete_department
    delete_department(code)
    return {"status": "ok"}

@app.get("/api/academic_years")
def list_academic_years(user: dict = Depends(get_current_user)):
    from models import get_all_academic_years
    return get_all_academic_years()

@app.post("/api/academic_years")
def create_academic_year(data: MetadataModel, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import add_academic_year
    ok = add_academic_year(data.code)
    if not ok:
        raise HTTPException(status_code=400, detail="Academic year already exists")
    return {"status": "ok"}

@app.delete("/api/academic_years/{code}")
def remove_academic_year(code: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import delete_academic_year
    delete_academic_year(code)
    return {"status": "ok"}

class CourseModel(BaseModel):
    code: str
    duration_years: int = 4
    years_list: Optional[List[str]] = None

@app.get("/api/courses")
def list_courses(user: dict = Depends(get_current_user)):
    from models import get_all_courses
    return get_all_courses()

@app.post("/api/courses")
def create_course(data: CourseModel, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import add_course
    ok = add_course(data.code, data.duration_years, data.years_list)
    if not ok:
        raise HTTPException(status_code=400, detail="Course already exists")
    return {"status": "ok"}

@app.put("/api/courses/{code:path}")
def edit_course_duration(code: str, data: CourseModel, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import update_course_duration
    update_course_duration(code, data.duration_years, data.years_list)
    return {"status": "ok"}

@app.delete("/api/courses/{code:path}")
def remove_course(code: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import delete_course
    delete_course(code)
    return {"status": "ok"}


# ── Schedules Management (Timetable slots mapping) ────────────
class ScheduleModel(BaseModel):
    course: str = ""
    department: str
    year: str
    academic_year: str
    subject_id: int
    day_of_week: str
    start_time: str
    end_time: str
    classroom: str = ""
    specific_date: str = ""

def normalize_dept_name(d: str) -> str:
    if not d: return ""
    clean = str(d).strip().upper().replace("/", "").replace("&", "").replace("-", "").replace(" ", "")
    if clean in ["AIML", "AI"]: return "AIML"
    if clean in ["MECH", "ME"]: return "MECH"
    return clean

def normalize_ay_str(ay: str) -> str:
    if not ay: return ""
    s = str(ay).strip()
    import re
    m = re.match(r"^(\d{4})-(\d{2})$", s)
    if m:
        return f"{m.group(1)}-20{m.group(2)}"
    return s

@app.get("/api/schedules")
def list_schedules(user: dict = Depends(get_current_user)):
    from models import get_all_schedules
    schedules = get_all_schedules()
    # Filter for student role: can only view their own class schedule
    if user.get("role") == "student":
        from models import get_student
        student = get_student(user.get("reference_id"))
        if student:
            s_dept = normalize_dept_name(student.get("department"))
            s_year = (student.get("year") or "").strip().lower()
            s_ay   = normalize_ay_str(student.get("academic_year"))
            
            # Exact match by normalized department & year
            matched = [s for s in schedules if 
                       normalize_dept_name(s.get("department")) == s_dept and 
                       (s.get("year") or "").strip().lower() == s_year and
                       (not s_ay or not s.get("academic_year") or normalize_ay_str(s.get("academic_year")) == s_ay)]
            
            # Fallback if academic_year mismatch
            if not matched:
                matched = [s for s in schedules if 
                           normalize_dept_name(s.get("department")) == s_dept and 
                           (s.get("year") or "").strip().lower() == s_year]
            
            return matched
        else:
            return []
    # Filter for teacher role: only view schedules for mapped subjects or classes
    elif user.get("role") == "teacher":
        from models import get_user
        username = str(user.get("sub") or user.get("username") or "").strip().lower()
        td = get_user(username)
        if td:
            # 1. Direct teacher_username match in schedules table
            direct_matches = [s for s in schedules if str(s.get("teacher_username") or "").strip().lower() == username]
            if direct_matches:
                # Cap at <= 4 classes per day
                capped_direct = []
                day_counts = {}
                for s in direct_matches:
                    day = s.get("day_of_week", "Monday")
                    if day_counts.get(day, 0) < 4:
                        day_counts[day] = day_counts.get(day, 0) + 1
                        capped_direct.append(s)
                return capped_direct

            # 2. Fallback by mapped subjects & classes with conflict deduplication & <=4 per day constraint
            mapped_subjects = [str(x).strip().lower() for x in td.get("subjects", [])]
            mapped_classes  = td.get("classes", [])
            if not mapped_subjects and not mapped_classes:
                return []
            
            candidates = []
            for s in schedules:
                sub_id_str = str(s.get("subject_id", "")).strip().lower()
                sub_code_str = str(s.get("code") or s.get("subject_code", "")).strip().lower()
                sub_match = (sub_id_str in mapped_subjects) or (sub_code_str in mapped_subjects)
                
                class_match = False
                s_dept_norm = normalize_dept_name(s.get("department"))
                s_year_norm = (s.get("year") or "").strip().lower()
                s_ay_norm   = normalize_ay_str(s.get("academic_year"))

                for c in mapped_classes:
                    c_dept_norm = normalize_dept_name(c.get("dept"))
                    c_year_norm = (c.get("year") or "").strip().lower()
                    c_ay_norm   = normalize_ay_str(c.get("academic_year"))

                    if s_dept_norm == c_dept_norm and s_year_norm == c_year_norm:
                        if not c_ay_norm or not s_ay_norm or s_ay_norm == c_ay_norm:
                            class_match = True
                            break
                if sub_match or class_match:
                    candidates.append(s)

            seen_slots = set()
            day_counts = {}
            filtered_sched = []
            for s in candidates:
                time_key = (s.get("day_of_week"), s.get("start_time"))
                day = s.get("day_of_week", "Monday")
                if time_key not in seen_slots and day_counts.get(day, 0) < 4:
                    seen_slots.add(time_key)
                    day_counts[day] = day_counts.get(day, 0) + 1
                    filtered_sched.append(s)
            return filtered_sched
        else:
            return []
    return schedules

@app.post("/api/schedules")
def create_schedule(data: ScheduleModel, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import add_schedule
    ok = add_schedule(
        department=data.department.strip(),
        year=data.year.strip(),
        academic_year=data.academic_year.strip(),
        subject_id=data.subject_id,
        day_of_week=data.day_of_week.strip(),
        start_time=data.start_time.strip(),
        end_time=data.end_time.strip(),
        classroom=data.classroom.strip(),
        specific_date=data.specific_date.strip(),
        course=data.course.strip()
    )
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to add schedule")
    return {"status": "ok"}

@app.delete("/api/schedules/{schedule_id}")
def remove_schedule(schedule_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import delete_schedule
    delete_schedule(schedule_id)
    return {"status": "ok"}


@app.get("/api/students/{roll_no}/subjects")
def student_subjects(roll_no: str, user: dict = Depends(get_current_user)):
    """Return subjects available to a student based on their section mapping."""
    if user.get("role") == "student" and user.get("reference_id") != roll_no:
        raise HTTPException(status_code=403, detail="Access denied")
    from models import get_student, get_subjects_for_class, get_all_subjects
    student = get_student(roll_no)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    dept = student.get("department", "")
    year = student.get("year", "")
    ay   = student.get("academic_year", "")
    subject_codes = get_subjects_for_class(dept, year, ay)
    all_subjects  = get_all_subjects()
    matched = [s for s in all_subjects if s["code"] in subject_codes]
    return {"subjects": matched, "section": {"department": dept, "year": year, "academic_year": ay}}


# Teachers Management
@app.get("/api/teachers")
def list_teachers(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import list_teachers
    teachers = list_teachers()
    for d in teachers:
        if "password_hash" in d:
            del d["password_hash"]
    return teachers

@app.post("/api/teachers")
def add_teacher(req: TeacherModel, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import get_user, add_user, list_teachers
    username = req.username.strip().lower()
    if not username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    
    current_teachers = list_teachers()
    if len(current_teachers) >= 25:
        return {
            "status": "limit_reached",
            "message": f"Maximum faculty limit reached (25/25). The system is limited to a maximum of 25 teachers."
        }

    if get_user(username):
        return {"status": "duplicate", "message": f"Username '{username}' already exists"}
        
    teacher_password = req.password.strip() if req.password and req.password.strip() else username
    add_user(
        username=username,
        password_hash=get_password_hash(teacher_password),
        role="teacher",
        name=req.name.strip()
    )
    return {"status": "ok", "message": f"Teacher registered successfully! Login ID: {username}, Default Password: {teacher_password}"}

@app.delete("/api/teachers/{username}")
def delete_teacher(username: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import get_user, delete_user
    if not get_user(username):
        raise HTTPException(status_code=404, detail="Teacher not found")
    delete_user(username)
    return {"status": "ok"}

@app.put("/api/teachers/{username}")
def edit_teacher(username: str, data: UpdateTeacherModel, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import get_user, update_user
    if not get_user(username):
        raise HTTPException(status_code=404, detail="Teacher not found")
    
    update_data = {
        "name": data.name.strip()
    }
    if data.password and data.password.strip():
        update_data["password_hash"] = get_password_hash(data.password.strip())
        
    update_user(username, update_data)
    return {"status": "ok"}

@app.get("/api/teachers/{username}/mappings")
def get_teacher_mappings_endpoint(username: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import get_user
    d = get_user(username)
    if not d:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return {
        "subjects": d.get("subjects", []),
        "classes": d.get("classes", [])
    }

@app.post("/api/teachers/{username}/mappings")
def save_teacher_mappings_endpoint(username: str, data: TeacherMappingsModel, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import get_user, update_user, get_all_subjects, add_schedule, get_all_schedules
    if not get_user(username):
        raise HTTPException(status_code=404, detail="Teacher not found")
    
    classes_list = [c.model_dump() for c in data.classes]
    update_user(username, {
        "subjects": data.subjects,
        "classes": classes_list
    })

    # Automatically ensure schedule slots exist for assigned subjects and classes
    try:
        all_subs = get_all_subjects()
        sub_lookup = {str(s.get("code")).lower(): s for s in all_subs}
        sub_lookup.update({str(s.get("id")).lower(): s for s in all_subs})
        existing_scheds = get_all_schedules()

        for sub_code in data.subjects:
            sub_info = sub_lookup.get(str(sub_code).lower())
            if not sub_info:
                continue
            s_id = sub_info.get("id")
            s_dept = sub_info.get("department", "CSE")

            # Check if this subject is already scheduled
            already_scheduled = any(str(s.get("subject_id")) == str(s_id) or str(s.get("subject_code", "")).lower() == str(sub_code).lower() for s in existing_scheds)

            if not already_scheduled:
                target_classes = classes_list if classes_list else sub_info.get("classes", [])
                if not target_classes:
                    target_classes = [{"dept": s_dept, "year": "1st Year", "academic_year": "2025-2026"}]
                
                days = ["Monday", "Wednesday", "Friday"]
                for i, c_item in enumerate(target_classes):
                    c_d = c_item.get("dept") or s_dept
                    c_y = c_item.get("year") or "1st Year"
                    c_ay = c_item.get("academic_year") or "2025-2026"
                    day_val = days[i % len(days)]
                    add_schedule(
                        department=c_d,
                        year=c_y,
                        academic_year=c_ay,
                        subject_id=s_id,
                        day_of_week=day_val,
                        start_time="10:00",
                        end_time="11:00",
                        classroom=f"{c_d}-LH-101"
                    )
        # Assign teacher_username in schedules table for mapped subjects/classes
        from models import get_conn
        conn = get_conn()
        for sub_code in data.subjects:
            sub_info = sub_lookup.get(str(sub_code).lower())
            if sub_info:
                s_id = sub_info.get("id")
                conn.execute("UPDATE schedules SET teacher_username = ? WHERE subject_id = ?", (username, s_id))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[Teacher Mapping Schedule Auto-Sync] Notice: {e}")

    return {"status": "ok"}

# Auth / Credentials
@app.post("/api/auth/change-password")
def change_password(req: ChangePasswordModel, user: dict = Depends(get_current_user)):
    username = user.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid session")
    from models import get_user, update_user
    user_doc = get_user(username)
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
        
    if not verify_password(req.old_password, user_doc.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Incorrect current password")
        
    update_user(username, {
        "password_hash": get_password_hash(req.new_password)
    })
    return {"status": "ok", "message": "Password updated successfully"}



# ── Attendance Alerts ─────────────────────────────────────────
@app.get("/api/alerts")
def get_alerts(
    threshold: float = Query(75.0),
    department: Optional[str] = Query(None),
    year: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    """Return students below attendance threshold with per-subject breakdown."""
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import get_all_students, get_all_subjects, get_all_sessions, get_student_history
    students = get_all_students()
    if department:
        students = [s for s in students if s.get("department") == department]
    if year:
        students = [s for s in students if s.get("year") == year]
    subjects = get_all_subjects()
    all_sessions = get_all_sessions()
    alerts = []
    for student in students:
        history = get_student_history(student["roll_no"])
        attended_session_ids = {h["session_id"] for h in history}
        subject_breakdown = []
        for sub in subjects:
            sub_sessions = [s for s in all_sessions if s.get("subject_id") == sub["id"]]
            attended = sum(1 for s in sub_sessions if s["id"] in attended_session_ids)
            total = len(sub_sessions)
            if total == 0:
                continue
            pct = round((attended / total * 100), 1)
            classes_needed = max(0, int((0.75 * total - attended) / 0.25) + 1) if pct < 75 else 0
            subject_breakdown.append({
                "subject_code": sub["code"],
                "subject_name": sub["name"],
                "attended": attended,
                "total": total,
                "pct": pct,
                "classes_needed": classes_needed,
            })
        if not subject_breakdown:
            continue
        overall_attended = sum(s["attended"] for s in subject_breakdown)
        overall_total    = sum(s["total"] for s in subject_breakdown)
        overall_pct = round((overall_attended / overall_total * 100), 1) if overall_total > 0 else 0
        if overall_pct < threshold:
            alerts.append({
                "roll_no": student["roll_no"],
                "name": student["name"],
                "department": student.get("department", ""),
                "year": student.get("year", ""),
                "academic_year": student.get("academic_year", ""),
                "overall_pct": overall_pct,
                "overall_attended": overall_attended,
                "overall_total": overall_total,
                "risk_level": "critical" if overall_pct < 60 else "at_risk",
                "subjects": [s for s in subject_breakdown if s["pct"] < 75],
            })
    alerts.sort(key=lambda x: x["overall_pct"])
    return alerts


# ── Student Calendar ──────────────────────────────────────────
@app.get("/api/students/{roll_no}/calendar")
def student_calendar(
    roll_no: str,
    month: str = Query(..., description="YYYY-MM format"),
    subject_id: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    """Return day-by-day attendance for a student for a given month."""
    if user.get("role") == "student" and user.get("reference_id") != roll_no:
        raise HTTPException(status_code=403, detail="Access denied")
    from models import get_student_history, get_all_sessions
    from datetime import datetime
    try:
        year_m, mo = int(month.split("-")[0]), int(month.split("-")[1])
    except Exception:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    # Build date range for the month
    import calendar as cal_mod
    days_in_month = cal_mod.monthrange(year_m, mo)[1]
    dates_in_month = [f"{year_m}-{mo:02d}-{d:02d}" for d in range(1, days_in_month + 1)]
    # Get all sessions in this month
    all_sessions = get_all_sessions()
    month_sessions = [
        s for s in all_sessions
        if s.get("date", "").startswith(month)
        and (not subject_id or str(s.get("subject_id")) == str(subject_id))
    ]
    session_dates = {s["date"] for s in month_sessions}
    # Get student's attended sessions
    history = get_student_history(roll_no)
    attended_session_ids = {h["session_id"] for h in history}
    attended_dates = set()
    for s in month_sessions:
        if s["id"] in attended_session_ids:
            attended_dates.add(s["date"])
    # Build calendar data
    result = []
    for d in dates_in_month:
        dt = datetime.strptime(d, "%Y-%m-%d")
        weekday = dt.weekday()  # 0=Mon, 6=Sun
        sessions_on_day = [s for s in month_sessions if s.get("date") == d]
        if weekday >= 6:  # Sunday
            status = "weekend"
        elif d not in session_dates:
            status = "no_class"
        elif d in attended_dates:
            status = "present"
        else:
            status = "absent"
        result.append({
            "date": d,
            "day": dt.day,
            "weekday": weekday,
            "status": status,
            "sessions": [{"id": s["id"], "subject_code": s.get("code") or s.get("subject_code", ""), "start_time": s.get("start_time", "")} for s in sessions_on_day],
        })
    return {"month": month, "days": result}


# ── Summary Export ────────────────────────────────────────────
@app.get("/api/export/summary")
def export_summary(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    year: Optional[str] = Query(None),
    subject_id: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    """Student-wise attendance summary export as multi-sheet Excel."""
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from models import get_all_students, get_all_subjects, get_all_sessions, get_student_history
    students = get_all_students()
    if department:
        students = [s for s in students if s.get("department") == department]
    if year:
        students = [s for s in students if s.get("year") == year]
    subjects = get_all_subjects()
    if subject_id:
        subjects = [s for s in subjects if str(s["id"]) == str(subject_id)]
    all_sessions = get_all_sessions()
    # Filter sessions by date range
    month_sessions = []
    for s in all_sessions:
        d = s.get("date", "")
        if from_date and d < from_date: continue
        if to_date   and d > to_date:   continue
        if subject_id and str(s.get("subject_id")) != str(subject_id): continue
        month_sessions.append(s)
    wb = openpyxl.Workbook()
    thin = Side(style="thin", color="D1D5DB")
    bdr  = Border(left=thin, right=thin, top=thin, bottom=thin)
    hfill = PatternFill(start_color="1E3A5F", end_color="1E3A5F", fill_type="solid")
    hfont = Font(color="FFFFFF", bold=True)
    good_fill  = PatternFill(start_color="D1FAE5", end_color="D1FAE5", fill_type="solid")
    warn_fill  = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
    bad_fill   = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
    def style_header(ws, headers):
        for col, h in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col, value=h)
            cell.font = hfont; cell.fill = hfill; cell.border = bdr
            cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.row_dimensions[1].height = 22
    # Sheet 1: Student-wise summary
    ws = wb.active; ws.title = "Student Summary"
    sub_codes = [s["code"] for s in subjects]
    headers = ["Roll No", "Name", "Department", "Year", "Academic Year"] + sub_codes + ["Overall %"]
    style_header(ws, headers)
    for ri, student in enumerate(students, 2):
        history = get_student_history(student["roll_no"])
        attended_ids = {h["session_id"] for h in history}
        row = [student["roll_no"], student["name"], student.get("department",""), student.get("year",""), student.get("academic_year","")]
        total_att = 0; total_ses = 0
        s_dept = student.get("department", "")
        s_year = student.get("year", "")
        s_ay   = student.get("academic_year", "")
        for sub in subjects:
            sub_sessions = [
                s for s in month_sessions
                if s.get("subject_id") == sub["id"]
                and (not s.get("department") or s.get("department") == s_dept)
                and (not s.get("year") or s.get("year") == s_year)
                and (not s.get("academic_year") or s.get("academic_year") == s_ay)
            ]
            attended = sum(1 for s in sub_sessions if s["id"] in attended_ids)
            total = len(sub_sessions)
            pct = round((attended / total * 100), 1) if total > 0 else 0
            total_att += attended; total_ses += total
            row.append(f"{pct}%" if total > 0 else "N/A")
        overall = round((total_att / total_ses * 100), 1) if total_ses > 0 else 0
        row.append(f"{overall}%")
        for ci, val in enumerate(row, 1):
            cell = ws.cell(row=ri, column=ci, value=val); cell.border = bdr
            if ci == len(headers):  # Overall %
                num = overall
                cell.fill = good_fill if num >= 75 else (warn_fill if num >= 60 else bad_fill)
                cell.font = Font(bold=True)
        ws.row_dimensions[ri].height = 18
    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = max(14, max(len(str(c.value or "")) for c in col) + 2)
    # Sheet 2: Raw attendance log
    ws2 = wb.create_sheet("Attendance Log")
    log_headers = ["Roll No", "Name", "Department", "Year", "Subject Code", "Subject Name", "Date", "Time"]
    style_header(ws2, log_headers)
    
    from config import USE_FIREBASE
    filtered = []
    if USE_FIREBASE:
        from firebase_db import _get_export_rows
        rows = _get_export_rows(from_date, to_date, subject_id)
        for r in rows:
            if department and r.get("department") != department: continue
            if year and r.get("year") != year: continue
            filtered.append(r)
    else:
        from models_sqlite import _export_query, get_conn
        conn = get_conn()
        rows = _export_query(conn, from_date=from_date, to_date=to_date, subject_id=subject_id)
        conn.close()
        for r in rows:
            rd = dict(zip(["roll_no","name","department","year","academic_year","subject_code","subject_name","date","time","confidence"], r))
            if department and rd.get("department") != department: continue
            if year and rd.get("year") != year: continue
            filtered.append(rd)
    for ri, rd in enumerate(filtered, 2):
        vals = [rd["roll_no"], rd["name"], rd["department"], rd["year"], rd["subject_code"], rd["subject_name"], rd["date"], rd["time"]]
        for ci, v in enumerate(vals, 1):
            cell = ws2.cell(row=ri, column=ci, value=v); cell.border = bdr
        ws2.row_dimensions[ri].height = 18
    for col in ws2.columns:
        ws2.column_dimensions[col[0].column_letter].width = 16
    import tempfile
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
    wb.save(tmp.name); tmp.close()
    return FileResponse(tmp.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        filename=f"attendance_summary_{from_date or 'all'}_{to_date or 'all'}.xlsx")

# ── Enhanced Endpoints: Client Frame, Defaulters, PDF Reports, Settings, Backup ──

@app.post("/api/session/client-frame")
def process_client_frame(data: ClientFrameModel, user: dict = Depends(get_current_user)):
    """
    Process a single video frame sent directly from the browser webcam (WebRTC / Canvas).
    Performs face detection, ArcFace recognition, multi-cue liveness verification, and marks attendance.
    """
    img_str = data.image
    if "," in img_str:
        img_str = img_str.split(",", 1)[1]
    try:
        img_bytes = base64.b64decode(img_str)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Failed to decode image from buffer")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image format: {e}")

    session_id = data.session_id or _get("active_session_id")
    cfg = load_settings()
    thresh = data.threshold if data.threshold is not None else float(cfg.get("threshold", 0.53))
    anti_spoof = data.anti_spoofing if data.anti_spoofing is not None else bool(cfg.get("anti_spoofing", True))
    strict_level = cfg.get("liveness_strictness", "medium")

    with _lock:
        db = load_face_db()
        _state["db"] = db
        last_marked = dict(_state["last_marked"])

    session_info = None
    if session_id:
        all_sess = get_all_sessions()
        session_info = next((s for s in all_sess if str(s.get("id")) == str(session_id)), None)

    session_course = session_info.get("course", "") if session_info else ""
    session_dept   = session_info.get("department", "") if session_info else ""
    session_year   = session_info.get("year", "") if session_info else ""
    session_ay     = session_info.get("academic_year", "") if session_info else ""

    results = recognize_single_frame(
        frame,
        db,
        threshold=thresh,
        anti_spoofing=anti_spoof,
        strictness=strict_level
    )

    now = time.time()
    newly_marked = []
    marked_update = []

    for r in results:
        roll_no = r.get("roll_no")
        if roll_no and r.get("is_real", True) and session_id:
            from models import get_student
            student_doc = get_student(roll_no)

            is_mapped_class = True
            if student_doc and (session_course or session_dept or session_year or session_ay):
                course_match = not session_course or (bool(student_doc.get("course")) and student_doc.get("course") == session_course)
                dept_match   = not session_dept   or student_doc.get("department") == session_dept
                year_match   = not session_year   or student_doc.get("year") == session_year
                ay_match     = not session_ay     or student_doc.get("academic_year") == session_ay
                if not (course_match and dept_match and year_match and ay_match):
                    is_mapped_class = False

            if student_doc:
                r["student_course"] = student_doc.get("course", "")
                r["student_dept"]   = student_doc.get("department", "")
                r["student_year"]   = student_doc.get("year", "")

            if not is_mapped_class:
                r["status"] = "wrong_class"
            else:
                last_time, last_status = last_marked.get(roll_no, (0, ""))
                cooldown_limit = int(cfg.get("cooldown_sec", 10))

                if now - last_time < cooldown_limit:
                    if last_status == "marked" and (now - last_time < 3.0):
                        r["status"] = "marked"
                    elif last_status == "marked":
                        r["status"] = "cooldown"
                    else:
                        r["status"] = last_status
                else:
                    # Stateful Identity Verification (requires at least 4 matches in 4 seconds)
                    global _temporal_history
                    if "_temporal_history" not in globals():
                        from collections import defaultdict
                        _temporal_history = defaultdict(lambda: defaultdict(list))
                    
                    hist = _temporal_history[session_id][roll_no]
                    hist.append(now)
                    # prune old entries
                    _temporal_history[session_id][roll_no] = [t for t in hist if now - t <= 4.0]
                    match_count = len(_temporal_history[session_id][roll_no])
                    
                    if match_count < 4:
                        r["status"] = "verifying"
                    else:
                        res = mark_attendance(
                            roll_no=roll_no,
                            session_id=session_id,
                            confidence=r.get("distance", 0.5)
                        )
                        r["status"] = res
                        marked_update.append((roll_no, now, res))
                        if res == "marked":
                            newly_marked.append({
                                "roll_no": roll_no,
                                "name": r.get("name"),
                                "department": student_doc.get("department", "") if student_doc else "",
                                "year": student_doc.get("year", "") if student_doc else "",
                                "time": datetime.now().strftime("%H:%M:%S"),
                                "confidence": round(max(0, (1.0 - r.get("distance", 0.5))) * 100, 1)
                            })
        elif not r.get("is_real", True):
            r["status"] = "spoof"

    if marked_update:
        with _lock:
            for roll_no, t, res in marked_update:
                _state["last_marked"][roll_no] = (t, res)
            # Prune stale records older than 1 hour if dict grows large
            if len(_state["last_marked"]) > 200:
                _state["last_marked"] = {
                    k: v for k, v in _state["last_marked"].items()
                    if (now - v[0]) < 3600
                }

    return {
        "status": "ok",
        "faces": results,
        "newly_marked": newly_marked,
        "session_active": session_id is not None,
        "frame_w": frame.shape[1],
        "frame_h": frame.shape[0]
    }


@app.get("/api/defaulters")
def get_defaulters_analysis(
    threshold: Optional[int] = Query(None),
    department: Optional[str] = Query(None),
    year: Optional[str] = Query(None),
    academic_year: Optional[str] = Query(None),
    user: dict = Depends(get_current_user)
):
    """
    Identifies and categorizes students whose attendance is below the minimum threshold.
    Returns critical (<50%), warning (50-74%), and safe (>=75%) groupings.
    """
    cfg = load_settings()
    cutoff = threshold or cfg.get("attendance_threshold", ATTENDANCE_THRESHOLD)
    
    students = get_all_students()
    all_sessions = get_all_sessions()

    if department:
        students = [s for s in students if s.get("department") == department]
    if year:
        students = [s for s in students if s.get("year") == year]
    if academic_year:
        students = [s for s in students if s.get("academic_year") == academic_year]

    defaulters = []
    safe_students = []

    for s in students:
        roll = s.get("roll_no")
        s_dept = s.get("department", "")
        s_year = s.get("year", "")
        s_ay   = s.get("academic_year", "")

        cohort_sessions = [
            sess for sess in all_sessions
            if (not sess.get("department") or sess.get("department") == s_dept) and
               (not sess.get("year") or sess.get("year") == s_year) and
               (not sess.get("academic_year") or sess.get("academic_year") == s_ay)
        ]
        
        history = get_student_history(roll)
        attended_ids = {h.get("session_id") for h in history}
        
        total_held = len(cohort_sessions) if cohort_sessions else len(all_sessions)
        total_attended = sum(1 for sess in (cohort_sessions or all_sessions) if sess.get("id") in attended_ids)
        
        pct = round((total_attended / total_held * 100), 1) if total_held > 0 else 0.0

        student_info = {
            "roll_no": roll,
            "name": s.get("name", "Unknown"),
            "email": s.get("email", ""),
            "department": s_dept,
            "year": s_year,
            "academic_year": s_ay,
            "total_held": total_held,
            "total_attended": total_attended,
            "percentage": pct,
            "risk_level": "critical" if pct < 50.0 else ("warning" if pct < cutoff else "safe"),
            "shortage_classes": max(0, int((cutoff / 100.0 * total_held) - total_attended))
        }

        if pct < cutoff and total_held > 0:
            defaulters.append(student_info)
        else:
            safe_students.append(student_info)

    defaulters.sort(key=lambda x: x["percentage"])

    return {
        "threshold": cutoff,
        "total_enrolled": len(students),
        "total_defaulters": len(defaulters),
        "critical_count": sum(1 for d in defaulters if d["risk_level"] == "critical"),
        "warning_count": sum(1 for d in defaulters if d["risk_level"] == "warning"),
        "defaulters": defaulters,
        "safe_count": len(safe_students)
    }


@app.post("/api/defaulters/notify")
def notify_defaulters(req: DefaulterNoticeRequest, user: dict = Depends(get_current_user)):
    """
    Simulates sending an official email/SMS attendance shortage warning notice.
    """
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    from models import get_student
    student = get_student(req.roll_no)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    notice_id = f"WARN-{req.roll_no}-{int(time.time())}"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    print(f"[DEFALERT] Dispatched attendance shortage warning {notice_id} to student {req.roll_no} ({student.get('email', 'no-email')})")
    
    return {
        "status": "ok",
        "notice_id": notice_id,
        "roll_no": req.roll_no,
        "student_name": student.get("name"),
        "recipient_email": student.get("email") or f"{req.roll_no.lower()}@visiontrack.edu",
        "dispatched_at": timestamp,
        "message": req.message or "Official warning: Your attendance has fallen below the 75% requirement. Please contact your department coordinator immediately."
    }


@app.get("/api/reports/pdf")
def download_pdf_report(
    roll_no: str = Query(...),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False))
):
    """
    Generates and returns an official PDF Attendance Transcript with QR Verification.
    """
    auth_token = credentials.credentials if credentials else token
    if not auth_token:
        raise HTTPException(status_code=401, detail="Authentication required")
        
    try:
        user = jwt.decode(auth_token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    if user.get("role") == "student" and user.get("reference_id") != roll_no:
        raise HTTPException(status_code=403, detail="Access denied")

    from models import get_student
    student = get_student(roll_no)
    if not student:
        raise HTTPException(status_code=404, detail="Student record not found")

    from models import get_subjects_for_class, get_all_subjects
    dept = student.get("department", "")
    year = student.get("year", "")
    ay   = student.get("academic_year", "")
    
    subject_codes = get_subjects_for_class(dept, year, ay)
    all_subjects = get_all_subjects()
    if subject_codes:
        subjects = [s for s in all_subjects if s["code"] in subject_codes]
    else:
        subjects = [s for s in all_subjects if not s.get("department") or s.get("department") == dept]

    history = get_student_history(roll_no)
    all_sessions = get_all_sessions()

    pdf_buffer = create_attendance_pdf(
        student=student,
        subjects=subjects,
        history=history,
        all_sessions=all_sessions,
        from_date=from_date,
        to_date=to_date
    )

    filename = f"VisionTrack_Report_{roll_no}_{datetime.now().strftime('%Y%m%d')}.pdf"
    return Response(
        content=pdf_buffer.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.get("/api/settings")
def get_system_settings(user: dict = Depends(get_current_user)):
    """Fetch current system configuration and AI thresholds."""
    return load_settings()


@app.post("/api/settings")
def update_system_settings(data: SettingsUpdateModel, user: dict = Depends(get_current_user)):
    """Update system settings and reload AI models if required."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can modify system settings")
    
    update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
    new_settings = save_settings(update_dict)
    
    with _lock:
        _state["recognizer"] = FrameSkipRecognizer(
            threshold=float(new_settings.get("threshold", 0.60)),
            anti_spoofing=bool(new_settings.get("anti_spoofing", True))
        )

    return {"status": "ok", "settings": new_settings}


@app.get("/api/backup/download")
def download_system_backup(
    token: Optional[str] = Query(None),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False))
):
    """
    Creates and returns a ZIP archive of the database, face embeddings, settings, and photos.
    """
    auth_token = credentials.credentials if credentials else token
    if not auth_token:
        raise HTTPException(status_code=401, detail="Authentication required")
        
    try:
        payload = jwt.decode(auth_token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Only administrators can download backups")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    tmp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(tmp_dir, f"visiontrack_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip")

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        if os.path.exists(DB_FILE):
            zipf.write(DB_FILE, arcname="database/attendance.db")
        if os.path.exists(FACE_DB_PATH):
            zipf.write(FACE_DB_PATH, arcname="database/embeddings.pkl")
        if os.path.exists(SETTINGS_FILE):
            zipf.write(SETTINGS_FILE, arcname="database/system_settings.json")
        if os.path.exists(FACES_DIR):
            for root, dirs, files in os.walk(FACES_DIR):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, os.path.dirname(FACES_DIR))
                    zipf.write(file_path, arcname=arcname)

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=os.path.basename(zip_path)
    )


@app.post("/api/backup/restore")
async def restore_system_backup(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """
    Restores database, embeddings, and face files from an uploaded ZIP archive.
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can restore backups")

    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a .zip backup archive.")

    tmp_dir = tempfile.mkdtemp()
    zip_dest = os.path.join(tmp_dir, "uploaded_backup.zip")

    with open(zip_dest, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        with zipfile.ZipFile(zip_dest, 'r') as zipf:
            zipf.extractall(BASE_DIR)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract backup: {e}")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    with _lock:
        _state["db"] = load_face_db()
        _state["last_marked"] = {}

    return {"status": "ok", "message": "System backup successfully restored!"}


@app.post("/api/admin/reset-database")
def reset_database_endpoint(user: dict = Depends(get_current_user)):
    """
    Admin only: Wipes all student records, face embeddings, attendance logs, and resets database.
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can reset the system database")
    from reset_data import reset_all_data
    reset_all_data()
    with _lock:
        _state["db"] = load_face_db()
        _state["last_marked"] = {}
    return {"status": "ok", "message": "All database records and face data have been completely reset!"}


# ── Notice Board API Endpoints ────────────────────────────────────────────────
@app.post("/api/notices")
def post_notice_endpoint(model: NoticeCreateModel, user: dict = Depends(get_current_user)):
    """Create and issue a notice from Admin or Faculty to students."""
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Only administrators and faculty can issue notices.")
    from models import create_notice
    sender_name = user.get("name", user.get("sub", "Faculty"))
    res = create_notice(
        title=model.title,
        message=model.message,
        sender_role=user.get("role"),
        sender_name=sender_name,
        sender_id=user.get("sub"),
        target_type=model.target_type,
        target_value=model.target_value,
        priority=model.priority,
        expires_at=model.expires_at or ""
    )
    if not res:
        raise HTTPException(status_code=500, detail="Failed to create and issue notice.")
    return {"status": "ok", "notice": res, "message": f"Notice '{model.title}' issued successfully!"}


@app.get("/api/notices")
def get_all_notices_endpoint(user: dict = Depends(get_current_user)):
    """Get all issued notices with read tracking stats (Admin or Faculty)."""
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import get_all_notices
    return get_all_notices()


@app.delete("/api/notices/{notice_id}")
def delete_notice_endpoint(notice_id: int, user: dict = Depends(get_current_user)):
    """Delete an issued notice (Admin or Faculty)."""
    if user.get("role") not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    from models import delete_notice
    ok = delete_notice(notice_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notice not found or could not be deleted")
    return {"status": "ok", "message": "Notice deleted successfully"}


@app.get("/api/notices/student")
def get_student_notices_endpoint(user: dict = Depends(get_current_user)):
    """Get all notices for the logged-in student."""
    from models import get_student_notices
    roll_no = user.get("sub")
    return get_student_notices(roll_no)


@app.post("/api/notices/{notice_id}/read")
def mark_notice_read_endpoint(notice_id: int, user: dict = Depends(get_current_user)):
    """Mark a notice as read by the student."""
    from models import mark_notice_read
    roll_no = user.get("sub")
    ok = mark_notice_read(notice_id, roll_no)
    return {"status": "ok" if ok else "failed"}


@app.get("/api/notices/unread-count")
def get_unread_notice_count_endpoint(user: dict = Depends(get_current_user)):
    """Get unread notice count for badge indicators."""
    if user.get("role") == "student":
        from models import get_student_unread_notice_count
        roll_no = user.get("sub")
        return {"unread": get_student_unread_notice_count(roll_no)}
    return {"unread": 0}




# Mount enrolled face images for reference photo display
if os.path.exists(FACES_DIR):
    app.mount("/faces", StaticFiles(directory=FACES_DIR), name="faces")

# Mount built React frontend static assets in cloud container deployment
static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    from models import get_all_students
    port = int(os.environ.get("PORT", 8000))
    print("=" * 60)
    print(f"  VisionTrack AI Attendance System — Backend")
    print(f"  Directory : {BASE_DIR}")
    print(f"  Database  : {DB_FILE} ({os.path.getsize(DB_FILE) if os.path.exists(DB_FILE) else 0} bytes)")
    try:
        studs = get_all_students()
        print(f"  Enrolled Students: {len(studs)}")
    except Exception:
        pass
    print(f"  Server URL: http://127.0.0.1:{port}")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=port)


