import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, CheckCircle, TrendingUp, BookOpen, Printer, ChevronLeft, ChevronRight } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

/* ── helpers ── */
const pctColor = p => p >= 85 ? '#0ca678' : p >= 75 ? '#6366f1' : p >= 60 ? '#f59e0b' : '#ef4444';

const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ── Calendar Cell ── */
function CalCell({ day }) {
  if (!day) return <div style={{ minHeight: 52 }} />;
  const colors = {
    present:  { bg: 'rgba(12,166,120,0.15)', border: '#0ca678', text: '#0ca678' },
    absent:   { bg: 'rgba(239,68,68,0.12)',  border: '#ef4444', text: '#ef4444' },
    no_class: { bg: 'transparent',           border: 'var(--border)', text: 'var(--text-muted)' },
    weekend:  { bg: 'transparent',           border: 'transparent',   text: 'var(--text-muted)' },
  };
  const c = colors[day.status] || colors.no_class;
  const labels = { present: '✓', absent: '✗', no_class: '–', weekend: '' };
  return (
    <div title={day.sessions?.map(s => s.subject_code).join(', ') || day.status}
      style={{ minHeight: 52, borderRadius: 8, border: `1.5px solid ${c.border}`, background: c.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 4, cursor: day.sessions?.length ? 'pointer' : 'default', transition: 'transform 0.12s' }}>
      <span style={{ fontWeight: 700, fontSize: 15, color: day.status === 'weekend' ? 'var(--text-muted)' : 'var(--text-main)' }}>{day.day}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: c.text, marginTop: 2 }}>{labels[day.status]}</span>
      {day.sessions?.length > 0 && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{day.sessions.map(s=>s.subject_code).join(',')}</span>}
    </div>
  );
}

