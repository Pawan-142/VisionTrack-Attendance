import { useState, useEffect, useRef } from 'react';
import { Camera, Play, Square, Users, Clock, AlertCircle, ShieldAlert, Sparkles, CheckCircle2, Video, SwitchCamera, Volume2, VolumeX } from 'lucide-react';

// Web Audio sound synthesizer (No external mp3 files needed)
function playSound(type = 'chime') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (type === 'chime') {
      // Pleasant double-chime for verified attendance
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.08);
        osc.stop(ctx.currentTime + i * 0.08 + 0.35);
      });
    } else if (type === 'alert') {
      // Short buzzer for spoof/error
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 180;
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (e) {
    // AudioContext blocked or not supported
  }
}

function fmtAMPM(timeStr) {
  if (!timeStr) return '';
  const str = String(timeStr).trim();
  if (str.toUpperCase().includes('AM') || str.toUpperCase().includes('PM')) return str;
  const parts = str.split(':');
  if (parts.length < 2) return str;
  let h = parseInt(parts[0], 10);
  const m = parts[1].slice(0, 2);
  const s = parts.length > 2 ? `:${parts[2].slice(0, 2)}` : '';
  if (isNaN(h)) return str;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  h = h ? h : 12;
  return `${String(h).padStart(2, '0')}:${m}${s} ${ampm}`;
}

const COURSE_SPECIALIZATIONS = {
  'B.Tech': ['CSE', 'IT', 'AI & ML', 'Data Science', 'Cyber Security'],
  'BCA': ['Web Development', 'Mobile App Development', 'Cloud Computing', 'Data Analytics', 'Software Development'],
  'M.Tech': ['CSE', 'AI & ML', 'Cyber Security'],
  'MCA': ['Software Development', 'AI & ML', 'Data Science', 'Cloud Computing', 'Cyber Security'],
  'MBA': ['Finance', 'Marketing']
};

const deriveCourse = (dept = '', year = '') => {
  const d = (dept || '').trim();
  const y = (year || '').trim().toLowerCase();
  if (y.startsWith('pg')) return 'M.Tech';
  if (d === 'Finance' || d === 'Marketing') return 'MBA';
  if (['Web Development', 'Mobile App Development', 'Data Analytics'].includes(d)) return 'BCA';
  return 'B.Tech';
};

