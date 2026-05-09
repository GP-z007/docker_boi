# Red Team Load Test (Deliverable 4.7)

**Campaign ID:** RT-LT  
**Date:** 2026-05-09  
**Objective:** 50 concurrent session stress against orchestrator and teardown system.

## Execution status

- **Not fully executable in this environment** due missing load tools and unavailable full runtime deployment:
  - `k6`: not installed
  - `locust`: not installed
  - full orchestrator + session fabric not running for 50-session benchmark

## What was executed

| Test ID | Attempt | Command | Result |
|---|---|---|---|
| RT-LT-001 | k6 availability | `k6 version` | `command not found` |
| RT-LT-002 | locust availability | `locust --version` | `command not found` |
| RT-LT-003 | watchdog recovery under overdue condition | `node --test tests/lifecycle/test_watchdog_recovery.js` | pass |
| RT-LT-004 | lifecycle integration probe | `node --test tests/lifecycle/test_full_pipeline.js` | skipped in local env |

## Required load-run playbook (pending)

1. Provision full stack (orchestrator, redis, event-bus, network policies).
2. Install `k6` or `locust` on runner.
3. Execute:
   - 50 concurrent `POST /api/v1/sessions`
   - track time-to-running per session
   - validate teardown timing against TTL under load
4. Capture:
   - p95 API latency target <= 2s
   - time-to-running target <= 60s
   - self-destruct drift target within +/-10s
5. Archive metrics + logs in this report revision.

## Security note

- Without this load run, leak behavior (orphan containers/keys/fds) cannot be signed off.
