import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import NetworkTimelinePanel from '../NetworkTimelinePanel.jsx';

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

describe('NetworkTimelinePanel', () => {
  it('renders suspicious port 4444 in red', () => {
    const c = clientStub();
    render(<NetworkTimelinePanel sessionId="s1" wsUrl="ws://x" authToken="t" createClient={() => c} />);
    act(() =>
      c.emit('network_event', {
        timestamp: new Date().toISOString(),
        event_type: 'connect',
        dst_ip: '1.2.3.4',
        dst_port: 4444,
        proto: 'tcp',
      }),
    );
    const row = screen.getByText(/4444/);
    expect(row).toHaveStyle({ color: 'rgb(241, 75, 75)' });
  });
});
