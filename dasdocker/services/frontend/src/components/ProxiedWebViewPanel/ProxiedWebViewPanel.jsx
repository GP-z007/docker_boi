import { useEffect, useMemo, useState } from 'react';
import { SessionWebSocketClient } from '../../lib/websocket-client.js';

function defaultClientFactory({ wsUrl, sessionId, authToken, authMode }) {
  return new SessionWebSocketClient({ wsUrl, sessionId, authToken, authMode });
}

export default function ProxiedWebViewPanel({
  sessionId,
  sessionState,
  wsUrl,
  authToken,
  authMode = 'first_message',
  createClient,
}) {
  const [portMeta, setPortMeta] = useState(null);

  const client = useMemo(() => {
    if (!sessionId || !wsUrl || !authToken) return null;
    const f = createClient || defaultClientFactory;
    return f({ wsUrl, sessionId, authToken, authMode });
  }, [authMode, authToken, createClient, sessionId, wsUrl]);

  useEffect(() => {
    if (!client) return undefined;
    const unsubPort = client.subscribe('port_detected', (evt) => {
      if (!evt.port) return;
      setPortMeta({ port: evt.port, protocol: evt.protocol || 'http' });
    });
    const unsubState = client.subscribe('state_change', (evt) => {
      if (evt.to === 'DESTROYED' || evt.to === 'FAILED') setPortMeta(null);
    });
    client.connect();
    return () => {
      unsubPort?.();
      unsubState?.();
      client.disconnect();
    };
  }, [client]);

  if (sessionState !== 'RUNNING' || !portMeta) {
    return (
      <section aria-label="Sandbox web view">
        <div>Web view not available</div>
      </section>
    );
  }

  const src = `/api/v1/sessions/${encodeURIComponent(sessionId)}/proxy/`;
  return (
    <section aria-label="Sandbox web view">
      <iframe
        title="Sandbox application preview"
        src={src}
        sandbox="allow-scripts allow-forms allow-same-origin"
        referrerPolicy="no-referrer"
        style={{ width: '100%', minHeight: 320, border: 0, background: '#0D1117' }}
      />
    </section>
  );
}
