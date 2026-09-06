import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('UI Crash ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px 20px',
          maxWidth: 600,
          margin: '40px auto',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 16,
          textAlign: 'center',
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)'
        }}>
          <AlertTriangle size={48} color="var(--danger)" style={{ marginBottom: 16 }} />
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 8, color: 'var(--text-main)' }}>
            Something went wrong
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 20 }}>
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '0 auto' }}
          >
            <RefreshCw size={16} /> Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
