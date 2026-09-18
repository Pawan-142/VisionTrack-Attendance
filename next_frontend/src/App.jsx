import React, { useState, useEffect } from 'react';
import {
  Camera, Users, LayoutDashboard, Settings, History, Moon, Sun,
  BookOpen, BarChart2, Download, LogOut, BookMarked, GraduationCap,
  ShieldCheck, UserCheck, ClipboardEdit, FileUser, Calendar, Menu, X,
  KeyRound, Bell,
} from 'lucide-react';
import { useToast, ToastContainer } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import { Modal } from './components/Modal';
import { useAuth } from './AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Session from './pages/Session';
import Analytics from './pages/Analytics';
import Logs from './pages/Logs';
import Export from './pages/Export';
import AdminPanel from './pages/AdminPanel';
import SettingsPage from './pages/Settings';
import StudentAttendance from './pages/StudentAttendance';
import ManualAttendance from './pages/ManualAttendance';
import ReportCard from './pages/ReportCard';
import ClassSchedule from './pages/ClassSchedule';
import NoticeBoard from './pages/NoticeBoard';
import logoLight from './assets/visiontrack_logo_light.png';
import logoDark from './assets/visiontrack_logo_dark.png';

const NAV = [
  { id: 'dashboard',        label: 'Dashboard',       icon: LayoutDashboard, roles: ['admin','teacher','student'] },
  { id: 'notices',          label: 'Notice Board',    icon: Bell,            roles: ['admin','teacher','student'] },
  { id: 'admin_panel',      label: 'Management',       icon: ShieldCheck,     roles: ['admin'] },
  { id: 'session',          label: 'Live Session',     icon: Camera,          roles: ['admin','teacher'] },
  { id: 'manual',           label: 'Manual Attendance',icon: ClipboardEdit,   roles: ['admin','teacher'] },
  { id: 'class_schedule',   label: 'Class Schedule',   icon: Calendar,        roles: ['admin','teacher','student'] },
  { id: 'analytics',        label: 'Analytics',        icon: BarChart2,       roles: ['admin','teacher'] },
  { id: 'my_attendance',    label: 'My Attendance',    icon: BookMarked,      roles: ['student'] },
  { id: 'logs',             label: 'Attendance Logs',  icon: History,         roles: ['admin','teacher','student'] },
  { id: 'export',           label: 'Export',           icon: Download,        roles: ['admin','teacher'] },
  { id: 'report_card',      label: 'Attendance Reports', icon: FileUser,      roles: ['admin','teacher','student'] },
  { id: 'settings',         label: 'Settings',         icon: Settings,        roles: ['admin','teacher','student'] },
];

const ROLE_ICONS = { admin: ShieldCheck, teacher: UserCheck, student: GraduationCap };

