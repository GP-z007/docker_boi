import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    const payload = {
      message: String(error?.message || 'frontend_error'),
      stack: import.meta.env.DEV ? String(error?.stack || '') : '',
      componentStack: import.meta.env.DEV ? String(info?.componentStack || '') : '',
      ts: new Date().toISOString(),
    };
    fetch('/api/v1/frontend-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="ds-stub">
          <h1 style={{ font: 'var(--font-heading)', color: 'var(--color-danger)' }}>Something went wrong</h1>
          <p style={{ color: 'var(--color-text-muted)' }}>
            The page encountered an unexpected error. Please retry or start a new session.
          </p>
        </main>
      );
    }
    return this.props.children;
  }
}
