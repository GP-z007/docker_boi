# Agent 14 — Frontend shell handoff (Phase 2 Deliverable 2.7)

## Branch

`feat/frontend-shell`

## Routing (React Router 6)

| Path | View | Notes |
|------|------|--------|
| `/` | Landing / submit placeholder | Operators start here; provisioning wiring is Agents 15–17. |
| `/session/:id` | Active session workspace | **Only RFC 4122 UUIDs accepted.** Non-opaque IDs (e.g. `/session/123`) `Navigate` to `/error`. |
| `/history` | Session history list | UI-only scaffold; authoritative listing enforced server-side. |
| `/error` | Generic error / terminal state | Boundary destination for invalid IDs and unmatched routes (`*` → `/error`). |

**ZTA / Rule 1:** URL segment is opaque UUID — no sequential integers — and client drops WebSocket payloads where `session_id` ≠ active client context (see `SessionWebSocketClient`).

Layout shell: [`services/frontend/src/App.jsx`](../../services/frontend/src/App.jsx) exports `AppRoutes` for MemoryRouter-driven tests.

## Design system (`services/frontend/src/design-system/`)

| Asset | Responsibility |
|-------|----------------|
| [`tokens.css`](../../services/frontend/src/design-system/tokens.css) | Semantic colour, typography, spacing, radius, skeleton animation, shadows (`--shadow-xs` … `--shadow-lg`) per Phase 1 `ui-ux-spec.md`. |
| `components/*.jsx` | Eight **stub components** exposing documented props only; loading states render **`ds-skeleton`** blocks alongside legible stubs. |

### Stub component library (Agents 15–17 owners per UI spec)

| Component | Primary consumers |
|-----------|-------------------|
| `Button` | Global actions (start session, kill, retries) — Agent 15. |
| `StatusBadge` | Session posture row — Agent 15. |
| `CountdownTimer` | TTL / self-destruct — Agent 15. |
| `ConsolePanel` | xterm host surface — Agents 15 + 17 integration. |
| `ProcessTree` | Telemetry column — Agent 16. |
| `NetworkTimeline` | Egress / denied flows — Agent 16. |
| `ProxiedWebViewPanel` | Sandboxed app preview — Agent 16 (**CSP `frame-src` open item**). |
| `AlertFeed` | IDS / policy stream — Agent 17. |

## Content-Security-Policy

Static hosting header file: [`services/frontend/public/_headers`](../../services/frontend/public/_headers)

```
Content-Security-Policy: default-src 'self'; connect-src 'self' wss://; frame-src 'none'; object-src 'none'
```

**Open item for Agent 16:** `frame-src 'none'` blocks all iframes today. When the proxied sandbox origin exists, narrow `frame-src` to that origin (and document nonces/hashes if required) — do **not** widen to `*`.

## WebSocket client interface (`services/frontend/src/lib/websocket-client.js`)

Export: **`SessionWebSocketClient`**

Constructor options:

| Option | Type | Purpose |
|--------|------|---------|
| `wsUrl` | `string` | Base `ws://` / `wss://` URL **without** auth query. |
| `sessionId` | `string` (UUID) | Active workspace id; used for filtering + first-message auth. |
| `authToken` | `string` | Session-scoped JWT. |
| `authMode` | `'url' \| 'first_message'` | `url` → append `?session_token=<JWT>`; `first_message` → send `{ type: 'auth', token, session_id }` immediately after `onopen`. |
| `minDelayMs` / `maxDelayMs` | `number` (optional) | Exponential backoff window (default `500` → `30_000`). |

Methods:

- **`connect()`** — opens socket, wires handlers, schedules reconnect on abnormal shutdown (unless `disconnect()` called).
- **`disconnect()`** — user teardown; clears timers, closes socket, resets backoff counter.
- **`subscribe(eventType, handler)`** — registers for server `event` **or** `type` field (post JSON parse). Returns **unsubscribe** function.
- **`unsubscribe()`** — clears all listeners.

Inbound JSON contract (initial):

```jsonc
{ "event": "telemetry", "session_id": "<uuid>", /* ... */ }
// or
{ "type": "telemetry", "session_id": "<uuid>", /* ... */ }
```

Handlers receive a shallow copy enriched with `__namespaced_event` = ``${sessionId}:${eventType}`` for downstream correlation.

**ZTA:** If payload includes `session_id` and it mismatches the client’s `sessionId`, the message is ignored.

## Tests

| File | Coverage |
|------|----------|
| `src/__tests__/design-system.test.jsx` | Snapshot coverage for all eight stubs (`loading` where applicable). |
| `src/__tests__/websocket-client.test.js` | URL auth, first-message auth, subscribe dispatch, cross-session drop, exponential backoff + cap. |
| `src/__tests__/routing.test.jsx` | Landing render, `/session/123` → error, UUID happy path. |

Run locally:

```bash
cd dasdocker/services/frontend
npm ci
npm run lint
npm test
```

## Follow-ups (not in this deliverable)

- Wire routes to orchestrator session bootstrap + history API.
- Replace stubs with real implementations + Agent 20 interaction suite.
- Resolve `frame-src` with secured proxy origin (Agent 16).
