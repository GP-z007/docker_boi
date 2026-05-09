# Phase 4 Load Test Results (Staging Mirror Validation)

**Owner:** Agent 18 - Platform Engineer  
**Date:** 2026-05-09  
**Deliverable:** 4.7 - Performance & Load Testing

## Scope and zero-trust prerequisites

Load testing must run only on staging with production-equivalent controls:

- Same network isolation policy (`dasdocker-isolated` + forward-drop rules)
- Same seccomp/AppArmor profiles used by production orchestrator
- Same Vault-backed secret flow and JWT signing/verification path
- Same orchestrator, Redis, event-bus, and monitor topology as production

## k6 workload script delivered

- Script path: `tests/load/k6-load-test.js`
- Simulates 50 virtual users, each with one full lifecycle:
  1. `POST /api/v1/sessions`
  2. Poll `GET /api/v1/sessions/:id` until `RUNNING` (max 120s)
  3. Hold `ws://.../events/:id` open for 60s
  4. Assert transition to `DESTROYED` and compute TTL drift
- Built-in thresholds:
  - `http_req_duration{name:create_session}: p95 < 2000ms`
  - `custom_time_to_running: p95 < 60000ms`
  - `self_destruct_accuracy: p95 < 10000ms` (±10s)
  - `http_req_failed < 1%`

## Execution status

`k6` binary is not installed on this host (`k6 version -> command not found`), so the 50-VU run was not executed in this local environment.

### Staging execution command (authoritative)

```bash
cd dasdocker
BASE_URL="https://staging-orchestrator.example.com/api/v1" \
EVENTS_BASE_URL="https://staging-event-bus.example.com" \
LOADTEST_GITHUB_URL="https://github.com/octocat/Hello-World" \
LOADTEST_TTL_SECONDS=60 \
LOADTEST_AUTH_BEARER="$STAGING_LOADTEST_JWT" \
k6 run tests/load/k6-load-test.js --summary-export docs/performance/phase4-k6-summary.json
```

## Leak verification checklist and local evidence

The following checks are required immediately after load completion:

1. **No orphan containers**
   - Command: `docker ps -a --format '{{.Names}} {{.Status}}'`
   - Local snapshot: no containers currently listed
2. **No orphan load-test volumes**
   - Command: `docker volume ls --format '{{.Name}}'`
   - Local snapshot: existing unrelated volumes present; no load-test-tagged volume naming in repo conventions
3. **No Redis TTL residue**
   - Command: `redis-cli --scan --pattern 'session:ttl:*' | wc -l`
   - Local status: `redis-cli` unavailable on this host; must run on staging runner
4. **Host memory returns to baseline**
   - Command: `vm_stat` (macOS) / `free -m` (Linux)
   - Local baseline captured during prep; compare post-test snapshot in staging
5. **File descriptor closure**
   - Command: `lsof -nP | wc -l`
   - Local snapshot baseline recorded: `15946`

## Peak utilization reporting template (fill from staging run)

| Metric | Target | Measured | Pass/Fail |
|---|---:|---:|---|
| API latency p50 (`POST /sessions`) | Informational | TBD | TBD |
| API latency p95 (`POST /sessions`) | <= 2000 ms | TBD | TBD |
| API latency p99 (`POST /sessions`) | Informational | TBD | TBD |
| Time-to-running p95 | <= 60000 ms | TBD | TBD |
| Self-destruct drift p95 | <= 10000 ms | TBD | TBD |
| Host CPU peak | No sustained saturation | TBD | TBD |
| Host memory peak | No sustained saturation | TBD | TBD |
| Host disk pressure | No contention | TBD | TBD |

## Gate decision

- **Phase 4 performance gate is pending** until the script is executed on staging and this report is populated with measured values and pass/fail evidence.
