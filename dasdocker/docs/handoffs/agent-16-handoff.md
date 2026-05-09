# Agent 16 — Proxied Web View Handoff (Phase 3)

**Branch:** `feat/proxied-web-view`  
**Deliverable:** 3C.2 sandboxed web preview via backend proxy.

## Proxy endpoint pattern

- Backend route: `GET /api/v1/sessions/:id/proxy/*`
- Typical iframe URL used by frontend:
  - `/api/v1/sessions/{sessionId}/proxy/`

Authorization/security requirements in proxy:
- Requires Bearer JWT with `session:read` scope.
- If JWT has `session_id`, it must match `:id`.
- Session must be `RUNNING`.
- Route disabled when no `app_port`/container IP is known.

Response hardening:
- Strips upstream:
  - `Set-Cookie`
  - `X-Frame-Options`
  - upstream `Content-Security-Policy`
- Adds:
  - `Content-Security-Policy: sandbox allow-scripts allow-forms allow-same-origin; default-src 'self'`
  - `X-Content-Type-Options: nosniff`

## Frontend iframe sandbox contract (for Agent 17)

Component:
- `services/frontend/src/components/ProxiedWebViewPanel/ProxiedWebViewPanel.jsx`

Iframe attributes:
- `sandbox="allow-scripts allow-forms allow-same-origin"`
- `referrerpolicy="no-referrer"`
- no `name` and no `id` attributes
- `src=/api/v1/sessions/{sessionId}/proxy/`

Render gating:
- Shows placeholder `Web view not available` unless:
  - session state is `RUNNING`, and
  - websocket `port_detected` event was received for this session.

Websocket events consumed:
- `port_detected` (`{session_id, port, protocol}`)
- `state_change` (DESTROYED/FAILED -> hides iframe)

## CSP update

Parent page CSP updated in `services/frontend/public/_headers`:
- `frame-src` changed from `'none'` to `'self'` for same-origin proxy embedding.

## Tests delivered

- Frontend:
  - `services/frontend/src/components/ProxiedWebViewPanel/__tests__/ProxiedWebViewPanel.test.jsx`
    - sandbox attribute checks
    - no allow-top-navigation
    - placeholder state checks
    - DESTROYED transition fallback
- Orchestrator:
  - `tests/orchestrator/test_proxy_route.js`
    - header stripping assertions (`Set-Cookie`, `X-Frame-Options`, upstream CSP)
    - auth/scope rejection path
