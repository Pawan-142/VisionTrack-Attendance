import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../components/Modal';
import { localToday } from '../utils/dateUtils';

const FieldLabel = ({ children }) => (
  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
    {children}
  </span>
);

const Badge = ({ color, bg, children }) => (
  <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
    {children}
  </span>
);

export default function ManualAttendance({ subjects, students, toast, authFetch, user }) {
  const [sessions, setSessions] = useState([]);
  const [sectionsList, setSectionsList] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [selDept, setSelDept] = useState('');
  const [selYear, setSelYear] = useState('');
  const [selAY, setSelAY] = useState('');
  const [selSubjectId, setSelSubjectId] = useState('');
  const [selSessionId, setSelSessionId] = useState('');
  const [selDate, setSelDate] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
  const [search, setSearch] = useState('');
  const [editLog, setEditLog] = useState(null);
  const [editRollNo, setEditRollNo] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const fetchSessions = async () => {
    try { const res = await authFetch('/api/sessions'); const data = await res.json(); if (Array.isArray(data)) setSessions(data); } catch {}
  };
  const fetchSections = async () => {
    try { const res = await authFetch('/api/sections'); const data = await res.json(); if (Array.isArray(data)) setSectionsList(data); } catch {}
  };
  const fetchLogs = async (date) => {
    if (!date) return;
    setLoadingLogs(true);
    try { const res = await authFetch(`/api/logs?log_date=${date}`); const data = await res.json(); setLogs(Array.isArray(data) ? data : []); } catch { setLogs([]); }
    setLoadingLogs(false);
  };

  useEffect(() => { fetchSessions(); fetchSections(); }, []);
  useEffect(() => { fetchLogs(selDate); }, [selDate]);

  const departments = useMemo(() => [...new Set(sectionsList.map(s => s.department))].sort(), [sectionsList]);
  const years = useMemo(() => {
    if (!selDept) return [];
    return [...new Set(sectionsList.filter(s => s.department === selDept).map(s => s.year))].sort();
  }, [selDept, sectionsList]);
  const academicYears = useMemo(() => {
    if (!selDept || !selYear) return [];
    return [...new Set(sectionsList.filter(s => s.department === selDept && s.year === selYear).map(s => s.academic_year))].sort().reverse();
  }, [selDept, selYear, sectionsList]);

  const sectionSubjects = useMemo(() => {
    if (!selDept || !selYear || !selAY) return [];
    const sec = sectionsList.find(s => s.department === selDept && s.year === selYear && s.academic_year === selAY);
    if (!sec || !sec.subjects) return [];
    const codes = Array.isArray(sec.subjects) ? sec.subjects : JSON.parse(sec.subjects || '[]');
    return subjects.filter(sub => codes.includes(sub.code));
  }, [selDept, selYear, selAY, sectionsList, subjects]);

  const filteredSessions = useMemo(() => sessions.filter(s => {
    const matchDate = !selDate || s.date === selDate;
    const matchSub  = !selSubjectId || String(s.subject_id) === String(selSubjectId);
    const matchDept = !selDept || s.department === selDept;
    const matchYear = !selYear || s.year === selYear;
    return matchDate && matchSub && matchDept && matchYear;
  }), [sessions, selDate, selSubjectId, selDept, selYear]);

  useEffect(() => {
    if (filteredSessions.length > 0) setSelSessionId(String(filteredSessions[0].id));
    else setSelSessionId('');
  }, [filteredSessions]);

  const classStudents = useMemo(() => {
    let list = students || [];
    if (selDept || selYear || selAY) {
      list = list.filter(st =>
        (!selDept || st.department === selDept) &&
        (!selYear || st.year === selYear) &&
        (!selAY   || st.academic_year === selAY)
      );
    }
    return [...list].sort((a, b) =>
      String(a.roll_no || '').localeCompare(String(b.roll_no || ''), undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [students, selDept, selYear, selAY]);

  const displayStudents = useMemo(() => {
    if (!search.trim()) return classStudents;
    const q = search.trim().toLowerCase();
    return classStudents.filter(s =>
      s.roll_no?.toLowerCase().includes(q) ||
      s.name?.toLowerCase().includes(q) ||
      s.department?.toLowerCase().includes(q) ||
      s.year?.toLowerCase().includes(q) ||
      s.academic_year?.toLowerCase().includes(q)
    );
  }, [classStudents, search]);

  // Present across ALL sessions on this date
  const presentRollNos = useMemo(() => {
    return new Set(logs.map(l => l.roll_no));
  }, [logs]);

  // Present in the SELECTED session specifically
  const presentInSession = useMemo(() => {
    if (!selSessionId) return presentRollNos;
    return new Set(logs.filter(l => String(l.session_id) === String(selSessionId)).map(l => l.roll_no));
  }, [logs, selSessionId, presentRollNos]);

  const isStudentPresent = (rollNo) => {
    if (selSessionId) return presentInSession.has(rollNo);
    return presentRollNos.has(rollNo);
  };

  const presentCount = displayStudents.filter(s => isStudentPresent(s.roll_no)).length;
  const absentCount  = displayStudents.length - presentCount;

  const handleToggle = async (student, isCurrentlyPresent) => {
    let currentSessionId = selSessionId;
    if (!currentSessionId && !isCurrentlyPresent) {
      let subId = Number(selSubjectId) || (subjects.length > 0 ? subjects[0].id : 1);
      const subObj = subjects.find(s => s.id === subId);
      try {
        const sRes = await authFetch('/api/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject_id: subId,
            department: selDept || student.department || subObj?.department || 'AI & ML',
            year: selYear || student.year || 'PG 2nd Year',
            academic_year: selAY || student.academic_year || '2025-2026',
            course: student.course || subObj?.course || 'M.Tech',
            faculty: user?.name || 'Faculty',
            date: selDate
          })
        });
        const sData = await sRes.json();
        if (sRes.ok && sData.session_id) {
          currentSessionId = String(sData.session_id);
          setSelSessionId(currentSessionId);
          await fetchSessions();
        } else {
          toast(sData.detail || 'Could not start session', 'error');
          return;
        }
      } catch (err) {
        toast('Connection error starting session', 'error');
        return;
      }
    }

    setSheetLoading(true);
    try {
      if (isCurrentlyPresent) {
        const targetLog = selSessionId 
          ? logs.find(l => l.roll_no === student.roll_no && String(l.session_id) === String(selSessionId))
          : logs.find(l => l.roll_no === student.roll_no);
        const delSessionId = targetLog?.session_id || currentSessionId;
        
        if (delSessionId) {
          const res = await authFetch(`/api/attendance/${delSessionId}/${student.roll_no}`, { method: 'DELETE' });
          const data = await res.json();
          if (res.ok && data.status === 'ok') { 
            toast(`Marked ${student.name} Absent`, 'warning'); 
            await fetchLogs(selDate); 
          } else {
            toast(data.detail || 'Failed', 'error');
          }
        }
      } else {
        const res = await authFetch('/api/attendance/manual', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roll_no: student.roll_no, session_id: currentSessionId, date: selDate }),
        });
        const data = await res.json();
        if (res.ok && (data.status === 'ok' || data.status === 'duplicate')) { 
          toast(`Marked ${student.name} Present`); 
          await fetchLogs(selDate); 
        } else {
          toast(data.detail || data.message || 'Failed', 'error');
        }
      }
    } catch { toast('Connection error', 'error'); }
    setSheetLoading(false);
  };

  const handleMarkAll = async (markPresent) => {
    let currentSessionId = selSessionId;
    if (!currentSessionId) {
      let subId = Number(selSubjectId) || (subjects.length > 0 ? subjects[0].id : 1);
      const subObj = subjects.find(s => s.id === subId);
      try {
        const sRes = await authFetch('/api/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject_id: subId,
            department: selDept || subObj?.department || 'AI & ML',
            year: selYear || 'PG 2nd Year',
            academic_year: selAY || '2025-2026',
            course: subObj?.course || 'M.Tech',
            faculty: user?.name || 'Faculty',
            date: selDate
          })
        });
        const sData = await sRes.json();
        if (sRes.ok && sData.session_id) {
          currentSessionId = String(sData.session_id);
          setSelSessionId(currentSessionId);
          await fetchSessions();
        }
      } catch {}
    }
    if (!currentSessionId) { toast('Please start a session first', 'error'); return; }

    const targets = markPresent
      ? displayStudents.filter(s => !presentInSession.has(s.roll_no))
      : displayStudents.filter(s => presentInSession.has(s.roll_no));
    if (targets.length === 0) { toast('No students to update', 'warning'); return; }
    const msg = markPresent
      ? `Mark all ${targets.length} absent students Present for ${selDate}?`
      : `Mark all ${targets.length} present students Absent for ${selDate}?`;
    if (!window.confirm(msg)) return;
    setSheetLoading(true);
    let ok = 0, fail = 0;
    for (const student of targets) {
      try {
        if (markPresent) {
          const res = await authFetch('/api/attendance/manual', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roll_no: student.roll_no, session_id: currentSessionId, date: selDate }),
          });
          const d = await res.json();
          if (res.ok && (d.status === 'ok' || d.status === 'duplicate')) ok++; else fail++;
        } else {
          const res = await authFetch(`/api/attendance/${currentSessionId}/${student.roll_no}`, { method: 'DELETE' });
          const d = await res.json();
          if (res.ok && d.status === 'ok') ok++; else fail++;
        }
      } catch { fail++; }
    }
    await fetchLogs(selDate);
    setSheetLoading(false);
    toast(`Done: ${ok} updated${fail > 0 ? `, ${fail} failed` : ''}`);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editRollNo.trim() || !editTime.trim()) { toast('Roll No and time required', 'error'); return; }
    setEditLoading(true);
    try {
      const res = await authFetch(`/api/attendance/${editLog.session_id}/${editLog.roll_no}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_roll_no: editRollNo.trim(), time: editTime.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') { toast('Record updated'); setEditLog(null); fetchLogs(selDate); }
      else toast(data.detail || data.message || 'Failed', 'error');
    } catch { toast('Connection error', 'error'); }
    setEditLoading(false);
  };

  const handleDelete = async (l) => {
    if (!window.confirm(`Delete attendance record of ${l.name || l.roll_no}?`)) return;
    try {
      const res = await authFetch(`/api/attendance/${l.session_id}/${l.roll_no}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.status === 'ok') { toast('Record deleted'); fetchLogs(selDate); }
      else toast(data.detail || 'Failed', 'error');
    } catch { toast('Connection error', 'error'); }
  };

  const fmtAMPM = (timeStr) => {
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
  };

  const handleCreateSession = async () => {
    let subId = Number(selSubjectId);
    if (!subId) {
      if (subjects.length > 0) {
        subId = subjects[0].id;
        setSelSubjectId(String(subId));
      } else {
        toast('No subjects available. Please add a subject first.', 'error');
        return;
      }
    }
    const subObj = subjects.find(s => s.id === subId);
    try {
      const res = await authFetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_id: subId,
          department: selDept || subObj?.department || 'AI & ML',
          year: selYear || 'PG 2nd Year',
          academic_year: selAY || '2025-2026',
          course: subObj?.course || 'M.Tech',
          faculty: user?.name || 'Faculty',
          date: selDate
        })
      });
      const data = await res.json();
      if (res.ok && data.session_id) {
        toast('Attendance session created successfully!');
        await fetchSessions();
        setSelSessionId(String(data.session_id));
      } else {
        toast(data.detail || 'Failed to create session', 'error');
      }
    } catch (err) {
      toast('Error creating session', 'error');
    }
  };

  const handleDeptChange = (v) => { setSelDept(v); setSelYear(''); setSelAY(''); setSelSubjectId(''); };
  const handleYearChange = (v) => { setSelYear(v); setSelAY(''); setSelSubjectId(''); };
  const handleAYChange   = (v) => { setSelAY(v); setSelSubjectId(''); };
  const sessionLabel = (s) => `${s.subject_code || s.code || '?'} · ${fmtAMPM(s.start_time)}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* FILTER CARD */}
      <div className="metric-card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Filter Attendance</span>
          {(selDept || selYear || selAY || selSubjectId) && (
            <button
              onClick={() => { setSelDept(''); setSelYear(''); setSelAY(''); setSelSubjectId(''); setSelSessionId(''); setSearch(''); }}
              style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 12px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}
            >
              Clear Filters
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
          <div>
            <FieldLabel>Date</FieldLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              <input 
                type="date" 
                value={selDate} 
                onChange={e => setSelDate(e.target.value)} 
                onClick={e => e.target.showPicker?.()}
                className="form-input" 
                style={{ flex: 1, cursor: 'pointer' }} 
              />
              <button 
                type="button" 
                onClick={() => setSelDate(localToday())} 
                className="btn btn-outline" 
                style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, height: 38 }}
                title="Select Today"
              >
                Today
              </button>
            </div>
          </div>
          <div>
            <FieldLabel>Department</FieldLabel>
            <select value={selDept} onChange={e => handleDeptChange(e.target.value)} className="form-input" style={{ width: '100%' }}>
              <option value="">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Year</FieldLabel>
            <select value={selYear} onChange={e => handleYearChange(e.target.value)} className="form-input" style={{ width: '100%' }} disabled={!selDept}>
              <option value="">All Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Academic Year</FieldLabel>
            <select value={selAY} onChange={e => handleAYChange(e.target.value)} className="form-input" style={{ width: '100%' }} disabled={!selYear}>
              <option value="">All Batches</option>
              {academicYears.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Subject</FieldLabel>
            <select value={selSubjectId} onChange={e => setSelSubjectId(e.target.value)} className="form-input" style={{ width: '100%' }}>
              <option value="">All Subjects</option>
              {(sectionSubjects.length > 0 ? sectionSubjects : subjects).map(s => (
                <option key={s.id} value={String(s.id)}>{s.code} — {s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Session</FieldLabel>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={selSessionId} onChange={e => setSelSessionId(e.target.value)} className="form-input" style={{ flex: 1 }}>
                <option value="">— Select Session —</option>
                {filteredSessions.map(s => <option key={s.id} value={String(s.id)}>{sessionLabel(s)}</option>)}
              </select>
              {filteredSessions.length === 0 && (
                <button
                  type="button"
                  onClick={handleCreateSession}
                  className="btn btn-primary"
                  style={{ padding: '8px 14px', fontSize: 12, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4, height: 38 }}
                  title="Create a new attendance session for this date/subject"
                >
                  ➕ New Session
                </button>
              )}
            </div>
            {selDate && filteredSessions.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>No session found. Click <b>"➕ New Session"</b> or toggle buttons below to start.</div>
            )}
          </div>
        </div>
      </div>

      {/* STATS STRIP */}
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: selSessionId ? 'Present in Session' : 'Present Today', value: presentCount, color: '#0ca678', bg: '#e6fcf5' },
          { label: 'Absent',  value: absentCount,  color: '#e64980', bg: '#fff0f6' },
          { label: 'Enrolled Shown', value: displayStudents.length, color: 'var(--primary)', bg: 'var(--bg-card)' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} style={{ flex: 1, background: bg, border: `1px solid ${color}22`, borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color, opacity: 0.85 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* STUDENT TABLE CARD */}
      <div className="metric-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '20px 24px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>
              {selDept ? `${selDept}${selYear ? ' · ' + selYear : ''}${selAY ? ' · ' + selAY : ''}` : 'All Students Roster'}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>({displayStudents.length} students)</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 14, pointerEvents: 'none' }}>🔍</span>
              <input
                placeholder="Search name, roll no, year..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="form-input"
                style={{ paddingLeft: 30, fontSize: 13, height: 36, width: 200 }}
              />
            </div>
            {displayStudents.length > 0 && (
              <>
                <button disabled={sheetLoading} onClick={() => handleMarkAll(true)} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600 }}>
                  Mark All Present
                </button>
                <button disabled={sheetLoading} onClick={() => handleMarkAll(false)} className="btn btn-danger" style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600 }}>
                  Mark All Absent
                </button>
              </>
            )}
          </div>
        </div>

        {displayStudents.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>👥</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>No Students Found</div>
            <div style={{ fontSize: 14 }}>No students match the current filters. Enroll students in the Admin Panel to see them here.</div>
          </div>
        ) : loadingLogs ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>Loading records...</div>
        ) : (
          <div className="table-container" style={{ margin: '0 24px 24px' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Roll No</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Year</th>
                  <th>Batch</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                  <th style={{ textAlign: 'center' }}>Action</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {displayStudents.map((student, i) => {
                  const isPresent = isStudentPresent(student.roll_no);
                  const activeLog = selSessionId 
                    ? logs.find(l => l.roll_no === student.roll_no && String(l.session_id) === String(selSessionId))
                    : logs.find(l => l.roll_no === student.roll_no);
                  return (
                    <tr key={i} style={{ background: isPresent ? 'rgba(12,166,120,0.04)' : undefined, transition: 'background 0.2s' }}>
                      <td style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: 13 }}>{i + 1}</td>
                      <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{student.roll_no}</td>
                      <td style={{ fontWeight: 600 }}>{student.name}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{student.department || '—'}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{student.year || '—'}</td>
                      <td>
                        <span style={{ fontSize: 12, padding: '2px 8px', background: 'var(--bg-sidebar)', borderRadius: 6, border: '1px solid var(--border)', fontWeight: 500 }}>
                          {student.academic_year || '—'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {isPresent
                          ? <Badge color="#0ca678" bg="#e6fcf5">Present{activeLog?.time ? ' · ' + fmtAMPM(activeLog.time) : ''}</Badge>
                          : <Badge color="#e64980" bg="#fff0f6">Absent</Badge>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          disabled={sheetLoading}
                          onClick={() => handleToggle(student, isPresent)}
                          style={{
                            padding: '6px 18px', fontSize: 12, fontWeight: 700, borderRadius: 8,
                            border: 'none', cursor: sheetLoading ? 'not-allowed' : 'pointer',
                            transition: 'all 0.18s',
                            background: isPresent ? 'rgba(230,73,128,0.12)' : 'rgba(12,166,120,0.12)',
                            color: isPresent ? '#e64980' : '#0ca678',
                            opacity: sheetLoading ? 0.6 : 1,
                          }}
                        >
                          {isPresent ? 'Mark Absent' : 'Mark Present'}
                        </button>
                      </td>
                      <td>
                        {isPresent && activeLog && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => { setEditLog(activeLog); setEditRollNo(activeLog.roll_no); setEditTime(activeLog.time); }}
                              style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(activeLog)}
                              style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* EDIT MODAL */}
      {editLog && (
        <Modal title="Edit Attendance Record" onClose={() => setEditLog(null)}>
          <form onSubmit={handleEditSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'var(--bg-sidebar)', padding: '10px 14px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)' }}>
                <b>{editLog.name}</b>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{editLog.subject_name || editLog.subject_code} · {editLog.date}</span>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Student Roll No</label>
                <input required value={editRollNo} onChange={e => setEditRollNo(e.target.value)} className="form-input" style={{ marginTop: 4 }} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                  Check-in Time <span style={{ fontWeight: 400 }}>(HH:MM:SS)</span>
                </label>
                <input required placeholder="e.g. 09:30:00" value={editTime} onChange={e => setEditTime(e.target.value)} className="form-input" style={{ marginTop: 4 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" onClick={() => setEditLog(null)} className="btn btn-outline" style={{ height: 40 }}>Cancel</button>
                <button disabled={editLoading} className="btn btn-primary" style={{ height: 40 }}>
                  {editLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}