function App() {
  const { user, logout, authFetch } = useAuth();
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [tab, setTab] = useState('dashboard');
  const [tabParams, setTabParams] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [stats, setStats] = useState({ total: 0, present: 0, absent: 0, feed: [], students: [], logs: [], student_analytics: null });
  const [subjects, setSubjects] = useState([]);
  const [unreadNotices, setUnreadNotices] = useState(0);
  const [loading, setLoading] = useState(false);
  const { toasts, toast } = useToast();

  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  const fetchAll = async () => {
    if (!user) return;
    try {
      const [s, sub, noticeRes] = await Promise.all([
        authFetch('/api/stats').then(r => r.json()),
        authFetch('/api/subjects').then(r => r.json()),
        authFetch('/api/notices/unread-count').then(r => r.json()).catch(() => ({ unread: 0 }))
      ]);
      if (s && !s.detail) {
        if (Array.isArray(s.students)) {
          s.students.sort((a, b) =>
            String(a.roll_no || '').localeCompare(String(b.roll_no || ''), undefined, { numeric: true, sensitivity: 'base' })
          );
        }
        setStats(s);
      }
      if (Array.isArray(sub)) {
        sub.sort((a, b) =>
          String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true, sensitivity: 'base' })
        );
        setSubjects(sub);
      }
      if (noticeRes && typeof noticeRes.unread === 'number') setUnreadNotices(noticeRes.unread);
    } catch (e) {
      if (e.message !== 'Session expired') console.warn('[fetchAll]', e);
    }
  };

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
    const iv = setInterval(fetchAll, 5000);
    return () => clearInterval(iv);
  }, [user]);

  // Reset tab when user changes
  useEffect(() => { setTab('dashboard'); setTabParams(null); setMobileMenuOpen(false); }, [user?.sub]);

  if (!user) return <Login theme={theme} setTheme={setTheme} />;

  const visibleNav = NAV.filter(n => n.roles.includes(user.role));
  const RoleIcon = ROLE_ICONS[user.role] || Users;

  const handleTabChange = (newTab, params = null) => {
    setTabParams(params);
    setTab(newTab);
    setMobileMenuOpen(false); // Auto-close drawer on mobile link tap
    if (newTab === 'notices') fetchAll();
  };

  const renderPage = () => {
    switch (tab) {
      case 'dashboard':     return <Dashboard stats={stats} user={user} authFetch={authFetch} setTab={handleTabChange} />;
      case 'notices':       return <NoticeBoard user={user} authFetch={authFetch} toast={toast} onUpdate={fetchAll} />;
      case 'admin_panel':   return user.role === 'admin' ? <AdminPanel stats={stats} subjects={subjects} onRefresh={fetchAll} toast={toast} authFetch={authFetch} /> : <UnauthorizedNotice />;
      case 'session':       return ['admin','teacher'].includes(user.role) ? <Session subjects={subjects} stats={stats} toast={toast} authFetch={authFetch} user={user} tabParams={tabParams} /> : <UnauthorizedNotice />;
      case 'analytics':     return ['admin','teacher'].includes(user.role) ? <Analytics authFetch={authFetch} subjects={subjects} toast={toast} /> : <UnauthorizedNotice />;
      case 'manual':        return ['admin','teacher'].includes(user.role) ? <ManualAttendance subjects={subjects} students={stats.students || []} toast={toast} authFetch={authFetch} user={user} /> : <UnauthorizedNotice />;
      case 'report_card':   return <ReportCard user={user} authFetch={authFetch} subjects={subjects} students={stats.students || []} toast={toast} />;
      case 'class_schedule': return <ClassSchedule user={user} subjects={subjects} toast={toast} authFetch={authFetch} setTab={handleTabChange} />;
      case 'logs':          return <Logs subjects={subjects} students={stats.students || []} toast={toast} authFetch={authFetch} user={user} />;
      case 'my_attendance': return user.role === 'student' ? <StudentAttendance user={user} authFetch={authFetch} setTab={handleTabChange} /> : <UnauthorizedNotice />;
      case 'export':        return ['admin','teacher'].includes(user.role) ? <Export toast={toast} authFetch={authFetch} subjects={subjects} students={stats.students || []} /> : <UnauthorizedNotice />;
      case 'settings':      return <SettingsPage user={user} toast={toast} authFetch={authFetch} />;
      default: return <div className="metric-card" style={{ textAlign: 'center', padding: 40 }}>Page not found.</div>;
    }
  };

  return (
    <div className={`app-container ${theme}`}>
      {/* Mobile Drawer Overlay Backdrop */}
      <div
        className={`sidebar-backdrop ${mobileMenuOpen ? 'open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />

      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div style={{ flexShrink: 0 }}>
          <div className="sidebar-logo flex-between">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img 
                src={theme === 'light' ? logoLight : logoDark} 
                alt="VisionTrack" 
                style={{ height: '34px', maxWidth: '185px', objectFit: 'contain' }}
              />
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="mobile-close-btn"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'none' }}
            >
              <X size={20} />
            </button>
          </div>
          <div className="sidebar-section-label">Navigation</div>
        </div>

        <nav className="sidebar-nav" style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
          {visibleNav.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href="#"
              className={`nav-item ${tab === id ? 'active' : ''}`}
              onClick={e => { e.preventDefault(); handleTabChange(id); }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                <Icon size={19} />
                <span>{label}</span>
              </div>
              {id === 'notices' && unreadNotices > 0 && (
                <span 
                  style={{
                    background: '#ef4444',
                    color: '#ffffff',
                    borderRadius: '12px',
                    padding: '2px 8px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)'
                  }}
                >
                  {unreadNotices}
                </span>
              )}
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-info">
            <div className="flex-between">
              <div>
                <div className="sidebar-user-name">{user.name || user.sub}</div>
                <div className="sidebar-user-role">{user.role}</div>
              </div>
              <span className={`role-badge ${user.role}`}>{user.role}</span>
            </div>
          </div>
          <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} className="theme-toggle">
            {theme === 'light' ? <><Moon size={16} /> Dark Mode</> : <><Sun size={16} /> Light Mode</>}
          </button>
          <button
            onClick={() => setShowChangePassword(true)}
            className="theme-toggle"
            style={{ marginTop: 4, borderColor: 'rgba(99, 102, 241, 0.3)' }}
          >
            <KeyRound size={16} /> Change Password
          </button>
          <button
            onClick={logout}
            className="theme-toggle"
            style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.25)', marginTop: 4 }}
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="mobile-menu-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              title="Toggle Menu"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              <span>Menu</span>
            </button>
            <div>
              <h1 className="page-title">{NAV.find(n => n.id === tab)?.label}</h1>
              <p className="page-subtitle">VisionTrack AI · Facial Attendance System</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                Refreshing…
              </div>
            )}
            <button 
              onClick={() => setShowChangePassword(true)}
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, minHeight: 0, height: 34 }}
              title="Change your account password"
            >
              <KeyRound size={14} /> Password
            </button>
          </div>
        </header>

        <div className="anim-fade" key={tab}>
          <ErrorBoundary>
            {renderPage()}
          </ErrorBoundary>
        </div>
      </main>

      {/* Change Password Modal */}
      {showChangePassword && (
        <ChangePasswordModal
          user={user}
          authFetch={authFetch}
          toast={toast}
          onClose={() => setShowChangePassword(false)}
        />
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}

function ChangePasswordModal({ onClose, authFetch, toast, user }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!oldPassword.trim() || !newPassword.trim()) {
      setError('Please fill all required fields');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirm password do not match');
      return;
    }
    if (newPassword.length < 4) {
      setError('New password must be at least 4 characters');
      return;
    }

    setSaving(true);
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_password: oldPassword.trim(),
          new_password: newPassword.trim()
        })
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        toast('Password updated successfully! Please use your new password next time.', 'success');
        onClose();
      } else {
        setError(data.detail || data.message || 'Failed to update password. Please check your current password.');
      }
    } catch {
      setError('Server error while updating password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="🔑 Change Account Password" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: 'var(--bg-sidebar)', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Logged in as: <strong>{user.name || user.sub}</strong> ({user.role})<br/>
          <span style={{ fontSize: '0.78rem' }}>Default password matches your Roll No / Teacher Login ID.</span>
        </div>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', padding: '10px 12px', borderRadius: 8, color: '#ef4444', fontSize: '0.84rem' }}>
            {error}
          </div>
        )}

        <div>
          <label style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Current Password</label>
          <input
            type="password"
            required
            placeholder="Enter current password"
            value={oldPassword}
            onChange={e => setOldPassword(e.target.value)}
            className="form-input"
            style={{ marginTop: 4, width: '100%' }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>New Password</label>
          <input
            type="password"
            required
            placeholder="Enter new secure password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="form-input"
            style={{ marginTop: 4, width: '100%' }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Confirm New Password</label>
          <input
            type="password"
            required
            placeholder="Re-enter new password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className="form-input"
            style={{ marginTop: 4, width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button type="button" onClick={onClose} disabled={saving} className="btn btn-outline">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? 'Updating...' : 'Save New Password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UnauthorizedNotice() {
  return (
    <div className="metric-card" style={{ textAlign: 'center', padding: '50px 20px', maxWidth: 500, margin: '40px auto' }}>
      <ShieldCheck size={48} color="var(--primary)" style={{ opacity: 0.7, marginBottom: 12 }} />
      <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 6 }}>Access Restricted</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
        Your account role does not have permission to access this module.
      </p>
    </div>
  );
}

export default App;

