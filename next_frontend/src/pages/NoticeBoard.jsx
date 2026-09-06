import React, { useState, useEffect } from 'react';
import { 
  Bell, AlertTriangle, Info, CheckCircle2, Trash2, Send, 
  Filter, Users, Calendar, ShieldCheck, UserCheck, Eye, Sparkles
} from 'lucide-react';

export default function NoticeBoard({ user, authFetch, toast }) {
  const isStaff = user?.role === 'admin' || user?.role === 'teacher';
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'unread', 'urgent'
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Notice creation form state
  const [form, setForm] = useState({
    title: '',
    message: '',
    priority: 'normal',
    target_type: 'all',
    target_value: '',
    expires_at: ''
  });

  const fetchNotices = async () => {
    try {
      setLoading(true);
      const endpoint = isStaff ? '/api/notices' : '/api/notices/student';
      const res = await authFetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        setNotices(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('[NoticeBoard] Fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotices();
  }, [user]);

  const handleCreateNotice = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.message.trim()) {
      toast('Please enter a title and message', 'error');
      return;
    }
    try {
      setSubmitting(true);
      const res = await authFetch('/api/notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (res.ok) {
        toast('Notice issued successfully to students!', 'success');
        setForm({
          title: '',
          message: '',
          priority: 'normal',
          target_type: 'all',
          target_value: '',
          expires_at: ''
        });
        setShowModal(false);
        fetchNotices();
      } else {
        toast(data.detail || 'Failed to issue notice', 'error');
      }
    } catch {
      toast('Failed to connect to server', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteNotice = async (id) => {
    if (!window.confirm('Are you sure you want to delete this notice?')) return;
    try {
      const res = await authFetch(`/api/notices/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast('Notice deleted', 'success');
        setNotices(n => n.filter(item => item.id !== id));
      } else {
        toast('Failed to delete notice', 'error');
      }
    } catch {
      toast('Server connection failed', 'error');
    }
  };

  const handleMarkAsRead = async (id) => {
    try {
      const res = await authFetch(`/api/notices/${id}/read`, { method: 'POST' });
      if (res.ok) {
        setNotices(n => n.map(item => item.id === id ? { ...item, is_read: 1 } : item));
        toast('Marked as read', 'info');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const filteredNotices = notices.filter(item => {
    if (filter === 'unread') return !item.is_read;
    if (filter === 'urgent') return item.priority === 'urgent';
    return true;
  });

  const unreadCount = notices.filter(n => !n.is_read).length;

  return (
    <div className="page-container" style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div className="flex-between" style={{ marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Bell size={26} color="var(--primary)" />
            Notice Board & Announcements
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            {isStaff 
              ? 'Issue important academic notices, exam alerts, and announcements to students.'
              : 'Official circulars, attendance warnings, and academic notices issued to you.'}
          </p>
        </div>

        {isStaff && (
          <button 
            className="btn-primary"
            onClick={() => setShowModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '10px', fontWeight: 600 }}
          >
            <Send size={18} />
            Issue New Notice
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setFilter('all')}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            background: filter === 'all' ? 'var(--primary)' : 'var(--card-bg)',
            color: filter === 'all' ? '#fff' : 'var(--text)',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          All Notices ({notices.length})
        </button>

        {!isStaff && (
          <button
            onClick={() => setFilter('unread')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: filter === 'unread' ? 'var(--primary)' : 'var(--card-bg)',
              color: filter === 'unread' ? '#fff' : 'var(--text)',
              cursor: 'pointer',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            Unread
            {unreadCount > 0 && (
              <span style={{ 
                background: '#ef4444', 
                color: '#fff', 
                borderRadius: '10px', 
                padding: '2px 8px', 
                fontSize: '0.75rem',
                fontWeight: 700 
              }}>
                {unreadCount}
              </span>
            )}
          </button>
        )}

        <button
          onClick={() => setFilter('urgent')}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            background: filter === 'urgent' ? '#ef4444' : 'var(--card-bg)',
            color: filter === 'urgent' ? '#fff' : 'var(--text)',
            cursor: 'pointer',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <AlertTriangle size={15} />
          Urgent Alerts
        </button>
      </div>

      {/* Notices Feed */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px', color: 'var(--text-muted)' }}>
          Loading notices...
        </div>
      ) : filteredNotices.length === 0 ? (
        <div className="metric-card" style={{ textAlign: 'center', padding: '48px', borderRadius: '16px' }}>
          <CheckCircle2 size={42} color="var(--success)" style={{ marginBottom: '12px' }} />
          <h3 style={{ margin: '0 0 6px 0', fontSize: '1.2rem' }}>No notices to show</h3>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            {filter === 'unread' ? 'You have read all your notices!' : 'There are no active notices at this time.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {filteredNotices.map(notice => {
            const isUrgent = notice.priority === 'urgent';
            const isImportant = notice.priority === 'important';
            const isUnread = !isStaff && !notice.is_read;

            return (
              <div 
                key={notice.id}
                className="metric-card"
                style={{
                  padding: '22px 24px',
                  borderRadius: '16px',
                  borderLeft: isUrgent 
                    ? '5px solid #ef4444' 
                    : isImportant 
                    ? '5px solid #f59e0b' 
                    : '5px solid var(--primary)',
                  position: 'relative',
                  background: isUnread ? 'rgba(37, 99, 235, 0.04)' : 'var(--card-bg)',
                  boxShadow: isUrgent ? '0 4px 20px rgba(239, 68, 68, 0.12)' : 'var(--shadow)',
                  transition: 'all 0.2s ease'
                }}
              >
                <div className="flex-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span 
                      style={{
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        background: isUrgent ? '#fee2e2' : isImportant ? '#fef3c7' : '#dbeafe',
                        color: isUrgent ? '#b91c1c' : isImportant ? '#b45309' : '#1d4ed8',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {isUrgent && <AlertTriangle size={12} />}
                      {notice.priority}
                    </span>

                    <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Calendar size={14} />
                      {notice.created_at}
                    </span>

                    <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                      • Issued by: <strong style={{ color: 'var(--text)' }}>{notice.sender_name}</strong> ({notice.sender_role})
                    </span>

                    {notice.target_type !== 'all' && (
                      <span style={{ fontSize: '0.82rem', padding: '2px 8px', borderRadius: '6px', background: 'var(--bg-body)', border: '1px solid var(--border)' }}>
                        Target: {notice.target_type.toUpperCase()}: {notice.target_value}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {isStaff && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Eye size={14} />
                          {notice.read_count || 0} student(s) read
                        </span>
                        <button
                          onClick={() => handleDeleteNotice(notice.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.82rem'
                          }}
                          title="Delete notice"
                        >
                          <Trash2 size={16} />
                          Delete
                        </button>
                      </div>
                    )}

                    {!isStaff && isUnread && (
                      <button
                        onClick={() => handleMarkAsRead(notice.id)}
                        className="btn-primary"
                        style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600 }}
                      >
                        Mark as Read
                      </button>
                    )}

                    {!isStaff && !isUnread && (
                      <span style={{ fontSize: '0.82rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                        <CheckCircle2 size={15} /> Read
                      </span>
                    )}
                  </div>
                </div>

                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--text)' }}>
                  {notice.title}
                </h3>

                <p style={{ color: 'var(--text)', lineHeight: '1.65', margin: 0, fontSize: '0.96rem', whiteSpace: 'pre-wrap' }}>
                  {notice.message}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Issue Notice */}
      {showModal && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
        >
          <div 
            className="metric-card"
            style={{
              width: '100%',
              maxWidth: '560px',
              borderRadius: '20px',
              padding: '28px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              animation: 'slideUp 0.25s ease-out'
            }}
          >
            <div className="flex-between" style={{ marginBottom: '18px' }}>
              <h2 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Send size={22} color="var(--primary)" />
                Issue Official Notice
              </h2>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateNotice} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600, marginBottom: '6px' }}>
                  Notice Title *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Mandatory Attendance Reminder / Exam Circular"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-body)',
                    color: 'var(--text)',
                    fontSize: '0.92rem'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600, marginBottom: '6px' }}>
                    Priority Level
                  </label>
                  <select
                    value={form.priority}
                    onChange={e => setForm({ ...form, priority: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-body)',
                      color: 'var(--text)',
                      fontSize: '0.92rem'
                    }}
                  >
                    <option value="normal">General (Normal)</option>
                    <option value="important">Important (Amber)</option>
                    <option value="urgent">Urgent / Action Required (Red)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600, marginBottom: '6px' }}>
                    Target Audience
                  </label>
                  <select
                    value={form.target_type}
                    onChange={e => setForm({ ...form, target_type: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-body)',
                      color: 'var(--text)',
                      fontSize: '0.92rem'
                    }}
                  >
                    <option value="all">All Students</option>
                    <option value="department">Specific Department</option>
                    <option value="year">Specific Year</option>
                    <option value="student">Specific Student (Roll No)</option>
                  </select>
                </div>
              </div>

              {form.target_type !== 'all' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600, marginBottom: '6px' }}>
                    Target Value ({form.target_type === 'student' ? 'Roll No' : form.target_type === 'department' ? 'e.g. CSE' : 'e.g. 1st Year'})
                  </label>
                  <input
                    type="text"
                    placeholder={form.target_type === 'student' ? 'e.g. 410' : form.target_type === 'department' ? 'e.g. CSE' : 'e.g. 1st Year'}
                    value={form.target_value}
                    onChange={e => setForm({ ...form, target_value: e.target.value })}
                    required
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-body)',
                      color: 'var(--text)',
                      fontSize: '0.92rem'
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600, marginBottom: '6px' }}>
                  Notice Content *
                </label>
                <textarea
                  rows={5}
                  placeholder="Enter detailed notice message, instructions, deadlines, or warnings..."
                  value={form.message}
                  onChange={e => setForm({ ...form, message: e.target.value })}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-body)',
                    color: 'var(--text)',
                    fontSize: '0.92rem',
                    fontFamily: 'inherit',
                    resize: 'vertical'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary"
                  style={{
                    padding: '10px 22px',
                    borderRadius: '10px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Send size={16} />
                  {submitting ? 'Issuing Notice...' : 'Issue Notice to Students'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
