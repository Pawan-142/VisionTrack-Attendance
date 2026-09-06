import { useState, useEffect } from 'react';
import { Modal } from '../components/Modal';
import { localToday } from '../utils/dateUtils';

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

export default function Logs({ subjects, students, toast, authFetch, user }) {
  const [logs, setLogs] = useState([]);
  const [logDate, setLogDate] = useState(() => localToday());
  const [subjectId, setSubjectId] = useState('');
  const [loading, setLoading] = useState(false);

  // Tab switcher state
  const [viewMode, setViewMode] = useState('sheet'); // 'sheet' or 'logs'

  // Class Attendance Sheet states
  const [sheetDate, setSheetDate] = useState(() => localToday());
  const [sheetSessionId, setSheetSessionId] = useState('');
  const [sheetLoading, setSheetLoading] = useState(false);

  // Manual attendance form states
  const [sessions, setSessions] = useState([]);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualDate, setManualDate] = useState('');
  const [manualSessionId, setManualSessionId] = useState('');
  const [manualRollNo, setManualRollNo] = useState('');
  const [manualLoading, setManualLoading] = useState(false);

  // Edit modal states
  const [editLog, setEditLog] = useState(null);
  const [editRollNo, setEditRollNo] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [sheetPage, setSheetPage] = useState(1);
  const recordsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [logs]);

  useEffect(() => {
    setSheetPage(1);
  }, [sheetSessionId, sheetDate]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (logDate) params.set('log_date', logDate);
      if (subjectId) params.set('subject_id', subjectId);
      const res = await authFetch(`/api/logs?${params}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setLogs(data);
      } else {
        setLogs([]);
      }
    } catch (err) {
      setLogs([]);
    }
    setLoading(false);
  };

  const fetchSheetLogs = async () => {
    if (!sheetDate) return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/logs?log_date=${sheetDate}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setLogs(data);
      } else {
        setLogs([]);
      }
    } catch (err) {
      setLogs([]);
    }
    setLoading(false);
  };

  const fetchSessions = async () => {
    try {
      const res = await authFetch(`/api/sessions`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setSessions(data);
      }
    } catch (err) {}
  };

  useEffect(() => { 
    if (viewMode === 'logs') {
      fetchLogs(); 
    }
  }, [logDate, subjectId, viewMode]);

  useEffect(() => {
    if (viewMode === 'sheet' && sheetDate) {
      fetchSheetLogs();
    }
  }, [sheetDate, viewMode]);

  useEffect(() => {
    fetchSessions();
  }, []);

  // Pre-select first session of the selected date in sheet view
  useEffect(() => {
    if (viewMode === 'sheet' && sheetDate) {
      const filtered = sessions.filter(s => s.date === sheetDate);
      if (filtered.length > 0) {
        setSheetSessionId(filtered[0].id);
      } else {
        setSheetSessionId('');
      }
    }
  }, [sheetDate, sessions, viewMode]);

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualSessionId || !manualRollNo) {
      alert('Select a session and enter a student Roll No');
      return;
    }
    setManualLoading(true);
    try {
      const res = await authFetch(`/api/attendance/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roll_no: manualRollNo.trim(), session_id: manualSessionId }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        alert('Attendance marked successfully!');
        setManualRollNo('');
        fetchLogs();
      } else {
        alert(data.detail || data.message || 'Failed to mark attendance');
      }
    } catch (err) {
      alert('Failed to connect to backend server');
    }
    setManualLoading(false);
  };

  const handleDelete = async (l) => {
    if (!window.confirm(`Delete attendance record of ${l.name} (${l.roll_no})?`)) return;
    try {
      const res = await authFetch(`/api/attendance/${l.session_id}/${l.roll_no}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        alert('Attendance deleted successfully!');
        fetchLogs();
      } else {
        alert(data.detail || data.message || 'Failed to delete attendance');
      }
    } catch (err) {
      alert('Failed to delete attendance');
    }
  };

  const handleToggleAttendance = async (student, isCurrentlyPresent) => {
    if (!sheetSessionId) return;
    setSheetLoading(true);
    try {
      if (isCurrentlyPresent) {
        // Mark Absent (DELETE)
        const res = await authFetch(`/api/attendance/${sheetSessionId}/${student.roll_no}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (res.ok && data.status === 'ok') {
          toast(`Marked ${student.name} absent`);
          await fetchSheetLogs();
        } else {
          toast(data.detail || data.message || 'Failed to remove attendance', 'error');
        }
      } else {
        // Mark Present (POST)
        const res = await authFetch(`/api/attendance/manual`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roll_no: student.roll_no, session_id: sheetSessionId }),
        });
        const data = await res.json();
        if (res.ok && data.status === 'ok') {
          toast(`Marked ${student.name} present`);
          await fetchSheetLogs();
        } else {
          toast(data.detail || data.message || 'Failed to mark attendance', 'error');
        }
      }
    } catch (err) {
      toast('Failed to update attendance', 'error');
    }
    setSheetLoading(false);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editRollNo.trim() || !editTime.trim()) {
      alert('Roll No and Check-in Time are required');
      return;
    }
    setEditLoading(true);
    try {
      const res = await authFetch(`/api/attendance/${editLog.session_id}/${editLog.roll_no}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_roll_no: editRollNo.trim(), time: editTime.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        alert('Attendance updated successfully!');
        setEditLog(null);
        fetchLogs();
      } else {
        alert(data.detail || data.message || 'Failed to update attendance');
      }
    } catch (err) {
      alert('Failed to update attendance');
    }
    setEditLoading(false);
  };

  const filteredSessions = sessions.filter(s => !manualDate || s.date === manualDate);
  const selStyle = { className: 'form-input' };

  const filteredSheetSessions = sessions.filter(s => s.date === sheetDate);

  const indexOfLastRecord = currentPage * recordsPerPage;
  const indexOfFirstRecord = indexOfLastRecord - recordsPerPage;
  const currentRecords = Array.isArray(logs) ? logs.slice(indexOfFirstRecord, indexOfLastRecord) : [];
  const totalPages = Array.isArray(logs) ? Math.ceil(logs.length / recordsPerPage) : 0;

  const sheetIndexOfLastRecord = sheetPage * recordsPerPage;
  const sheetIndexOfFirstRecord = sheetIndexOfLastRecord - recordsPerPage;
  const currentSheetStudents = Array.isArray(students) ? students.slice(sheetIndexOfFirstRecord, sheetIndexOfLastRecord) : [];
  const sheetTotalPages = Array.isArray(students) ? Math.ceil(students.length / recordsPerPage) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Tab Switcher */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 12, padding: '4px 8px' }}>
        <button 
          onClick={() => {
            setViewMode('sheet');
            if (!sheetDate) {
              setSheetDate(localToday());
            }
          }} 
          style={{ 
            background: viewMode === 'sheet' ? 'var(--primary)' : 'none', 
            color: viewMode === 'sheet' ? '#fff' : 'var(--text-muted)', 
            border: 'none', 
            padding: '10px 20px', 
            borderRadius: 8,
            fontWeight: 600, 
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            marginRight: 8
          }}
        >
          📝 Attendance Sheet
        </button>
        <button 
          onClick={() => setViewMode('logs')} 
          style={{ 
            background: viewMode === 'logs' ? 'var(--primary)' : 'none', 
            color: viewMode === 'logs' ? '#fff' : 'var(--text-muted)', 
            border: 'none', 
            padding: '10px 20px', 
            borderRadius: 8,
            fontWeight: 600, 
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          📋 Check-in History
        </button>
      </div>

      {viewMode === 'logs' ? (
        <div className="metric-card">
          <div className="metric-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <span>Check-in History ({Array.isArray(logs) ? logs.length : 0} records)</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input 
                  type="date" 
                  value={logDate} 
                  onChange={e => setLogDate(e.target.value)} 
                  onClick={e => e.target.showPicker?.()}
                  className="form-input" 
                  title="Click to open calendar" 
                  style={{ padding: '8px 12px', minHeight: '38px', cursor: 'pointer', minWidth: '140px' }} 
                />
              </div>
              <button 
                type="button" 
                onClick={() => setLogDate(localToday())} 
                className="btn btn-outline" 
                style={{ padding: '6px 12px', height: '38px', fontSize: 12, fontWeight: 600 }}
                title="Select Today's Date"
              >
                📅 Today
              </button>
              <select value={subjectId} onChange={e => setSubjectId(e.target.value)} className="form-input" style={{ padding: '8px 12px', minHeight: '38px' }}>
                <option value="">All Subjects</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
              <button onClick={() => { setLogDate(''); setSubjectId(''); }} className="btn btn-outline" style={{ padding: '8px 14px', height: '38px', fontSize: 12 }}>
                All Dates
              </button>
            </div>
          </div>

          {/* Manual Entry Collapsible Panel */}
          {user?.role !== 'student' && (
            <div style={{ padding: '0 24px', marginBottom: 12 }}>
              <button 
                onClick={() => setShowManualForm(!showManualForm)} 
                className="btn btn-outline" 
                style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: 8, marginBottom: showManualForm ? 16 : 0, fontWeight: 600 }}
              >
                {showManualForm ? '▲ Hide Manual Entry' : '▼ Show Manual Entry / Override'}
              </button>

              {showManualForm && (
                <div className="metric-card" style={{ padding: 20, marginBottom: 16, background: 'var(--bg-sidebar)', borderColor: 'var(--border)' }}>
                  <h3 style={{ fontSize: 15, marginBottom: 16, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>✏️ Mark Attendance Manually</span>
                  </h3>
                  <form onSubmit={handleManualSubmit} className="form-grid" style={{ alignItems: 'flex-end' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Session Date</label>
                      <input 
                        type="date" 
                        value={manualDate} 
                        onChange={e => { setManualDate(e.target.value); setManualSessionId(''); }} 
                        onClick={e => e.target.showPicker?.()}
                        className="form-input" 
                        style={{ marginTop: 4, cursor: 'pointer' }}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Select Session</label>
                      <select 
                        required 
                        value={manualSessionId} 
                        onChange={e => setManualSessionId(e.target.value)} 
                        className="form-input"
                        style={{ marginTop: 4 }}
                      >
                        <option value="">Select Session...</option>
                        {filteredSessions.map(s => (
                          <option key={s.id} value={s.id}>
                            #{s.id.toString().substring(0, 6)} — {s.code} ({s.date} {fmtAMPM(s.start_time)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Student Roll No</label>
                      <input 
                        required 
                        placeholder="e.g. 2024CS01" 
                        value={manualRollNo} 
                        onChange={e => setManualRollNo(e.target.value)} 
                        className="form-input" 
                        style={{ marginTop: 4 }}
                      />
                    </div>
                    <button disabled={manualLoading} className="btn btn-primary" style={{ height: '42px' }}>
                      {manualLoading ? 'Marking...' : 'Mark Present'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          <div style={{ padding: 24, paddingTop: 0 }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
            ) : (
              <>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th><th>Time</th><th>Subject</th><th>Roll No</th><th>Name</th>
                        {user?.role !== 'student' && <th>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {currentRecords.map((l, i) => (
                        <tr key={i}>
                          <td style={{ color: 'var(--text-muted)' }}>{l.date}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{fmtAMPM(l.time)}</td>
                          <td style={{ fontWeight: 600 }}>{l.subject_name || l.subject_code || '—'}</td>
                          <td className="text-primary">{l.roll_no}</td>
                          <td>{l.name}</td>
                          {user?.role !== 'student' && (
                            <td>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button 
                                  onClick={() => {
                                    setEditLog(l);
                                    setEditRollNo(l.roll_no);
                                    setEditTime(l.time);
                                  }}
                                  className="btn btn-primary" 
                                  style={{ padding: '6px 12px', fontSize: 12, minHeight: 0, height: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                                  title="Edit attendance log"
                                >
                                  Edit
                                </button>
                                <button 
                                  onClick={() => handleDelete(l)} 
                                  className="btn btn-danger" 
                                  style={{ padding: '6px 12px', fontSize: 12, minHeight: 0, height: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                                  title="Delete attendance log"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                      {(!Array.isArray(logs) || logs.length === 0) && (
                        <tr>
                          <td colSpan={user?.role === 'student' ? "5" : "6"} className="text-center" style={{ padding: 32 }}>
                            No logs found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                
                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                    <button 
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      className="btn btn-outline"
                      style={{ padding: '6px 14px', fontSize: 13, minHeight: 0, height: '34px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                    >
                      ◀ Prev
                    </button>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>
                      Page {currentPage} of {totalPages}
                    </span>
                    <button 
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      className="btn btn-outline"
                      style={{ padding: '6px 14px', fontSize: 13, minHeight: 0, height: '34px', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
                    >
                      Next ▶
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="metric-card">
          <div className="metric-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <span>Attendance Sheet</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="date" value={sheetDate} onChange={e => setSheetDate(e.target.value)} className="form-input" title="Filter by date" style={{ padding: '8px 12px', minHeight: '38px' }} />
              <select value={sheetSessionId} onChange={e => setSheetSessionId(e.target.value)} className="form-input" style={{ padding: '8px 12px', minHeight: '38px', minWidth: '220px' }}>
                <option value="">Select Session...</option>
                {filteredSheetSessions.map(s => (
                  <option key={s.id} value={s.id}>
                    #{s.id.toString().substring(0, 6)} — {s.code} ({fmtAMPM(s.start_time)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ padding: 24 }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
            ) : !sheetSessionId ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                Please select a date and an active session to view the attendance sheet.
              </div>
            ) : (
              <>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Roll No</th><th>Name</th><th>Department</th><th>Year</th><th>Academic Year</th><th>Status</th>
                        {user?.role !== 'student' && <th>Toggle Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {currentSheetStudents.map((student, i) => {
                        const isPresent = logs.some(l => l.roll_no === student.roll_no && l.session_id === sheetSessionId);
                        return (
                          <tr key={i}>
                            <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{student.roll_no}</td>
                            <td style={{ fontWeight: 600 }}>{student.name}</td>
                            <td>{student.department || '—'}</td>
                            <td>{student.year || '—'}</td>
                            <td><span style={{ padding: '3px 8px', background: 'var(--bg-sidebar)', borderRadius: 6, fontSize: 12, border: '1px solid var(--border)', fontWeight: 500 }}>{student.academic_year || '—'}</span></td>
                            <td>
                              {isPresent ? (
                                <span style={{ background: '#e6fcf5', color: '#0ca678', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                                  Present
                                </span>
                              ) : (
                                <span style={{ background: '#fff0f6', color: '#e64980', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                                  Absent
                                </span>
                              )}
                            </td>
                            {user?.role !== 'student' && (
                              <td>
                                <button
                                  disabled={sheetLoading}
                                  onClick={() => handleToggleAttendance(student, isPresent)}
                                  className={isPresent ? "btn btn-danger" : "btn btn-primary"}
                                  style={{ padding: '6px 14px', fontSize: 12, minHeight: 0, height: 'auto', minWidth: '100px' }}
                                >
                                  {isPresent ? 'Mark Absent' : 'Mark Present'}
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {students.length === 0 && (
                        <tr>
                          <td colSpan={user?.role === 'student' ? "6" : "7"} className="text-center" style={{ padding: 32 }}>
                            No enrolled students found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {sheetTotalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                    <button 
                      disabled={sheetPage === 1}
                      onClick={() => setSheetPage(prev => Math.max(prev - 1, 1))}
                      className="btn btn-outline"
                      style={{ padding: '6px 14px', fontSize: 13, minHeight: 0, height: '34px', cursor: sheetPage === 1 ? 'not-allowed' : 'pointer' }}
                    >
                      ◀ Prev
                    </button>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>
                      Page {sheetPage} of {sheetTotalPages}
                    </span>
                    <button 
                      disabled={sheetPage === sheetTotalPages}
                      onClick={() => setSheetPage(prev => Math.min(prev + 1, sheetTotalPages))}
                      className="btn btn-outline"
                      style={{ padding: '6px 14px', fontSize: 13, minHeight: 0, height: '34px', cursor: sheetPage === sheetTotalPages ? 'not-allowed' : 'pointer' }}
                    >
                      Next ▶
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {editLog && (
        <Modal title="✏️ Edit Attendance Record" onClose={() => setEditLog(null)}>
          <form onSubmit={handleEditSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Student Name</span>
                <div style={{ padding: '8px 12px', background: 'var(--bg-sidebar)', borderRadius: 8, marginTop: 4, color: 'var(--text-main)', fontSize: 14 }}>
                  {editLog.name}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Subject</span>
                <div style={{ padding: '8px 12px', background: 'var(--bg-sidebar)', borderRadius: 8, marginTop: 4, color: 'var(--text-main)', fontSize: 14 }}>
                  {editLog.subject_name || editLog.subject_code}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Student Roll No</label>
                <input 
                  required 
                  value={editRollNo} 
                  onChange={e => setEditRollNo(e.target.value)} 
                  className="form-input" 
                  style={{ marginTop: 4 }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Check-in Time</label>
                <input 
                  required 
                  placeholder="HH:MM:SS"
                  value={editTime} 
                  onChange={e => setEditTime(e.target.value)} 
                  className="form-input" 
                  style={{ marginTop: 4 }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                <button type="button" onClick={() => setEditLog(null)} className="btn btn-outline" style={{ height: '40px' }}>
                  Cancel
                </button>
                <button disabled={editLoading} className="btn btn-primary" style={{ height: '40px' }}>
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
