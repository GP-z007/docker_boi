import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SessionWebSocketClient } from '../../lib/websocket-client.js';
import TooltipHint from '../Tooltip/TooltipHint.jsx';
import 'xterm/css/xterm.css';
import './ConsolePanel.css';

function createDefaultClient({ wsUrl, sessionId, authToken, authMode }) {
  return new SessionWebSocketClient({
    wsUrl,
    sessionId,
    authToken,
    authMode: authMode || 'first_message',
  });
}

/**
 * Read-only live console streaming stdout/stderr/state over session-scoped websocket.
 */
export default function ConsolePanel({ sessionId, wsUrl, authToken, authMode = 'first_message', createClient }) {
  const mountRef = useRef(null);
  const terminalRef = useRef(null);
  const fitRef = useRef(null);
  const unsubRef = useRef([]);
  const terminatedRef = useRef(false);
  const [status, setStatus] = useState('connecting');

  const client = useMemo(() => {
    const factory = createClient || createDefaultClient;
    return factory({ wsUrl, sessionId, authToken, authMode });
  }, [authMode, authToken, createClient, sessionId, wsUrl]);

  useEffect(() => {
    if (!mountRef.current) return undefined;

    const term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      scrollback: 5000,
      convertEol: true,
      fontFamily:
        '"Fira Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      theme: {
        background: '#0D1117',
        foreground: '#E6EAF2',
        yellow: '#F5A524',
        cyan: '#42C5F5',
        red: '#F14B4B',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(mountRef.current);
    fit.fit();
    term.attachCustomKeyEventHandler(() => false);
    term.onData(() => {});

    terminalRef.current = term;
    fitRef.current = fit;

    const onResize = () => fitRef.current?.fit();
    window.addEventListener('resize', onResize);

    if (!wsUrl || !sessionId || !authToken) {
      setStatus('disconnected');
      term.writeln('\x1b[36;3m[console] waiting for websocket configuration\x1b[0m');
      return () => {
        window.removeEventListener('resize', onResize);
        term.dispose();
      };
    }

    const onStdout = (evt) => {
      if (terminatedRef.current) return;
      setStatus('connected');
      const line = typeof evt.line === 'string' ? evt.line : String(evt.message || '');
      term.writeln(`\x1b[37m${line}\x1b[0m`);
      term.scrollToBottom();
    };
    const onStderr = (evt) => {
      if (terminatedRef.current) return;
      setStatus('connected');
      const line = typeof evt.line === 'string' ? evt.line : String(evt.message || '');
      term.writeln(`\x1b[33m${line}\x1b[0m`);
      term.scrollToBottom();
    };
    const onState = (evt) => {
      const from = evt.from || 'unknown';
      const to = evt.to || 'unknown';
      const reason = evt.reason ? ` (${evt.reason})` : '';
      term.writeln(`\x1b[36;3m[state] ${from} -> ${to}${reason}\x1b[0m`);
      term.scrollToBottom();
      if (to === 'DESTROYED') {
        const why = evt.reason || 'unspecified';
        term.writeln(`\x1b[31m[SESSION TERMINATED - ${why}]\x1b[0m`);
        term.scrollToBottom();
        terminatedRef.current = true;
        setStatus('disconnected');
        client.disconnect();
      }
    };

    const u1 = client.subscribe('stdout_line', onStdout);
    const u2 = client.subscribe('stderr_line', onStderr);
    const u3 = client.subscribe('state_change', onState);
    unsubRef.current = [u1, u2, u3];

    setStatus('connecting');
    client.connect();

    return () => {
      unsubRef.current.forEach((fn) => fn?.());
      unsubRef.current = [];
      client.disconnect();
      window.removeEventListener('resize', onResize);
      term.dispose();
      fitRef.current = null;
      terminalRef.current = null;
    };
  }, [authToken, client, sessionId, wsUrl]);

  return (
    <section
      className="console-panel"
      aria-label="Sandbox console"
      aria-describedby="console-panel-help"
      title="Shows live stdout/stderr and session state transitions."
    >
      <header className="console-panel__header">
        <strong>Live Console</strong>
        <span className="console-panel__status">{status}</span>
      </header>
      <TooltipHint
        id="console-panel-help"
        text="Live console streams stdout and stderr lines plus state changes from the running sandbox."
      />
      <div className="console-panel__body">
        {wsUrl ? (
          <div className="console-panel__terminal" ref={mountRef} />
        ) : (
          <div className="console-panel__fallback">Waiting for stream...</div>
        )}
      </div>
    </section>
  );
}
