# 🎓 Facial Attendance System
### M.Tech AI/ML Project — Deep Learning Face Recognition

---

## 📁 Project Structure

```
facial_attendance/
├── main.py           →  Run full attendance system
├── enroll.py         →  Enroll new students
├── detect.py         →  Face detection (MTCNN)
├── recognize.py      →  Face recognition (ArcFace)
├── liveness.py       →  Anti-spoofing (EAR blink)
├── attendance.py     →  Attendance logging (SQLite)
├── dashboard.py      →  Streamlit dashboard
├── requirements.txt  →  Python dependencies
├── database/         →  Auto-created (embeddings + SQLite)
└── faces/            →  Auto-created (enrolled face images)
```

---

## ⚙️ Setup Instructions

### Step 1 — Install dependencies
```bash
pip install -r requirements.txt
```

### Step 2 — Download dlib landmark model (for liveness)
```
Download: http://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2
Extract and place shape_predictor_68_face_landmarks.dat in the project root
```

### Step 3 — Enroll students
```bash
python enroll.py
```
- Select option 1
- Enter student name and roll number
- Look at the camera — system captures 10 photos automatically

### Step 4 — Run attendance system
```bash
python main.py
```
- Blink once to confirm liveness
- System recognizes face and marks attendance
- Press Q to quit

### Step 5 — View dashboard
```bash
streamlit run dashboard.py
```
- Opens at http://localhost:8501

---

## 🛠️ Tech Stack

| Component          | Technology              |
|--------------------|-------------------------|
| Face Detection     | MTCNN                   |
| Face Recognition   | ArcFace (via DeepFace)  |
| Liveness Detection | dlib EAR (Eye Blink)    |
| Database           | SQLite                  |
| Dashboard          | Streamlit               |
| Language           | Python 3.10             |

---

## 📊 Model Performance

| Metric                    | Value         |
|---------------------------|---------------|
| ArcFace accuracy (LFW)    | 99.82%        |
| Recognition threshold     | 0.40 cosine   |
| Processing speed          | ~25 FPS (GPU) |
| Enrollment time           | ~30 seconds   |
| Liveness: blinks required | 1 blink       |

---

## 🔑 Key Controls

| Key | Action                        |
|-----|-------------------------------|
| Q   | Quit attendance system        |
| R   | Refresh student database live |

---

## ⚠️ Notes

- First run downloads ArcFace model automatically (~500MB)
- Enrollment needs good lighting for best accuracy
- One attendance entry per student per day (auto-prevented)
- Confidence shown is cosine distance — lower = better match

---

## 📬 Contact

Sakinala Sri Sai Pawan — 1005-25-742404  
CH U V R S Pradyumna — 1005-25-742410  
M.Tech AI/ML — Academic Year 2025–26
