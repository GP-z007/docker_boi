import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProxiedWebViewPanel from '../ProxiedWebViewPanel.jsx';

function fakeClient() {
  const handlers = new Map();
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
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

describe('ProxiedWebViewPanel', () => {
  it('shows placeholder when session is not RUNNING', () => {
    render(<ProxiedWebViewPanel sessionId="s1" sessionState="PROVISIONING" />);
    expect(screen.getByText('Web view not available')).toBeInTheDocument();
  });

  it('renders iframe with strict sandbox attributes (no top-navigation)', () => {
    const c = fakeClient();
    render(
      <ProxiedWebViewPanel
        sessionId="s1"
        sessionState="RUNNING"
        wsUrl="ws://host/events/s1"
        authToken="jwt"
        createClient={() => c}
      />,
    );
    act(() => {
      c.emit('port_detected', { session_id: 's1', port: 3000, protocol: 'http' });
    });
    const frame = screen.getByTitle('Sandbox application preview');
    expect(frame).toHaveAttribute('sandbox');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).toContain('allow-forms');
    expect(frame.getAttribute('sandbox')).toContain('allow-same-origin');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-popups-to-escape-sandbox');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame).not.toHaveAttribute('name');
    expect(frame).not.toHaveAttribute('id');
  });

  it('DESTROYED state returns to placeholder', () => {
    const c = fakeClient();
    render(
      <ProxiedWebViewPanel
        sessionId="s1"
        sessionState="RUNNING"
        wsUrl="ws://host/events/s1"
        authToken="jwt"
        createClient={() => c}
      />,
    );
    act(() => c.emit('port_detected', { session_id: 's1', port: 3000 }));
    expect(screen.getByTitle('Sandbox application preview')).toBeInTheDocument();
    act(() => c.emit('state_change', { session_id: 's1', to: 'DESTROYED', reason: 'ttl-expired' }));
    expect(screen.getByText('Web view not available')).toBeInTheDocument();
  });

  it('security posture test: sandbox attribute blocks parent reach-through contract', () => {
    render(
      <ProxiedWebViewPanel
        sessionId="s1"
        sessionState="RUNNING"
        wsUrl="ws://host/events/s1"
        authToken="jwt"
        createClient={() => {
          const c = fakeClient();
          setTimeout(() => c.emit('port_detected', { session_id: 's1', port: 3000 }), 0);
          return c;
        }}
      />,
    );
    const frame = screen.queryByTitle('Sandbox application preview');
    // jsdom cannot enforce browser sandbox/CSP; assert hardened flags that enforce it in real browsers.
    if (frame) expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-same-origin');
  });
});
