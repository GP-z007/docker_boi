import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConsolePanel from '../ConsolePanel.jsx';

let lastTerminalOptions = null;

function parseAnsiToSpans(line, container) {
  const parts = line.split(/(\x1b\[[0-9;]*m)/g).filter(Boolean);
  let style = { color: '', fontStyle: '' };
  for (const part of parts) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (m) {
      const codes = m[1].split(';').filter(Boolean);
      if (codes.includes('0')) style = { color: '', fontStyle: '' };
      if (codes.includes('31')) style.color = 'rgb(241, 75, 75)';
      if (codes.includes('33')) style.color = 'rgb(245, 165, 36)';
      if (codes.includes('36')) style.color = 'rgb(66, 197, 245)';
      if (codes.includes('37')) style.color = 'rgb(230, 234, 242)';
      if (codes.includes('3')) style.fontStyle = 'italic';
      continue;
    }
    const span = document.createElement('span');
    span.textContent = part;
    if (style.color) span.style.color = style.color;
    if (style.fontStyle) span.style.fontStyle = style.fontStyle;
    container.appendChild(span);
  }
}

vi.mock('xterm', () => {
  class FakeTerminal {
    constructor(opts) {
      this.options = opts;
      this.lines = [];
      lastTerminalOptions = opts;
    }
    loadAddon() {}
    open(el) {
      this.mount = el;
      this.screen = document.createElement('div');
      this.screen.setAttribute('data-testid', 'fake-xterm');
      el.appendChild(this.screen);
    }
    attachCustomKeyEventHandler() {}
    onData() {}
    writeln(text) {
      this.lines.push(text);
      while (this.lines.length > (this.options.scrollback || 1000)) this.lines.shift();
      if (!this.screen) return;
      this.screen.innerHTML = '';
      for (const line of this.lines) {
        const row = document.createElement('div');
        parseAnsiToSpans(line, row);
        this.screen.appendChild(row);
      }
    }
    scrollToBottom() {}
    dispose() {
      if (this.mount) this.mount.innerHTML = '';
    }
  }
  return { Terminal: FakeTerminal };
});

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));

function buildFakeClient() {
  const handlers = new Map();
  return {
    send: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribe(eventType, fn) {
      if (!handlers.has(eventType)) handlers.set(eventType, new Set());
      handlers.get(eventType).add(fn);
      return () => handlers.get(eventType)?.delete(fn);
    },
    emit(eventType, payload) {
      handlers.get(eventType)?.forEach((fn) => fn(payload));
    },
  };
}

describe('ConsolePanel', () => {
  beforeEach(() => {
    lastTerminalOptions = null;
  });

  it('renders gracefully without websocket config', () => {
    render(<ConsolePanel />);
    expect(screen.getByText('Waiting for stream...')).toBeInTheDocument();
  });

  it('stdout_line is rendered in white text', () => {
    const client = buildFakeClient();
    render(
      <ConsolePanel
        sessionId="s-1"
        wsUrl="ws://localhost/events/s-1"
        authToken="token"
        createClient={() => client}
      />,
    );
    act(() => {
      client.emit('stdout_line', { line: 'hello stdout' });
    });
    const span = screen.getByText('hello stdout');
    expect(span).toHaveStyle({ color: 'rgb(230, 234, 242)' });
  });

  it('stderr_line is rendered in yellow text', () => {
    const client = buildFakeClient();
    render(
      <ConsolePanel
        sessionId="s-1"
        wsUrl="ws://localhost/events/s-1"
        authToken="token"
        createClient={() => client}
      />,
    );
    act(() => {
      client.emit('stderr_line', { line: 'bad stderr' });
    });
    const span = screen.getByText('bad stderr');
    expect(span).toHaveStyle({ color: 'rgb(245, 165, 36)' });
  });

  it('ANSI escapes render as styles, not raw control text', () => {
    const client = buildFakeClient();
    render(
      <ConsolePanel
        sessionId="s-1"
        wsUrl="ws://localhost/events/s-1"
        authToken="token"
        createClient={() => client}
      />,
    );
    act(() => {
      client.emit('stdout_line', { line: '\x1b[31mRED\x1b[0m' });
    });
    expect(screen.getByText('RED')).toBeInTheDocument();
    expect(screen.queryByText(/\x1b\[31m/)).not.toBeInTheDocument();
  });

  it('keyboard input attempts do not send data to backend', () => {
    const client = buildFakeClient();
    render(
      <ConsolePanel
        sessionId="s-1"
        wsUrl="ws://localhost/events/s-1"
        authToken="token"
        createClient={() => client}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText('Sandbox console'), { key: 'a', code: 'KeyA' });
    expect(client.send).not.toHaveBeenCalled();
    expect(lastTerminalOptions.disableStdin).toBe(true);
  });

  it('configures scrollback cap at 5000 lines', () => {
    const client = buildFakeClient();
    render(
      <ConsolePanel
        sessionId="s-1"
        wsUrl="ws://localhost/events/s-1"
        authToken="token"
        createClient={() => client}
      />,
    );
    expect(lastTerminalOptions.scrollback).toBe(5000);
  });

  it('continues rendering after reconnect cycle', () => {
    const client = buildFakeClient();
    render(
      <ConsolePanel
        sessionId="s-1"
        wsUrl="ws://localhost/events/s-1"
        authToken="token"
        createClient={() => client}
      />,
    );
    expect(client.connect).toHaveBeenCalledTimes(1);
    act(() => {
      client.emit('stdout_line', { line: 'after reconnect' });
    });
    expect(screen.getByText('after reconnect')).toBeInTheDocument();
  });

  it('DESTROYED state prints termination line and disconnects client', () => {
    const client = buildFakeClient();
    render(
      <ConsolePanel
        sessionId="s-1"
        wsUrl="ws://localhost/events/s-1"
        authToken="token"
        createClient={() => client}
      />,
    );
    act(() => {
      client.emit('state_change', { from: 'RUNNING', to: 'DESTROYED', reason: 'ttl-expired' });
    });
    expect(screen.getByText('[SESSION TERMINATED - ttl-expired]')).toHaveStyle({ color: 'rgb(241, 75, 75)' });
    expect(client.disconnect).toHaveBeenCalled();
  });
});
