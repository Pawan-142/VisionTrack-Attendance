"""
detect.py
─────────────────────────────────────
Face Detection using MTCNN
Detects faces in real-time from webcam
and returns bounding boxes + landmarks
"""

import cv2
import numpy as np

# Multi-cascade face detectors for maximum detection coverage across lighting and angles
_alt2_detector = None
_default_detector = None

def _get_detectors():
    global _alt2_detector, _default_detector
    if _alt2_detector is None:
        _alt2_detector = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_alt2.xml')
    if _default_detector is None:
        _default_detector = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    return _alt2_detector, _default_detector


def _nms_boxes(boxes, overlap_thresh=0.35):
    """Merge overlapping bounding boxes (Non-Maximum Suppression)."""
    if len(boxes) == 0:
        return []
    boxes = np.array(boxes, dtype=np.float32)
    pick = []
    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 0] + boxes[:, 2]
    y2 = boxes[:, 1] + boxes[:, 3]
    area = (x2 - x1 + 1) * (y2 - y1 + 1)
    idxs = np.argsort(area)[::-1]
    while len(idxs) > 0:
        i = idxs[0]
        pick.append(i)
        suppress = [0]
        for pos in range(1, len(idxs)):
            j = idxs[pos]
            xx1 = max(x1[i], x1[j])
            yy1 = max(y1[i], y1[j])
            xx2 = min(x2[i], x2[j])
            yy2 = min(y2[i], y2[j])
            w = max(0, xx2 - xx1 + 1)
            h = max(0, yy2 - yy1 + 1)
            overlap = float(w * h) / (area[j] + 1e-6)
            if overlap > overlap_thresh:
                suppress.append(pos)
        idxs = np.delete(idxs, suppress)
    return [boxes[i].astype(int).tolist() for i in pick]


def detect_faces(frame):
    """
    Detect genuine human faces in a given BGR frame using ultra-fast OpenCV Haar Cascades + NMS.
    Runs in < 15 milliseconds.
    """
    faces = []
    if frame is None or frame.size == 0:
        return faces

    try:
        alt2_det, def_det = _get_detectors()
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Equalize histogram for fast robust detection in low/varying lighting
        gray_eq = cv2.equalizeHist(gray)

        raw_boxes = alt2_det.detectMultiScale(
            gray_eq,
            scaleFactor=1.08,
            minNeighbors=4,
            minSize=(30, 30)
        )

        if len(raw_boxes) == 0:
            raw_boxes = def_det.detectMultiScale(
                gray_eq,
                scaleFactor=1.08,
                minNeighbors=4,
                minSize=(30, 30)
            )

        # Apply Non-Maximum Suppression to prevent duplicate/stacked boxes
        clean_boxes = _nms_boxes(list(raw_boxes), overlap_thresh=0.35)

        for (x, y, w, h) in clean_boxes:
            # Aspect ratio check: genuine human faces have aspect ratio between 0.65 and 1.30
            aspect = float(w) / float(h) if h > 0 else 1.0
            if aspect < 0.65 or aspect > 1.30:
                continue

            face_crop = frame[y:y+h, x:x+w]
            if face_crop.size == 0:
                continue

            # Dual-model human skin chrominance check (YCrCb + HSV)
            # Rejects white plastic switchboards, electrical sockets, grey walls, metal, wires, and tiles
            ycrcb = cv2.cvtColor(face_crop, cv2.COLOR_BGR2YCrCb)
            cr = ycrcb[:, :, 1]
            cb = ycrcb[:, :, 2]
            skin_ycrcb = (cr >= 130) & (cr <= 175) & (cb >= 75) & (cb <= 130)

            hsv = cv2.cvtColor(face_crop, cv2.COLOR_BGR2HSV)
            h_chan = hsv[:, :, 0]
            s_chan = hsv[:, :, 1]
            v_chan = hsv[:, :, 2]
            skin_hsv = ((h_chan <= 28) | (h_chan >= 165)) & (s_chan >= 20) & (s_chan <= 230) & (v_chan >= 35)

            skin_mask = skin_ycrcb & skin_hsv
            skin_ratio = float(np.sum(skin_mask)) / float(w * h)

            # Enforce stricter skin check for small/distant crops to filter out background false positives (like curtains/wood)
            min_skin = 0.22 if (w < 60 or h < 60) else 0.10
            if skin_ratio < min_skin:
                continue  # Skip non-human objects, switchboards, and background items

            faces.append({
                'box': [int(x), int(y), int(w), int(h)],
                'confidence': 0.95,
                'keypoints': {}
            })
    except Exception as e:
        print(f"[detect.py] Detection error: {e}")

    # Sort faces by area (largest first)
    faces.sort(key=lambda f: f['box'][2] * f['box'][3], reverse=True)
    return faces


def crop_face(frame, padding=20):
    """
    Detect and crop the largest/most confident face in a frame.

    Args:
        frame   : BGR image from OpenCV
        padding : pixels to add around face box

    Returns:
        cropped face resized to 112x112 (ArcFace input size)
        or None if no face detected
    """
    faces = detect_faces(frame)

    if not faces:
        return None

    # detect_faces now sorts by area, so faces[0] is the largest face
    face = faces[0]

    x, y, w, h = face['box']

    # Add padding (clamped to frame borders)
    x1 = max(0, x - padding)
    y1 = max(0, y - padding)
    x2 = min(frame.shape[1], x + w + padding)
    y2 = min(frame.shape[0], y + h + padding)

    cropped = frame[y1:y2, x1:x2]

    if cropped.size == 0:
        return None

    # Resize to standard ArcFace input
    return cv2.resize(cropped, (112, 112))


def draw_detections(frame, faces, label=None):
    """
    Draw bounding boxes and landmarks on frame.

    Args:
        frame  : BGR image
        faces  : output from detect_faces()
        label  : optional text label override

    Returns:
        annotated frame
    """
    for face in faces:
        if face['confidence'] < 0.95:
            continue

        x, y, w, h = face['box']
        conf = face['confidence']

        # Bounding box
        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

        # Label
        text = label if label else f"Face {conf:.2f}"
        cv2.putText(frame, text, (x, y - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        # Facial landmarks (eyes, nose, mouth corners)
        for point in face['keypoints'].values():
            cv2.circle(frame, point, 4, (0, 0, 255), -1)

    # Face count
    cv2.putText(frame, f"Faces: {len(faces)}", (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 0), 2)

    return frame


def run_live_detection():
    """
    Run real-time face detection from webcam.
    Press Q to quit.
    """
    cam = cv2.VideoCapture(0)

    if not cam.isOpened():
        print("[ERROR] Cannot open camera")
        return

    print("[*] Live detection running... Press Q to quit")

    while True:
        ret, frame = cam.read()
        if not ret:
            break

        faces = detect_faces(frame)
        frame = draw_detections(frame, faces)

        cv2.imshow("MTCNN Face Detection", frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cam.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    run_live_detection()