export default function Session({ subjects, stats, toast, authFetch, user, tabParams }) {
  const [form, setForm] = useState({
    course: tabParams?.course || (tabParams?.year ? deriveCourse(tabParams?.dept, tabParams?.year) : 'M.Tech'),
    subject_id: tabParams?.subject || '',
    faculty: user?.name || '',
    department: tabParams?.dept || '',
    year: tabParams?.year || '',
    academic_year: tabParams?.academic_year || ''
  });
  const [isActive, setIsActive] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [presentCount, setPresentCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [startTime, setStartTime] = useState(null);
  const [cameraMode, setCameraMode] = useState('client'); // 'client' (browser) or 'server' (OpenCV local)
  const [facingMode, setFacingMode] = useState('user'); // 'user' (front) or 'environment' (rear back camera)
  const isSelfie = facingMode === 'user';
  const [sectionSubjects, setSectionSubjects] = useState([]);
  const [sectionsList, setSectionsList] = useState([]);
  const [recentAttendees, setRecentAttendees] = useState([]);
  const [spoofAlert, setSpoofAlert] = useState(false);

  // Sync form when tabParams changes (e.g. from Take Attendance button)
  useEffect(() => {
    if (tabParams) {
      const pYear = tabParams.year || '';
      const pCourse = tabParams.course || (pYear.toLowerCase().startsWith('pg') ? 'M.Tech' : deriveCourse(tabParams.dept, pYear));
      setForm(f => ({
        ...f,
        course: pCourse,
        department: tabParams.dept || f.department,
        year: pYear || f.year,
        academic_year: tabParams.academic_year || f.academic_year,
        subject_id: tabParams.subject || f.subject_id
      }));
    }
  }, [tabParams]);

  // Refs for client camera and HUD smoothing
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const processingRef = useRef(false);
  const lastFacesRef = useRef([]);
  const emptyCountRef = useRef(0);
  const spoofCountRef = useRef(0);
  const wrongClassRef = useRef(0);

  // Diagnostics & Tab States (#12 Diagnostic Mode support)
  const [activeTab, setActiveTab] = useState('attendees'); // 'attendees' or 'diagnostics'
  const [currentFace, setCurrentFace] = useState(null);
  const [clientFps, setClientFps] = useState(0);
  const fpsRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const livenessHistoryRef = useRef([]);
  const [verificationLogs, setVerificationLogs] = useState([]);

  // Load system settings default camera mode
  useEffect(() => {
    authFetch('/api/settings')
      .then(r => r.json())
      .then(cfg => {
        if (cfg?.camera_mode) setCameraMode(cfg.camera_mode);
      })
      .catch(() => {});
  }, [authFetch]);

  const [metaDepts, setMetaDepts] = useState([]);
  const [metaAYs, setMetaAYs] = useState([]);
  const [metaCourses, setMetaCourses] = useState(['B.Tech', 'BCA', 'M.Tech', 'MCA', 'MBA']);

  const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];

  function normalizeAY(ay) {
    if (!ay) return '';
    ay = String(ay).trim();
    const m = ay.match(/^(\d{4})-(\d{2})$/);
    if (m) return `${m[1]}-20${m[2]}`;
    return ay;
  }

  const isMastersCourse = (c) => {
    if (!c) return false;
    const str = String(c).toLowerCase().trim();
    return str.includes('m.tech') || str.includes('mtech') || str.includes('mca') || str.includes('mba') || str.includes('m.sc') || str.startsWith('m.');
  };

  useEffect(() => {
    Promise.all([
      authFetch('/api/departments').then(r => r.json()).catch(() => []),
      authFetch('/api/academic_years').then(r => r.json()).catch(() => []),
      authFetch('/api/courses').then(r => r.json()).catch(() => [])
    ]).then(([d, ay, c]) => {
      if (Array.isArray(d)) setMetaDepts(d);
      if (Array.isArray(ay)) setMetaAYs(ay.map(normalizeAY));
      if (Array.isArray(c) && c.length > 0) setMetaCourses(c);
    });
  }, [authFetch]);

  const isTeacher = user?.role === 'teacher';
  const teacherClasses = stats?.teacher_classes || [];

  const safeSections = Array.isArray(sectionsList) ? sectionsList : [];
  const safeMetaDepts = Array.isArray(metaDepts) ? metaDepts : [];
  const safeMetaAYs = Array.isArray(metaAYs) ? metaAYs : [];

  const availableDepts = (() => {
    if (isTeacher && teacherClasses.length > 0) {
      return [...new Set(teacherClasses.map(c => c?.dept))].filter(Boolean).sort();
    }
    if (form.course && COURSE_SPECIALIZATIONS[form.course]) {
      return COURSE_SPECIALIZATIONS[form.course];
    }
    return safeMetaDepts.slice().sort();
  })();

  const getYearsForCourse = (cName) => {
    if (!cName) return ['1st Year', '2nd Year', '3rd Year', '4th Year'];
    const searchStr = String(cName).toLowerCase().trim();
    if (Array.isArray(metaCourses)) {
      const foundObj = metaCourses.find(item => {
        const name = typeof item === 'object' ? item.code : item;
        return String(name).toLowerCase().trim() === searchStr;
      });
      if (foundObj && typeof foundObj === 'object' && Array.isArray(foundObj.years_list) && foundObj.years_list.length > 0) {
        return foundObj.years_list;
      }
    }
    if (searchStr.includes('m.tech') || searchStr.includes('mtech')) {
      return ['PG 1st Year', 'PG 2nd Year'];
    }
    if (searchStr === 'bca') {
      return ['1st Year', '2nd Year', '3rd Year'];
    }
    if (searchStr === 'mca' || searchStr === 'mba') {
      return ['1st Year', '2nd Year'];
    }
    return ['1st Year', '2nd Year', '3rd Year', '4th Year'];
  };

  const availableYears = (() => {
    let baseYears = getYearsForCourse(form.course);
    if (isTeacher && teacherClasses.length > 0) {
      const teacherYears = [...new Set(teacherClasses.map(c => c?.year))].filter(Boolean);
      if (teacherYears.length > 0) baseYears = teacherYears;
    }
    return baseYears;
  })();

  const availableAYs = (() => {
    if (isTeacher && teacherClasses.length > 0) {
      return [...new Set(teacherClasses.map(c => normalizeAY(c?.academic_year)))].filter(Boolean).sort();
    }
    return [...new Set([...safeSections.map(s => s?.academic_year), ...safeMetaAYs].map(normalizeAY))].filter(Boolean).sort();
  })();

  if (availableAYs.length === 0) availableAYs.push('2024-2025', '2025-2026', '2026-2027');

  if (form.department && !availableDepts.includes(form.department)) availableDepts.push(form.department);
  if (form.year && !availableYears.includes(form.year)) availableYears.push(form.year);
  if (form.academic_year && !availableAYs.includes(form.academic_year)) availableAYs.push(form.academic_year);

  // Auto-select faculty's mapped class if form is empty
  useEffect(() => {
    if (isTeacher && teacherClasses.length > 0 && !form.department) {
      const first = teacherClasses[0];
      setForm(prev => ({
        ...prev,
        department: first.dept || '',
        year: first.year || '',
        academic_year: normalizeAY(first.academic_year) || '',
        faculty: user?.name || prev.faculty
      }));
    }
  }, [isTeacher, teacherClasses, user?.name]);

  // Fetch subjects mapped to selected class cohort dynamically
  useEffect(() => {
    if (form.department && form.year && form.academic_year) {
      const crsParam = form.course ? `&course=${encodeURIComponent(form.course)}` : '';
      authFetch(`/api/sections/by-class?department=${encodeURIComponent(form.department)}&year=${encodeURIComponent(form.year)}&academic_year=${encodeURIComponent(form.academic_year)}${crsParam}`)
        .then(r => r.json())
        .then(data => { setSectionSubjects(data.subjects || []); })
        .catch(() => { setSectionSubjects([]); });
    } else {
      setSectionSubjects([]);
    }
  }, [form.course, form.department, form.year, form.academic_year, authFetch]);

  const safeSubjects = Array.isArray(subjects) ? subjects : [];
  const filteredSubjects = (() => {
    if (!form.department || !form.year) return [];

    const normDept = (form.department || '').trim().toLowerCase();
    const normYear = (form.year || '').trim();

    let list = [];
    // 1. If section has explicit mapped subjects from database for this cohort, prioritize them!
    if (sectionSubjects && sectionSubjects.length > 0) {
      const matched = safeSubjects.filter(s =>
        sectionSubjects.includes(s.code) ||
        sectionSubjects.includes(String(s.id)) ||
        sectionSubjects.some(sc => String(sc).toLowerCase() === String(s.code).toLowerCase())
      );
      if (matched.length > 0) {
        list = matched;
      }
    }

    // 2. Otherwise match by department and class metadata
    if (list.length === 0) {
      list = safeSubjects.filter(s => {
        const subDept = (s.department || '').trim().toLowerCase();
        if (subDept && subDept !== normDept) return false;

        const cls = Array.isArray(s.classes) ? s.classes : [];
        if (cls.length > 0) {
          return cls.some(c => {
            const cDept = (c.dept || '').trim().toLowerCase();
            const cYear = (c.year || '').trim();
            const deptOk = !normDept || cDept === normDept;
            const yearOk = cYear === normYear ||
              (normYear === '2nd Year' && cYear === 'PG 2nd Year') ||
              (normYear === '1st Year' && cYear === 'PG 1st Year') ||
              (normYear === 'PG 2nd Year' && cYear === '2nd Year') ||
              (normYear === 'PG 1st Year' && cYear === '1st Year');
            return deptOk && yearOk;
          });
        }

        return true;
      });
    }

    // 3. If tabParams passed a specific subject ID or code, ensure it is always included!
    if (tabParams?.subject) {
      const targetSub = safeSubjects.find(s => String(s.id) === String(tabParams.subject) || String(s.code) === String(tabParams.subject));
      if (targetSub && !list.some(s => String(s.id) === String(targetSub.id))) {
        list = [targetSub, ...list];
      }
    }

    return list;
  })();


  // Check active session status on mount
  useEffect(() => {
    authFetch('/api/session/status')
      .then(r => r.json())
      .then(d => {
        if (d?.active) {
          setIsActive(true);
          setSessionId(d.session_id);
          setStartTime(Date.now());
        }
      }).catch(() => {});
  }, [authFetch]);

  // Elapsed timer
  useEffect(() => {
    if (!isActive || !startTime) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [isActive, startTime]);

  // Poll present count for server mode
  useEffect(() => {
    if (!isActive || !sessionId || cameraMode === 'client') return;
    const iv = setInterval(async () => {
      try {
        const d = await authFetch(`/api/stats?session_id=${sessionId}`).then(r => r.json());
        if (d?.present !== undefined) setPresentCount(d.present);
      } catch {}
    }, 3000);
    return () => clearInterval(iv);
  }, [isActive, sessionId, cameraMode, authFetch]);

  // ── Browser Camera Management (WebRTC / Canvas) ──
  useEffect(() => {
    if (isActive && cameraMode === 'client') {
      startBrowserCamera();
    } else {
      stopBrowserCamera();
    }
    return () => stopBrowserCamera();
  }, [isActive, cameraMode, facingMode]);

  const startBrowserCamera = async () => {
    stopBrowserCamera();
    // Allow mobile device camera hardware 150ms to release previous stream
    await new Promise(r => setTimeout(r, 150));

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Camera API is not supported in this browser. Please use Chrome or Safari.', 'error');
      return;
    }

    let stream = null;
    const constraintList = [
      // 1. Ideal high-res with selected facing mode
      { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: facingMode } }, audio: false },
      // 2. Standard resolution with facing mode
      { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: facingMode }, audio: false },
      // 3. Simple facing mode only
      { video: { facingMode: facingMode }, audio: false },
      // 4. Universal fallback (any camera)
      { video: true, audio: false }
    ];

    let lastErr = null;
    for (const c of constraintList) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        if (stream) break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (!stream) {
      toast('Could not access camera (' + facingMode + '): ' + (lastErr?.message || 'In use or permission denied'), 'error');
      return;
    }

    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.setAttribute('playsinline', 'true');
      videoRef.current.setAttribute('muted', 'true');
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch(e => console.warn('Video play deferred:', e));
      };
    }
  };

  const stopBrowserCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const toggleFacingMode = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    toast(`Switched to ${facingMode === 'user' ? 'Rear (Back)' : 'Front (Selfie)'} Camera`, 'info');
  };

  const fetchSessionData = async () => {
    if (!sessionId) return;
    try {
      const d = await authFetch(`/api/stats?session_id=${sessionId}`).then(r => r.json());
      if (d?.present !== undefined) setPresentCount(d.present);
    } catch {}
  };

  const smoothBoxRef = useRef(null);

  // Client Frame Processing Loop (Runs at high-speed 16 FPS with EMA smoothing)
  useEffect(() => {
    if (!isActive || cameraMode !== 'client') return;

    const captureAndSend = async () => {
      // Auto-release lock after 2 seconds to prevent permanent blocking on slow responses
      if (processingRef.current) {
        const elapsed = Date.now() - (processingRef._startTime || 0);
        if (elapsed < 2000) return;
      }
      processingRef.current = true;
      processingRef._startTime = Date.now();

      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const overlay = overlayCanvasRef.current;
        if (!canvas || !video) return;

        // Calculate client-side FPS
        const nowTime = performance.now();
        if (lastFrameTimeRef.current > 0) {
          const fps = 1000 / (nowTime - lastFrameTimeRef.current);
          fpsRef.current = Math.round(fpsRef.current * 0.8 + fps * 0.2);
          setClientFps(fpsRef.current);
        }
        lastFrameTimeRef.current = nowTime;

        const w = video.videoWidth || 640;
        const h = video.videoHeight || 480;

        if (overlay && (overlay.width !== w || overlay.height !== h)) {
          overlay.width = w;
          overlay.height = h;
        }

        // Send 400px frame at 0.65 quality (~8KB payload for ultra-fast <10ms mobile transfer)
        const sendW = Math.min(400, w);
        const sendH = Math.round(h * (sendW / w));
        if (canvas.width !== sendW || canvas.height !== sendH) {
          canvas.width = sendW;
          canvas.height = sendH;
        }

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, sendW, sendH);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.65);

        const res = await authFetch('/api/session/client-frame', {
          method: 'POST',
          body: JSON.stringify({
            image: dataUrl,
            session_id: sessionId,
            anti_spoofing: true
          })
        });

        if (res.ok) {
          const data = await res.json();
          
          if (overlay) {
            const octx = overlay.getContext('2d');
            octx.clearRect(0, 0, w, h);

            const serverW = data.frame_w || sendW;
            const serverH = data.frame_h || sendH;
            const scaleX = w / serverW;
            const scaleY = h / serverH;

            let facesList = data.faces || [];

            if (facesList.length === 0) {
              smoothBoxRef.current = null;
              octx.clearRect(0, 0, w, h);
              setCurrentFace(null);
              livenessHistoryRef.current = [];
            } else {
              // Apply client-side liveness smoothing and update diagnostics cache
              const primary = facesList[0];
              const currentLiveness = primary.is_real;
              livenessHistoryRef.current.push(currentLiveness);
              if (livenessHistoryRef.current.length > 8) {
                livenessHistoryRef.current.shift();
              }
              const realCount = livenessHistoryRef.current.filter(Boolean).length;
              const consensusLiveness = livenessHistoryRef.current.length < 3 
                ? currentLiveness 
                : (realCount / livenessHistoryRef.current.length >= 0.60);
              
              primary.is_real = consensusLiveness;
              
              // Map all details for diagnostics display
              setCurrentFace({
                ...primary,
                fps: fpsRef.current,
                cam_res: `${w}x${h}`,
                proc_res: `${sendW}x${sendH}`
              });

              // Add to verification logs list (throttle to add only when details differ or occasionally)
              const logEntry = {
                timestamp: new Date().toLocaleTimeString(),
                candidate: primary.best_match_name || 'Unknown',
                liveness: primary.is_real ? 'LIVE' : 'FAILED',
                liveness_score: primary.liveness_score,
                distance: primary.distance,
                status: primary.status || 'unknown'
              };
              setVerificationLogs(prev => {
                // Only add if last log is not identical to prevent rapid log flooding
                if (prev.length > 0 && prev[0].candidate === logEntry.candidate && prev[0].liveness === logEntry.liveness && prev[0].status === logEntry.status) {
                  return prev;
                }
                return [logEntry, ...prev].slice(0, 15);
              });

              let hasSpoof = false;

              facesList.forEach((f, idx) => {
                const [rawFx, rawFy, rawFw, rawFh] = f.box || [0,0,0,0];
                const targetFx = rawFx * scaleX;
                const targetFy = rawFy * scaleY;
                const targetFw = rawFw * scaleX;
                const targetFh = rawFh * scaleY;

                // Exponential Moving Average (EMA) smoothing for tight, jitter-free tracking
                let fx = targetFx, fy = targetFy, fw = targetFw, fh = targetFh;
                if (idx === 0) {
                  if (smoothBoxRef.current) {
                    const s = smoothBoxRef.current;
                    fx = Math.round(s.fx * 0.35 + targetFx * 0.65);
                    fy = Math.round(s.fy * 0.35 + targetFy * 0.65);
                    fw = Math.round(s.fw * 0.35 + targetFw * 0.65);
                    fh = Math.round(s.fh * 0.35 + targetFh * 0.65);
                  }
                  smoothBoxRef.current = { fx, fy, fw, fh };
                }

                const isReal = f.is_real;
                const status = f.status;
                const name = (f.name || 'Unknown').toUpperCase();
                const conf = f.distance ? Math.max(0, Math.round((1 - f.distance) * 100)) : 0;

                let color = '#3B82F6';
                let tag = `🔍 VERIFYING...`;

                const reason = f.liveness_reason || '';
                const isDistant = !isReal && (reason.toLowerCase().includes('small') || reason.toLowerCase().includes('distant') || reason.toLowerCase().includes('closer'));

                if (isDistant) {
                  color = '#F59E0B'; // Amber
                  tag = `⚠️ ALIGN CLOSER`;
                } else if (!isReal) {
                  color = '#EF4444';
                  tag = `🚨 FAKE FACE - PHOTO DETECTED (${Math.round((f.liveness_score||0)*100)}%)`;
                  hasSpoof = true;
                } else if (f.roll_no) {
                  if (status === 'wrong_class') {
                    color = '#F59E0B';
                    const sCourse = f.student_course || '';
                    const sDept = f.student_dept || '';
                    const sYear = f.student_year || '';
                    const parts = [sCourse, sDept, sYear].filter(Boolean);
                    const classInfo = parts.length > 0 ? ` [${parts.join(' ')}]` : '';
                    tag = `⚠️ ${name} — WRONG CLASS${classInfo}`;
                  } else if (status === 'verifying') {
                    color = '#3B82F6'; // Blue
                    tag = `🔍 VERIFYING — HOLD STILL`;
                  } else if (status === 'marked') {
                    color = '#10B981';
                    tag = `✓ ${name} — PRESENT`;
                  } else if (status === 'duplicate' || status === 'cooldown') {
                    color = '#10B981';
                    tag = `✓ ${name} — RECORDED (${conf}%)`;
                  } else {
                    color = '#3B82F6';
                    tag = `✓ ${name} (${conf}%)`;
                  }
                } else {
                  color = '#38BDF8';
                  tag = `❓ UNENROLLED / UNKNOWN FACE`;
                }

                // Responsive Font & Pill Sizing
                const fontSize = Math.max(16, Math.min(24, Math.round(w * 0.032)));
                const pillH = fontSize + 14;
                const cornerLen = Math.max(18, Math.round(fw * 0.20));

                // Tight, Sleek HUD Frame
                octx.save();
                octx.shadowColor = color;
                octx.shadowBlur = 10;
                octx.strokeStyle = color;
                octx.lineWidth = 3.5;
                octx.strokeRect(fx, fy, fw, fh);

                // Solid Corner Brackets (5px thick)
                octx.lineWidth = 5.5;
                octx.beginPath(); octx.moveTo(fx, fy + cornerLen); octx.lineTo(fx, fy); octx.lineTo(fx + cornerLen, fy); octx.stroke();
                octx.beginPath(); octx.moveTo(fx + fw - cornerLen, fy); octx.lineTo(fx + fw, fy); octx.lineTo(fx + fw, fy + cornerLen); octx.stroke();
                octx.beginPath(); octx.moveTo(fx, fy + fh - cornerLen); octx.lineTo(fx, fy + fh); octx.lineTo(fx + cornerLen, fy + fh); octx.stroke();
                octx.beginPath(); octx.moveTo(fx + fw - cornerLen, fy + fh); octx.lineTo(fx + fw, fy + fh); octx.lineTo(fx + fw, fy + fh - cornerLen); octx.stroke();
                octx.restore();

                // High-Contrast Tag Pill
                octx.font = `bold ${fontSize}px 'Inter', system-ui, -apple-system, sans-serif`;
                const textWidth = octx.measureText(tag).width;
                const pillW = textWidth + 20;
                const pillY = Math.max(6, fy - pillH - 5);

                octx.save();
                octx.shadowColor = 'rgba(0, 0, 0, 0.7)';
                octx.shadowBlur = 8;
                octx.fillStyle = color;
                if (octx.roundRect) {
                  octx.beginPath();
                  octx.roundRect(fx, pillY, pillW, pillH, 7);
                  octx.fill();
                } else {
                  octx.fillRect(fx, pillY, pillW, pillH);
                }
                octx.restore();

                // White bold text (un-mirrored if in selfie mode so it reads normally)
                octx.save();
                if (isSelfie) {
                  const textCenter = fx + pillW / 2;
                  octx.translate(textCenter, 0);
                  octx.scale(-1, 1);
                  octx.translate(-textCenter, 0);
                }
                octx.fillStyle = '#FFFFFF';
                octx.textBaseline = 'middle';
                octx.fillText(tag, fx + 10, pillY + (pillH / 2));
                octx.restore();
              });

              const wrongClassFace = facesList.find(f => f.status === 'wrong_class' && f.roll_no && f.is_real);
              if (wrongClassFace && wrongClassFace.name) {
                if (!wrongClassRef.current || (Date.now() - wrongClassRef.current) > 5000) {
                  wrongClassRef.current = Date.now();
                  const sCourse = wrongClassFace.student_course || '';
                  const sDept = wrongClassFace.student_dept || '';
                  const sYear = wrongClassFace.student_year || '';
                  const parts = [sCourse, sDept, sYear].filter(Boolean);
                  const info = parts.length > 0 ? ` (${parts.join(' ')})` : '';
                  toast(`⚠️ Notice: ${wrongClassFace.name}${info} is registered in a different class.`, 'warn');
                }
              }

              if (hasSpoof) {
                spoofCountRef.current += 1;
                if (spoofCountRef.current === 1) {
                  toast("⚠️ Photo/Spoof Detected! No real person present.", "error");
                }
                if (spoofCountRef.current === 3) playSound('alert');
              } else {
                spoofCountRef.current = 0;
              }
              setSpoofAlert(hasSpoof);
            }

            // Handle newly marked students
            if (data.newly_marked && data.newly_marked.length > 0) {
              playSound('chime');
              data.newly_marked.forEach(m => {
                toast(`Attendance Marked: ${m.name} (${m.roll_no})`, 'success');
              });
              setRecentAttendees(prev => [
                ...data.newly_marked.map(m => ({
                  name: m.name,
                  roll_no: m.roll_no,
                  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                  confidence: m.confidence || 98
                })),
                ...prev
              ].slice(0, 15));
              fetchSessionData();
            }
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        processingRef.current = false;
      }
    };

    const interval = setInterval(captureAndSend, 110);
    return () => clearInterval(interval);
  }, [isActive, cameraMode, sessionId, authFetch, isSelfie]);

  const fmtTime = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  const handleStart = async e => {
    e.preventDefault();
    if (!form.subject_id) { toast('Select a subject first', 'warn'); return; }
    if (!form.department || !form.year) { toast('Select a class cohort first', 'warn'); return; }
    try {
      const res = await authFetch('/api/session/start', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        setIsActive(true);
        setSessionId(data.session_id);
        setStartTime(Date.now());
        setElapsed(0);
        setPresentCount(0);
        setRecentAttendees([]);
        toast('Session started! Camera is active.', 'success');
      } else {
        toast(data.detail || 'Failed to start session.', 'error');
      }
    } catch { toast('Cannot connect to backend.', 'error'); }
  };

  const handleStop = async () => {
    try {
      await authFetch('/api/session/stop', { method: 'POST' });
    } catch {}
    stopBrowserCamera();
    setIsActive(false);
    setSessionId(null);
    setElapsed(0);
    setStartTime(null);
    toast(`Session ended — ${presentCount} student(s) marked present.`, 'success');
  };

  const selectedSubject = safeSubjects.find(s => String(s.id) === String(form.subject_id) || s.code === form.subject_id);

  return (
    <div style={{ maxWidth: '100%' }}>
      {/* Session Controls */}
      <div className="metric-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="metric-title" style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Live Attendance Session</div>
            <div style={{ display: 'flex', background: 'var(--bg-card)', padding: '3px 6px', borderRadius: 8, border: '1px solid var(--border-color)', gap: 4, fontSize: '0.8rem' }}>
              <button
                type="button"
                onClick={() => !isActive && setCameraMode('client')}
                style={{
                  background: cameraMode === 'client' ? 'var(--primary)' : 'transparent',
                  color: cameraMode === 'client' ? '#fff' : 'var(--text-muted)',
                  border: 'none', borderRadius: 5, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem'
                }}
              >
                <Video size={13} /> Browser Webcam
              </button>
              <button
                type="button"
                onClick={() => !isActive && setCameraMode('server')}
                style={{
                  background: cameraMode === 'server' ? 'var(--primary)' : 'transparent',
                  color: cameraMode === 'server' ? '#fff' : 'var(--text-muted)',
                  border: 'none', borderRadius: 5, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem'
                }}
              >
                <Camera size={13} /> Server USB
              </button>
            </div>
          </div>

          {isActive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {cameraMode === 'client' && (
                <button
                  onClick={toggleFacingMode}
                  className="btn btn-outline"
                  style={{ padding: '4px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  <SwitchCamera size={14} /> {facingMode === 'user' ? 'Front Cam' : 'Rear Cam'}
                </button>
              )}
              <div className="live-indicator">
                <span className="live-dot" /> LIVE AI TRACKING
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                <Clock size={14} /> {fmtTime(elapsed)}
              </div>
            </div>
          )}
        </div>

      {!isActive ? (
        <form onSubmit={handleStart}>
          <div className="session-form-grid">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Course / Degree</label>
              <select
                className="form-select"
                value={form.course || (form.year?.toLowerCase().startsWith('pg') ? 'M.Tech' : 'B.Tech')}
                onChange={e => {
                  const selectedCourse = e.target.value;
                  setForm(f => {
                    let newYear = f.year;
                    if (selectedCourse === 'M.Tech' && !newYear.toLowerCase().startsWith('pg')) {
                      newYear = '';
                    } else if (selectedCourse === 'B.Tech' && newYear.toLowerCase().startsWith('pg')) {
                      newYear = '';
                    }
                    return { ...f, course: selectedCourse, year: newYear, department: '', subject_id: '' };
                  });
                }}
                disabled={tabParams?.locked}
              >
                <option value="">Select Course</option>
                {metaCourses.map(c => {
                  const code = typeof c === 'object' ? c.code : c;
                  return <option key={code} value={code}>{code}</option>;
                })}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Department *</label>
              <select
                required
                className="form-select"
                value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value, subject_id: '' }))}
                disabled={tabParams?.locked}
              >
                <option value="">Select Dept</option>
                {availableDepts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Year *</label>
              <select
                required
                className="form-select"
                value={form.year}
                onChange={e => {
                  const y = e.target.value;
                  let autoCourse = form.course;
                  if (y.toLowerCase().startsWith('pg')) {
                    autoCourse = 'M.Tech';
                  } else if (autoCourse === 'M.Tech' && !y.toLowerCase().startsWith('pg')) {
                    autoCourse = 'B.Tech';
                  }
                  setForm(f => ({ ...f, year: y, course: autoCourse, subject_id: '' }));
                }}
                disabled={tabParams?.locked}
              >
                <option value="">Select Year</option>
                {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Acad Year *</label>
              <select
                required
                className="form-select"
                value={form.academic_year}
                onChange={e => setForm(f => ({ ...f, academic_year: e.target.value, subject_id: '' }))}
                disabled={tabParams?.locked}
              >
                <option value="">Select AY</option>
                {availableAYs.map(ay => <option key={ay} value={ay}>{ay}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Subject *</label>
              <select
                required
                className="form-select"
                value={String(form.subject_id || '')}
                onChange={e => setForm(f => ({ ...f, subject_id: e.target.value }))}
                disabled={tabParams?.locked || !form.department || !form.year || !form.academic_year || filteredSubjects.length === 0}
              >
                <option value="">
                  {!form.department || !form.year || !form.academic_year
                    ? '— Select Filters first —'
                    : filteredSubjects.length === 0
                      ? '— No subjects mapped —'
                      : '— Select Subject —'}
                </option>
                {filteredSubjects.map(s => <option key={s.id} value={String(s.id)}>{s.code} - {s.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Faculty Name</label>
              <input
                className="form-input"
                placeholder="Your name"
                value={form.faculty}
                onChange={e => setForm(f => ({ ...f, faculty: e.target.value }))}
              />
            </div>
            <div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Play size={15} fill="currentColor" /> Start Session
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div className="alert alert-success" style={{ flex: 1, margin: 0, padding: '10px 14px' }}>
            <Users size={16} style={{ flexShrink: 0 }} />
            <span>
              Session active — <strong>{selectedSubject?.name || 'Subject'}</strong> ({[(form.year?.toLowerCase().startsWith('pg') ? 'M.Tech' : (form.course || 'M.Tech')), form.department, form.year].filter(Boolean).join(' ')}).
            </span>
          </div>
          <button onClick={handleStop} className="btn btn-danger" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, height: 40 }}>
            <Square size={14} fill="currentColor" /> Stop Session
          </button>
        </div>
      )}
    </div>

      {/* Stats row when active */}
      {isActive && (
        <div className="metrics-grid" style={{ marginBottom: 16 }}>
          <div className="metric-card" style={{ padding: 14 }}>
            <div className="metric-header"><span>Present</span></div>
            <div className="metric-value" style={{ color: 'var(--success)', fontSize: '1.8rem' }}>{presentCount}</div>
            <div className="metric-label">Marked students</div>
          </div>
          <div className="metric-card" style={{ padding: 14 }}>
            <div className="metric-header"><span>Anti-Spoofing</span></div>
            <div className="metric-value" style={{ color: spoofAlert ? '#EF4444' : '#10B981', fontSize: '1.3rem' }}>
              {spoofAlert ? 'ALERT' : 'ACTIVE'}
            </div>
            <div className="metric-label">Dual-cue liveness</div>
          </div>
          <div className="metric-card" style={{ padding: 14 }}>
            <div className="metric-header"><span>Duration</span></div>
            <div className="metric-value" style={{ fontSize: '1.5rem' }}>{fmtTime(elapsed)}</div>
            <div className="metric-label">Elapsed time</div>
          </div>
        </div>
      )}

      {/* Camera Feed & Live Attendee Stream Layout */}
      <div className="session-media-grid">
        {/* Video HUD */}
        <div className="video-container" style={{ position: 'relative', width: '100%', minHeight: 460, height: '60vh', maxHeight: 620, borderRadius: 16, overflow: 'hidden', background: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isActive ? (
            cameraMode === 'client' ? (
              <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                    transform: isSelfie ? 'scaleX(-1)' : 'none'
                  }}
                />
                {/* Overlay canvas for bounding boxes */}
                <canvas
                  ref={overlayCanvasRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    pointerEvents: 'none',
                    transform: isSelfie ? 'scaleX(-1)' : 'none'
                  }}
                />
                <canvas ref={canvasRef} style={{ display: 'none' }} />

                {/* Mobile Camera Switch Overlay Button */}
                <button
                  onClick={toggleFacingMode}
                  style={{
                    position: 'absolute',
                    bottom: 12,
                    right: 12,
                    background: 'rgba(0,0,0,0.65)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.3)',
                    padding: '8px 12px',
                    borderRadius: 30,
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    backdropFilter: 'blur(4px)',
                    zIndex: 10
                  }}
                >
                  <SwitchCamera size={16} /> {facingMode === 'user' ? 'Switch to Rear Cam' : 'Switch to Front Cam'}
                </button>
              </div>
            ) : (
              <img
                src={`${import.meta.env.DEV ? 'http://' + window.location.hostname + ':8000' : ''}/video_feed?t=${sessionId}`}
                alt="Live Camera Feed"
                className="video-feed"
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            )
          ) : (
            <div className="video-placeholder" style={{ padding: '50px 20px', textAlign: 'center' }}>
              <Camera size={52} style={{ opacity: 0.25, marginBottom: 10 }} />
              <p style={{ fontSize: '1.05rem', fontWeight: 600, margin: '0 0 4px 0' }}>Ready for Face Verification</p>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                Select department, subject, and click <strong>Start Session</strong>
              </p>
            </div>
          )}
        </div>

        {/* Live Attendee & Diagnostics Sidebar */}
        {isActive && (
          <div className="metric-card" style={{ padding: 14 }}>
            {/* Tab Headers */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 8 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <button 
                  onClick={() => setActiveTab('attendees')} 
                  style={{
                    background: 'none',
                    border: 'none',
                    color: activeTab === 'attendees' ? 'var(--primary)' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    padding: '4px 0',
                    borderBottom: activeTab === 'attendees' ? '2px solid var(--primary)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <Users size={14} /> Attendees ({presentCount})
                </button>
                <button 
                  onClick={() => setActiveTab('diagnostics')} 
                  style={{
                    background: 'none',
                    border: 'none',
                    color: activeTab === 'diagnostics' ? 'var(--primary)' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    padding: '4px 0',
                    borderBottom: activeTab === 'diagnostics' ? '2px solid var(--primary)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <Sparkles size={14} /> Diagnostics
                </button>
              </div>
              {activeTab === 'attendees' && (
                <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>{presentCount} Total</span>
              )}
            </div>

            {/* TAB CONTENT: ATTENDEES LIST */}
            {activeTab === 'attendees' && (
              recentAttendees.length === 0 ? (
                <div style={{ padding: '24px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  <Clock size={24} style={{ opacity: 0.3, marginBottom: 6 }} />
                  <p style={{ margin: 0 }}>Scan student face in camera view...</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
                  {recentAttendees.map((att, idx) => (
                    <div
                      key={att.roll_no + idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: idx === 0 ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-card)',
                        border: idx === 0 ? '1px solid #10B981' : '1px solid var(--border-color)',
                        padding: '8px 10px',
                        borderRadius: 10,
                        gap: 10,
                        transition: 'all 0.3s ease'
                      }}
                    >
                      {/* Side-by-side Matched Face Photos */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ textAlign: 'center' }}>
                          <img
                            src={`/faces/${att.roll_no}/0.jpg`}
                            onError={(e) => { e.target.style.display = 'none'; }}
                            alt="Enrolled Photo"
                            style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', border: '2px solid #10B981', display: 'block' }}
                            title="Enrolled Reference Photo"
                          />
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>Enrolled</span>
                        </div>
                        {att.crop_b64 && (
                          <div style={{ textAlign: 'center' }}>
                            <img
                              src={att.crop_b64.startsWith('data:') ? att.crop_b64 : `data:image/jpeg;base64,${att.crop_b64}`}
                              alt="Live Frame"
                              style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--primary)', display: 'block' }}
                              title="Live Verified Frame"
                            />
                            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>Live</span>
                          </div>
                        )}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{att.roll_no} &bull; {fmtAMPM(att.time)}</div>
                      </div>

                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10B981' }}>{att.confidence}%</span>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Matched</div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* TAB CONTENT: DIAGNOSTICS & SYSTEM PIPELINE PANEL */}
            {activeTab === 'diagnostics' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 380, overflowY: 'auto', fontSize: '0.8rem', color: 'var(--text-main)' }}>
                {/* Real-time stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 10, border: '1px solid var(--border-color)' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Camera FPS:</span>
                    <strong style={{ marginLeft: 4, color: 'var(--primary)' }}>{clientFps} fps</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Resolutions:</span>
                    <strong style={{ marginLeft: 4, fontSize: '0.72rem' }}>{currentFace ? `${currentFace.cam_res} ➔ ${currentFace.proc_res}` : 'N/A'}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Face Box:</span>
                    <strong style={{ marginLeft: 4 }}>{currentFace && currentFace.box ? `${currentFace.box[2]}x${currentFace.box[3]} px` : 'N/A'}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Anti-Spoof:</span>
                    <strong style={{ marginLeft: 4, color: spoofAlert ? '#EF4444' : '#10B981' }}>{spoofAlert ? 'ALERT' : 'ACTIVE'}</strong>
                  </div>
                </div>

                {/* Pipeline / Authoritative Verification State Machine */}
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 10, border: '1px solid var(--border-color)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--primary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Pipeline Verification Steps</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>1. Bounding Box Detection</span>
                      <span style={{ color: currentFace ? '#10B981' : 'var(--text-muted)' }}>{currentFace ? '✓ DETECTED' : '◯ WAITING'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>2. Minimum Dimensions Check</span>
                      <span style={{ color: currentFace ? (currentFace.is_real || currentFace.liveness_reason.toLowerCase().indexOf('small') === -1 ? '#10B981' : '#EF4444') : 'var(--text-muted)' }}>
                        {currentFace ? (currentFace.is_real || currentFace.liveness_reason.toLowerCase().indexOf('small') === -1 ? '✓ GOOD' : '✗ TOO SMALL') : '◯ WAITING'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>3. Liveness Analysis Check</span>
                      <span style={{ color: currentFace ? (currentFace.is_real ? '#10B981' : '#EF4444') : 'var(--text-muted)' }}>
                        {currentFace ? (currentFace.is_real ? '✓ LIVE FACE' : `✗ SPOOFED`) : '◯ WAITING'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>4. Embedding Identification</span>
                      <span style={{ color: currentFace ? (currentFace.best_match_name !== 'Unknown' ? '#10B981' : '#F59E0B') : 'var(--text-muted)' }}>
                        {currentFace ? (currentFace.best_match_name !== 'Unknown' ? `✓ ${currentFace.best_match_name.split(' ')[0]}` : '✗ UNKNOWN') : '◯ WAITING'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Score meters / bars */}
                {currentFace && (
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 10, border: '1px solid var(--border-color)' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--primary)', marginBottom: 8, textTransform: 'uppercase' }}>Face Quality & Match Metrics</div>
                    
                    {/* ArcFace Cosine Distance */}
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span>ArcFace Distance (Best vs. 2nd):</span>
                        <strong>{currentFace.distance} vs. {currentFace.second_match_distance}</strong>
                      </div>
                      <div style={{ height: 4, background: '#1E293B', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, (currentFace.distance / 1.0) * 100)}%`, background: currentFace.distance < 0.53 ? '#10B981' : '#EF4444' }} />
                      </div>
                      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Threshold: 0.53 (lower distance is better match)</span>
                    </div>

                    {/* Moiré Score */}
                    {currentFace.liveness_details && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span>Moiré Pattern Ratio:</span>
                          <strong>{currentFace.liveness_details.moire_score}</strong>
                        </div>
                        <div style={{ height: 4, background: '#1E293B', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, (currentFace.liveness_details.moire_score / 1.0) * 100)}%`, background: currentFace.liveness_details.moire_score >= 0.50 ? '#10B981' : '#EF4444' }} />
                        </div>
                        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Threshold: &gt;= 0.50 is natural (screens have Moire noise)</span>
                      </div>
                    )}

                    {/* FFT Ratio */}
                    {currentFace.liveness_details && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span>FFT Energy Ratio:</span>
                          <strong>{currentFace.liveness_details.fft_ratio}</strong>
                        </div>
                        <div style={{ height: 4, background: '#1E293B', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, (currentFace.liveness_details.fft_ratio / 1.0) * 100)}%`, background: currentFace.liveness_details.fft_ratio >= 0.49 ? '#10B981' : '#EF4444' }} />
                        </div>
                        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Threshold: &gt;= 0.49 (3D skin energy vs. flat printed paper)</span>
                      </div>
                    )}
                    
                    {/* Texture variance */}
                    {currentFace.liveness_details && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span>Laplacian Texture Variance:</span>
                          <strong>{currentFace.liveness_details.texture_var}</strong>
                        </div>
                        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Acceptable range: 15.0 - 1200.0 (below is blur, above is grid lines)</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Verification attempts logs table */}
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 10, border: '1px solid var(--border-color)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--primary)', marginBottom: 6, textTransform: 'uppercase' }}>Recent Verification Logs</div>
                  {verificationLogs.length === 0 ? (
                    <div style={{ padding: '10px 0', textAlign: 'center', color: 'var(--text-muted)' }}>No logs captured yet</div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.68rem', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-muted)' }}>
                            <th style={{ padding: '4px 2px' }}>Time</th>
                            <th style={{ padding: '4px 2px' }}>Candidate</th>
                            <th style={{ padding: '4px 2px' }}>Liveness</th>
                            <th style={{ padding: '4px 2px' }}>Dist</th>
                            <th style={{ padding: '4px 2px' }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {verificationLogs.map((log, index) => (
                            <tr key={index} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                              <td style={{ padding: '4px 2px', whiteSpace: 'nowrap' }}>{log.timestamp}</td>
                              <td style={{ padding: '4px 2px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }} title={log.candidate}>{log.candidate.split(' ')[0]}</td>
                              <td style={{ padding: '4px 2px', color: log.liveness === 'LIVE' ? '#10B981' : '#EF4444', fontWeight: 700 }}>{log.liveness}</td>
                              <td style={{ padding: '4px 2px' }}>{log.distance ? log.distance.toFixed(2) : '1.00'}</td>
                              <td style={{ padding: '4px 2px', textTransform: 'capitalize' }}>
                                <span style={{ color: log.status === 'marked' || log.status === 'present' ? '#10B981' : (log.status === 'verifying' ? '#3B82F6' : '#F59E0B') }}>
                                  {log.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {isActive && spoofAlert && (
        <div className="alert alert-danger" style={{ marginTop: 14, padding: '12px 16px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #EF4444', color: '#EF4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10, borderRadius: 8 }}>
          <AlertCircle size={20} style={{ flexShrink: 0 }} />
          <span>🚨 <strong>FAKE FACE / PHOTO DETECTED!</strong> Presentation attack detected. A real live person must be present to mark attendance.</span>
        </div>
      )}

      {isActive && (
        <div className="alert alert-info" style={{ marginTop: 14, padding: '10px 14px' }}>
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          Session <strong>#{sessionId}</strong> active. Each student face is automatically verified with anti-spoofing protection.
        </div>
      )}
    </div>
  );
}
