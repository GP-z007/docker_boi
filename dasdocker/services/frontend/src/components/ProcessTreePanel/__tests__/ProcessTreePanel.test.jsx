import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ProcessTreePanel from '../ProcessTreePanel.jsx';

function clientStub() {
  const handlers = new Map();
  return {
    connect() {},
    disconnect() {},
    subscribe(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    emit(type, payload) {
      handlers.get(type)?.forEach((fn) => fn(payload));
    },
  };
}

describe('ProcessTreePanel', () => {
  it('renders parent-child tree from pid/ppid', () => {
    const c = clientStub();
    render(
      <ProcessTreePanel
        sessionId="s1"
        wsUrl="ws://x"
        authToken="t"
        createClient={() => c}
      />,
    );
    act(() => {
      c.emit('process_event', { pid: 1, ppid: 0, comm: 'node' });
      c.emit('process_event', { pid: 47, ppid: 1, comm: 'npm' });
    });
    expect(screen.getByText(/node \(pid:1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/npm \(pid:47\)/i)).toBeInTheDocument();
  });

  it('flags suspicious process with warning icon', () => {
    const c = clientStub();
    render(<ProcessTreePanel sessionId="s1" wsUrl="ws://x" authToken="t" createClient={() => c} />);
    act(() => c.emit('process_event', { pid: 9, ppid: 0, comm: 'ncat' }));
    act(() =>
      c.emit('alert_event', {
        severity: 'critical',
        evidence: { event_meta: { comm: 'ncat' } },
      }),
    );
    expect(screen.getByText(/⚠️/)).toBeInTheDocument();
  });

  it('clears process data on DESTROYED state', () => {
    const c = clientStub();
    render(<ProcessTreePanel sessionId="s1" wsUrl="ws://x" authToken="t" createClient={() => c} />);
    act(() => c.emit('process_event', { pid: 1, ppid: 0, comm: 'node' }));
    expect(screen.getByText(/node \(pid:1\)/i)).toBeInTheDocument();
    act(() => c.emit('state_change', { to: 'DESTROYED', reason: 'ttl-expired' }));
    expect(screen.getByText(/No process telemetry yet/i)).toBeInTheDocument();
  });
});
