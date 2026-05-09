# Agent 15 — Live Console Handoff (Phase 3)

**Branch:** `feat/live-console`  
**Deliverable:** 3C.1 read-only browser live console (xterm.js).

## Component API (for Agent 17 dashboard integration)

Path:
- `services/frontend/src/components/ConsolePanel/ConsolePanel.jsx`
- `services/frontend/src/components/ConsolePanel/ConsolePanel.css`

Props:
- `sessionId: string` (required for websocket session scoping)
- `wsUrl: string` (base event-bus endpoint, e.g. `wss://host/events/{sessionId}`)
- `authToken: string` (session-scoped JWT)
- `authMode?: 'url' | 'first_message'` (defaults to `first_message`)
- `createClient?: ({ wsUrl, sessionId, authToken, authMode }) => SessionWebSocketClient` (test/DI hook)

## Stream handling contract

Uses Agent 14 `SessionWebSocketClient` and subscribes to:
- `stdout_line`
- `stderr_line`
- `state_change`

Rendering:
- `stdout_line` -> white terminal text
- `stderr_line` -> yellow terminal text
- `state_change` -> cyan italic status line
- On `to=DESTROYED`:
  - prints red `[SESSION TERMINATED - {reason}]`
  - disconnects websocket client
  - transitions status to disconnected

## ZTA / read-only guarantees

- `xterm` configured with:
  - `disableStdin: true`
  - `cursorBlink: false`
  - `scrollback: 5000`
- `attachCustomKeyEventHandler(() => false)` blocks terminal key handling.
- No code path sends keyboard/input payloads to backend.

## Test coverage

`services/frontend/src/components/ConsolePanel/__tests__/ConsolePanel.test.jsx` verifies:
- graceful render without websocket config
- stdout/stderr color behavior
- ANSI escape handling path
- no backend send on keyboard attempts
- scrollback cap set to 5000
- reconnect-safe event rendering path
- DESTROYED termination line + client disconnect
