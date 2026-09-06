import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Clock, MapPin, BookOpen, Trash2, ChevronLeft, ChevronRight, Layout, List, Camera } from 'lucide-react';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function ClassSchedule({ user, subjects, toast, authFetch, setTab }) {
  const isAdmin = user?.role === 'admin';
  const isStudent = user?.role === 'student';

  const [schedules, setSchedules] = useState([]);
  const [depts, setDepts] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [courses, setCourses] = useState(['B.Tech', 'BCA', 'M.Tech', 'MCA', 'MBA']);
  const [loading, setLoading] = useState(true);

  // Tab state: 'weekly' or 'calendar'
  const [viewMode, setViewMode] = useState('weekly');

  // Month selector for monthly calendar
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // Filter selection states (used by Admins & Teachers)
  const [selCourse, setSelCourse] = useState('');
  const [selDept, setSelDept] = useState('');
  const [selYear, setSelYear] = useState('');
  const [selAY, setSelAY] = useState('');

  const COURSE_SPECIALIZATIONS = {
    'B.Tech': ['CSE', 'IT', 'AI & ML', 'Data Science', 'Cyber Security'],
    'BCA': ['Web Development', 'Mobile App Development', 'Cloud Computing', 'Data Analytics', 'Software Development'],
    'M.Tech': ['CSE', 'AI & ML', 'Cyber Security'],
    'MCA': ['Software Development', 'AI & ML', 'Data Science', 'Cloud Computing', 'Cyber Security'],
    'MBA': ['Finance', 'Marketing']
  };

  const deriveCourse = (dept = '', yr = '') => {
    const d = String(dept || '').trim();
    const y = String(yr || '').trim().toLowerCase();
    if (y.startsWith('pg')) return 'M.Tech';
    if (d === 'Finance' || d === 'Marketing') return 'MBA';
    if (['Web Development', 'Mobile App Development', 'Data Analytics', 'Cloud Computing', 'Software Development'].includes(d)) return 'BCA';
    return 'B.Tech';
  };

  const getYearsForCourse = (cName) => {
    if (!cName) return ['1st Year', '2nd Year', '3rd Year', '4th Year', 'PG 1st Year', 'PG 2nd Year'];
    const searchStr = String(cName).toLowerCase().trim();
    if (Array.isArray(courses)) {
      const foundObj = courses.find(item => {
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

  const fmtAMPM = (timeStr) => {
    if (!timeStr) return '';
    const str = String(timeStr).trim();
    if (str.toUpperCase().includes('AM') || str.toUpperCase().includes('PM')) return str;
    const parts = str.split(':');
    if (parts.length < 2) return str;
    let h = parseInt(parts[0], 10);
    const m = parts[1].slice(0, 2);
    if (isNaN(h)) return str;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  };

  const fmtRange = (st, en) => {
    if (!st) return '';
    if (!en) return fmtAMPM(st);
    return `${fmtAMPM(st)} – ${fmtAMPM(en)}`;
  };

  // Create slot form state (Admin only)
  const [scheduleType, setScheduleType] = useState('weekly'); // 'weekly' or 'date'
  const [form, setForm] = useState({
    course: '',
    department: '',
    year: '',
    academic_year: '',
    subject_id: '',
    day_of_week: 'Monday',
    specific_date: '',
    start_time: '09:00',
    end_time: '10:00',
    classroom: ''
  });
  const [saving, setSaving] = useState(false);
  const [showAdminForm, setShowAdminForm] = useState(false);

  // Fetch metadata and schedules
  const fetchAll = async () => {
    setLoading(true);
    try {
      const [schRes, deptRes, ayRes, courseRes] = await Promise.all([
        authFetch('/api/schedules').then(r => r.json()).catch(() => []),
        authFetch('/api/departments').then(r => r.json()).catch(() => []),
        authFetch('/api/academic_years').then(r => r.json()).catch(() => []),
        authFetch('/api/courses').then(r => r.json()).catch(() => [])
      ]);
      if (Array.isArray(schRes)) setSchedules(schRes);
      if (Array.isArray(deptRes)) setDepts(deptRes);
      if (Array.isArray(ayRes)) setAcademicYears(ayRes);
      if (Array.isArray(courseRes) && courseRes.length > 0) setCourses(courseRes);
    } catch (err) {
      toast('Failed to load schedule data', 'error');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const normalizeDept = (dept) => {
    const d = String(dept || '').trim().toUpperCase();
    if (d === 'AI/ML' || d === 'AIML' || d === 'AI-ML' || d === 'AI_ML' || d === 'AI & ML' || d === 'AI' || d === 'ARTIFICIAL INTELLIGENCE') return 'AIML';
    if (d === 'CS' || d === 'CSE' || d === 'COMPUTER SCIENCE') return 'CSE';
    if (d === 'EC' || d === 'ECE') return 'ECE';
    if (d === 'EE' || d === 'EEE') return 'EEE';
    if (d === 'ME' || d === 'MECH' || d === 'MECHANICAL') return 'ME';
    return d;
  };

  // Filter schedules matching chosen view settings
  const activeFilters = useMemo(() => {
    if (isStudent) return { dept: '', year: '', ay: '', course: '' };
    return { dept: selDept, year: selYear, ay: selAY, course: selCourse };
  }, [isStudent, selDept, selYear, selAY, selCourse]);

  const filteredSchedules = useMemo(() => {
    if (isStudent) return schedules;
    return schedules.filter(s => {
      const sCourse = s.course || deriveCourse(s.department, s.year);
      const cMatch = !activeFilters.course || sCourse === activeFilters.course || s.course === activeFilters.course;
      const dMatch = !activeFilters.dept || normalizeDept(s.department) === normalizeDept(activeFilters.dept);
      const yMatch = !activeFilters.year || s.year === activeFilters.year;
      const ayMatch = !activeFilters.ay || s.academic_year === activeFilters.ay;
      return cMatch && dMatch && yMatch && ayMatch;
    });
  }, [schedules, isStudent, activeFilters]);

  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    let str = String(timeStr).trim().toUpperCase();
    const isPM = str.includes('PM');
    const isAM = str.includes('AM');
    str = str.replace(/AM|PM/gi, '').trim();
    const parts = str.split(':');
    let h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    return h * 60 + m;
  };

  // Group schedules by day of the week (For Weekly timetable view)
  const groupedSchedules = useMemo(() => {
    const map = {};
    DAYS.forEach(day => { map[day] = []; });
    filteredSchedules.forEach(s => {
      // For weekly tab view, we only show weekly recurring items
      if (!s.specific_date && map[s.day_of_week]) {
        map[s.day_of_week].push(s);
      }
    });
    DAYS.forEach(day => {
      if (map[day]) {
        map[day].sort((a, b) => {
          const timeDiff = parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time);
          if (timeDiff !== 0) return timeDiff;
          const courseDiff = String(a.course || '').localeCompare(String(b.course || ''));
          if (courseDiff !== 0) return courseDiff;
          const deptDiff = String(a.department || '').localeCompare(String(b.department || ''));
          if (deptDiff !== 0) return deptDiff;
          return String(a.year || '').localeCompare(String(b.year || ''));
        });
      }
    });
    return map;
  }, [filteredSchedules]);

  // Generate calendar days for monthly view
  const calendarCells = useMemo(() => {
    const [year, monthStr] = currentMonth.split('-').map(Number);
    const monthIndex = monthStr - 1;

    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);

    const totalDays = lastDay.getDate();
    let startOffset = firstDay.getDay(); 
    startOffset = startOffset === 0 ? 6 : startOffset - 1; // Align Mon as first col (0)

    const cells = [];
    // Prefix blank cells
    for (let i = 0; i < startOffset; i++) {
      cells.push(null);
    }
    // Days of month
    for (let day = 1; day <= totalDays; day++) {
      const dateStr = `${year}-${String(monthStr).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dateObj = new Date(year, monthIndex, day);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayOfWeek = dayNames[dateObj.getDay()];
      cells.push({ day, dateStr, dayOfWeek });
    }
    return cells;
  }, [currentMonth]);

  // Retrieve matching sessions for a calendar cell (Sorted chronologically by start time)
  const getSessionsForDate = (dateStr, dayOfWeek) => {
    const matches = filteredSchedules.filter(s => {
      if (s.specific_date) {
        return s.specific_date === dateStr;
      }
      return s.day_of_week === dayOfWeek;
    });
    return matches.sort((a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time));
  };

  const handleAddSlot = async (e) => {
    e.preventDefault();
    
    let payload = { ...form };

    if (scheduleType === 'date') {
      if (!form.specific_date) {
        toast('Specific date is required', 'warn');
        return;
      }
      // Derive day of week
      const dateObj = new Date(form.specific_date);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      payload.day_of_week = dayNames[dateObj.getDay()];
    } else {
      payload.specific_date = '';
    }

    if (!payload.department || !payload.year || !payload.academic_year || !payload.subject_id || !payload.day_of_week || !payload.start_time || !payload.end_time) {
      toast('Please fill all required parameters', 'warn');
      return;
    }

    setSaving(true);
    try {
      const res = await authFetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        toast('Slot added to schedule successfully!', 'success');
        setForm(f => ({ ...f, classroom: '', subject_id: '', specific_date: '' }));
        fetchAll();
      } else {
        const d = await res.json();
        toast(d.detail || 'Failed to create schedule slot', 'error');
      }
    } catch {
      toast('Server connection failure', 'error');
    }
    setSaving(false);
  };

  const handleDeleteSlot = async (id, code, label) => {
    if (!window.confirm(`Remove ${code} slot from schedule (${label})?`)) return;
    try {
      const res = await authFetch(`/api/schedules/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast('Slot deleted successfully!', 'success');
        fetchAll();
      } else {
        toast('Failed to delete schedule slot', 'error');
      }
    } catch {
      toast('Server connection failure', 'error');
    }
  };

  const changeMonth = (dir) => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const monthLabel = useMemo(() => {
    const [y, m] = currentMonth.split('-').map(Number);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${monthNames[m - 1]} ${y}`;
  }, [currentMonth]);

  const inp = { className: 'form-input', style: { marginBottom: 12 } };
  const sel = { className: 'form-select', style: { marginBottom: 12 } };

  if (loading) return <div className="loading-overlay"><div className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header and Filter Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)' }}>Class Timetable & Calendar</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {isStudent 
              ? 'Your personalized academic semester class calendar.' 
              : 'Configure and view semester timetables and calendar classes.'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {isAdmin && (
            <button
              onClick={() => setShowAdminForm(!showAdminForm)}
              className="btn btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, fontSize: 12, fontWeight: 700 }}
            >
              <Clock size={15} color="var(--primary)" />
              {showAdminForm ? 'Close Add Form' : '+ Add Slot'}
            </button>
          )}

          {/* View Mode Toggle */}
          <div style={{ display: 'flex', background: 'var(--bg-sidebar)', borderRadius: 8, padding: 3, border: '1px solid var(--border)' }}>
            <button 
              onClick={() => setViewMode('weekly')} 
              style={{
                display: 'flex', alignItems: 'center', gap: 6, border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: viewMode === 'weekly' ? 'var(--primary)' : 'transparent',
                color: viewMode === 'weekly' ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.2s'
              }}
            >
              <List size={14} /> Weekly
            </button>
            <button 
              onClick={() => setViewMode('calendar')} 
              style={{
                display: 'flex', alignItems: 'center', gap: 6, border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: viewMode === 'calendar' ? 'var(--primary)' : 'transparent',
                color: viewMode === 'calendar' ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.2s'
              }}
            >
              <Calendar size={14} /> Calendar View
            </button>
          </div>

          {!isStudent && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={selCourse} onChange={e => { setSelCourse(e.target.value); setSelDept(''); }} className="form-select" style={{ minWidth: 100, height: 38, marginBottom: 0 }}>
                <option value="">All Courses</option>
                {courses.map(c => {
                  const code = typeof c === 'object' ? c.code : c;
                  return <option key={code} value={code}>{code}</option>;
                })}
              </select>
              <select value={selDept} onChange={e => setSelDept(e.target.value)} className="form-select" style={{ minWidth: 110, height: 38, marginBottom: 0 }}>
                <option value="">All Branches</option>
                {(selCourse && COURSE_SPECIALIZATIONS[selCourse] ? COURSE_SPECIALIZATIONS[selCourse] : depts).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select value={selYear} onChange={e => setSelYear(e.target.value)} className="form-select" style={{ minWidth: 110, height: 38, marginBottom: 0 }}>
                <option value="">All Years</option>
                {getYearsForCourse(selCourse).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select value={selAY} onChange={e => setSelAY(e.target.value)} className="form-select" style={{ minWidth: 110, height: 38, marginBottom: 0 }}>
                <option value="">All Acad Years</option>
                {academicYears.map(ay => <option key={ay} value={ay}>{ay}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Quick Cohort Filters Bar */}
      {!isStudent && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: 'var(--bg-card)', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginRight: 4 }}>Quick View:</span>
          {[
            { label: 'All Classes', course: '', dept: '', year: '' },
            { label: '⚡ M.Tech — AI & ML (PG 2nd Yr)', course: 'M.Tech', dept: 'AI & ML', year: 'PG 2nd Year' },
            { label: '⚡ M.Tech — CSE (PG 2nd Yr)', course: 'M.Tech', dept: 'CSE', year: 'PG 2nd Year' },
            { label: '⚡ M.Tech — Cyber Security (PG 2nd Yr)', course: 'M.Tech', dept: 'Cyber Security', year: 'PG 2nd Year' },
            { label: 'B.Tech — CSE (1st Yr)', course: 'B.Tech', dept: 'CSE', year: '1st Year' },
            { label: 'B.Tech — AI & ML (2nd Yr)', course: 'B.Tech', dept: 'AI & ML', year: '2nd Year' },
            { label: 'BCA — Web Dev (1st Yr)', course: 'BCA', dept: 'Web Development', year: '1st Year' },
          ].map(p => {
            const active = selCourse === p.course && selDept === p.dept && selYear === p.year;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setSelCourse(p.course);
                  setSelDept(p.dept);
                  setSelYear(p.year);
                }}
                style={{
                  border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
                  background: active ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-sidebar)',
                  color: active ? 'var(--primary)' : 'var(--text-main)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}

      <div className={`schedule-grid-layout ${isAdmin && showAdminForm ? 'admin-layout' : ''}`}>
        {/* Admin Form: Add Slot */}
        {isAdmin && showAdminForm && (
          <div className="metric-card" style={{ padding: 20 }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)' }}>
              <Clock size={16} color="var(--primary)" /> Add Class Schedule
            </div>
            <form onSubmit={handleAddSlot} style={{ display: 'flex', flexDirection: 'column' }}>
              
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Course / Degree</label>
              <select value={form.course || ''} onChange={e => {
                const c = e.target.value;
                setForm({ ...form, course: c, department: '', year: '' });
              }} {...sel}>
                <option value="">Select Course</option>
                {courses.map(c => {
                  const code = typeof c === 'object' ? c.code : c;
                  return <option key={code} value={code}>{code}</option>;
                })}
              </select>

              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Specialization / Branch *</label>
              <select required value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} {...sel}>
                <option value="">Select Specialization</option>
                {(form.course && COURSE_SPECIALIZATIONS[form.course] ? COURSE_SPECIALIZATIONS[form.course] : depts).map(d => <option key={d} value={d}>{d}</option>)}
              </select>

              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Class Year *</label>
              <select required value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} {...sel}>
                <option value="">Select Year</option>
                {getYearsForCourse(form.course).map(y => <option key={y} value={y}>{y}</option>)}
              </select>

              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Academic Year *</label>
              <select required value={form.academic_year} onChange={e => setForm({ ...form, academic_year: e.target.value })} {...sel}>
                <option value="">Select Academic Year</option>
                {academicYears.map(ay => <option key={ay} value={ay}>{ay}</option>)}
              </select>

              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Subject *</label>
              <select required value={form.subject_id} onChange={e => setForm({ ...form, subject_id: e.target.value })} {...sel}>
                <option value="">
                  {!form.department || !form.year ? '— Select Dept & Year first —' : 'Select Subject'}
                </option>
                {subjects
                  .filter(s => {
                    if (!form.department && !form.year) return true;
                    const normDept = normalizeDept(form.department);
                    const normYear = (form.year || '').trim();
                    const cls = Array.isArray(s.classes) ? s.classes : [];
                    if (cls.length > 0) {
                      return cls.some(c => {
                        const dMatch = !normDept || normalizeDept(c.dept) === normDept;
                        const yMatch = !normYear || c.year === normYear;
                        return dMatch && yMatch;
                      });
                    }
                    const subDept = normalizeDept(s.department);
                    if (normDept && subDept && subDept !== normDept) return false;
                    return true;
                  })
                  .map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)
                }
              </select>

              {/* Schedule Type Toggle */}
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Schedule Type</label>
              <div style={{ display: 'flex', background: 'var(--bg-main)', borderRadius: 8, padding: 3, border: '1px solid var(--border)', marginBottom: 12 }}>
                <button 
                  type="button"
                  onClick={() => setScheduleType('weekly')} 
                  style={{
                    flex: 1, border: 'none', padding: '6px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    background: scheduleType === 'weekly' ? 'var(--primary)' : 'transparent',
                    color: scheduleType === 'weekly' ? '#fff' : 'var(--text-muted)',
                    transition: 'all 0.15s'
                  }}
                >
                  Weekly Recurring
                </button>
                <button 
                  type="button"
                  onClick={() => setScheduleType('date')} 
                  style={{
                    flex: 1, border: 'none', padding: '6px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    background: scheduleType === 'date' ? 'var(--primary)' : 'transparent',
                    color: scheduleType === 'date' ? '#fff' : 'var(--text-muted)',
                    transition: 'all 0.15s'
                  }}
                >
                  Specific Date
                </button>
              </div>

              {scheduleType === 'weekly' ? (
                <>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Day of Week *</label>
                  <select required value={form.day_of_week} onChange={e => setForm({ ...form, day_of_week: e.target.value })} {...sel}>
                    {DAYS.map(day => <option key={day} value={day}>{day}</option>)}
                  </select>
                </>
              ) : (
                <>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Calendar Date *</label>
                  <input type="date" required value={form.specific_date} onChange={e => setForm({ ...form, specific_date: e.target.value })} {...inp} />
                </>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Start Time *</label>
                  <input type="time" required value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} {...inp} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>End Time *</label>
                  <input type="time" required value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} {...inp} />
                </div>
              </div>

              {/* Timing presets */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Quick Presets (10 AM – 5 PM · Lunch 1-2 PM)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <button type="button" onClick={() => setForm({ ...form, start_time: '10:00', end_time: '11:00' })} className="btn btn-outline" style={{ fontSize: 10, padding: '3px 7px', minHeight: 0, height: 24 }}>10-11 AM (1h)</button>
                  <button type="button" onClick={() => setForm({ ...form, start_time: '11:00', end_time: '12:00' })} className="btn btn-outline" style={{ fontSize: 10, padding: '3px 7px', minHeight: 0, height: 24 }}>11-12 PM (1h)</button>
                  <button type="button" onClick={() => setForm({ ...form, start_time: '12:00', end_time: '13:00' })} className="btn btn-outline" style={{ fontSize: 10, padding: '3px 7px', minHeight: 0, height: 24 }}>12-1 PM (1h)</button>
                  <button type="button" onClick={() => setForm({ ...form, start_time: '14:00', end_time: '15:00' })} className="btn btn-outline" style={{ fontSize: 10, padding: '3px 7px', minHeight: 0, height: 24 }}>2-3 PM (1h)</button>
                  <button type="button" onClick={() => setForm({ ...form, start_time: '15:00', end_time: '16:00' })} className="btn btn-outline" style={{ fontSize: 10, padding: '3px 7px', minHeight: 0, height: 24 }}>3-4 PM (1h)</button>
                  <button type="button" onClick={() => setForm({ ...form, start_time: '16:00', end_time: '17:00' })} className="btn btn-outline" style={{ fontSize: 10, padding: '3px 7px', minHeight: 0, height: 24 }}>4-5 PM (1h)</button>
                  <button type="button" onClick={() => setForm({ ...form, start_time: '10:00', end_time: '12:00', classroom: (form.classroom || '') + ' Lab' })} className="btn btn-outline" style={{ fontSize: 10, padding: '3px 7px', minHeight: 0, height: 24, borderColor: 'var(--primary)', color: 'var(--primary)' }}>🧪 Lab 10-12 (2h)</button>
                  <button type="button" onClick={() => setForm({ ...form, start_time: '14:00', end_time: '16:00', classroom: (form.classroom || '') + ' Lab' })} className="btn btn-outline" style={{ fontSize: 10, padding: '3px 7px', minHeight: 0, height: 24, borderColor: 'var(--primary)', color: 'var(--primary)' }}>🧪 Lab 2-4 (2h)</button>
                  <button type="button" onClick={() => setForm({ ...form, start_time: '15:00', end_time: '17:00', classroom: (form.classroom || '') + ' Lab' })} className="btn btn-outline" style={{ fontSize: 10, padding: '3px 7px', minHeight: 0, height: 24, borderColor: 'var(--primary)', color: 'var(--primary)' }}>🧪 Lab 3-5 (2h)</button>
                </div>
              </div>

              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Classroom / Venue</label>
              <input placeholder="e.g. Room 302, Lab A" value={form.classroom} onChange={e => setForm({ ...form, classroom: e.target.value })} {...inp} />

              <button disabled={saving} className="btn btn-primary" style={{ height: 42, marginTop: 8 }}>
                {saving ? 'Saving Class...' : '+ Add to Calendar'}
              </button>
            </form>
          </div>
        )}

        {/* Dynamic Display Area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0, width: '100%' }}>
          {viewMode === 'weekly' ? (
            /* WEEKLY TIMETABLE VIEW */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
              {DAYS.map(day => {
                const slots = groupedSchedules[day] || [];
                return (
                  <div key={day} className="metric-card" style={{ padding: '16px 20px', minHeight: 80, width: '100%', boxSizing: 'border-box' }}>
                    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{day}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-sidebar)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)' }}>
                        {slots.length} recurring
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {slots.map(s => (
                        <div key={s.id} className="schedule-slot-card">
                          <div className="schedule-slot-card-left">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--primary)', fontWeight: 700, fontSize: 13, minWidth: 110 }}>
                              <Clock size={14} />
                              <span>{fmtRange(s.start_time, s.end_time)}</span>
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: 14 }}>
                                {s.subject_name} 
                                <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>({s.subject_code})</span>
                              </div>
                              {!isStudent && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <span style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#818cf8', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                                    {s.course || deriveCourse(s.department, s.year)}
                                  </span>
                                  <span>•</span>
                                  <span>{s.department}</span>
                                  <span>•</span>
                                  <span>{s.year}</span>
                                  <span style={{ color: 'var(--text-faint)' }}>({s.academic_year})</span>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="schedule-slot-card-actions">
                            {s.classroom && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--success)', fontSize: 12, fontWeight: 600, background: 'rgba(16,185,129,0.06)', padding: '4px 10px', borderRadius: 8 }}>
                                <MapPin size={13} />
                                <span>{s.classroom}</span>
                              </div>
                            )}
                            {['admin', 'teacher'].includes(user.role) && (
                              <button 
                                onClick={() => setTab('session', { course: s.course || deriveCourse(s.department, s.year), dept: s.department, year: s.year, academic_year: s.academic_year, subject: s.subject_id, locked: true })}
                                style={{ background: 'var(--primary)', border: 'none', color: '#fff', cursor: 'pointer', padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
                              >
                                <Camera size={14} /> Take Attendance
                              </button>
                            )}
                            {isAdmin && (
                              <button 
                                onClick={() => handleDeleteSlot(s.id, s.subject_code, 'Weekly')}
                                style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 4 }}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}

                      {slots.length === 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '6px 0' }}>
                          No recurring classes on {day}.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* MONTHLY CALENDAR GRID VIEW */
            <div className="metric-card" style={{ padding: 20 }}>
              {/* Calendar Month Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)' }}>{monthLabel}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => changeMonth(-1)} className="btn btn-outline" style={{ padding: 8, minHeight: 0, height: 34, width: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronLeft size={16} /></button>
                  <button onClick={() => changeMonth(1)} className="btn btn-outline" style={{ padding: 8, minHeight: 0, height: 34, width: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronRight size={16} /></button>
                </div>
              </div>

              {/* Weekday labels */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 8, textAlign: 'center' }}>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => (
                  <div key={w} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{w}</div>
                ))}
              </div>

              {/* Days grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, minHeight: 400 }}>
                {calendarCells.map((cell, idx) => {
                  if (!cell) {
                    return (
                      <div key={`empty-${idx}`} style={{ background: 'rgba(255,255,255,0.01)', borderRadius: 10, border: '1px dashed var(--border)', minHeight: 90 }} />
                    );
                  }

                  const daySessions = getSessionsForDate(cell.dateStr, cell.dayOfWeek);

                  return (
                    <div 
                      key={cell.dateStr} 
                      style={{ 
                        background: 'var(--bg-sidebar)', 
                        border: '1px solid var(--border)', 
                        borderRadius: 10, 
                        padding: 8, 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: 6,
                        minHeight: 90,
                        transition: 'border-color 0.15s'
                      }}
                      className="calendar-day-cell"
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)' }}>{cell.day}</div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', flex: 1 }}>
                        {daySessions.map(s => {
                          const label = s.specific_date ? 'one-off' : 'recurring';
                          return (
                            <div 
                              key={s.id} 
                              style={{ 
                                fontSize: 10, 
                                padding: '3px 6px', 
                                background: s.specific_date ? 'rgba(16,185,129,0.08)' : 'rgba(99,102,241,0.08)', 
                                border: s.specific_date ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(99,102,241,0.2)', 
                                borderRadius: 6, 
                                color: s.specific_date ? 'var(--success)' : 'var(--primary)', 
                                fontWeight: 700, 
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 4
                              }}
                              title={`${fmtRange(s.start_time, s.end_time)} - ${s.subject_code} (${s.classroom || 'No Venue'}) [${label}]`}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {fmtAMPM(s.start_time)} {s.subject_code}
                              </span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                {['admin', 'teacher'].includes(user.role) && (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); setTab('session', { course: s.course || deriveCourse(s.department, s.year), dept: s.department, year: s.year, academic_year: s.academic_year, subject: s.subject_id, locked: true }); }}
                                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                                    title="Take Attendance"
                                  >
                                    <Camera size={12} />
                                  </button>
                                )}
                                {isAdmin && (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleDeleteSlot(s.id, s.subject_code, s.specific_date || s.day_of_week); }}
                                    style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                                  >
                                    <Trash2 size={10} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
