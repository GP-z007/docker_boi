# Agent 10 / 13 - Phase 3 Observability Backbone Handoff

**Branch:** `feat/observability-pipeline`  
**Scope:** WebSocket event bus + Fluent Bit/Loki pipeline + alert rule engine.

## 1) WebSocket endpoint and auth protocol

- **Endpoint:** `wss://{host}/events/{session_id}`
- **Transport auth:** `Authorization: Bearer <session-scoped JWT>`
- **JWT requirements:**
  - `alg` must be `RS256`
  - signature must verify against configured public key
  - `session_id` (or `sid`) claim must match path `{session_id}`
  - optional audience guard: `aud=obs:subscribe`
- **Failure semantics:**
  - invalid/malformed JWT -> close code `4001`
  - valid JWT but session claim mismatch -> close code `4003`

## 2) Session scoping and lifecycle

- Each socket is bound to exactly one `session_id` room.
- Fan-out sends only to subscribers of that exact room.
- Redis stream source per session: `dasdocker:events:{session_id}`.
- When a `state_change` with `to=DESTROYED` is observed:
  - gateway emits final `session_closed` event
  - all room sockets close cleanly (`1000`).

## 3) Event schema contract

The gateway forwards JSON unchanged to frontend subscribers, preserving `type` and `session_id`.

Supported event `type` values:

- `process_event`
- `file_event`
- `network_event`
- `alert_event`
- `state_change`
- `session_closed` (gateway terminal event)

Representative envelopes:

```json
{ "type":"process_event","session_id":"<id>","timestamp":"...","event_type":"exec","pid":123,"ppid":1,"comm":"node","args":"npm start","uid":1000 }
```

```json
{ "type":"alert_event","session_id":"<id>","timestamp":"...","severity":"critical","rule_id":"ALERT-002","description":"Potential reverse shell","evidence":{"matched_pattern":"process:(nc|ncat)" } }
```

```json
{ "type":"state_change","session_id":"<id>","from":"RUNNING","to":"DESTROYED","timestamp":"...","reason":"ttl-expired" }
```

```json
{ "type":"session_closed","session_id":"<id>","timestamp":"...","reason":"session_destroyed" }
```

## 4) Fluent Bit + Loki pipeline (Agent 13)

- Config: `config/observability/fluent-bit.conf`
- Input: Docker logs from `/var/lib/docker/containers/*/*.log`
- Labels: `session_id`, `event_source`, `severity`
- Redaction policy before Loki persistence:
  - API keys
  - JWT-like tokens
  - `KEY=VALUE` style env assignments (value removed)
- Runtime posture: Fluent Bit configured with `User fluentbit` (non-root intent).

## 5) Alert rule engine summary

- Rules file: `config/observability/alert-rules.yaml`
- Total rules: **12** (`ALERT-001`..`ALERT-012`)
- Includes mandated detections (curl/wget, ncat, base64 python exec, C2 ports, fork-rate, onion/i2p, cron persistence) plus STRIDE-derived additions (security-control disablement, account manipulation, credential path access, cloud metadata probing).

## 6) Tests delivered

- Event bus:
  - `tests/event-bus/test_websocket_auth.js`
  - `tests/event-bus/test_session_isolation.js`
  - `tests/event-bus/test_fanout.js`
- Observability/alerting:
  - `tests/observability/test_alert_rules.js`
  - `tests/observability/test_log_redaction.js`
  - `tests/observability/test_alert_cross_session.js`
