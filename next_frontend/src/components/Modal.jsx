export function Modal({ title, onClose, children, style = {} }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 32, minWidth: 420, maxWidth: 560, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', ...style }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexShrink: 0 }}>
          <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-muted)', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', paddingRight: 4, flex: 1, minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
