import { useMemo, useState } from 'react';
import ConsolePanel from '../components/ConsolePanel/ConsolePanel.jsx';
import ProxiedWebViewPanel from '../components/ProxiedWebViewPanel/ProxiedWebViewPanel.jsx';
import ProcessTreePanel from '../components/ProcessTreePanel/ProcessTreePanel.jsx';
import NetworkTimelinePanel from '../components/NetworkTimelinePanel/NetworkTimelinePanel.jsx';
import AlertFeedPanel from '../components/AlertFeedPanel/AlertFeedPanel.jsx';
import SessionControlPanel from '../components/SessionControlPanel/SessionControlPanel.jsx';

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export default function SessionWorkspace({ sessionId }) {
  const token = window.__DASDOCKER_SESSION_JWT || '';
  const claims = useMemo(() => decodeJwtPayload(token), [token]);
  const [status, setStatus] = useState('RUNNING');

  if (claims?.session_id && claims.session_id !== sessionId) {
    return <main><h1>Something went wrong</h1><p>Session scope mismatch.</p></main>;
  }

  const wsUrl = `${window.location.origin.replace(/^http/, 'ws')}/events/${sessionId}`;
  const expiresAt = claims?.exp ? new Date(claims.exp * 1000).toISOString() : new Date(Date.now() + 15 * 60_000).toISOString();

  return (
    <main style={{ display: 'grid', gap: 12 }}>
      <p style={{ color: 'var(--color-text-muted)' }}>Opaque session: {sessionId.slice(0, 8)}…</p>
      <SessionControlPanel sessionId={sessionId} authToken={token} expiresAt={expiresAt} status={status} />

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ConsolePanel sessionId={sessionId} wsUrl={wsUrl} authToken={token || 'dev-token'} />
        <div style={{ display: 'grid', gap: 12 }}>
          <ProcessTreePanel sessionId={sessionId} wsUrl={wsUrl} authToken={token || 'dev-token'} />
          <NetworkTimelinePanel sessionId={sessionId} wsUrl={wsUrl} authToken={token || 'dev-token'} />
          <AlertFeedPanel sessionId={sessionId} wsUrl={wsUrl} authToken={token || 'dev-token'} />
        </div>
      </section>

      <ProxiedWebViewPanel sessionId={sessionId} sessionState={status} wsUrl={wsUrl} authToken={token || 'dev-token'} />
    </main>
  );
}
