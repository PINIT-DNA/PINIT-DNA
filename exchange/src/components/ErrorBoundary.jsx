import React from 'react';

/** Shows runtime errors instead of a blank black screen. */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[Pinit Exchange] UI crash:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#080b11',
          color: '#f8fafc',
          padding: 40,
          fontFamily: 'system-ui, sans-serif',
        }}>
          <h1 style={{ fontSize: '1.4rem', marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ color: '#94a3b8', marginBottom: 16 }}>
            The Exchange UI crashed. Try a hard refresh (Ctrl+Shift+R). Details:
          </p>
          <pre style={{
            background: '#0e1421',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: 16,
            borderRadius: 8,
            overflow: 'auto',
            color: '#f87171',
            fontSize: 13,
          }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20,
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Reload Exchange
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
