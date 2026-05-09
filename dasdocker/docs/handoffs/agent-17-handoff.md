# Agent 17 — Telemetry Dashboard Handoff (Phase 3)

**Branch:** `feat/telemetry-dashboard`  
**Deliverable:** 3C.3 real-time telemetry dashboard + session workspace assembly.

## Component layout API (for Agent 14 assembly)

Page:
- `services/frontend/src/pages/SessionWorkspace.jsx`

Props:
- `sessionId` (UUID, route-provided)

Layout composition:
- Header bar: `SessionControlPanel`
- Top split:
  - left: `ConsolePanel`
  - right stack: `ProcessTreePanel`, `NetworkTimelinePanel`, `AlertFeedPanel`
- Bottom: `ProxiedWebViewPanel`

All stream-driven components use `SessionWebSocketClient` with:
- `sessionId`
- `wsUrl` (`ws(s)://.../events/{sessionId}`)
- `authToken` (session-scoped JWT)

## Built components

### `ProcessTreePanel`
Path: `services/frontend/src/components/ProcessTreePanel/ProcessTreePanel.jsx`

- Consumes `process_event`, `alert_event`, `state_change`
- Builds in-memory `pid -> {comm,args,ppid,children}`
- Renders nested tree with expand/collapse affordance
- Suspicious process flagging via alert evidence comm match (`⚠️`)
- New-process flash marker (500ms)
- Clears all nodes on `to=DESTROYED`

### `NetworkTimelinePanel`
Path: `services/frontend/src/components/NetworkTimelinePanel/NetworkTimelinePanel.jsx`

- Consumes `network_event`, `state_change`
- Chronological rows:
  - `[time] [event_type] -> [dst_ip]:[dst_port] [proto]`
- Colors:
  - DNS query blue
  - HTTP request green
  - suspicious ports (4444/1337/31337) red
- Keeps latest 200 rows; tracks total connection counter
- Clears timeline on `to=DESTROYED`

### `AlertFeedPanel`
Path: `services/frontend/src/components/AlertFeedPanel/AlertFeedPanel.jsx`

- Consumes `alert_event`, `state_change`
- Persistent per-session alert cards (until destroyed)
- Severity badges:
  - CRITICAL red pulse
  - HIGH orange
  - WARN yellow
  - INFO grey
- CRITICAL side effects:
  - Browser Notification API (if permission granted)
  - Optional audio tone (Web Audio; configurable by `enableAudio`)
- Clears alerts on `to=DESTROYED`

### `SessionControlPanel`
Path: `services/frontend/src/components/SessionControlPanel/SessionControlPanel.jsx`

- Countdown `HH:MM:SS` from `expiresAt`
- Timer turns red when `< 60s`
- Status label for lifecycle state
- Kill flow:
  - confirmation dialog
  - `DELETE /api/v1/sessions/:id` with `Authorization: Bearer <session-jwt>`

## Security / ZTA

- Dashboard components only render data from session-scoped websocket client filtering.
- Session JWT payload is the source of session scoping in `SessionWorkspace`; URL alone is not trusted.
- No cross-session render path or persistence layer introduced.

## Tests delivered

- `ProcessTreePanel/__tests__/ProcessTreePanel.test.jsx`
  - parent-child tree rendering
  - suspicious process warning icon
  - clear on DESTROYED
- `NetworkTimelinePanel/__tests__/NetworkTimelinePanel.test.jsx`
  - port 4444 rendered red
- `AlertFeedPanel/__tests__/AlertFeedPanel.test.jsx`
  - CRITICAL pulse badge + Notification API call
- `SessionControlPanel/__tests__/SessionControlPanel.test.jsx`
  - red timer at T-30s
  - kill confirmation + authenticated DELETE call
