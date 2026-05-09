import { useEffect, useMemo, useState } from 'react';

function fmt(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function SessionControlPanel({ sessionId, authToken, expiresAt, status, onKilled }) {
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remainMs = useMemo(() => new Date(expiresAt || now).getTime() - now, [expiresAt, now]);
  const danger = remainMs <= 60_000;

  const onKill = async () => {
    const ok = window.confirm(
      'This will immediately destroy the container and all its data. This cannot be undone.',
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!r.ok) throw new Error(`kill failed ${r.status}`);
      onKilled?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Session control panel" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>
        Status: <strong>{status || 'UNKNOWN'}</strong>
      </span>
      <span style={{ color: danger ? '#F14B4B' : 'var(--color-text-primary)' }}>TTL: {fmt(remainMs)}</span>
      <button type="button" onClick={onKill} disabled={busy} style={{ background: '#F14B4B', color: '#fff', border: 0, padding: '8px 10px' }}>
        🔴 KILL SESSION
      </button>
    </section>
  );
}
