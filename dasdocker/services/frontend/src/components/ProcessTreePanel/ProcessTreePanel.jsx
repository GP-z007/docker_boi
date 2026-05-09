import { useEffect, useMemo, useState } from 'react';
import { SessionWebSocketClient } from '../../lib/websocket-client.js';
import TooltipHint from '../Tooltip/TooltipHint.jsx';

function makeClient({ wsUrl, sessionId, authToken, authMode }) {
  return new SessionWebSocketClient({ wsUrl, sessionId, authToken, authMode });
}

function renderNode(pid, nodes, expanded, toggle) {
  const n = nodes[pid];
  if (!n) return null;
  const hasChildren = n.children.length > 0;
  const isExpanded = expanded.has(pid);
  const prefix = hasChildren ? (isExpanded ? '▼' : '▶') : '•';
  return (
    <li key={pid} data-pid={pid}>
      <button
        type="button"
        onClick={() => hasChildren && toggle(pid)}
        style={{ border: 0, background: 'transparent', color: 'inherit', cursor: hasChildren ? 'pointer' : 'default' }}
      >
        {prefix} {n.comm || 'unknown'} (pid:{pid}) {n.flagged ? '⚠️' : ''}{' '}
        {n.flash ? <span style={{ color: '#F5A524' }}>NEW</span> : null}
      </button>
      {hasChildren && isExpanded ? <ul>{n.children.map((c) => renderNode(c, nodes, expanded, toggle))}</ul> : null}
    </li>
  );
}

export default function ProcessTreePanel({ sessionId, wsUrl, authToken, authMode = 'first_message', createClient }) {
  const [nodes, setNodes] = useState({});
  const [expanded, setExpanded] = useState(new Set());
  const roots = useMemo(() => {
    const out = [];
    for (const [pid, n] of Object.entries(nodes)) {
      if (!n.ppid || !nodes[n.ppid]) out.push(Number(pid));
    }
    return out;
  }, [nodes]);

  const client = useMemo(() => {
    if (!wsUrl || !sessionId || !authToken) return null;
    return (createClient || makeClient)({ wsUrl, sessionId, authToken, authMode });
  }, [authMode, authToken, createClient, sessionId, wsUrl]);

  useEffect(() => {
    if (!client) return undefined;

    const onProc = (evt) => {
      const pid = Number(evt.pid || 0);
      const ppid = Number(evt.ppid || 0);
      if (!pid) return;
      setNodes((prev) => {
        const copy = { ...prev };
        const existing = copy[pid] || { pid, ppid, comm: '', args: '', children: [], flagged: false, flash: false };
        existing.comm = evt.comm || existing.comm;
        existing.args = evt.args || existing.args;
        existing.ppid = ppid || existing.ppid;
        existing.flash = true;
        copy[pid] = existing;
        if (ppid) {
          const parent = copy[ppid] || {
            pid: ppid,
            ppid: 0,
            comm: 'unknown',
            args: '',
            children: [],
            flagged: false,
            flash: false,
          };
          if (!parent.children.includes(pid)) parent.children = [...parent.children, pid];
          copy[ppid] = parent;
        }
        setTimeout(() => {
          setNodes((curr) => {
            if (!curr[pid]) return curr;
            return { ...curr, [pid]: { ...curr[pid], flash: false } };
          });
        }, 500);
        return copy;
      });
      setExpanded((prev) => new Set([...prev, ppid, pid]));
    };

    const onAlert = (evt) => {
      const comm = evt?.evidence?.event_meta?.comm;
      if (!comm) return;
      setNodes((prev) => {
        const copy = { ...prev };
        for (const [pid, node] of Object.entries(copy)) {
          if ((node.comm || '').toLowerCase() === String(comm).toLowerCase()) {
            copy[pid] = { ...node, flagged: true };
          }
        }
        return copy;
      });
    };

    const onState = (evt) => {
      if (evt.to === 'DESTROYED') {
        setNodes({});
        setExpanded(new Set());
      }
    };

    const u1 = client.subscribe('process_event', onProc);
    const u2 = client.subscribe('alert_event', onAlert);
    const u3 = client.subscribe('state_change', onState);
    client.connect();
    return () => {
      u1?.();
      u2?.();
      u3?.();
      client.disconnect();
    };
  }, [client]);

  const toggle = (pid) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });

  return (
    <section
      aria-label="Process tree panel"
      aria-describedby="process-tree-help"
      title="Shows process creation hierarchy and suspicious flagged commands."
    >
      <h3>Process Tree</h3>
      <TooltipHint
        id="process-tree-help"
        text="Process Tree displays parent-child process lineage from runtime telemetry and marks nodes flagged by IDS alerts."
      />
      {roots.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No process telemetry yet.</p>
      ) : (
        <ul>{roots.map((pid) => renderNode(pid, nodes, expanded, toggle))}</ul>
      )}
    </section>
  );
}
