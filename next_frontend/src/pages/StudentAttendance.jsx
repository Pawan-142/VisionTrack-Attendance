import React, { useEffect, useState } from 'react';
import { BookOpen, AlertTriangle, TrendingUp, CheckCircle, Bell, ArrowRight } from 'lucide-react';
import { RadialBarChart, RadialBar, ResponsiveContainer, Tooltip } from 'recharts';

export default function StudentAttendance({ user, authFetch, setTab }) {
  const [data, setData] = useState([]);
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.reference_id) return;
    setLoading(true);
    Promise.all([
      authFetch(`/api/students/${user.reference_id}/subject-attendance`).then(r => r.json()),
      authFetch('/api/notices/student').then(r => r.json()).catch(() => [])
    ])
      .then(([attData, noticeData]) => {
        setData(Array.isArray(attData) ? attData.reverse() : []);
        setNotices(Array.isArray(noticeData) ? noticeData : []);
      })
      .catch(() => setError('Failed to load attendance data.'))
      .finally(() => setLoading(false));
  }, [user?.reference_id]);

  const overall = data.length
    ? Math.round(data.reduce((a, s) => a + s.pct, 0) / data.length)
    : 0;

  const safe    = data.filter(s => s.pct >= 75).length;
  const low     = data.filter(s => s.pct > 0 && s.pct < 75).length;
  const noClass = data.filter(s => s.total === 0).length;

  const latestUnreadNotice = notices.find(n => !n.is_read) || (notices.length > 0 ? notices[0] : null);

  const getColor = pct => {
    if (pct >= 85) return 'var(--success)';
    if (pct >= 75) return 'var(--primary)';
    if (pct >= 60) return 'var(--warning)';
    return 'var(--danger)';
  };

  if (loading) return <div className="loading-overlay"><div className="spinner" /></div>;
  if (error)   return <div className="alert alert-danger">{error}</div>;

  return (
    <>
      {/* Latest Notice from Faculty/Admin Banner */}
      {latestUnreadNotice && (
        <div 
          className="metric-card" 
          style={{
            marginBottom: '20px',
            padding: '16px 20px',
            borderRadius: '14px',
            borderLeft: latestUnreadNotice.priority === 'urgent' 
              ? '5px solid #ef4444' 
              : latestUnreadNotice.priority === 'important' 
              ? '5px solid #f59e0b' 
              : '5px solid var(--primary)',
            background: 'var(--card-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '14px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div 
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: latestUnreadNotice.priority === 'urgent' ? '#fee2e2' : '#dbeafe',
                color: latestUnreadNotice.priority === 'urgent' ? '#b91c1c' : '#1d4ed8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Bell size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.98rem' }}>{latestUnreadNotice.title}</strong>
                <span 
                  style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    background: latestUnreadNotice.priority === 'urgent' ? '#ef4444' : 'var(--primary)',
                    color: '#ffffff'
                  }}
                >
                  {latestUnreadNotice.priority}
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  By {latestUnreadNotice.sender_name} ({latestUnreadNotice.sender_role})
                </span>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: 'var(--text-muted)', maxWidth: '700px' }}>
                {latestUnreadNotice.message.length > 120 ? `${latestUnreadNotice.message.slice(0, 120)}...` : latestUnreadNotice.message}
              </p>
            </div>
          </div>

          <button 
            className="btn-primary"
            onClick={() => setTab && setTab('notices')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '8px', fontSize: '0.86rem', fontWeight: 600 }}
          >
            View Notice Board
            <ArrowRight size={15} />
          </button>
        </div>
      )}

      {low > 0 && (
        <div className="alert alert-warning">
          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>{low} subject{low > 1 ? 's' : ''} below 75%.</strong> You may be ineligible for exams in those subjects. Attend more classes!
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 24 }}>
        <div className="metric-card">
          <div className="metric-header"><span>Avg Attendance</span><div className="metric-icon"><TrendingUp size={16}/></div></div>
          <div className="metric-value" style={{ color: overall >= 75 ? 'var(--success)' : 'var(--danger)' }}>{overall}%</div>
          <div className="metric-label">Across all subjects</div>
        </div>
        <div className="metric-card">
          <div className="metric-header"><span>Subjects OK</span><div className="metric-icon" style={{ background:'var(--success-bg)',color:'var(--success)' }}><CheckCircle size={16}/></div></div>
          <div className="metric-value" style={{ color:'var(--success)' }}>{safe}</div>
          <div className="metric-label">≥75% threshold</div>
        </div>
        <div className="metric-card">
          <div className="metric-header"><span>At Risk</span><div className="metric-icon" style={{ background:'var(--warning-bg)',color:'var(--warning)' }}><AlertTriangle size={16}/></div></div>
          <div className="metric-value" style={{ color:'var(--warning)' }}>{low}</div>
          <div className="metric-label">&lt;75% attendance</div>
        </div>
        <div className="metric-card">
          <div className="metric-header"><span>Total Subjects</span><div className="metric-icon" style={{ background:'var(--info-bg)',color:'var(--info)' }}><BookOpen size={16}/></div></div>
          <div className="metric-value">{data.length}</div>
          <div className="metric-label">Enrolled subjects</div>
        </div>
      </div>

      {/* Subject breakdown */}
      <div className="table-container">
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8 }}>
          <BookOpen size={16} color="var(--primary)" />
          <strong style={{ fontSize:'0.9rem' }}>Subject-wise Attendance</strong>
        </div>

        {!data.length ? (
          <div className="empty-state">
            <div className="empty-state-icon">📚</div>
            <p>No subjects found.</p>
            <p style={{ fontSize:'0.85rem', marginTop:4 }}>Subjects will appear once sessions are created.</p>
          </div>
        ) : (
          <div style={{ padding:'8px 20px' }}>
            {data.map(sub => (
              <div key={sub.subject_id} style={{ padding:'16px 0', borderBottom:'1px solid var(--border)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:'0.95rem' }}>
                      {sub.subject_name}
                      <span style={{ fontWeight:400, fontSize:'0.8rem', color:'var(--text-muted)', marginLeft:8 }}>({sub.subject_code})</span>
                    </div>
                    {sub.department && <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:2 }}>{sub.department}</div>}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <span style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>{sub.attended}/{sub.total} classes</span>
                    <span
                      className="badge"
                      style={{
                        background: `${getColor(sub.pct)}20`,
                        color: getColor(sub.pct),
                        fontSize:'0.82rem',
                        padding:'4px 12px',
                        minWidth:56,
                        textAlign:'center',
                      }}
                    >
                      {sub.total === 0 ? 'N/A' : `${sub.pct}%`}
                    </span>
                  </div>
                </div>
                {sub.total > 0 && (
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${sub.pct}%`,
                        background: `linear-gradient(90deg, ${getColor(sub.pct)}80, ${getColor(sub.pct)})`,
                      }}
                    />
                  </div>
                )}
                {sub.pct < 75 && sub.total > 0 && (
                  <div style={{ fontSize:'0.75rem', color:'var(--warning)', marginTop:5, display:'flex', alignItems:'center', gap:4 }}>
                    <AlertTriangle size={12} />
                    Need {Math.ceil((0.75 * sub.total - sub.attended) / 0.25)} more classes to reach 75%
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
