import { useState, useEffect, useRef } from 'react';
import { Modal } from '../components/Modal';
import { Users, GraduationCap, UserCheck, BookOpen, Search, X, Check, ArrowRight, Layout, Settings, Camera, SwitchCamera, Video, Sparkles } from 'lucide-react';


const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
const DEFAULT_DEPTS = ['AIML', 'CSE', 'ECE', 'MBA', 'EEE', 'MECH', 'CIVIL'];
const DEFAULT_AYS = ['2024-2025', '2025-2026', '2026-2027'];

export default function AdminPanel({ stats, subjects, onRefresh, toast, authFetch }) {
  const [activeTab, setActiveTab] = useState('students'); // 'students', 'teachers', 'subjects'
  
  // Roster / Directory Lists
  const [teachers, setTeachers] = useState([]);
  const [fetchingTeachers, setFetchingTeachers] = useState(false);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // ─── STUDENTS STATES ──────────────────────────────────────────
  const [enrollForm, setEnrollForm] = useState({ name: '', roll_no: '', email: '', course: '', dept: '', year: '', academic_year: '', force: false });
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [enrollKey, setEnrollKey] = useState(0); // cache-buster: changes each enrollment so browser fetches fresh stream
  const [editStudent, setEditStudent] = useState(null);
  const [historyStudent, setHistoryStudent] = useState(null);
  const [history, setHistory] = useState([]);

  // ─── WEBCAM ENROLLMENT MODAL STATES ─────────────────────────────
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollFacingMode, setEnrollFacingMode] = useState('user');
  const [enrollCapturing, setEnrollCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [enrollError, setEnrollError] = useState('');
  const enrollVideoRef = useRef(null);
  const enrollCanvasRef = useRef(null);
  const enrollStreamRef = useRef(null);

  const startEnrollCamera = async () => {
    stopEnrollCamera();
    await new Promise(r => setTimeout(r, 150));

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Camera API is not supported in this browser.', 'error');
      return;
    }

    let stream = null;
    const constraintList = [
      { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: enrollFacingMode } }, audio: false },
      { video: { facingMode: enrollFacingMode }, audio: false },
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
      toast('Could not access camera: ' + (lastErr?.message || 'In use or permission denied'), 'error');
      return;
    }

    enrollStreamRef.current = stream;
    if (enrollVideoRef.current) {
      enrollVideoRef.current.srcObject = stream;
      enrollVideoRef.current.setAttribute('playsinline', 'true');
      enrollVideoRef.current.setAttribute('muted', 'true');
      enrollVideoRef.current.onloadedmetadata = () => {
        enrollVideoRef.current?.play().catch(e => console.warn('Enroll video play deferred:', e));
      };
    }
  };

  const stopEnrollCamera = () => {
    if (enrollStreamRef.current) {
      enrollStreamRef.current.getTracks().forEach(t => {
        try { t.stop(); } catch {}
      });
      enrollStreamRef.current = null;
    }
    if (enrollVideoRef.current) {
      enrollVideoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (showEnrollModal) {
      setEnrollError('');
      startEnrollCamera();
    } else {
      stopEnrollCamera();
    }
    return () => stopEnrollCamera();
  }, [showEnrollModal, enrollFacingMode]);

  const handleCaptureAndSubmitEnrollment = async () => {
    setEnrollCapturing(true);
    setCaptureProgress(0);
    setEnrollError('');
    toast('Capturing face photos... Please hold still and tilt head slightly!', 'info');

    const frames = [];
    const video = enrollVideoRef.current;
    const canvas = enrollCanvasRef.current;

    if (!video || !canvas) {
      toast('Camera feed not ready', 'error');
      setEnrollCapturing(false);
      return;
    }

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    for (let i = 1; i <= 10; i++) {
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      frames.push(dataUrl);
      setCaptureProgress(i);
      await new Promise(r => setTimeout(r, 220));
    }

    toast('Extracting ArcFace facial embeddings...', 'info');

    try {
      const res = await authFetch('/api/enroll/client-frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...enrollForm,
          images: frames
        })
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        toast(`Successfully enrolled ${enrollForm.name} (${enrollForm.roll_no})!`, 'success');
        setShowEnrollModal(false);
        setEnrollForm({ name: '', roll_no: '', email: '', course: '', dept: '', year: '', academic_year: '', force: false });
        onRefresh();
      } else {
        const errMsg = data.detail || data.message || 'Enrollment failed';
        setEnrollError(errMsg);
        toast(errMsg, 'error');
      }
    } catch {
      setEnrollError('Network or server error during enrollment');
      toast('Network error during enrollment', 'error');
    } finally {
      setEnrollCapturing(false);
    }
  };

  // ─── TEACHERS STATES ──────────────────────────────────────────
  const [teacherForm, setTeacherForm] = useState({ name: '', username: '', password: '' });
  const [addingTeacher, setAddingTeacher] = useState(false);
  const [editTeacher, setEditTeacher] = useState(null); // Edit Details (Name, Password)
  const [mappingsTeacher, setMappingsTeacher] = useState(null); // Manage Mappings
  const [tempSubjects, setTempSubjects] = useState([]);
  const [tempClasses, setTempClasses] = useState([]);
  const [newClass, setNewClass] = useState({ dept: '', year: '', academic_year: '' });
  const [savingMappings, setSavingMappings] = useState(false);
  const [savingTeacherDetails, setSavingTeacherDetails] = useState(false);

  // ─── SUBJECTS STATES ──────────────────────────────────────────
  const [subjectForm, setSubjectForm] = useState({ code: '', name: '', dept: '' });
  const [addingSubject, setAddingSubject] = useState(false);
  const [mappingsSubject, setMappingsSubject] = useState(null);
  const [tempSubjectClasses, setTempSubjectClasses] = useState([]);
  const [newSubjectClass, setNewSubjectClass] = useState({ dept: '', year: '', academic_year: '' });
  const [savingSubjectMappings, setSavingSubjectMappings] = useState(false);

  // ─── SECTIONS STATES ──────────────────────────────────────────
  const [sections, setSections] = useState([]);
  const [fetchingSections, setFetchingSections] = useState(false);
  const [sectionForm, setSectionForm] = useState({ department: '', year: '', academic_year: '', subjects: [] });
  const [addingSection, setAddingSection] = useState(false);
  const [editSection, setEditSection] = useState(null); // {id, department, year, academic_year, subjects[]}
  const [tempSectionSubjects, setTempSectionSubjects] = useState([]);
  const [savingSectionSubjects, setSavingSectionSubjects] = useState(false);

  // ─── METADATA STATES ──────────────────────────────────────────
  const [deptsList, setDeptsList] = useState([]);
  const [academicYearsList, setAcademicYearsList] = useState([]);
  const [coursesList, setCoursesList] = useState([]);
  const [fetchingMetadata, setFetchingMetadata] = useState(false);
  const [newDeptCode, setNewDeptCode] = useState('');
  const [newAYCode, setNewAYCode] = useState('');
  const [newCourseCode, setNewCourseCode] = useState('');

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
    return str.includes('m.e') || str.includes('m.tech') || str.includes('mtech') || str.includes('mca') || str.includes('mba') || str.includes('m.sc') || str.startsWith('m.');
  };

  const getYearsForCourse = (c) => {
    if (!c) return ['1st Year', '2nd Year', '3rd Year', '4th Year', 'PG 1st Year', 'PG 2nd Year'];
    const searchStr = String(c).toLowerCase().trim();
    if (Array.isArray(coursesList)) {
      const foundObj = coursesList.find(item => {
        const name = typeof item === 'object' ? item.code : item;
        return String(name).toLowerCase().trim() === searchStr;
      });
      if (foundObj && typeof foundObj === 'object' && Array.isArray(foundObj.years_list) && foundObj.years_list.length > 0) {
        return foundObj.years_list;
      }
    }
    if (isMastersCourse(c)) {
      return ['PG 1st Year', 'PG 2nd Year', '1st Year', '2nd Year'];
    }
    return ['1st Year', '2nd Year', '3rd Year', '4th Year'];
  };

  const COURSE_SPECIALIZATIONS = {
    'B.Tech': ['CSE', 'IT', 'AI & ML', 'Data Science', 'Cyber Security'],
    'BCA': ['Web Development', 'Mobile App Development', 'Cloud Computing', 'Data Analytics', 'Software Development'],
    'M.Tech': ['CSE', 'AI & ML', 'Cyber Security'],
    'MCA': ['Software Development', 'AI & ML', 'Data Science', 'Cloud Computing', 'Cyber Security'],
    'MBA': ['Finance', 'Marketing']
  };

  const allDepts = [...new Set(Array.isArray(deptsList) ? deptsList : [])].sort();
  const allAYs = [...new Set((Array.isArray(academicYearsList) ? academicYearsList : []).map(normalizeAY))].sort();
  const allCourses = [...new Set((Array.isArray(coursesList) ? coursesList : []).map(c => typeof c === 'object' ? c.code : c))].sort();

  const fetchMetadata = async () => {
    setFetchingMetadata(true);
    try {
      const [dRes, ayRes, cRes] = await Promise.all([
        authFetch('/api/departments').then(r => r.json()).catch(() => []),
        authFetch('/api/academic_years').then(r => r.json()).catch(() => []),
        authFetch('/api/courses').then(r => r.json()).catch(() => []),
      ]);
      if (Array.isArray(dRes)) setDeptsList(dRes);
      if (Array.isArray(ayRes)) setAcademicYearsList(ayRes);
      if (Array.isArray(cRes)) setCoursesList(cRes);
    } catch (err) {
      console.error(err);
    }
    setFetchingMetadata(false);
  };

  const handleAddDept = async (e) => {
    e.preventDefault();
    if (!newDeptCode.trim()) return;
    try {
      const res = await authFetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: newDeptCode.trim() }),
      });
      if (res.ok) {
        toast('Department added successfully!');
        setNewDeptCode('');
        fetchMetadata();
      } else {
        const d = await res.json();
        toast(d.detail || 'Failed to add department', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
  };

  const handleDeleteDept = async (code) => {
    if (!window.confirm(`Delete department ${code}?`)) return;
    try {
      const res = await authFetch(`/api/departments/${code}`, { method: 'DELETE' });
      if (res.ok) {
        toast(`Removed department ${code}`);
        fetchMetadata();
      } else {
        toast('Failed to delete department', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
  };

  const handleAddAY = async (e) => {
    e.preventDefault();
    if (!newAYCode.trim()) return;
    try {
      const res = await authFetch('/api/academic_years', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalizeAY(newAYCode.trim()) }),
      });
      if (res.ok) {
        toast('Academic year added successfully!');
        setNewAYCode('');
        fetchMetadata();
      } else {
        const d = await res.json();
        toast(d.detail || 'Failed to add academic year', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
  };

  const handleDeleteAY = async (code) => {
    if (!window.confirm(`Delete academic year ${code}?`)) return;
    try {
      const res = await authFetch(`/api/academic_years/${code}`, { method: 'DELETE' });
      if (res.ok) {
        toast(`Removed academic year ${code}`);
        fetchMetadata();
      } else {
        toast('Failed to delete academic year', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
  };

  const [newCourseDuration, setNewCourseDuration] = useState(4);
  const [editingCourse, setEditingCourse] = useState(null);

  const handleAddCourse = async (e) => {
    e.preventDefault();
    if (!newCourseCode.trim()) return;
    try {
      const res = await authFetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: newCourseCode.trim(), duration_years: parseInt(newCourseDuration) || 4 }),
      });
      if (res.ok) {
        toast('Course added successfully!');
        setNewCourseCode('');
        setNewCourseDuration(4);
        fetchMetadata();
      } else {
        const d = await res.json();
        toast(d.detail || 'Failed to add course', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
  };

  const handleUpdateCourseDuration = async (code, durYears) => {
    try {
      const res = await authFetch(`/api/courses/${encodeURIComponent(code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, duration_years: parseInt(durYears) || 4 }),
      });
      if (res.ok) {
        toast(`Updated duration for ${code} to ${durYears} years!`, 'success');
        setEditingCourse(null);
        fetchMetadata();
      } else {
        const d = await res.json();
        toast(d.detail || 'Failed to update course duration', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
  };

  const handleDeleteCourse = async (code) => {
    if (!window.confirm(`Delete course ${code}?`)) return;
    try {
      const res = await authFetch(`/api/courses/${encodeURIComponent(code)}`, { method: 'DELETE' });
      if (res.ok) {
        toast(`Removed course ${code}`);
        fetchMetadata();
      } else {
        toast('Failed to delete course', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
  };

  // Fetch teacher directory
  const fetchTeachers = async () => {
    setFetchingTeachers(true);
    try {
      const res = await authFetch(`/api/teachers`);
      if (res.ok) {
        setTeachers(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
    setFetchingTeachers(false);
  };

  const fetchSections = async () => {
    setFetchingSections(true);
    try {
      const res = await authFetch(`/api/sections`);
      if (res.ok) setSections(await res.json());
    } catch (err) {
      console.error(err);
    }
    setFetchingSections(false);
  };

  useEffect(() => {
    fetchTeachers();
    fetchSections();
    fetchMetadata();
  }, []);


  // ─── STUDENTS LOGIC ───────────────────────────────────────────
  const handleEnroll = (e) => {
    e.preventDefault();
    if (!enrollForm.name.trim() || !enrollForm.roll_no.trim() || !enrollForm.course || !enrollForm.dept || !enrollForm.year || !enrollForm.academic_year) {
      toast('Please fill all required student details', 'warn');
      return;
    }
    setShowEnrollModal(true);
  };

  const handleEditStudent = async (e) => {
    e.preventDefault();
    try {
      let finalCourse = editStudent.course || '';
      if (!finalCourse || finalCourse === 'B.Tech') {
        if (String(editStudent.year || '').toLowerCase().startsWith('pg')) {
          finalCourse = 'M.Tech';
        }
      }
      const res = await authFetch(`/api/students/${editStudent.roll_no}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editStudent,
          course: finalCourse,
          dept: editStudent.department,
          department: editStudent.department,
        }),
      });
      if (res.ok) {
        toast('Student details updated successfully!');
        setEditStudent(null);
        onRefresh();
      } else {
        toast('Failed to update student details', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
  };

  const handleDeleteStudent = async (roll_no, name) => {
    if (!window.confirm(`Remove ${name} (${roll_no}) and delete their database records?`)) return;
    try {
      await authFetch(`/api/students/${roll_no}`, { method: 'DELETE' });
      toast(`Removed student ${name}`);
      onRefresh();
    } catch {
      toast('Failed to delete student', 'error');
    }
  };

  const handleViewHistory = async (s) => {
    try {
      const res = await authFetch(`/api/students/${s.roll_no}/history`);
      if (res.ok) {
        setHistory(await res.json());
        setHistoryStudent(s);
      }
    } catch {
      toast('Failed to load attendance history', 'error');
    }
  };

  // ─── TEACHERS LOGIC ───────────────────────────────────────────
  const handleAddTeacher = async (e) => {
    e.preventDefault();
    if (!teacherForm.name.trim() || !teacherForm.username.trim()) {
      toast('Name and Login Username/ID are required', 'warn');
      return;
    }
    const cleanUsername = teacherForm.username.trim().toLowerCase();
    const cleanPassword = teacherForm.password.trim() || cleanUsername;

    setAddingTeacher(true);
    try {
      const res = await authFetch(`/api/teachers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: teacherForm.name.trim(),
          username: cleanUsername,
          password: cleanPassword
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        toast(`Teacher registered! Login ID: ${cleanUsername}, Password: ${cleanPassword}`, 'success');
        setTeacherForm({ name: '', username: '', password: '' });
        fetchTeachers();
      } else {
        toast(data.message || 'Failed to register teacher', 'warn');
      }
    } catch {
      toast('Server error', 'error');
    }
    setAddingTeacher(false);
  };

  const handleEditTeacherDetails = async (e) => {
    e.preventDefault();
    setSavingTeacherDetails(true);
    try {
      const res = await authFetch(`/api/teachers/${editTeacher.username}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editTeacher.name.trim(),
          password: editTeacher.password || null
        })
      });
      if (res.ok) {
        toast('Teacher details updated successfully!');
        setEditTeacher(null);
        fetchTeachers();
      } else {
        toast('Failed to update teacher', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
    setSavingTeacherDetails(false);
  };

  const handleDeleteTeacher = async (username, name) => {
    if (!window.confirm(`Delete teacher account of ${name} (${username})?`)) return;
    try {
      const res = await authFetch(`/api/teachers/${username}`, { method: 'DELETE' });
      if (res.ok) {
        toast(`Removed teacher ${name}`);
        fetchTeachers();
      } else {
        toast('Failed to delete teacher account', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
  };

  const handleOpenMappings = (t) => {
    setMappingsTeacher(t);
    setTempSubjects(t.subjects || []);
    setTempClasses(t.classes || []);
    setNewClass({ dept: '', year: '', academic_year: '' });
  };

  const handleAddClassMapping = () => {
    if (!newClass.dept || !newClass.year || !newClass.academic_year) {
      toast('Select Department, Year, and Academic Year to add class', 'warn');
      return;
    }
    // Check for duplicates
    const duplicate = tempClasses.some(c => 
      c.dept === newClass.dept && c.year === newClass.year && c.academic_year === newClass.academic_year
    );
    if (duplicate) {
      toast('Class mapping already added', 'warn');
      return;
    }
    setTempClasses([...tempClasses, { ...newClass }]);
    setNewClass({ dept: '', year: '', academic_year: '' });
  };

  const handleRemoveClassMapping = (idx) => {
    setTempClasses(tempClasses.filter((_, i) => i !== idx));
  };

  const handleSubjectCheckbox = (code, checked) => {
    if (checked) {
      setTempSubjects([...tempSubjects, code]);
    } else {
      setTempSubjects(tempSubjects.filter(c => c !== code));
    }
  };

  const handleSaveMappings = async () => {
    setSavingMappings(true);
    let classesToSave = [...tempClasses];
    if (newClass.dept && newClass.year && newClass.academic_year) {
      const duplicate = classesToSave.some(c => 
        c.dept === newClass.dept && c.year === newClass.year && c.academic_year === newClass.academic_year
      );
      if (!duplicate) {
        classesToSave.push({ ...newClass });
      }
    }
    try {
      const res = await authFetch(`/api/teachers/${mappingsTeacher.username}/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjects: tempSubjects,
          classes: classesToSave
        })
      });
      if (res.ok) {
        toast('Teacher class & subject mappings updated!');
        setMappingsTeacher(null);
        fetchTeachers();
      } else {
        toast('Failed to save mappings', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
    setSavingMappings(false);
  };

  const handleOpenSubjectMappings = (s) => {
    setMappingsSubject(s);
    setTempSubjectClasses(s.classes || []);
    setNewSubjectClass({ dept: '', year: '', academic_year: '' });
  };

  const handleAddSubjectClassMapping = () => {
    if (!newSubjectClass.dept || !newSubjectClass.year || !newSubjectClass.academic_year) {
      toast('Select Department, Year, and Academic Year to add class', 'warn');
      return;
    }
    const duplicate = tempSubjectClasses.some(c => 
      c.dept === newSubjectClass.dept && c.year === newSubjectClass.year && c.academic_year === newSubjectClass.academic_year
    );
    if (duplicate) {
      toast('Class mapping already added', 'warn');
      return;
    }
    setTempSubjectClasses([...tempSubjectClasses, { ...newSubjectClass }]);
    setNewSubjectClass({ dept: '', year: '', academic_year: '' });
  };

  const handleRemoveSubjectClassMapping = (idx) => {
    setTempSubjectClasses(tempSubjectClasses.filter((_, i) => i !== idx));
  };

  const handleSaveSubjectMappings = async () => {
    setSavingSubjectMappings(true);
    let classesToSave = [...tempSubjectClasses];
    if (newSubjectClass.dept && newSubjectClass.year && newSubjectClass.academic_year) {
      const duplicate = classesToSave.some(c => 
        c.dept === newSubjectClass.dept && c.year === newSubjectClass.year && c.academic_year === newSubjectClass.academic_year
      );
      if (!duplicate) {
        classesToSave.push({ ...newSubjectClass });
      }
    }
    try {
      const res = await authFetch(`/api/subjects/${mappingsSubject.id || mappingsSubject.code}/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classes: classesToSave
        })
      });
      if (res.ok) {
        toast('Subject class mappings updated!');
        setMappingsSubject(null);
        onRefresh();
      } else {
        toast('Failed to save mappings', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
    setSavingSubjectMappings(false);
  };

  // ─── SUBJECTS LOGIC ───────────────────────────────────────────
  const handleAddSubject = async (e) => {
    e.preventDefault();
    setAddingSubject(true);
    try {
      const res = await authFetch(`/api/subjects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subjectForm),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        toast('Subject added successfully!');
        setSubjectForm({ code: '', name: '', dept: '' });
        onRefresh();
      } else {
        toast(data.detail || data.message || 'Subject code already exists', 'warn');
      }
    } catch {
      toast('Server error', 'error');
    }
    setAddingSubject(false);
  };

  const handleDeleteSubject = async (code) => {
    if (!window.confirm(`Delete subject ${code} and all associated logs?`)) return;
    try {
      await authFetch(`/api/subjects/${code}`, { method: 'DELETE' });
      toast(`Deleted subject ${code}`);
      onRefresh();
    } catch {
      toast('Failed to delete subject', 'error');
    }
  };

  // ─── SECTIONS LOGIC ───────────────────────────────────────────
  const handleSectionSubjectToggle = (code, checked) => {
    setSectionForm(f => ({
      ...f,
      subjects: checked ? [...f.subjects, code] : f.subjects.filter(c => c !== code)
    }));
  };

  const handleCreateSection = async (e) => {
    e.preventDefault();
    if (!sectionForm.department || !sectionForm.year || !sectionForm.academic_year) {
      toast('Select Department, Year, and Academic Year', 'warn');
      return;
    }
    if (sectionForm.subjects.length === 0) {
      toast('Select at least one subject for this section', 'warn');
      return;
    }
    setAddingSection(true);
    try {
      const res = await authFetch(`/api/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sectionForm),
      });
      const data = await res.json();
      if (data.status === 'ok') {
        toast('Section created successfully!');
        setSectionForm({ department: '', year: '', academic_year: '', subjects: [] });
        fetchSections();
      } else {
        toast(data.message || 'Section already exists for this class', 'warn');
      }
    } catch {
      toast('Server error', 'error');
    }
    setAddingSection(false);
  };

  const handleOpenEditSection = (s) => {
    setEditSection(s);
    setTempSectionSubjects([...( s.subjects || [])]);
  };

  const handleSaveSectionSubjects = async () => {
    setSavingSectionSubjects(true);
    try {
      const res = await authFetch(`/api/sections/${editSection.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjects: tempSectionSubjects }),
      });
      if (res.ok) {
        toast('Section subjects updated!');
        setEditSection(null);
        fetchSections();
      } else {
        toast('Failed to update section subjects', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
    setSavingSectionSubjects(false);
  };

  const handleDeleteSection = async (id, label) => {
    if (!window.confirm(`Delete section "${label}"?`)) return;
    try {
      const res = await authFetch(`/api/sections/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast(`Section deleted`);
        fetchSections();
      } else {
        toast('Failed to delete section', 'error');
      }
    } catch {
      toast('Server error', 'error');
    }
  };


  // ─── FILTERING / SEARCHING (ALL SORTED) ─────────────────────
  const naturalSort = (a, b, key = 'roll_no') => {
    const valA = String(a?.[key] || '');
    const valB = String(b?.[key] || '');
    return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
  };

  const studentsList = [...(stats.students || [])].sort((a, b) => naturalSort(a, b, 'roll_no'));
  const filteredStudents = studentsList.filter(s =>
    !searchQuery || `${s.name} ${s.roll_no} ${s.department} ${s.year} ${s.academic_year || ''}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredTeachers = [...teachers].sort((a, b) =>
    String(a.name || a.username || '').localeCompare(String(b.name || b.username || ''))
  ).filter(t =>
    !searchQuery || `${t.name} ${t.username}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredSubjects = [...subjects].sort((a, b) =>
    naturalSort(a, b, 'code')
  ).filter(s =>
    !searchQuery || `${s.code} ${s.name} ${s.department || ''}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const availableDepts = allDepts;
  
  const newClassYears = YEARS;
  const newClassAYs = allAYs;

  const newSubClassYears = YEARS;
  const newSubClassAYs = allAYs;

  const inp = { className: 'form-input', style: { marginBottom: 12 } };

  return (
    <>
      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div className="metric-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '20px 24px' }}>
          <div style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1', padding: 14, borderRadius: 12 }}>
            <GraduationCap size={28} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>Total Students</div>
            <h2 style={{ margin: '4px 0 0 0', fontSize: 28, fontWeight: 800 }}>{studentsList.length}</h2>
          </div>
        </div>
        <div className="metric-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '20px 24px' }}>
          <div style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: 14, borderRadius: 12 }}>
            <UserCheck size={28} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>Total Teachers</div>
            <h2 style={{ margin: '4px 0 0 0', fontSize: 28, fontWeight: 800 }}>{teachers.length}</h2>
          </div>
        </div>
        <div className="metric-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '20px 24px' }}>
          <div style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: 14, borderRadius: 12 }}>
            <BookOpen size={28} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>Total Subjects</div>
            <h2 style={{ margin: '4px 0 0 0', fontSize: 28, fontWeight: 800 }}>{subjects.length}</h2>
          </div>
        </div>
      </div>

      {/* Main Console Container */}
      <div className="metric-card" style={{ padding: 24 }}>
        {/* Hub Header & Navigation Tab Selector */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 24 }}>
          <div style={{ display: 'flex', background: 'var(--bg-sidebar)', borderRadius: 10, padding: 4 }}>
            <button
              onClick={() => { setActiveTab('students'); setSearchQuery(''); onRefresh(); }}
              style={{
                background: activeTab === 'students' ? 'var(--primary)' : 'none',
                color: activeTab === 'students' ? '#fff' : 'var(--text-muted)',
                border: 'none', padding: '10px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s'
              }}
            >
              <GraduationCap size={16} /> Students
            </button>
            <button
              onClick={() => { setActiveTab('teachers'); setSearchQuery(''); fetchTeachers(); }}
              style={{
                background: activeTab === 'teachers' ? 'var(--primary)' : 'none',
                color: activeTab === 'teachers' ? '#fff' : 'var(--text-muted)',
                border: 'none', padding: '10px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s'
              }}
            >
              <UserCheck size={16} /> Teachers
            </button>
            <button
              onClick={() => { setActiveTab('subjects'); setSearchQuery(''); onRefresh(); }}
              style={{
                background: activeTab === 'subjects' ? 'var(--primary)' : 'none',
                color: activeTab === 'subjects' ? '#fff' : 'var(--text-muted)',
                border: 'none', padding: '10px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s'
              }}
            >
              <BookOpen size={16} /> Subjects
            </button>
            <button
              onClick={() => { setActiveTab('sections'); setSearchQuery(''); fetchSections(); }}
              style={{
                background: activeTab === 'sections' ? 'var(--primary)' : 'none',
                color: activeTab === 'sections' ? '#fff' : 'var(--text-muted)',
                border: 'none', padding: '10px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s'
              }}
            >
              <Layout size={16} /> Sections
            </button>
            <button
              onClick={() => { setActiveTab('metadata'); setSearchQuery(''); fetchMetadata(); }}
              style={{
                background: activeTab === 'metadata' ? 'var(--primary)' : 'none',
                color: activeTab === 'metadata' ? '#fff' : 'var(--text-muted)',
                border: 'none', padding: '10px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s'
              }}
            >
              <Settings size={16} /> Metadata
            </button>
          </div>


          {/* Dynamic Search Box */}
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
            <input
              placeholder={`Search ${activeTab}...`}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="form-input"
              style={{ paddingLeft: 36, width: 260, height: 38, marginBottom: 0, fontSize: 13 }}
            />
          </div>
        </div>

        {/* ─── TAB CONTENT: STUDENTS ─────────────────────────────────── */}
        {activeTab === 'students' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 300px) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
            {/* Enrollment Form */}
            <div style={{ background: 'var(--bg-sidebar)', borderRadius: 16, padding: 18, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, color: 'var(--text-main)' }}>Enroll Student</div>
              <form onSubmit={handleEnroll} style={{ display: 'flex', flexDirection: 'column' }}>
                <input required placeholder="Full Name" value={enrollForm.name} onChange={e => setEnrollForm({ ...enrollForm, name: e.target.value })} pattern="[A-Za-z\s]+" title="Name must contain only letters and spaces" {...inp} />
                <input required placeholder="Roll No / ID" value={enrollForm.roll_no} onChange={e => setEnrollForm({ ...enrollForm, roll_no: e.target.value })} pattern="[a-zA-Z0-9]+" title="Roll No must be alphanumeric without spaces" {...inp} />
                <input type="email" placeholder="Email (optional)" value={enrollForm.email} onChange={e => setEnrollForm({ ...enrollForm, email: e.target.value })} {...inp} />
                
                <select required value={enrollForm.course || ''} onChange={e => {
                  const c = e.target.value;
                  const newYear = (isMastersCourse(c) && (enrollForm.year === '3rd Year' || enrollForm.year === '4th Year')) ? '' : enrollForm.year;
                  setEnrollForm({ ...enrollForm, course: c, year: newYear });
                }} {...inp}>
                  <option value="">Select Course / Degree</option>
                  {allCourses.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <select required value={enrollForm.dept} onChange={e => setEnrollForm({ ...enrollForm, dept: e.target.value })} {...inp}>
                  <option value="">Select Department</option>
                  {(enrollForm.course && COURSE_SPECIALIZATIONS[enrollForm.course] ? COURSE_SPECIALIZATIONS[enrollForm.course] : allDepts).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                
                <select required value={enrollForm.year} onChange={e => {
                  const y = e.target.value;
                  let autoCourse = enrollForm.course;
                  if (!autoCourse || autoCourse === 'B.Tech') {
                    if (y.toLowerCase().startsWith('pg')) autoCourse = 'M.Tech';
                  }
                  setEnrollForm({ ...enrollForm, year: y, course: autoCourse });
                }} {...inp}>
                  <option value="">Select Year</option>
                  {getYearsForCourse(enrollForm.course).map(y => <option key={y} value={y}>{y}</option>)}
                </select>

                <select required value={enrollForm.academic_year} onChange={e => setEnrollForm({ ...enrollForm, academic_year: e.target.value })} {...inp}>
                  <option value="">Select Academic Year</option>
                  {allAYs.map(ay => <option key={ay} value={ay}>{ay}</option>)}
                </select>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', margin: '4px 0 16px 0' }}>
                  <input type="checkbox" checked={enrollForm.force} onChange={e => setEnrollForm({ ...enrollForm, force: e.target.checked })} />
                  Overwrite existing photos
                </label>

                <button disabled={isEnrolling} className="btn btn-primary" style={{ width: '100%', height: 42 }}>
                  {isEnrolling ? '📸 Capturing Face...' : '+ Enroll Student'}
                </button>
              </form>

              {/* Enrollment stream feed overlay */}
              {isEnrolling && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ background: 'rgba(99, 102, 241, 0.05)', border: '1px solid var(--primary)', borderRadius: 10, padding: 12, marginBottom: 12, color: 'var(--primary)', fontWeight: 600, fontSize: 12 }}>
                    📸 Look straight at the camera. Align your face inside the overlay.
                  </div>
                  <div style={{ borderRadius: 12, overflow: 'hidden', background: '#000', lineHeight: 0 }}>
                    <img src={`${import.meta.env.DEV ? 'http://' + window.location.hostname + ':8000' : ''}/enrollment_feed?t=${enrollKey}`} alt="Enrollment Camera" style={{ width: '100%', maxHeight: 260, minHeight: 260, objectFit: 'contain' }} />
                  </div>
                </div>
              )}
            </div>

            {/* Students Table */}
            <div style={{ minWidth: 0, width: '100%' }}>
              <div className="table-container" style={{ margin: 0, width: '100%', overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Roll No</th><th>Name</th><th>Course</th><th>Dept</th><th>Year</th><th>Acad Year</th><th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((s, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{s.roll_no}</td>
                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                        <td><span style={{ padding: '3px 8px', background: 'rgba(99, 102, 241, 0.08)', color: '#6366f1', borderRadius: 6, fontSize: 12, border: '1px solid rgba(99, 102, 241, 0.2)', fontWeight: 600 }}>{s.course || '—'}</span></td>
                        <td>{s.department || '—'}</td>
                        <td>{s.year || '—'}</td>
                        <td><span style={{ padding: '3px 8px', background: 'var(--bg-sidebar)', borderRadius: 6, fontSize: 12, border: '1px solid var(--border)', fontWeight: 500 }}>{s.academic_year || '—'}</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button className="btn btn-outline" style={{ padding: '5px 10px', fontSize: 11, minHeight: 0, height: 28 }} onClick={() => handleViewHistory(s)}>History</button>
                            <button className="btn btn-outline" style={{ padding: '5px 10px', fontSize: 11, minHeight: 0, height: 28 }} onClick={() => {
                              let initialCourse = s.course || '';
                              if (!initialCourse || initialCourse === 'B.Tech') {
                                if (String(s.year || '').toLowerCase().startsWith('pg')) initialCourse = 'M.Tech';
                              }
                              setEditStudent({
                                ...s,
                                course: initialCourse,
                                department: s.department || '',
                                dept: s.department || '',
                                academic_year: s.academic_year || ''
                              });
                            }}>Edit</button>
                            <button className="btn btn-danger" style={{ padding: '5px 10px', fontSize: 11, minHeight: 0, height: 28 }} onClick={() => handleDeleteStudent(s.roll_no, s.name)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredStudents.length === 0 && (
                      <tr><td colSpan="7" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>No student records found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB CONTENT: TEACHERS ─────────────────────────────────── */}
        {activeTab === 'teachers' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 300px) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
            {/* Create Teacher Account Form */}
            <div style={{ background: 'var(--bg-sidebar)', borderRadius: 16, padding: 18, border: '1px solid var(--border)' }}>
              <div className="flex-between" style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>Register Teacher</div>
                <span 
                  style={{ 
                    fontSize: 12, 
                    fontWeight: 700, 
                    padding: '3px 9px', 
                    borderRadius: 12,
                    background: 'rgba(37, 99, 235, 0.12)',
                    color: 'var(--primary)',
                    border: '1px solid rgba(37, 99, 235, 0.3)'
                  }}
                >
                  Total: {teachers.length} Faculty
                </span>
              </div>

              <form onSubmit={handleAddTeacher} style={{ display: 'flex', flexDirection: 'column' }}>
                <input required placeholder="Display Name (e.g. Dr. John)" value={teacherForm.name} onChange={e => setTeacherForm({ ...teacherForm, name: e.target.value })} pattern="[A-Za-z\s\.]+" title="Name can only contain letters, spaces, or dots" {...inp} />
                <input required placeholder="Login Username" value={teacherForm.username} onChange={e => setTeacherForm({ ...teacherForm, username: e.target.value })} pattern="[a-zA-Z0-9_\-\.]+" title="Username must be alphanumeric without spaces" {...inp} />
                <input type="password" placeholder="Password (Optional, defaults to Login ID)" value={teacherForm.password} onChange={e => setTeacherForm({ ...teacherForm, password: e.target.value })} {...inp} />
                <button disabled={addingTeacher} className="btn btn-primary" style={{ width: '100%', height: 42, marginTop: 4 }}>
                  {addingTeacher ? 'Registering...' : '+ Register Teacher'}
                </button>
              </form>
            </div>

            {/* Teachers Table */}
            <div style={{ minWidth: 0, width: '100%' }}>
              {fetchingTeachers ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Loading teachers...</div>
              ) : (
                <div className="table-container" style={{ margin: 0, width: '100%', overflowX: 'auto' }}>
                  <div style={{ padding: '12px 16px', background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Registered Faculty Members ({teachers.length})</span>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th><th>Username</th><th>Assigned Subjects</th><th>Assigned Classes</th><th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTeachers.map((t, i) => {
                        const mSubjects = t.subjects || [];
                        const mClasses = t.classes || [];
                        return (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{t.name}</td>
                            <td className="text-primary" style={{ fontWeight: 500 }}>{t.username}</td>
                            <td>
                              {mSubjects.length > 0 ? (
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {mSubjects.map(subCode => (
                                    <span key={subCode} style={{ background: 'rgba(99, 102, 241, 0.08)', color: '#6366f1', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                                      {subCode}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>All Access (None mapped)</span>
                              )}
                            </td>
                            <td>
                              {mClasses.length > 0 ? (
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {mClasses.map((cl, idx) => (
                                    <span key={idx} style={{ background: 'rgba(16, 185, 129, 0.08)', color: '#10b981', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                                      {cl.dept} {cl.year.split(' ')[0]} ({cl.academic_year})
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>All Access (None mapped)</span>
                              )}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                <button className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 11, minHeight: 0, height: 28 }} onClick={() => handleOpenMappings(t)}>Mappings</button>
                                <button className="btn btn-outline" style={{ padding: '5px 10px', fontSize: 11, minHeight: 0, height: 28 }} onClick={() => setEditTeacher({ ...t, password: '' })}>Edit</button>
                                <button className="btn btn-danger" style={{ padding: '5px 10px', fontSize: 11, minHeight: 0, height: 28 }} onClick={() => handleDeleteTeacher(t.username, t.name)}>Delete</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredTeachers.length === 0 && (
                        <tr><td colSpan="5" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>No teacher records found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB CONTENT: SUBJECTS ─────────────────────────────────── */}
        {activeTab === 'subjects' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 300px) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
            {/* Create Subject Form */}
            <div style={{ background: 'var(--bg-sidebar)', borderRadius: 16, padding: 18, border: '1px solid var(--border)' }}>
              <div className="flex-between" style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>Add Subject</div>
              </div>

              <form onSubmit={handleAddSubject} style={{ display: 'flex', flexDirection: 'column' }}>
                <input required placeholder="Subject Code (e.g. CS301)" value={subjectForm.code} onChange={e => setSubjectForm({ ...subjectForm, code: e.target.value })} pattern="[a-zA-Z0-9]+" title="Subject code must be alphanumeric without spaces" {...inp} />
                <input required placeholder="Subject Name (e.g. Algorithms)" value={subjectForm.name} onChange={e => setSubjectForm({ ...subjectForm, name: e.target.value })} pattern="[A-Za-z0-9\s\-\:]+" title="Name must only contain alphanumeric, spaces, or dashes" {...inp} />
                <select required value={subjectForm.dept} onChange={e => setSubjectForm({ ...subjectForm, dept: e.target.value })} {...inp}>
                  <option value="">Select Department</option>
                  {deptsList.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <button disabled={addingSubject} className="btn btn-primary" style={{ width: '100%', height: 42, marginTop: 4 }}>
                  {addingSubject ? 'Creating...' : '+ Create Subject'}
                </button>
              </form>
            </div>

            {/* Subjects Table */}
            <div style={{ minWidth: 0, width: '100%' }}>
              <div className="table-container" style={{ margin: 0, width: '100%', overflowX: 'auto' }}>
                <div style={{ padding: '12px 16px', background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Active Curriculum Subjects ({subjects.length})</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Subject Code</th><th>Name</th><th>Department</th><th>Assigned Classes</th><th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSubjects.map((s, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{s.code}</td>
                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                        <td>{s.department || '—'}</td>
                        <td>
                          {(s.classes || []).length > 0 ? (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {(s.classes || []).map((cl, idx) => (
                                <span key={idx} style={{ background: 'rgba(16, 185, 129, 0.08)', color: '#10b981', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                                  {cl.dept} {cl.year} ({cl.academic_year})
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>All Access (None mapped)</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 11, minHeight: 0, height: 28 }} onClick={() => handleOpenSubjectMappings(s)}>Mappings</button>
                            <button className="btn btn-danger" style={{ padding: '5px 12px', fontSize: 11, minHeight: 0, height: 28 }} onClick={() => handleDeleteSubject(s.code)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredSubjects.length === 0 && (
                      <tr><td colSpan="5" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>No subjects registered</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB CONTENT: SECTIONS ─────────────────────────────────── */}
        {activeTab === 'sections' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 320px) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
            {/* Create Section Form */}
            <div style={{ background: 'var(--bg-sidebar)', borderRadius: 16, padding: 18, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: 'var(--text-main)' }}>Create Section</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Map a class to a set of subjects. All students in this class share these subjects.</div>
              <form onSubmit={handleCreateSection} style={{ display: 'flex', flexDirection: 'column' }}>
                <select required value={sectionForm.department} onChange={e => setSectionForm({ ...sectionForm, department: e.target.value })} {...inp}>
                  <option value="">Select Department</option>
                  {deptsList.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <select required value={sectionForm.year} onChange={e => setSectionForm({ ...sectionForm, year: e.target.value })} {...inp}>
                  <option value="">Select Year</option>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select required value={sectionForm.academic_year} onChange={e => setSectionForm({ ...sectionForm, academic_year: e.target.value })} {...inp}>
                  <option value="">Select Academic Year</option>
                  {academicYearsList.map(ay => <option key={ay} value={ay}>{ay}</option>)}
                </select>

                {/* Subject checklist */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Select Subjects for this Section</div>
                  {subjects.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No subjects available. Add subjects first.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', background: 'var(--bg-main)', padding: 12, borderRadius: 10, border: '1px solid var(--border)' }}>
                      {subjects.map(s => (
                        <label key={s.code} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer', color: 'var(--text-main)' }}>
                          <input
                            type="checkbox"
                            checked={sectionForm.subjects.includes(s.code)}
                            onChange={e => handleSectionSubjectToggle(s.code, e.target.checked)}
                            style={{ cursor: 'pointer' }}
                          />
                          <span><b>{s.code}</b> — {s.name} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({s.department})</span></span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <button disabled={addingSection} className="btn btn-primary" style={{ width: '100%', height: 42, marginTop: 4 }}>
                  {addingSection ? 'Creating...' : '+ Create Section'}
                </button>
              </form>
            </div>

            {/* Sections Table */}
            <div style={{ minWidth: 0, width: '100%' }}>
              {fetchingSections ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Loading sections...</div>
              ) : (
                <div className="table-container" style={{ margin: 0, width: '100%', overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Section</th><th>Academic Year</th><th>Subjects Mapped</th><th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sections.filter(s =>
                        !searchQuery || `${s.department} ${s.year} ${s.academic_year}`.toLowerCase().includes(searchQuery.toLowerCase())
                      ).map((s, i) => (
                        <tr key={i}>
                          <td>
                            <div style={{ fontWeight: 700, color: 'var(--primary)' }}>{s.department}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.year}</div>
                          </td>
                          <td><span style={{ padding: '3px 8px', background: 'var(--bg-sidebar)', borderRadius: 6, fontSize: 12, border: '1px solid var(--border)', fontWeight: 500 }}>{s.academic_year}</span></td>
                          <td>
                            {(s.subjects || []).length > 0 ? (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {(s.subjects || []).map(code => (
                                  <span key={code} style={{ background: 'rgba(99,102,241,0.08)', color: '#6366f1', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{code}</span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>No subjects mapped</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 11, minHeight: 0, height: 28 }} onClick={() => handleOpenEditSection(s)}>Edit Subjects</button>
                              <button className="btn btn-danger" style={{ padding: '5px 12px', fontSize: 11, minHeight: 0, height: 28 }} onClick={() => handleDeleteSection(s.id, `${s.department} ${s.year} ${s.academic_year}`)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {sections.length === 0 && (
                        <tr><td colSpan="4" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>No sections defined yet. Create one to map subjects to a class.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB CONTENT: METADATA ─────────────────────────────────── */}
        {activeTab === 'metadata' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, alignItems: 'start' }}>
            {/* Courses / Degree Programs Card (1st) */}
            <div style={{ background: 'var(--bg-sidebar)', borderRadius: 16, padding: 20, border: '1px solid var(--border)', gridColumn: 'span 2' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <span>Manage Courses / Degrees & Durations</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Configures number of years dynamically</span>
              </div>

              <form onSubmit={handleAddCourse} style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                <input
                  required
                  placeholder="e.g. BTech, MTech, MCA, MBA, BSc, MBBS"
                  value={newCourseCode}
                  onChange={e => setNewCourseCode(e.target.value)}
                  className="form-input"
                  style={{ marginBottom: 0, height: 42, flex: 2, minWidth: 200 }}
                />
                <select
                  value={newCourseDuration}
                  onChange={e => setNewCourseDuration(e.target.value)}
                  className="form-input"
                  style={{ marginBottom: 0, height: 42, width: 140 }}
                >
                  <option value={1}>1 Year</option>
                  <option value={2}>2 Years</option>
                  <option value={3}>3 Years</option>
                  <option value={4}>4 Years</option>
                  <option value={5}>5 Years</option>
                </select>
                <button className="btn btn-primary" style={{ height: 42, minWidth: 120 }}>
                  + Add Course
                </button>
              </form>

              {fetchingMetadata ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
              ) : (
                <div className="table-container" style={{ margin: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Course / Degree</th>
                        <th>Duration (Years)</th>
                        <th>Valid Year Cohorts</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coursesList.map(cItem => {
                        const code = typeof cItem === 'object' ? cItem.code : cItem;
                        const dur = typeof cItem === 'object' ? cItem.duration_years : 4;
                        const yList = (typeof cItem === 'object' && Array.isArray(cItem.years_list)) ? cItem.years_list : getYearsForCourse(code);
                        const isEditing = editingCourse?.code === code;

                        return (
                          <tr key={code}>
                            <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{code}</td>
                            <td>
                              {isEditing ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <select
                                    value={editingCourse.duration_years}
                                    onChange={e => setEditingCourse({ ...editingCourse, duration_years: parseInt(e.target.value) || 4 })}
                                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-main)', fontSize: 12 }}
                                  >
                                    <option value={1}>1 Year</option>
                                    <option value={2}>2 Years</option>
                                    <option value={3}>3 Years</option>
                                    <option value={4}>4 Years</option>
                                    <option value={5}>5 Years</option>
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateCourseDuration(code, editingCourse.duration_years)}
                                    className="btn btn-primary"
                                    style={{ padding: '4px 8px', fontSize: 11, minHeight: 0, height: 26 }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingCourse(null)}
                                    className="btn btn-outline"
                                    style={{ padding: '4px 8px', fontSize: 11, minHeight: 0, height: 26 }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{dur} Years</span>
                              )}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {yList.map(y => (
                                  <span key={y} style={{ fontSize: 10, background: 'rgba(99,102,241,0.08)', color: '#6366f1', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>
                                    {y}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                                {!isEditing && (
                                  <button
                                    type="button"
                                    onClick={() => setEditingCourse({ code, duration_years: dur })}
                                    className="btn btn-outline"
                                    style={{ padding: '4px 10px', fontSize: 11, minHeight: 0, height: 28 }}
                                  >
                                    Edit Duration
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDeleteCourse(code)}
                                  className="btn btn-danger"
                                  style={{ padding: '4px 10px', fontSize: 11, minHeight: 0, height: 28 }}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {coursesList.length === 0 && (
                        <tr><td colSpan="4" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>No courses defined</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Academic Years Card (2nd) */}
            <div style={{ background: 'var(--bg-sidebar)', borderRadius: 16, padding: 20, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: 'var(--text-main)' }}>Manage Academic Years</div>
              
              <form onSubmit={handleAddAY} style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <input
                  required
                  placeholder="e.g. 2025-26, 2026-27"
                  value={newAYCode}
                  onChange={e => setNewAYCode(e.target.value)}
                  className="form-input"
                  style={{ marginBottom: 0, height: 42, flex: 1 }}
                />
                <button className="btn btn-primary" style={{ height: 42, minWidth: 100 }}>
                  + Add AY
                </button>
              </form>

              {fetchingMetadata ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
              ) : (
                <div className="table-container" style={{ margin: 0 }}>
                  <table>
                    <thead>
                      <tr><th>Academic Year</th><th style={{ textAlign: 'right' }}>Action</th></tr>
                    </thead>
                    <tbody>
                      {academicYearsList.map(code => (
                        <tr key={code}>
                          <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{code}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              onClick={() => handleDeleteAY(code)}
                              className="btn btn-danger"
                              style={{ padding: '5px 12px', fontSize: 11, minHeight: 0, height: 28 }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                      {academicYearsList.length === 0 && (
                        <tr><td colSpan="2" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>No academic years defined</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Departments Card (3rd) */}
            <div style={{ background: 'var(--bg-sidebar)', borderRadius: 16, padding: 20, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: 'var(--text-main)' }}>Manage Departments</div>
              
              <form onSubmit={handleAddDept} style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <input
                  required
                  placeholder="e.g. IT, MECH, CIVIL"
                  value={newDeptCode}
                  onChange={e => setNewDeptCode(e.target.value)}
                  className="form-input"
                  style={{ marginBottom: 0, height: 42, flex: 1 }}
                />
                <button className="btn btn-primary" style={{ height: 42, minWidth: 100 }}>
                  + Add Dept
                </button>
              </form>

              {fetchingMetadata ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
              ) : (
                <div className="table-container" style={{ margin: 0 }}>
                  <table>
                    <thead>
                      <tr><th>Department Code</th><th style={{ textAlign: 'right' }}>Action</th></tr>
                    </thead>
                    <tbody>
                      {deptsList.map(code => (
                        <tr key={code}>
                          <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{code}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              onClick={() => handleDeleteDept(code)}
                              className="btn btn-danger"
                              style={{ padding: '5px 12px', fontSize: 11, minHeight: 0, height: 28 }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                      {deptsList.length === 0 && (
                        <tr><td colSpan="2" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>No departments defined</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>


      {/* ─── MODAL: EDIT STUDENT ────────────────────────────────────── */}
      {editStudent && (
        <Modal title="✏️ Edit Student Details" onClose={() => setEditStudent(null)}>
          <form onSubmit={handleEditStudent} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Full Name</label>
              <input required placeholder="Name" value={editStudent.name} onChange={e => setEditStudent({ ...editStudent, name: e.target.value })} pattern="[A-Za-z\s]+" title="Name must contain only letters and spaces" {...inp} style={{ marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Email Address</label>
              <input type="email" placeholder="Email" value={editStudent.email || ''} onChange={e => setEditStudent({ ...editStudent, email: e.target.value })} {...inp} style={{ marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Course / Degree</label>
              <select value={editStudent.course || ''} onChange={e => {
                const c = e.target.value;
                const newYear = (isMastersCourse(c) && (editStudent.year === '3rd Year' || editStudent.year === '4th Year')) ? '' : editStudent.year;
                setEditStudent({ ...editStudent, course: c, year: newYear });
              }} {...inp} style={{ marginTop: 4 }}>
                <option value="">Select Course / Degree</option>
                {allCourses.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Department</label>
              <select required value={editStudent.department} onChange={e => setEditStudent({ ...editStudent, department: e.target.value })} {...inp} style={{ marginTop: 4 }}>
                <option value="">Select Department</option>
                {(editStudent.course && COURSE_SPECIALIZATIONS[editStudent.course] ? COURSE_SPECIALIZATIONS[editStudent.course] : deptsList).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Class Year</label>
              <select required value={editStudent.year || ''} onChange={e => {
                const y = e.target.value;
                let autoCourse = editStudent.course;
                if (!autoCourse || autoCourse === 'B.Tech') {
                  if (y.toLowerCase().startsWith('pg')) autoCourse = 'M.Tech';
                }
                setEditStudent({ ...editStudent, year: y, course: autoCourse });
              }} {...inp} style={{ marginTop: 4 }}>
                <option value="">Select Year</option>
                {getYearsForCourse(editStudent.course).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Academic Year</label>
              <select required value={editStudent.academic_year || ''} onChange={e => setEditStudent({ ...editStudent, academic_year: e.target.value })} {...inp} style={{ marginTop: 4 }}>
                <option value="">Select Academic Year</option>
                {academicYearsList.map(ay => <option key={ay} value={ay}>{ay}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
              <button type="button" onClick={() => setEditStudent(null)} className="btn btn-outline" style={{ height: 40 }}>Cancel</button>
              <button className="btn btn-primary" style={{ height: 40 }}>Save Changes</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── MODAL: STUDENT HISTORY ─────────────────────────────────── */}
      {historyStudent && (
        <Modal title={`📊 ${historyStudent.name} — Attendance Summary`} onClose={() => setHistoryStudent(null)}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Roll No: <b>{historyStudent.roll_no}</b></div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Department & Class: <b>{historyStudent.department} {historyStudent.year} ({historyStudent.academic_year})</b></div>
            <div style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 700, marginTop: 12 }}>{history.length} sessions attended in total</div>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: 'var(--bg-sidebar)', position: 'sticky', top: 0 }}>
                <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left' }}>Date</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left' }}>Time</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left' }}>Subject</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 16px' }}>{h.date}</td>
                    <td style={{ padding: '10px 16px' }}>{h.time}</td>
                    <td style={{ padding: '10px 16px', fontWeight: 600 }}>{h.subject_name || h.subject_code || '—'}</td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr><td colSpan="3" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No attendance logs found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {/* ─── MODAL: EDIT TEACHER DETAILS ────────────────────────────── */}
      {editTeacher && (
        <Modal title="✏️ Edit Teacher Details" onClose={() => setEditTeacher(null)}>
          <form onSubmit={handleEditTeacherDetails} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Login Username</label>
              <div style={{ padding: '8px 12px', background: 'var(--bg-sidebar)', borderRadius: 8, marginTop: 4, color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>
                {editTeacher.username}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Display Name</label>
              <input required placeholder="Name" value={editTeacher.name} onChange={e => setEditTeacher({ ...editTeacher, name: e.target.value })} pattern="[A-Za-z\s\.]+" title="Name can only contain letters, spaces, or dots" {...inp} style={{ marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>New Password (Leave blank to keep current)</label>
              <input type="password" placeholder="Enter new password" value={editTeacher.password || ''} onChange={e => setEditTeacher({ ...editTeacher, password: e.target.value })} {...inp} style={{ marginTop: 4 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
              <button type="button" onClick={() => setEditTeacher(null)} className="btn btn-outline" style={{ height: 40 }}>Cancel</button>
              <button disabled={savingTeacherDetails} className="btn btn-primary" style={{ height: 40 }}>
                {savingTeacherDetails ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── MODAL: SUBJECT CLASS MAPPINGS ────────────────── */}
      {mappingsSubject && (
        <Modal title={`🔗 Manage Class Mappings — ${mappingsSubject.code}`} onClose={() => setMappingsSubject(null)} style={{ maxWidth: '600px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Class mappings list */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>Mapped Classes (Cohorts studying this subject)</label>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {tempSubjectClasses.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-sidebar)', padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }}>
                    <span>
                      Department: <b>{c.dept}</b> • Year: <b>{c.year}</b> • Academic Year: <b>{c.academic_year}</b>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveSubjectClassMapping(i)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4 }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                {tempSubjectClasses.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', padding: 8 }}>
                    No classes assigned (All students can take this subject).
                  </div>
                )}
              </div>

              {/* Add class mapping controls */}
              <div style={{ background: 'var(--bg-sidebar)', padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 10 }}>Add Class Mapping</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <select value={newSubjectClass.dept} onChange={e => setNewSubjectClass({ ...newSubjectClass, dept: e.target.value })} {...inp} style={{ marginBottom: 0 }}>
                    <option value="">Department</option>
                    {deptsList.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select value={newSubjectClass.year} onChange={e => setNewSubjectClass({ ...newSubjectClass, year: e.target.value })} {...inp} style={{ marginBottom: 0 }}>
                    <option value="">Year</option>
                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select value={newSubjectClass.academic_year} onChange={e => setNewSubjectClass({ ...newSubjectClass, academic_year: e.target.value })} {...inp} style={{ marginBottom: 0 }}>
                    <option value="">Acad Year</option>
                    {academicYearsList.map(ay => <option key={ay} value={ay}>{ay}</option>)}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleAddSubjectClassMapping}
                  className="btn btn-outline"
                  style={{ width: '100%', height: '36px', fontSize: 12, minHeight: 0 }}
                >
                  + Add Class mapping
                </button>
              </div>
            </div>

            {/* Footer Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button type="button" onClick={() => setMappingsSubject(null)} className="btn btn-outline" style={{ height: 40 }}>
                Cancel
              </button>
              <button disabled={savingSubjectMappings} onClick={handleSaveSubjectMappings} className="btn btn-primary" style={{ height: 40 }}>
                {savingSubjectMappings ? 'Saving...' : 'Save Mappings'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {mappingsTeacher && (
        <Modal title={`🔗 Manage Assignments — ${mappingsTeacher.name}`} onClose={() => setMappingsTeacher(null)} style={{ maxWidth: '640px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Subject Checkboxes */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>Mapped Subjects</label>
              {subjects.length === 0 ? (
                <p style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--text-muted)' }}>No subjects available in the system. Create subjects first.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: 'var(--bg-sidebar)', padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
                  {subjects.map(s => {
                    const isChecked = tempSubjects.includes(s.code);
                    return (
                      <label key={s.code} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-main)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => handleSubjectCheckbox(s.code, e.target.checked)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span><b>{s.code}</b> — {s.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Class mappings layout */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>Mapped Classes (Students Cohort)</label>
              
              {/* Existing mappings list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {tempClasses.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-sidebar)', padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }}>
                    <span>
                      Department: <b>{c.dept}</b> • Year: <b>{c.year}</b> • Academic Year: <b>{c.academic_year}</b>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveClassMapping(i)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4 }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                {tempClasses.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', padding: 8 }}>
                    No specific classes assigned (Teacher has access to all cohorts).
                  </div>
                )}
              </div>

              {/* Add class mapping controls */}
              <div style={{ background: 'var(--bg-sidebar)', padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 10 }}>Add Class Mapping</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <select value={newClass.dept} onChange={e => setNewClass({ ...newClass, dept: e.target.value })} {...inp} style={{ marginBottom: 0 }}>
                    <option value="">Department</option>
                    {deptsList.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select value={newClass.year} onChange={e => setNewClass({ ...newClass, year: e.target.value })} {...inp} style={{ marginBottom: 0 }}>
                    <option value="">Year</option>
                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select value={newClass.academic_year} onChange={e => setNewClass({ ...newClass, academic_year: e.target.value })} {...inp} style={{ marginBottom: 0 }}>
                    <option value="">Acad Year</option>
                    {academicYearsList.map(ay => <option key={ay} value={ay}>{ay}</option>)}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleAddClassMapping}
                  className="btn btn-outline"
                  style={{ width: '100%', height: '36px', fontSize: 12, minHeight: 0 }}
                >
                  + Add Class mapping
                </button>
              </div>
            </div>

            {/* Footer Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button type="button" onClick={() => setMappingsTeacher(null)} className="btn btn-outline" style={{ height: 40 }}>
                Cancel
              </button>
              <button disabled={savingMappings} onClick={handleSaveMappings} className="btn btn-primary" style={{ height: 40 }}>
                {savingMappings ? 'Saving...' : 'Save Assignments'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── MODAL: EDIT SECTION SUBJECTS ────────────────────────────── */}
      {editSection && (
        <Modal title={`✏️ Edit Subjects — ${editSection.department} ${editSection.year} (${editSection.academic_year})`} onClose={() => setEditSection(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Select the subjects taught in this section. All students in <b>{editSection.department} {editSection.year}</b> will be mapped to these subjects.
            </div>
            {subjects.length === 0 ? (
              <p style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--text-muted)' }}>No subjects available. Add subjects first.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', background: 'var(--bg-sidebar)', padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
                {subjects.map(s => {
                  const isChecked = tempSectionSubjects.includes(s.code);
                  return (
                    <label key={s.code} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-main)', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, background: isChecked ? 'rgba(99,102,241,0.06)' : 'transparent', transition: 'background 0.15s' }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={e => {
                          const code = s.code;
                          setTempSectionSubjects(prev =>
                            e.target.checked ? [...prev, code] : prev.filter(c => c !== code)
                          );
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                      <span>
                        <b style={{ color: isChecked ? '#6366f1' : 'var(--text-main)' }}>{s.code}</b>
                        {' — '}{s.name}
                        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>({s.department})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tempSectionSubjects.length} subject{tempSectionSubjects.length !== 1 ? 's' : ''} selected</span>
              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" onClick={() => setEditSection(null)} className="btn btn-outline" style={{ height: 40 }}>Cancel</button>
                <button disabled={savingSectionSubjects} onClick={handleSaveSectionSubjects} className="btn btn-primary" style={{ height: 40 }}>
                  {savingSectionSubjects ? 'Saving...' : 'Save Subjects'}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Webcam Student Enrollment Modal */}
      {showEnrollModal && (
        <Modal title={`📸 Capture Face — ${enrollForm.name}`} onClose={() => !enrollCapturing && setShowEnrollModal(false)}>
          <div style={{ padding: 16 }}>
            <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid var(--primary)', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: '0.85rem' }}>
              <strong>Student:</strong> {enrollForm.name} ({enrollForm.roll_no}) &bull; {enrollForm.course || 'Degree'} &bull; {enrollForm.dept} {enrollForm.year} ({enrollForm.academic_year})
            </div>

            {enrollError && (
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: 10, padding: '12px 14px', marginBottom: 14, color: '#ef4444', fontSize: '0.85rem', lineHeight: 1.4, fontWeight: 500 }}>
                <strong>🚫 Enrollment Rejected:</strong> {enrollError}
              </div>
            )}

            <div style={{ position: 'relative', width: '100%', borderRadius: 12, overflow: 'hidden', background: '#000', minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <video
                ref={enrollVideoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: 'auto',
                  display: 'block',
                  transform: enrollFacingMode === 'user' ? 'scaleX(-1)' : 'none'
                }}
              />
              <canvas ref={enrollCanvasRef} style={{ display: 'none' }} />

              {/* Facing Mode Switcher Button */}
              <button
                type="button"
                onClick={() => setEnrollFacingMode(m => m === 'user' ? 'environment' : 'user')}
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  background: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.3)',
                  padding: '6px 12px',
                  borderRadius: 20,
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5
                }}
              >
                <SwitchCamera size={14} /> {enrollFacingMode === 'user' ? 'Front Cam' : 'Rear Cam'}
              </button>

              {/* Progress Overlay */}
              {enrollCapturing && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', backdropFilter: 'blur(3px)' }}>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 8 }}>Capturing Face: {captureProgress}/10</div>
                  <p style={{ fontSize: '0.85rem', color: '#CBD5E1', marginBottom: 14 }}>Hold still and tilt head slightly...</p>
                  <div style={{ width: '80%', height: 8, background: 'rgba(255,255,255,0.2)', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ width: `${(captureProgress/10)*100}%`, height: '100%', background: '#10B981', transition: 'width 0.2s' }} />
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowEnrollModal(false)} disabled={enrollCapturing} className="btn btn-outline">
                Cancel
              </button>
              <button type="button" onClick={handleCaptureAndSubmitEnrollment} disabled={enrollCapturing} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Camera size={16} /> {enrollCapturing ? 'Capturing Photos...' : 'Capture & Save Student'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>

  );
}
