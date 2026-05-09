# Agent 14 — Phase 3 Frontend Integration Handoff

**Branch:** `feat/frontend-integration`  
**Deliverable:** 3C.4 submit/provisioning/history integration + global error boundary + smoke coverage.

## Routes and pages now functional

- `/` -> `SubmitPage`
  - GitHub URL validation with backend-matching allowlist regex
  - ZIP upload (`.zip`, max 256MB)
  - TTL selector (`60, 300, 600, 1800, 3600`)
  - POST `/api/v1/sessions`
  - error handling for `400`, `429`, `503`
  - submit disabled until valid URL or ZIP selected
- `/session/:id/provisioning` -> `SessionProvisioningView`
  - state-aware progress text for `QUEUED/PROVISIONING/INSTALLING_DEPS`
  - live narrow `ConsolePanel` stream
  - auto-transition to `/session/:id` on `RUNNING` state event
- `/session/:id` -> `SessionWorkspace` (Agents 15/16/17 composition)
- `/history` -> `SessionHistoryPage` table + destroyed forensic summary links
- `/error` -> generic safe error screen

UUID/ZTA guard:
- non-UUID IDs still redirect to `/error`
- session JWT is memory-only (`window.__DASDOCKER_SESSION_JWT`), no local/session storage writes

## Integrated component composition

`SessionWorkspace` now assembles:
- `SessionControlPanel` (header)
- `ConsolePanel` (top-left)
- `ProcessTreePanel`, `NetworkTimelinePanel`, `AlertFeedPanel` (top-right stack)
- `ProxiedWebViewPanel` (bottom)

## Global error boundary

Added:
- `services/frontend/src/components/ErrorBoundary/ErrorBoundary.jsx`
- wrapped app in `main.jsx`

Behavior:
- catches unhandled React render/lifecycle errors
- shows user-safe fallback
- posts error metadata to `/api/v1/frontend-errors`
- does not expose internals in production UI

## Test coverage added

- `pages/__tests__/SubmitPage.test.jsx`
- `pages/__tests__/SessionProvisioningView.test.jsx`
- `__tests__/e2e-smoke.test.jsx` (frontend smoke skeleton for submit-to-session flow)

Existing panel tests from Agents 15/16/17 remain passing and integrated.

## Browser/test compatibility notes for Agent 20

- `xterm` requires jsdom shims for `matchMedia` and canvas context in unit tests (`src/__tests__/setup.js`).
- React Router v6 emits v7 future-flag warnings in tests (non-blocking).
- Notification API and AudioContext paths are test-mocked in component tests; real-browser verification still required on Chromium + Firefox + Safari.
