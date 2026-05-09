import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AlertFeedPanel from '../AlertFeedPanel.jsx';

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

describe('AlertFeedPanel', () => {
  it('CRITICAL alert renders pulsing badge and triggers Notification', () => {
    const c = clientStub();
    const notif = vi.fn();
    global.Notification = Object.assign(notif, { permission: 'granted' });
    render(<AlertFeedPanel sessionId="s1" wsUrl="ws://x" authToken="t" createClient={() => c} enableAudio={false} />);
    act(() =>
      c.emit('alert_event', {
        severity: 'critical',
        rule_id: 'ALERT-002',
        description: 'reverse shell',
        timestamp: new Date().toISOString(),
      }),
    );
    const badge = screen.getByTestId('severity-CRITICAL');
    expect(badge).toHaveStyle({ background: 'rgb(241, 75, 75)' });
    expect(badge.style.animation).toContain('pulse-critical');
    expect(notif).toHaveBeenCalled();
  });
});
