import React, { useEffect, useState } from 'react';
import { Users, CheckCircle, XCircle, TrendingUp, AlertTriangle, CalendarX2, BookOpen } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

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

const COLORS = ['#6366f1', '#ef4444'];

function StatCard({ label, value, sub, icon: Icon, color, subColor }) {
  return (
    <div className="metric-card">
      <div className="metric-header">
        <span>{label}</span>
        <div className="metric-icon" style={{ background: `${color}20`, color }}>
          <Icon size={18} />
        </div>
      </div>
      <div className="metric-value" style={{ color }}>{value}</div>
      <div className="metric-label" style={{ color: subColor || 'var(--text-muted)' }}>{sub}</div>
    </div>
  );
}

/* ─── Admin / Teacher Dashboard ─── */
function AdminDashboard({ stats }) {
  const pct = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;
  const belowThreshold = stats.students?.filter(s => s.pct !== undefined && s.pct < 75) || [];

  const pieData = [
    { name: 'Present', value: stats.present || 0 },
    { name: 'Absent', value: stats.absent || 0 },
  ];

  return (
    <>
      {belowThreshold.length > 0 && (
        <div className="alert alert-warning">
          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>{belowThreshold.length} student{belowThreshold.length > 1 ? 's' : ''}</strong> below 75% attendance threshold this period.
          </div>
        </div>
      )}

      <div className="metrics-grid">
        <StatCard label="Total Students" value={stats.total} sub="Enrolled in system" icon={Users} color="var(--primary)" />
        <StatCard label="Present Today" value={stats.present} sub="Marked attendance" icon={CheckCircle} color="var(--success)" subColor="var(--success)" />
        <StatCard label="Absent Today" value={stats.absent} sub="Not yet marked" icon={XCircle} color="var(--danger)" subColor="var(--danger)" />
        <StatCard label="Today's Rate" value={`${pct}%`} sub={pct >= 75 ? 'Above threshold ✓' : 'Below threshold ⚠'} icon={TrendingUp} color={pct >= 75 ? 'var(--success)' : 'var(--warning)'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20, marginBottom: 24 }}>
        {/* Pie Chart */}
        <div className="metric-card" style={{ alignItems: 'center' }}>
          <div className="metric-title" style={{ alignSelf: 'flex-start', marginBottom: 8 }}>Today Breakdown</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value" stroke="none">
                {pieData.map((_, i) => <Cell key={i} fill={['var(--primary)', 'var(--danger)'][i]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-main)', fontSize: 13 }} />
              <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Activity */}
        <div className="metric-card">
          <div className="metric-title" style={{ marginBottom: 14 }}>Recent Activity</div>
          <div className="feed-list">
            {!stats.feed?.length ? (
              <div className="empty-state">
                <div className="empty-state-icon">📋</div>
                <p>No attendance recorded today.</p>
                <p style={{ fontSize: '0.85rem', marginTop: 4 }}>Start a session to begin marking.</p>
              </div>
            ) : stats.feed.map((item, idx) => (
              <div className="feed-item" key={idx}>
                <div className="user-info">
                  <div className="avatar" style={{ background: `hsl(${idx * 55 + 200},70%,50%)`, borderRadius: 10 }}>
                    {item.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.name}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{fmtAMPM(item.time)}</div>
                  </div>
                </div>
                <span className="badge success">Present</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Low Attendance Alert Table */}
      {belowThreshold.length > 0 && (
        <div className="table-container">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} color="var(--warning)" />
            <strong style={{ fontSize: '0.9rem' }}>Low Attendance Students</strong>
          </div>
          <table>
            <thead>
              <tr><th>Roll No</th><th>Name</th><th>Dept</th><th>Attendance %</th></tr>
            </thead>
            <tbody>
              {belowThreshold.slice(0, 10).map(s => (
                <tr key={s.roll_no}>
                  <td style={{ fontWeight: 600 }}>{s.roll_no}</td>
                  <td>{s.name}</td>
                  <td>{s.department}</td>
                  <td>
                    <span className={`badge ${s.pct < 60 ? 'danger' : 'warning'}`}>{s.pct}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ─── Student Dashboard ─── */
function StudentDashboard({ stats, user }) {
  const analytics = stats.student_analytics;
  const pct = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;
  const totalSessions = analytics?.total_sessions || 0;
  const totalAttended = analytics?.total_attended || 0;
  const totalMissed = Math.max(0, totalSessions - totalAttended);
  const overallPct = totalSessions > 0
    ? Math.round((totalAttended / totalSessions) * 100) : 0;

  // Smart today's status using backend fields
  const hasSessionToday = analytics?.has_session_today ?? (stats.present > 0);
  const isPresentToday  = analytics?.is_present_today  ?? (stats.present > 0);

  const todayStatus = isPresentToday
    ? { label: '✓ Present',     sub: 'Marked today',         color: 'var(--success)' }
    : hasSessionToday
    ? { label: '✗ Absent',      sub: 'Class held — not marked', color: 'var(--danger)'  }
    : { label: '○ No Class',    sub: 'No session today',     color: 'var(--text-muted)' };

  const pieData = [
    { name: 'Attended', value: totalAttended },
    { name: 'Missed',   value: totalMissed },
  ];

  const isLowAttendance = overallPct < 75 && totalSessions > 0;

  return (
    <>
      {isLowAttendance && (
        <div className="alert alert-warning">
          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>Low Attendance Warning!</strong> Your overall attendance is <strong>{overallPct}%</strong>, which is below the required 75%. Please attend more classes.
          </div>
        </div>
      )}

      <div className="metrics-grid">
        <StatCard label="Today's Status" value={todayStatus.label} sub={todayStatus.sub} icon={CheckCircle} color={todayStatus.color} />
        <StatCard label="Overall Attendance" value={`${overallPct}%`} sub={`${totalAttended} of ${totalSessions} sessions`} icon={TrendingUp} color={overallPct >= 75 ? 'var(--success)' : 'var(--danger)'} />
        <StatCard label="Classes Attended" value={totalAttended} sub="Total sessions present" icon={BookOpen} color="var(--primary)" />
        <StatCard label="Classes Missed" value={totalMissed} sub="Total sessions absent" icon={CalendarX2} color="var(--warning)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, marginBottom: 24 }}>
        {/* Donut Chart */}
        <div className="metric-card" style={{ alignItems: 'center' }}>
          <div className="metric-title" style={{ alignSelf: 'flex-start', marginBottom: 8 }}>Overall</div>
          <div style={{ position: 'relative', width: 180, height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value" stroke="none">
                  {pieData.map((_, i) => <Cell key={i} fill={['var(--primary)', 'var(--danger)'][i]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-main)', fontSize: 13 }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: overallPct >= 75 ? 'var(--success)' : 'var(--danger)' }}>{overallPct}%</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Overall</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
            {pieData.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: ['var(--primary)', 'var(--danger)'][i] }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.name} ({d.value})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly Trend */}
        <div className="metric-card">
          <div className="metric-title" style={{ marginBottom: 14 }}>Monthly Trend</div>
          {analytics?.monthly_trend?.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={analytics.monthly_trend} barSize={22}>
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-main)', fontSize: 13 }} cursor={{ fill: 'var(--bg-hover)' }} />
                <Bar dataKey="attended" name="Attended" fill="var(--primary)" radius={[4,4,0,0]} />
                <Bar dataKey="missed"   name="Missed"   fill="var(--danger)"  radius={[4,4,0,0]} />
                <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state"><p>No data yet</p></div>
          )}
        </div>
      </div>

      {/* Missed Classes */}
      <div className="table-container">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarX2 size={16} color="var(--danger)" />
          <strong style={{ fontSize: '0.9rem' }}>Missed Classes</strong>
          <span className="badge danger" style={{ marginLeft: 'auto' }}>{analytics?.missed_sessions?.length || 0} missed</span>
        </div>
        {!analytics?.missed_sessions?.length ? (
          <div className="empty-state">
            <div className="empty-state-icon">🎉</div>
            <p>Perfect attendance! No missed classes.</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>Subject</th><th>Date</th><th>Faculty</th><th>Status</th></tr></thead>
            <tbody>
              {analytics.missed_sessions.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 600 }}>{item.subject_name || item.subject_id}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{item.date}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{item.faculty || '—'}</td>
                  <td><span className="badge danger">Absent</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default function Dashboard({ stats, user }) {
  if (user?.role === 'student') return <StudentDashboard stats={stats} user={user} />;
  return <AdminDashboard stats={stats} user={user} />;
}
