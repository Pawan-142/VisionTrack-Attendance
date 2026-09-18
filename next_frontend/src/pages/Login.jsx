import React, { useState } from 'react';
import { 
  Camera, Eye, EyeOff, Moon, Sun, ShieldCheck, BookOpen, GraduationCap, 
  Lock, User, ArrowRight, Shield, ScanFace, Clock, UserCheck
} from 'lucide-react';
import { useAuth } from '../AuthContext';

const ROLES = [
  { 
    id: 'admin',   
    label: 'Admin',   
    icon: ShieldCheck, 
    placeholder: 'Enter your username',
  },
  { 
    id: 'teacher', 
    label: 'Faculty', 
    icon: User,    
    placeholder: 'Enter your faculty ID',
  },
  { 
    id: 'student', 
    label: 'Student', 
    icon: GraduationCap,
    placeholder: 'Enter your roll number',
  },
];

export default function Login({ theme, setTheme }) {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedRole, setSelectedRole] = useState('admin');

  const handleLogin = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setError('');
    if (!form.username || !form.password) { 
      setError('Please enter your username and password.'); 
      return; 
    }
    setLoading(true);
    const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
    try {
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username.trim(), password: form.password }),
      });
      const data = await res.json();
      if (!res.ok) { 
        setError(data.detail || 'Invalid username or password.'); 
        return; 
      }
      login(data.user, data.access_token);
    } catch {
      setError('Unable to connect to server. Please verify backend status.');
    } finally { 
      setLoading(false); 
    }
  };

  const selectRole = (roleId) => {
    setSelectedRole(roleId);
    setError('');
    if (roleId === 'admin') {
      setForm({ username: 'admin', password: 'admin123' });
    } else {
      setForm({ username: '', password: '' });
    }
  };

  const useDemoAccount = () => {
    if (selectedRole === 'admin') {
      setForm({ username: 'admin', password: 'admin123' });
    } else if (selectedRole === 'teacher') {
      setForm({ username: 'teacher9', password: 'teacher9' });
    } else {
      setForm({ username: '100525742404', password: '100525742404' });
    }
  };

  const currentRole = ROLES.find(r => r.id === selectedRole) || ROLES[0];

  return (
    <div className={`vt-login-page ${theme}`}>
      {/* Top Navbar */}
      <header className="vt-topbar">
        <div className="vt-brand">
          <img 
            src={theme === 'light' ? '/assets/visiontrack_logo_light.png' : '/assets/visiontrack_logo_dark.png'} 
            alt="VisionTrack" 
            className="vt-brand-full-logo"
            style={{ height: '34px', maxWidth: '170px', objectFit: 'contain' }}
          />
          <span className="vt-brand-pill">AI ATTENDANCE</span>
        </div>

        <div className="vt-nav-right">
          <div className="vt-status-indicator">
            <span className="vt-status-dot" />
            <span>System Online</span>
          </div>

          <div className="vt-nav-divider" />

          <button
            type="button"
            className="vt-theme-toggle"
            onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <><Moon size={14} /> Dark</> : <><Sun size={14} /> Light</>}
          </button>
        </div>
      </header>

      {/* Main Unified Centerpiece */}
      <main className="vt-main-container">
        <div className="vt-portal-card">
          {/* Left Canvas: AI Biometric Engine */}
          <section className="vt-left-canvas">
            <div className="vt-engine-badge">
              <ShieldCheck size={14} className="vt-badge-icon" />
              <span>AI BIOMETRIC ENGINE</span>
            </div>

            <div className="vt-headline-group">
              <h1 className="vt-main-title">
                AI Facial <span className="vt-title-blue">Attendance System</span>
              </h1>
              <p className="vt-subtitle">
                Real-time facial recognition with intelligent liveness detection and secure attendance tracking.
              </p>
            </div>

            {/* Glowing Face Scan with 4 Target Brackets */}
            <div className="vt-scan-visual-wrapper">
              <div className="vt-target-brackets">
                <span className="corner top-left" />
                <span className="corner top-right" />
                <span className="corner bottom-left" />
                <span className="corner bottom-right" />
                
                <img 
                  src="/assets/cyber_face_scan.png" 
                  alt="AI Biometric Face Scan" 
                  className="vt-face-mesh-image"
                />
              </div>
            </div>

            {/* Bottom 3 Feature Cards */}
            <div className="vt-feature-cards-row">
              <div className="vt-feature-card">
                <div className="vt-feat-icon-box">
                  <ScanFace size={24} className="vt-feat-icon" />
                </div>
                <span className="vt-feat-title">ArcFace</span>
                <span className="vt-feat-sub">Deep Face<br />Recognition</span>
              </div>

              <div className="vt-feature-card">
                <div className="vt-feat-icon-box">
                  <ShieldCheck size={24} className="vt-feat-icon" />
                </div>
                <span className="vt-feat-title">Anti-Spoofing</span>
                <span className="vt-feat-sub">Liveness<br />Detection</span>
              </div>

              <div className="vt-feature-card">
                <div className="vt-feat-icon-box">
                  <Clock size={24} className="vt-feat-icon" />
                </div>
                <span className="vt-feat-title">Real-Time</span>
                <span className="vt-feat-sub">Instant<br />Verification</span>
              </div>
            </div>
          </section>

          {/* Right Canvas: Pure White Auth Console */}
          <section className="vt-right-canvas">
            <div className="vt-auth-header">
              <h2 className="vt-auth-title">Portal Sign In</h2>
              <p className="vt-auth-subtitle">Select your role to access your dashboard</p>
            </div>

            {/* Role Switcher Tabs */}
            <div className="vt-role-tabs-grid" role="tablist">
              {ROLES.map((role) => {
                const IconComp = role.icon;
                const active = selectedRole === role.id;
                return (
                  <button
                    key={role.id}
                    type="button"
                    className={`vt-role-tab ${active ? 'active' : ''}`}
                    onClick={() => selectRole(role.id)}
                    role="tab"
                    aria-selected={active}
                  >
                    <IconComp size={16} strokeWidth={active ? 2.2 : 1.8} />
                    <span>{role.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Error Message */}
            {error && (
              <div className="vt-error-alert" role="alert">
                <span>⚠️ {error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleLogin} className="vt-auth-form" noValidate>
              <div className="vt-form-group">
                <label className="vt-input-label" htmlFor="vt-username-input">Username</label>
                <div className="vt-input-wrapper">
                  <User size={16} className="vt-input-icon" />
                  <input
                    id="vt-username-input"
                    type="text"
                    className="vt-text-input"
                    placeholder={currentRole.placeholder}
                    value={form.username}
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              <div className="vt-form-group">
                <div className="vt-password-header">
                  <label className="vt-input-label" htmlFor="vt-password-input">Password</label>
                  <button
                    type="button"
                    className="vt-forgot-link"
                    onClick={() => alert('Please contact system administrator to reset password.')}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="vt-input-wrapper">
                  <Lock size={16} className="vt-input-icon" />
                  <input
                    id="vt-password-input"
                    type={showPwd ? 'text' : 'password'}
                    className="vt-text-input pwd-input"
                    placeholder="Enter your password"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="vt-eye-toggle"
                    onClick={() => setShowPwd(v => !v)}
                    aria-label="Toggle password visibility"
                  >
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="vt-submit-cta"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="vt-btn-spinner" />
                    <span>Signing in…</span>
                  </>
                ) : (
                  <>
                    <span>Continue to Dashboard</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>

            <div className="vt-or-divider">
              <span>or</span>
            </div>

            <button
              type="button"
              className="vt-demo-account-btn"
              onClick={useDemoAccount}
            >
              <User size={16} />
              <span>Use Demo Account</span>
            </button>

            <div className="vt-auth-card-footer">
              <Shield size={13} className="vt-footer-shield" />
              <span>Secure Session • Biometric Verification</span>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
