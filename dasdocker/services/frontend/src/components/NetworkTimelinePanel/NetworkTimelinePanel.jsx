import { useEffect, useMemo, useState } from 'react';
import { SessionWebSocketClient } from '../../lib/websocket-client.js';
import TooltipHint from '../Tooltip/TooltipHint.jsx';

function mkClient({ wsUrl, sessionId, authToken, authMode }) {
  return new SessionWebSocketClient({ wsUrl, sessionId, authToken, authMode });
}

function tone(evt) {
  if (evt.event_type === 'dns_query') return '#42C5F5';
  if (evt.event_type === 'http_request') return '#12B76A';
  if ([4444, 1337, 31337].includes(Number(evt.dst_port || 0))) return '#F14B4B';
  return '#E6EAF2';
}

export default function NetworkTimelinePanel({ sessionId, wsUrl, authToken, authMode = 'first_message', createClient }) {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);

  const client = useMemo(() => {
    if (!sessionId || !wsUrl || !authToken) return null;
    return (createClient || mkClient)({ wsUrl, sessionId, authToken, authMode });
  }, [authMode, authToken, createClient, sessionId, wsUrl]);

  useEffect(() => {
    if (!client) return undefined;
    const onNetwork = (evt) => {
      setEvents((prev) => [...prev, evt].slice(-200));
      setTotal((n) => n + 1);
    };
    const onState = (evt) => {
      if (evt.to === 'DESTROYED') {
        setEvents([]);
        setTotal(0);
      }
    };
    const u1 = client.subscribe('network_event', onNetwork);
    const u2 = client.subscribe('state_change', onState);
    client.connect();
    return () => {
      u1?.();
      u2?.();
      client.disconnect();
    };
  }, [client]);

  return (
    <section
      aria-label="Network timeline panel"
      aria-describedby="network-timeline-help"
      title="Shows DNS and outbound connection telemetry emitted by eBPF/network monitors."
    >
      <h3>Network Timeline</h3>
      <TooltipHint
        id="network-timeline-help"
        text="Network Timeline lists network events (for example DNS queries and HTTP requests) observed for this session."
      />
      <p>Total connections: {total}</p>
      <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--color-border-subtle)' }}>
        {events.map((evt, idx) => (
          <div key={`${evt.timestamp || 't'}-${idx}`} style={{ color: tone(evt), fontFamily: 'var(--font-console)' }}>
            [{new Date(evt.timestamp || Date.now()).toLocaleTimeString()}] {evt.event_type} → {evt.dst_ip}:{evt.dst_port}{' '}
            {evt.proto}
          </div>
        ))}
      </div>
    </section>
  );
}
