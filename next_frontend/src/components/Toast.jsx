// Toast notification system
import { useState, useCallback } from 'react';

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((msg, type = 'success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);
  return { toasts, toast };
}

export function ToastContainer({ toasts }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === 'error' ? '#ef4444' : t.type === 'warn' ? '#f59e0b' : '#10b981',
          color: '#fff', padding: '12px 20px', borderRadius: 10, fontWeight: 600,
          fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          animation: 'slideIn 0.3s ease'
        }}>
          {t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : '⚠️'} {typeof t.msg === 'string' ? t.msg : JSON.stringify(t.msg)}
        </div>
      ))}
    </div>
  );
}
