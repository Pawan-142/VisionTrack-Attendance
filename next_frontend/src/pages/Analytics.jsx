import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { AlertTriangle, TrendingUp, Users, BookOpen, Send, ShieldAlert, CheckCircle2, FileText, Download } from 'lucide-react';

export default function Analytics({ authFetch, subjects, toast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subFilter, setSubFilter] = useState('');
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'defaulters'
  const [defaulterData, setDefaulterData] = useState(null);
  const [defaulterLoading, setDefaulterLoading] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [warningMessage, setWarningMessage] = useState('');
  const [sendingNotice, setSendingNotice] = useState(false);

  const loadAnalytics = () => {
    setLoading(true);
    authFetch('/api/analytics')
      .then(r => r.json())
      .then(d => { setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const loadDefaulters = () => {
    setDefaulterLoading(true);
    authFetch('/api/defaulters')
      .then(r => r.json())
      .then(d => { setDefaulterData(d); })
      .catch(() => {})
      .finally(() => setDefaulterLoading(false));
  };

  useEffect(loadAnalytics, [authFetch]);

  useEffect(() => {
    if (activeTab === 'defaulters') {
      loadDefaulters();
    }
  }, [activeTab]);

  const handleSendNotice = async (rollNo) => {
    setSendingNotice(true);
    try {
      const res = await authFetch('/api/defaulters/notify', {
        method: 'POST',
        body: JSON.stringify({
          roll_no: rollNo,
          message: warningMessage || undefined,
          notify_parent: true
        })
      });
      const d = await res.json();
      if (res.ok && d.status === 'ok') {
        toast(`Warning notice sent to ${d.student_name} (${d.recipient_email})`, 'success');
        setSelectedStudent(null);
        setWarningMessage('');
      } else {
        toast(d.detail || 'Failed to dispatch warning', 'error');
      }
    } catch {
      toast('Network error dispatching warning', 'error');
    } finally {
      setSendingNotice(false);
    }
  };

  if (loading) return <div className="loading-overlay"><div className="spinner" /></div>;
  if (!data) return <div className="alert alert-danger">Failed to load analytics.</div>;

  const summary = subFilter
    ? data.summary.filter(s => (s.subject_code === subFilter || String(s.subject_id) === subFilter))
    : data.summary;

  const pieData = [
    { name: 'Above 75%', value: data.summary.filter(s => s.pct >= 75).length },
    { name: 'Below 75%', value: data.summary.filter(s => s.pct < 75 && s.total_sessions > 0).length },
  ];

  return (
    <>
      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
        <button
          className={`btn ${activeTab === 'overview' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveTab('overview')}
        >
          <TrendingUp size={16} /> Overview & Trends
        </button>
        <button
          className={`btn ${activeTab === 'defaulters' ? 'btn-danger' : 'btn-outline'}`}
          onClick={() => setActiveTab('defaulters')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <ShieldAlert size={16} /> Defaulter & Warning Hub
          {data.alerts.length > 0 && (
            <span style={{ background: '#EF4444', color: '#fff', fontSize: '0.72rem', padding: '2px 7px', borderRadius: 10, fontWeight: 700 }}>
              {data.alerts.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'overview' ? (
        <>
          {/* Top KPIs */}
          <div className="metrics-grid" style={{ marginBottom: 24 }}>
            <div className="metric-card">
              <div className="metric-header"><span>Total Enrolled</span><div className="metric-icon"><Users size={16}/></div></div>
              <div className="metric-value">{data.summary.length}</div>
              <div className="metric-label">Active students</div>
            </div>
            <div className="metric-card">
              <div className="metric-header"><span>Attendance Deficit</span><div className="metric-icon" style={{ background:'var(--danger-bg)',color:'var(--danger)' }}><AlertTriangle size={16}/></div></div>
              <div className="metric-value" style={{ color:'var(--danger)' }}>{data.alerts.length}</div>
              <div className="metric-label">Below 75% threshold</div>
            </div>
            <div className="metric-card">
              <div className="metric-header"><span>Subjects Offered</span><div className="metric-icon" style={{ background:'var(--info-bg)',color:'var(--info)' }}><BookOpen size={16}/></div></div>
              <div className="metric-value">{data.subject_count}</div>
              <div className="metric-label">Mapped courses</div>
            </div>
            <div className="metric-card">
              <div className="metric-header"><span>Good Standing</span><div className="metric-icon" style={{ background:'var(--success-bg)',color:'var(--success)' }}><TrendingUp size={16}/></div></div>
              <div className="metric-value" style={{ color:'var(--success)' }}>{data.summary.length - data.alerts.length}</div>
              <div className="metric-label">Eligible for exams</div>
            </div>
          </div>

          {/* Daily Trend */}
          <div className="chart-container" style={{ marginBottom: 20 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div className="metric-title">Daily Attendance — Last 14 Days</div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.trend} margin={{ top:4, right:16, bottom:4, left:0 }} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize:11, fill:'var(--text-muted)' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize:11, fill:'var(--text-muted)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8, color:'var(--text-main)', fontSize:13 }} cursor={{ fill:'var(--bg-hover)' }} />
                <Bar dataKey="count" name="Students Present" fill="var(--primary)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:20 }}>
            {/* Pie */}
            <div className="chart-container" style={{ marginBottom:0 }}>
              <div className="metric-title" style={{ marginBottom:16 }}>Exam Eligibility Proportion</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} innerRadius={50} paddingAngle={4} dataKey="value" stroke="none">
                    <Cell fill="var(--success)" />
                    <Cell fill="var(--danger)" />
                  </Pie>
                  <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize:12 }} />
                  <Tooltip contentStyle={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8, color:'var(--text-main)', fontSize:13 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Alerts */}
            <div className="chart-container" style={{ marginBottom:0, overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
                <AlertTriangle size={16} color="var(--danger)" />
                <div className="metric-title">Critical Deficit Alerts</div>
              </div>
              <div style={{ maxHeight:220, overflowY:'auto' }}>
                {!data.alerts.length ? (
                  <div className="empty-state" style={{ padding:24 }}>
                    <div style={{ fontSize:'2rem' }}>🎉</div>
                    <p style={{ marginTop:8 }}>All students are above the 75% requirement!</p>
                  </div>
                ) : data.alerts.map((s, i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontWeight:600, fontSize:'0.88rem' }}>{s.name}</div>
                      <div style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>{s.roll_no} &bull; {s.department}</div>
                    </div>
                    <span className={`badge ${s.pct < 60 ? 'danger' : 'warning'}`}>{s.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Summary Table */}
          <div className="table-container">
            <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 }}>
              <strong style={{ fontSize:'0.9rem' }}>Comprehensive Student Ledger</strong>
              <select
                className="form-select"
                style={{ width:'auto', minWidth:180, padding:'7px 32px 7px 12px' }}
                value={subFilter}
                onChange={e => setSubFilter(e.target.value)}
              >
                <option value="">All Subjects</option>
                {subjects.map(s => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            <table>
              <thead>
                <tr><th>Student</th><th>Department</th><th>Attended</th><th>Total</th><th>Attendance %</th></tr>
              </thead>
              <tbody>
                {summary.map((s, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ fontWeight:600 }}>{s.name}</div>
                      <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{s.roll_no}</div>
                    </td>
                    <td style={{ color:'var(--text-muted)', fontSize:'0.88rem' }}>{s.department || '—'}</td>
                    <td style={{ fontWeight:600 }}>{s.days_present}</td>
                    <td style={{ color:'var(--text-muted)' }}>{s.total_sessions}</td>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div className="progress-bar" style={{ flex:1 }}>
                          <div className="progress-fill" style={{ width:`${s.pct}%`, background: s.pct >= 75 ? 'var(--success)' : s.pct >= 60 ? 'var(--warning)' : 'var(--danger)' }} />
                        </div>
                        <span className={`badge ${s.pct >= 75 ? 'success' : s.pct >= 60 ? 'warning' : 'danger'}`}>{s.pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {!summary.length && <tr><td colSpan="5" style={{ textAlign:'center', padding:32, color:'var(--text-muted)' }}>No data available</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        /* Defaulter Warning Center */
        <div>
          {defaulterLoading ? (
            <div className="loading-overlay"><div className="spinner" /></div>
          ) : defaulterData ? (
            <>
              {/* Defaulter Metrics */}
              <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 24 }}>
                <div className="metric-card">
                  <div className="metric-header"><span>Total Defaulters</span><ShieldAlert size={16} color="var(--danger)" /></div>
                  <div className="metric-value" style={{ color: 'var(--danger)' }}>{defaulterData.total_defaulters}</div>
                  <div className="metric-label">Below {defaulterData.threshold}% criteria</div>
                </div>
                <div className="metric-card">
                  <div className="metric-header"><span>Critical Risk (&lt;50%)</span><AlertTriangle size={16} color="#EF4444" /></div>
                  <div className="metric-value" style={{ color: '#EF4444' }}>{defaulterData.critical_count}</div>
                  <div className="metric-label">Severe shortage</div>
                </div>
                <div className="metric-card">
                  <div className="metric-header"><span>Warning (50-74%)</span><AlertTriangle size={16} color="#F59E0B" /></div>
                  <div className="metric-value" style={{ color: '#F59E0B' }}>{defaulterData.warning_count}</div>
                  <div className="metric-label">Action required</div>
                </div>
                <div className="metric-card">
                  <div className="metric-header"><span>Safe Standing</span><CheckCircle2 size={16} color="#10B981" /></div>
                  <div className="metric-value" style={{ color: '#10B981' }}>{defaulterData.safe_count}</div>
                  <div className="metric-label">Compliant students</div>
                </div>
              </div>

              {/* Defaulters Table */}
              <div className="table-container">
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: '0.95rem' }}>Official Attendance Defaulter List</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Minimum required semester attendance: {defaulterData.threshold}%</div>
                  </div>
                  <button
                    className="btn btn-outline"
                    onClick={() => {
                      const csvContent = "data:text/csv;charset=utf-8," + 
                        "Roll No,Name,Department,Year,Attended,Total,Percentage,Risk Level,Classes Short\n" +
                        defaulterData.defaulters.map(d => `${d.roll_no},${d.name},${d.department},${d.year},${d.total_attended},${d.total_held},${d.percentage}%,${d.risk_level},${d.shortage_classes}`).join("\n");
                      const encodedUri = encodeURI(csvContent);
                      const link = document.createElement("a");
                      link.setAttribute("href", encodedUri);
                      link.setAttribute("download", `VisionTrack_Defaulters_${new Date().toISOString().slice(0,10)}.csv`);
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Download size={14} /> Export Defaulters CSV
                  </button>
                </div>

                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Cohort</th>
                      <th>Attended / Total</th>
                      <th>Attendance %</th>
                      <th>Shortage</th>
                      <th>Risk Level</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {defaulterData.defaulters.length === 0 ? (
                      <tr><td colSpan="7" style={{ textAlign: 'center', padding: 32 }}>No defaulters found! All enrolled students meet minimum requirements.</td></tr>
                    ) : (
                      defaulterData.defaulters.map(st => (
                        <tr key={st.roll_no}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{st.name}</div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{st.roll_no} &bull; {st.email || 'No email'}</div>
                          </td>
                          <td style={{ fontSize: '0.85rem' }}>{st.department} ({st.year})</td>
                          <td style={{ fontWeight: 600 }}>{st.total_attended} / {st.total_held}</td>
                          <td>
                            <span className={`badge ${st.risk_level === 'critical' ? 'danger' : 'warning'}`}>
                              {st.percentage}%
                            </span>
                          </td>
                          <td style={{ color: 'var(--danger)', fontWeight: 600 }}>-{st.shortage_classes} classes</td>
                          <td>
                            <span style={{
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              background: st.risk_level === 'critical' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                              color: st.risk_level === 'critical' ? '#EF4444' : '#F59E0B'
                            }}>
                              {st.risk_level.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <button
                              className="btn btn-outline"
                              style={{ padding: '5px 10px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}
                              onClick={() => setSelectedStudent(st)}
                            >
                              <Send size={13} /> Dispatch Notice
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Warning Notice Modal */}
              {selectedStudent && (
                <div className="modal-backdrop">
                  <div className="modal-content" style={{ maxWidth: 500 }}>
                    <div className="modal-header">
                      <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ShieldAlert color="var(--danger)" size={18} />
                        Dispatch Attendance Shortage Warning
                      </div>
                      <button className="modal-close" onClick={() => setSelectedStudent(null)}>&times;</button>
                    </div>

                    <div style={{ padding: '16px 0' }}>
                      <div style={{ background: 'var(--bg-hover)', padding: 12, borderRadius: 8, marginBottom: 14 }}>
                        <div><strong>Student:</strong> {selectedStudent.name} ({selectedStudent.roll_no})</div>
                        <div><strong>Current Attendance:</strong> <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{selectedStudent.percentage}%</span> (Requires {defaulterData.threshold}%)</div>
                        <div><strong>Classes Deficit:</strong> Short by {selectedStudent.shortage_classes} class(es)</div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Warning Letter Body</label>
                        <textarea
                          className="form-input"
                          rows={4}
                          value={warningMessage || `Dear ${selectedStudent.name},\nYour semester attendance is currently ${selectedStudent.percentage}%, which is below the mandatory ${defaulterData.threshold}% threshold. Please meet with your academic advisor immediately to avoid semester debarment.`}
                          onChange={e => setWarningMessage(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button className="btn btn-outline" onClick={() => setSelectedStudent(null)}>Cancel</button>
                      <button
                        className="btn btn-danger"
                        disabled={sendingNotice}
                        onClick={() => handleSendNotice(selectedStudent.roll_no)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        <Send size={14} /> {sendingNotice ? 'Dispatching...' : 'Send Official Notice'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="alert alert-danger">Could not load defaulters data.</div>
          )}
        </div>
      )}
    </>
  );
}
