import { useEffect, useState } from 'react';

export default function SessionHistoryPage() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/sessions')
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setRows(j.sessions || j.data || []);
      })
      .catch(() => alive && setErr('Failed to load session history.'));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main>
      <h1 style={{ font: 'var(--font-heading)' }}>Session history</h1>
      {err ? <p style={{ color: '#F14B4B' }}>{err}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Session</th>
            <th>Source</th>
            <th>Runtime</th>
            <th>TTL</th>
            <th>Status</th>
            <th>Created</th>
            <th>Forensics</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.session_id || s.id}>
              <td>{String(s.session_id || s.id || '').slice(0, 8)}…</td>
              <td>{s.source_type || '-'}</td>
              <td>{s.runtime || '-'}</td>
              <td>{s.ttl_seconds || '-'}</td>
              <td>{s.state || '-'}</td>
              <td>{s.created_at || '-'}</td>
              <td>
                {s.state === 'DESTROYED' ? (
                  <a href={`/api/v1/sessions/${encodeURIComponent(s.session_id || s.id)}/audit`}>Summary</a>
                ) : (
                  '-'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
