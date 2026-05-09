import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SubmitPage from '../../../pages/SubmitPage.jsx';
import SessionControlPanel from '../../SessionControlPanel/SessionControlPanel.jsx';
import ProcessTreePanel from '../../ProcessTreePanel/ProcessTreePanel.jsx';
import NetworkTimelinePanel from '../../NetworkTimelinePanel/NetworkTimelinePanel.jsx';
import AlertFeedPanel from '../../AlertFeedPanel/AlertFeedPanel.jsx';

function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  act(() => window.dispatchEvent(new Event('resize')));
}

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

describe('Tooltip system', () => {
  it.each([375, 768, 1280])('renders tooltip text at viewport %ipx', (width) => {
    setViewport(width);
    const c = clientStub();
    render(
      <MemoryRouter>
        <SubmitPage />
        <SessionControlPanel sessionId="s1" authToken="jwt" status="RUNNING" expiresAt={new Date(Date.now() + 300000).toISOString()} />
        <ProcessTreePanel sessionId="s1" wsUrl="ws://x" authToken="t" createClient={() => c} />
        <NetworkTimelinePanel sessionId="s1" wsUrl="ws://x" authToken="t" createClient={() => c} />
        <AlertFeedPanel sessionId="s1" wsUrl="ws://x" authToken="t" createClient={() => c} enableAudio={false} />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/TTL Selector/i)).toHaveAttribute('aria-describedby', 'ttl-selector-help');
    expect(screen.getByRole('button', { name: /kill session/i })).toHaveAttribute('aria-describedby', 'kill-session-help');
    expect(screen.getByText(/TTL means maximum runtime/i)).toBeInTheDocument();
    expect(screen.getByText(/Kill Session triggers immediate teardown/i)).toBeInTheDocument();
    expect(screen.getByText(/Process Tree displays parent-child/i)).toBeInTheDocument();
    expect(screen.getByText(/Network Timeline lists network events/i)).toBeInTheDocument();
    expect(screen.getByText(/Alert Feed shows intrusion detection/i)).toBeInTheDocument();
  });

  it('adds tooltip semantics to alert severity badges', () => {
    const c = clientStub();
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
    expect(badge).toHaveAttribute('title', expect.stringMatching(/active high-risk behavior/i));
    expect(badge).toHaveAttribute('aria-describedby', 'severity-help-0');
    expect(screen.getByText(/Critical indicates active high-risk behavior/i)).toBeInTheDocument();
  });
});