/* ── Main Component ── */
export default function ReportCard({ user, authFetch, subjects, students, toast }) {
  const isStudent = user?.role === 'student';

  /* student selection */
  const [selRoll, setSelRoll] = useState(isStudent ? user.reference_id : '');
  const [search, setSearch] = useState('');
  const filteredStudents = useMemo(() => {
    const list = [...(students || [])].sort((a, b) =>
      String(a.roll_no || '').localeCompare(String(b.roll_no || ''), undefined, { numeric: true, sensitivity: 'base' })
    );
    if (!search.trim()) return list.slice(0, 60);
    const q = search.toLowerCase();
    return list.filter(s => s.roll_no?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q));
  }, [search, students]);

  /* report data */
  const [subjectData, setSubjectData] = useState([]);
  const [loadingReport, setLoadingReport] = useState(false);

  /* calendar */
  const [activeTab, setActiveTab] = useState('report');
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; });
  const [calData, setCalData] = useState(null);
  const [calSubject, setCalSubject] = useState('');
  const [loadingCal, setLoadingCal] = useState(false);

  /* fetch report */
  const fetchReport = async (roll) => {
    if (!roll) return;
    setLoadingReport(true);
    try {
      const res = await authFetch(`/api/students/${roll}/subject-attendance`);
      const data = await res.json();
      setSubjectData(Array.isArray(data) ? data.reverse() : []);
    } catch { toast('Failed to load report', 'error'); }
    setLoadingReport(false);
  };

  /* fetch calendar */
  const fetchCalendar = async (roll, month, subId) => {
    if (!roll) return;
    setLoadingCal(true);
    try {
      const qs = subId ? `&subject_id=${subId}` : '';
      const res = await authFetch(`/api/students/${roll}/calendar?month=${month}${qs}`);
      const data = await res.json();
      setCalData(data);
    } catch { toast('Failed to load calendar', 'error'); }
    setLoadingCal(false);
  };

  useEffect(() => { if (isStudent) { fetchReport(user.reference_id); } }, []);
  useEffect(() => { if (selRoll) { fetchReport(selRoll); fetchCalendar(selRoll, calMonth, calSubject); } }, [selRoll]);
  useEffect(() => { if (selRoll && activeTab === 'calendar') fetchCalendar(selRoll, calMonth, calSubject); }, [calMonth, calSubject, activeTab]);

  const changeMonth = (dir) => {
    const [y, m] = calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setCalMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  };

  /* stats */
  const totalConducted = subjectData.reduce((a, s) => a + (s.total || 0), 0);
  const totalAttended  = subjectData.reduce((a, s) => a + (s.attended || 0), 0);
  const overall = totalConducted > 0 ? Math.round((totalAttended / totalConducted) * 100) : 0;
  const atRisk = subjectData.filter(s=>s.total>0 && s.pct<75).length;
  const safe   = subjectData.filter(s=>s.total>0 && s.pct>=75).length;
  const pieData = [
    { name: 'Attended', value: totalAttended },
    { name: 'Missed',   value: Math.max(0, totalConducted - totalAttended) },
  ];

  /* calendar grid builder */
  const calGrid = useMemo(() => {
    if (!calData?.days) return null;
    const firstDay = calData.days[0];
    const blanks = firstDay.weekday; // Mon=0
    const grid = [...Array(blanks).fill(null), ...calData.days];
    while (grid.length % 7 !== 0) grid.push(null);
    return grid;
  }, [calData]);

  const selectedStudent = students.find(s => s.roll_no === selRoll);
  const [yr, mo] = calMonth.split('-').map(Number);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* STUDENT SELECTOR — hidden for student role */}
      {!isStudent && (
        <div className="metric-card" style={{ padding: '20px 24px' }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Select Student</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <input placeholder="Search by name or roll no..." value={search} onChange={e => setSearch(e.target.value)} className="form-input" style={{ width: '100%', marginBottom: 8 }} />
              <div style={{ maxHeight: search ? 200 : 0, overflow: 'hidden', transition: 'max-height 0.2s', border: search ? '1px solid var(--border)' : 'none', borderRadius: 8, background: 'var(--bg-card)' }}>
                {filteredStudents.map(s => (
                  <div key={s.roll_no} onClick={() => { setSelRoll(s.roll_no); setSearch(''); }}
                    style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <span style={{ fontWeight: 600 }}>{s.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.roll_no} · {s.department}</span>
                  </div>
                ))}
                {filteredStudents.length === 0 && <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: 13 }}>No students found</div>}
              </div>
            </div>
            {selRoll && (
              <div style={{ background: 'var(--bg-sidebar)', borderRadius: 10, padding: '12px 18px', border: '1px solid var(--border)', minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{selectedStudent?.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{selRoll} · {selectedStudent?.department} · {selectedStudent?.year}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedStudent?.academic_year}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {!selRoll ? (
        <div className="metric-card" style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Search and select a student to view their report card</div>
        </div>
      ) : (
        <>
            {/* TAB BAR + PRINT & PDF DOWNLOAD */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {[['report','📊 Report'], ['calendar','📅 Calendar']].map(([id, label]) => (
                <button key={id} onClick={() => setActiveTab(id)}
                  style={{ padding: '8px 20px', borderRadius: 9, fontWeight: 600, fontSize: 13, border: `1.5px solid ${activeTab===id ? 'var(--primary)' : 'var(--border)'}`, background: activeTab===id ? 'var(--primary)' : 'none', color: activeTab===id ? '#fff' : 'var(--text-muted)', cursor: 'pointer', transition: 'all 0.15s' }}>
                  {label}
                </button>
              ))}

              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  onClick={async () => {
                    try {
                      toast('Generating official PDF transcript...', 'info');
                      const token = localStorage.getItem('vt_token') || localStorage.getItem('token');
                      const res = await fetch(`/api/reports/pdf?roll_no=${encodeURIComponent(selRoll)}`, {
                        headers: { Authorization: `Bearer ${token}` }
                      });
                      if (res.ok) {
                        const blob = await res.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `VisionTrack_Transcript_${selRoll}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        window.URL.revokeObjectURL(url);
                        toast('PDF Transcript downloaded successfully!', 'success');
                      } else {
                        toast('Failed to generate PDF report', 'error');
                      }
                    } catch (e) {
                      toast('Error downloading PDF', 'error');
                    }
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 9,
                    fontWeight: 600,
                    fontSize: 13,
                    border: 'none',
                    background: 'var(--primary)',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <TrendingUp size={14} /> Download Official PDF Transcript
                </button>

                <button onClick={() => window.print()}
                  style={{ padding: '8px 18px', borderRadius: 9, fontWeight: 600, fontSize: 13, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Printer size={14} /> Print
                </button>
              </div>
            </div>

          {/* ═══ REPORT TAB ═══ */}
          {activeTab === 'report' && (
            <>
              {atRisk > 0 && (
                <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10, color: '#f59e0b' }}>
                  <AlertTriangle size={16} />
                  <span style={{ fontWeight: 600 }}>{atRisk} subject{atRisk>1?'s':''} below 75% attendance — risk of exam ineligibility</span>
                </div>
              )}

              {/* Stats + Donut */}
              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>
                <div className="metric-card" style={{ alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <div style={{ position: 'relative', width: 150, height: 150 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} innerRadius={48} outerRadius={68} paddingAngle={3} dataKey="value" stroke="none">
                          {pieData.map((_,i)=><Cell key={i} fill={['var(--primary)','var(--danger)'][i]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8, fontSize:12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
                      <span style={{ fontSize:22, fontWeight:800, color:pctColor(overall) }}>{overall}%</span>
                      <span style={{ fontSize:10, color:'var(--text-muted)' }}>Overall</span>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:12, marginTop:6 }}>
                    <div style={{ textAlign:'center' }}><div style={{ fontWeight:700, color:'#0ca678', fontSize:18 }}>{safe}</div><div style={{ fontSize:11, color:'var(--text-muted)' }}>Safe</div></div>
                    <div style={{ textAlign:'center' }}><div style={{ fontWeight:700, color:'#ef4444', fontSize:18 }}>{atRisk}</div><div style={{ fontSize:11, color:'var(--text-muted)' }}>At Risk</div></div>
                  </div>
                </div>

                {/* Subject Table */}
                <div className="metric-card">
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:14, display:'flex', alignItems:'center', gap:6 }}>
                    <BookOpen size={14} /> Subject-wise Breakdown
                  </div>
                  {loadingReport ? (
                    <div style={{ textAlign:'center', padding:32, color:'var(--text-muted)' }}>Loading...</div>
                  ) : subjectData.length === 0 ? (
                    <div style={{ textAlign:'center', padding:32, color:'var(--text-muted)' }}>No data yet. Attendance will appear after sessions.</div>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                      {subjectData.map(sub => {
                        const color = pctColor(sub.pct);
                        const classesNeeded = sub.pct < 75 && sub.total > 0
                          ? Math.max(0, Math.ceil((0.75 * sub.total - sub.attended) / 0.25))
                          : 0;
                        return (
                          <div key={sub.subject_id} style={{ borderBottom:'1px solid var(--border)', paddingBottom:12 }}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                              <div>
                                <span style={{ fontWeight:700, fontSize:14 }}>{sub.subject_name}</span>
                                <span style={{ fontSize:12, color:'var(--text-muted)', marginLeft:6 }}>({sub.subject_code})</span>
                                {sub.department && <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:6 }}>· {sub.department}</span>}
                              </div>
                              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                <span style={{ fontSize:12, color:'var(--text-muted)' }}>{sub.attended}/{sub.total} classes</span>
                                <span style={{ padding:'3px 12px', borderRadius:20, fontSize:13, fontWeight:700, background:`${color}18`, color, minWidth:52, textAlign:'center' }}>
                                  {sub.total === 0 ? 'N/A' : `${sub.pct}%`}
                                </span>
                              </div>
                            </div>
                            {sub.total > 0 && (
                              <div style={{ height:7, borderRadius:10, background:'var(--bg-sidebar)', overflow:'hidden' }}>
                                <div style={{ height:'100%', width:`${sub.pct}%`, borderRadius:10, background:`linear-gradient(90deg,${color}80,${color})`, transition:'width 0.4s' }} />
                              </div>
                            )}
                            {classesNeeded > 0 && (
                              <div style={{ fontSize:12, color:'#f59e0b', marginTop:5, display:'flex', alignItems:'center', gap:4 }}>
                                <AlertTriangle size={11} />
                                Attend {classesNeeded} more class{classesNeeded>1?'es':''} to reach 75%
                              </div>
                            )}
                            {sub.pct >= 75 && sub.total > 0 && (
                              <div style={{ fontSize:12, color:'#0ca678', marginTop:5, display:'flex', alignItems:'center', gap:4 }}>
                                <CheckCircle size={11} /> Above threshold
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ═══ CALENDAR TAB ═══ */}
          {activeTab === 'calendar' && (
            <div className="metric-card" style={{ padding: '20px 24px' }}>
              {/* Calendar toolbar */}
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20, flexWrap:'wrap' }}>
                <button onClick={()=>changeMonth(-1)} style={{ padding:'6px 10px', borderRadius:8, border:'1px solid var(--border)', background:'none', cursor:'pointer', color:'var(--text-main)', display:'flex', alignItems:'center' }}><ChevronLeft size={16}/></button>
                <span style={{ fontWeight:700, fontSize:16, minWidth:160, textAlign:'center' }}>{MONTH_NAMES[mo-1]} {yr}</span>
                <button onClick={()=>changeMonth(1)} style={{ padding:'6px 10px', borderRadius:8, border:'1px solid var(--border)', background:'none', cursor:'pointer', color:'var(--text-main)', display:'flex', alignItems:'center' }}><ChevronRight size={16}/></button>
                <select value={calSubject} onChange={e=>setCalSubject(e.target.value)} className="form-input" style={{ minWidth:180 }}>
                  <option value="">All Subjects</option>
                  {subjects.map(s=><option key={s.id} value={String(s.id)}>{s.code} — {s.name}</option>)}
                </select>
                {/* Legend */}
                <div style={{ marginLeft:'auto', display:'flex', gap:14, alignItems:'center' }}>
                  {[['#0ca678','Present'],['#ef4444','Absent'],['var(--border)','No Class']].map(([c,l])=>(
                    <div key={l} style={{ display:'flex', alignItems:'center', gap:5 }}>
                      <div style={{ width:10, height:10, borderRadius:3, background:c, border:`1.5px solid ${c}` }}/>
                      <span style={{ fontSize:12, color:'var(--text-muted)' }}>{l}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats strip */}
              {calData?.days && (() => {
                const days = calData.days;
                const p = days.filter(d=>d.status==='present').length;
                const a = days.filter(d=>d.status==='absent').length;
                const n = days.filter(d=>d.status==='no_class').length;
                return (
                  <div style={{ display:'flex', gap:10, marginBottom:16 }}>
                    {[['Present',p,'#0ca678','#e6fcf5'],['Absent',a,'#ef4444','#fff0f6'],['No Class',n,'var(--text-muted)','var(--bg-sidebar)']].map(([l,v,c,bg])=>(
                      <div key={l} style={{ flex:1, background:bg, border:`1px solid ${c}22`, borderRadius:10, padding:'10px 14px', display:'flex', alignItems:'center', gap:10 }}>
                        <span style={{ fontSize:22, fontWeight:800, color:c }}>{v}</span>
                        <span style={{ fontSize:12, fontWeight:600, color:c }}>{l}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Day headers */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:6, marginBottom:6 }}>
                {DAY_LABELS.map(d=><div key={d} style={{ textAlign:'center', fontSize:12, fontWeight:700, color:'var(--text-muted)', padding:'4px 0' }}>{d}</div>)}
              </div>

              {/* Calendar grid */}
              {loadingCal ? (
                <div style={{ textAlign:'center', padding:48, color:'var(--text-muted)' }}>Loading calendar...</div>
              ) : calGrid ? (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:6 }}>
                  {calGrid.map((day, i) => <CalCell key={i} day={day} />)}
                </div>
              ) : (
                <div style={{ textAlign:'center', padding:48, color:'var(--text-muted)' }}>No data for this month</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}