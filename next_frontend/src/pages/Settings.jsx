import { useState, useEffect } from 'react';
import { Key, Sliders, Shield, Download, Upload, Save, CheckCircle2, RefreshCw, Cpu, Volume2, Bell } from 'lucide-react';

export default function Settings({ user, toast, authFetch }) {
  const [passwords, setPasswords] = useState({ old_password: '', new_password: '', confirm_password: '' });
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const [aiSettings, setAiSettings] = useState({
    threshold: 0.60,
    cooldown_sec: 10,
    anti_spoofing: true,
    liveness_strictness: 'medium',
    camera_mode: 'client',
    attendance_threshold: 75,
    college_name: 'VisionTrack University of Technology',
    sound_enabled: true,
    email_alerts_enabled: true
  });

  // Fetch settings from backend
  useEffect(() => {
    authFetch('/api/settings')
      .then(r => r.json())
      .then(cfg => {
        if (cfg) {
          setAiSettings(prev => ({
            ...prev,
            threshold: cfg.threshold !== undefined ? Number(cfg.threshold) : 0.60,
            cooldown_sec: cfg.cooldown_sec !== undefined ? Number(cfg.cooldown_sec) : 10,
            anti_spoofing: cfg.anti_spoofing !== undefined ? Boolean(cfg.anti_spoofing) : true,
            liveness_strictness: cfg.liveness_strictness || 'medium',
            camera_mode: cfg.camera_mode || 'client',
            attendance_threshold: cfg.attendance_threshold || 75,
            college_name: cfg.college_name || 'VisionTrack University of Technology',
            sound_enabled: cfg.sound_enabled !== undefined ? Boolean(cfg.sound_enabled) : true,
            email_alerts_enabled: cfg.email_alerts_enabled !== undefined ? Boolean(cfg.email_alerts_enabled) : true
          }));
        }
      })
      .catch(() => {});
  }, [authFetch]);

  const handleSaveAiSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await authFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(aiSettings)
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        toast('AI and system parameters updated live!', 'success');
      } else {
        toast(data.detail || 'Failed to update settings', 'error');
      }
    } catch {
      toast('Network error updating settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDownloadBackup = async () => {
    try {
      toast('Preparing system backup package...', 'info');
      const token = localStorage.getItem('vt_token') || localStorage.getItem('token');
      const res = await fetch('/api/backup/download', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `VisionTrack_Backup_${new Date().toISOString().slice(0,10)}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        toast('System backup downloaded successfully!', 'success');
      } else {
        const data = await res.json().catch(() => ({}));
        toast(data.detail || 'Failed to download backup', 'error');
      }
    } catch {
      toast('Error downloading backup archive', 'error');
    }
  };

  const handleRestoreBackup = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.zip')) {
      toast('Please select a valid .zip backup file', 'warn');
      return;
    }

    if (!window.confirm('Are you sure you want to restore? This will merge/overwrite existing database records.')) {
      e.target.value = '';
      return;
    }

    setRestoring(true);
    try {
      const token = localStorage.getItem('vt_token') || localStorage.getItem('token');
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        toast('System backup restored successfully! Reloading...', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast(data.detail || 'Failed to restore backup', 'error');
      }
    } catch {
      toast('Error during backup restoration', 'error');
    } finally {
      setRestoring(false);
      e.target.value = '';
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!passwords.old_password.trim() || !passwords.new_password.trim() || !passwords.confirm_password.trim()) {
      toast('All password fields are required', 'warn');
      return;
    }
    if (passwords.new_password !== passwords.confirm_password) {
      toast('New passwords do not match', 'warn');
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          old_password: passwords.old_password,
          new_password: passwords.new_password,
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        toast('Password updated successfully!', 'success');
        setPasswords({ old_password: '', new_password: '', confirm_password: '' });
      } else {
        toast(data.detail || data.message || 'Failed to update password', 'warn');
      }
    } catch (err) {
      toast('Server error', 'error');
    }
    setLoading(false);
  };

  const inp = { className: 'form-input', style: { marginBottom: 12 } };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* AI & System Settings (Admin Only) */}
      {user.role === 'admin' && (
        <div className="metric-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <Cpu size={20} color="var(--primary)" />
            <h2 className="metric-title" style={{ fontSize: '1.2rem', margin: 0 }}>AI Face Recognition & Verification Parameters</h2>
          </div>

          <form onSubmit={handleSaveAiSettings}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginBottom: 20 }}>
              {/* ArcFace Similarity Threshold Slider */}
              <div className="form-group" style={{ background: 'var(--bg-card)', padding: 14, borderRadius: 10, border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>ArcFace Distance Threshold</label>
                  <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{aiSettings.threshold.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.40"
                  max="0.80"
                  step="0.02"
                  value={aiSettings.threshold}
                  onChange={e => setAiSettings({ ...aiSettings, threshold: parseFloat(e.target.value) })}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  <span>0.40 (Strictest)</span>
                  <span>0.60 (Optimal)</span>
                  <span>0.80 (Lenient)</span>
                </div>
              </div>

              {/* Cooldown Seconds */}
              <div className="form-group" style={{ background: 'var(--bg-card)', padding: 14, borderRadius: 10, border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>Duplicate Attendance Cooldown</label>
                  <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{aiSettings.cooldown_sec}s</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={aiSettings.cooldown_sec}
                  onChange={e => setAiSettings({ ...aiSettings, cooldown_sec: parseInt(e.target.value) })}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  <span>5s (Fast)</span>
                  <span>30s</span>
                  <span>60s (Strict)</span>
                </div>
              </div>

              {/* Anti-Spoofing & Liveness */}
              <div className="form-group" style={{ background: 'var(--bg-card)', padding: 14, borderRadius: 10, border: '1px solid var(--border-color)' }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Dual-Cue Anti-Spoofing Engine</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <input
                    type="checkbox"
                    id="anti_spoof"
                    checked={aiSettings.anti_spoofing}
                    onChange={e => setAiSettings({ ...aiSettings, anti_spoofing: e.target.checked })}
                    style={{ width: 18, height: 18, cursor: 'pointer' }}
                  />
                  <label htmlFor="anti_spoof" style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                    Enable Moiré & Texture Anti-Spoofing
                  </label>
                </div>
                {aiSettings.anti_spoofing && (
                  <select
                    className="form-select"
                    style={{ marginTop: 10 }}
                    value={aiSettings.liveness_strictness}
                    onChange={e => setAiSettings({ ...aiSettings, liveness_strictness: e.target.value })}
                  >
                    <option value="low">Low Sensitivity (Permissive)</option>
                    <option value="medium">Medium Sensitivity (Recommended)</option>
                    <option value="high">High Sensitivity (Maximum Security)</option>
                  </select>
                )}
              </div>

              {/* Default Camera Mode */}
              <div className="form-group" style={{ background: 'var(--bg-card)', padding: 14, borderRadius: 10, border: '1px solid var(--border-color)' }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Default Camera Source</label>
                <select
                  className="form-select"
                  style={{ marginTop: 8 }}
                  value={aiSettings.camera_mode}
                  onChange={e => setAiSettings({ ...aiSettings, camera_mode: e.target.value })}
                >
                  <option value="client">Browser Webcam (Cloud / WebRTC / Mobile)</option>
                  <option value="server">Server Local Camera (USB / CCTV)</option>
                </select>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
                  Choose Browser Webcam for cloud deployments like Cloud Run or remote users.
                </div>
              </div>

              {/* Attendance Threshold */}
              <div className="form-group" style={{ background: 'var(--bg-card)', padding: 14, borderRadius: 10, border: '1px solid var(--border-color)' }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Exam Eligibility Minimum Threshold (%)</label>
                <input
                  type="number"
                  min="50"
                  max="95"
                  className="form-input"
                  style={{ marginTop: 6 }}
                  value={aiSettings.attendance_threshold}
                  onChange={e => setAiSettings({ ...aiSettings, attendance_threshold: parseInt(e.target.value) || 75 })}
                />
              </div>

              {/* College / Institution Name */}
              <div className="form-group" style={{ background: 'var(--bg-card)', padding: 14, borderRadius: 10, border: '1px solid var(--border-color)' }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Institution Name (Report Header)</label>
                <input
                  type="text"
                  className="form-input"
                  style={{ marginTop: 6 }}
                  value={aiSettings.college_name}
                  onChange={e => setAiSettings({ ...aiSettings, college_name: e.target.value })}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Save size={15} /> {savingSettings ? 'Saving Settings...' : 'Save AI Parameters'}
            </button>
          </form>
        </div>
      )}

      {/* 1-Click System Backup & Restore (Admin Only) */}
      {user.role === 'admin' && (
        <div className="metric-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Shield size={20} color="var(--primary)" />
            <h2 className="metric-title" style={{ fontSize: '1.2rem', margin: 0 }}>System Ledger Backup & Restore</h2>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 16 }}>
            Download or restore full snapshots of attendance records, face embeddings (`embeddings.pkl`), student facial database, and system configs.
          </p>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <button
              onClick={handleDownloadBackup}
              className="btn btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Download size={15} /> Download Full System Backup (.zip)
            </button>

            <label
              className="btn btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: restoring ? 'not-allowed' : 'pointer' }}
            >
              <Upload size={15} /> {restoring ? 'Restoring Archive...' : 'Restore From Backup (.zip)'}
              <input
                type="file"
                accept=".zip"
                onChange={handleRestoreBackup}
                disabled={restoring}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>
      )}

      {/* Change Password */}
      <div className="metric-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Key size={20} color="var(--primary)" />
          <h2 className="metric-title" style={{ fontSize: '1.2rem', margin: 0 }}>Account Security & Password</h2>
        </div>
        <form onSubmit={handleChangePassword} style={{ maxWidth: 460 }}>
          <div className="form-group">
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Current Password</label>
            <input required type="password" placeholder="Enter current password" value={passwords.old_password} onChange={e => setPasswords({ ...passwords, old_password: e.target.value })} {...inp} style={{ marginTop: 4 }} />
          </div>
          <div className="form-group">
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>New Password</label>
            <input required type="password" placeholder="Enter new password" value={passwords.new_password} onChange={e => setPasswords({ ...passwords, new_password: e.target.value })} {...inp} style={{ marginTop: 4 }} />
          </div>
          <div className="form-group">
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Confirm New Password</label>
            <input required type="password" placeholder="Confirm new password" value={passwords.confirm_password} onChange={e => setPasswords({ ...passwords, confirm_password: e.target.value })} {...inp} style={{ marginTop: 4 }} />
          </div>
          <button disabled={loading} className="btn btn-primary" style={{ marginTop: 8 }}>
            {loading ? 'Updating...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
