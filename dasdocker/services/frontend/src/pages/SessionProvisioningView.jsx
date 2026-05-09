import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ConsolePanel from '../components/ConsolePanel/ConsolePanel.jsx';
import { SessionWebSocketClient } from '../lib/websocket-client.js';

const STEP_TEXT = {
  QUEUED: 'Session queued',
  PROVISIONING: 'Provisioning sandbox',
  INSTALLING_DEPS: 'Installing dependencies',
  RUNNING: 'Sandbox ready',
};

export default function SessionProvisioningView({ sessionId, authToken, initialState = 'QUEUED' }) {
  const nav = useNavigate();

  useEffect(() => {
    if (!sessionId || !authToken) return undefined;
    const wsUrl = `${window.location.origin.replace(/^http/, 'ws')}/events/${sessionId}`;
    const c = new SessionWebSocketClient({ wsUrl, sessionId, authToken, authMode: 'first_message' });
    const unsub = c.subscribe('state_change', (evt) => {
      if (evt.to === 'RUNNING') nav(`/session/${sessionId}`);
    });
    c.connect();
    return () => {
      unsub?.();
      c.disconnect();
    };
  }, [authToken, nav, sessionId]);

  const wsUrl = `${window.location.origin.replace(/^http/, 'ws')}/events/${sessionId}`;
  return (
    <main style={{ display: 'grid', gap: 12 }}>
      <h1 style={{ font: 'var(--font-heading)' }}>Provisioning Session</h1>
      <p>
        <strong>{initialState}</strong> - {STEP_TEXT[initialState] || 'Preparing environment'}
      </p>
      <div style={{ maxWidth: 860 }}>
        <ConsolePanel sessionId={sessionId} wsUrl={wsUrl} authToken={authToken} />
      </div>
    </main>
  );
}
