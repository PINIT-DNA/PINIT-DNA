import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary.jsx';

const root = ReactDOM.createRoot(document.getElementById('root'));

import('./App.jsx')
  .then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  })
  .catch((err) => {
    console.error('[Pinit Exchange] failed to load', err);
    root.render(
      <div style={{
        minHeight: '100vh',
        background: '#080b11',
        color: '#f8fafc',
        padding: 40,
        fontFamily: 'system-ui, sans-serif',
      }}>
        <h1 style={{ fontSize: '1.4rem', marginBottom: 12 }}>Exchange failed to load</h1>
        <pre style={{ color: '#f87171', whiteSpace: 'pre-wrap' }}>{String(err?.message || err)}</pre>
      </div>,
    );
  });
