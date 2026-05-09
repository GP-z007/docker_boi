import { useEffect, useMemo, useState } from 'react';
import { SessionWebSocketClient } from '../../lib/websocket-client.js';

function makeClient({ wsUrl, sessionId, authToken, authMode }) {
  return new SessionWebSocketClient({ wsUrl, sessionId, authToken, authMode });
}

function sevStyle(sev) {
  const s = String(sev || '').toLowerCase();
  if (s === 'critical') return { bg: '#F14B4B', pulse: true };
  if (s === 'high') return { bg: '#F97316', pulse: false };
  if (s === 'warn' || s === 'warning') return { bg: '#F5A524', pulse: false };
  return { bg: '#6B7280', pulse: false };
}

function notifyCritical(alert) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    // eslint-disable-next-line no-new
    new Notification(`CRITICAL ${alert.rule_id}`, { body: alert.description || 'Security alert' });
  }
}

function playCriticalTone() {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  const ctx = new window.AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.value = 0.03;
  osc.start();
  osc.stop(ctx.currentTime + 0.12);
}

export default function AlertFeedPanel({
  sessionId,
  wsUrl,
  authToken,
  authMode = 'first_message',
  createClient,
  enableAudio = true,
}) {
  const [alerts, setAlerts] = useState([]);

  const client = useMemo(() => {
    if (!sessionId || !wsUrl || !authToken) return null;
    return (createClient || makeClient)({ wsUrl, sessionId, authToken, authMode });
  }, [authMode, authToken, createClient, sessionId, wsUrl]);

  useEffect(() => {
    if (!client) return undefined;
    const onAlert = (evt) => {
      setAlerts((prev) => [evt, ...prev]);
      if (String(evt.severity || '').toLowerCase() === 'critical') {
        notifyCritical(evt);
        if (enableAudio) playCriticalTone();
      }
    };
    const onState = (evt) => {
      if (evt.to === 'DESTROYED') setAlerts([]);
    };
    const u1 = client.subscribe('alert_event', onAlert);
    const u2 = client.subscribe('state_change', onState);
    client.connect();
    return () => {
      u1?.();
      u2?.();
      client.disconnect();
    };
  }, [client, enableAudio]);

  return (
    <section aria-label="Alert feed panel">
      <h3>IDS Alerts</h3>
      {alerts.length === 0 ? <p style={{ color: 'var(--color-text-muted)' }}>No alerts yet.</p> : null}
      <div style={{ display: 'grid', gap: 8 }}>
        {alerts.map((a, idx) => {
          const st = sevStyle(a.severity);
          return (
            <article key={`${a.timestamp || idx}-${idx}`} style={{ border: '1px solid var(--color-border-subtle)', padding: 8 }}>
              <span
                data-testid={`severity-${String(a.severity || '').toUpperCase()}`}
                style={{
                  background: st.bg,
                  color: '#fff',
                  padding: '2px 6px',
                  borderRadius: 6,
                  animation: st.pulse ? 'pulse-critical 1s ease-in-out infinite' : 'none',
                }}
              >
                {String(a.severity || 'info').toUpperCase()}
              </span>{' '}
              <strong>{a.rule_id}</strong> - {a.description}
              <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                {new Date(a.timestamp || Date.now()).toLocaleTimeString()}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
