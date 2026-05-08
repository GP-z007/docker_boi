# Agent 08 — Phase 3 Container Lifecycle Handoff

**Role:** Container Lifecycle Manager (Stream A Backend).  
**Phase:** 3 — End-to-end provisioning, dependency install, entry execution, Redis TTL self-destruct, watchdog recovery, cgroup limits.  
**Downstream:** Agent 15 (live console WebSocket consumer); Agent 09 (storage controller integration on top of wired lifecycle).

---

## (a) What was built

| Area | Behaviour |
|------|-----------|
| **Flow** | Ingestion supplies `workspaceRoot` + `sessionId` → `resolveIngestPaths` + `detectRuntimeSpec` → `provisionFromDetectedTree` → `provisionContainer` → sequential `docker exec` install → detached entry + polling → destroy on exit or external destroy. |
| **ZTA (Rule 1)** | Docker args built only from operator maps + `provisionStorage(sessionId)` + `dockerResourceCliArgs()` + baseline flags (seccomp, AppArmor profile, `--cap-drop ALL`, `--security-opt no-new-privileges`). User/repo content cannot widen the argv; runtime payload must pass `validateRuntimeSpecSchema`. Integration tests may set `DASDOCKER_INTEGRATION_SKIP_BASELINE=1` / `DASDOCKER_INTEGRATION_SKIP_NETWORK=1` for machines without Agent 02/03 artefacts. |
| **Self-destruct L1** | Redis key `session:ttl:{sessionId}` value `sessionId`, `SET … EX ttl_seconds`. `ensureKeyspaceExpiryNotifications` sets `notify-keyspace-events Ex` when permitted. Subscriber pattern `__keyevent@*__:expired`; on matching key, handler receives cause `ttl-expired`. |
| **Self-destruct L2** | `scripts/watchdog.sh`: authenticated `curl -fsS GET "${DASDOCKER_ORCHESTRATOR_URL}/api/v1/sessions"` pipes JSON into `scripts/watchdog-runner.cjs`. Runner requires `DASDOCKER_WATCHDOG_JWT`; for each overdue, non-terminal row it issues DELETE via Node `http`/`https` (Bearer, `Connection: close`). Cron: **60s**. |
| **Tests** | Under `dasdocker/tests/lifecycle/test_*.js`. **Docker** suites require `DASDOCKER_LIFECYCLE_INTEGRATION=1` and local Docker. **Redis TTL** requires `DASDOCKER_REDIS_TESTS=1` and `DASDOCKER_TEST_REDIS_URL` (default `redis://127.0.0.1:6379`). TTL duration: `DASDOCKER_TTL_TEST_SECONDS` (default **8** for speed; set **60** for ±5s acceptance). Watchdog: `VT-RED-S14` exercises runner + mock HTTP (subscriber process kill is operations-verified; L2 still deletes when API reports overdue rows). |

---

## (b) WebSocket / event bus — state transitions (Agent 15)

**Transport (target contract):** live console subscribes to **`ws://{host}/events/{sessionId}`** (or `wss://` behind gateway). The orchestrator core emits the same JSON on an in-process **`SessionEventBus`** (`SessionEventBus.emitStateChange`); the HTTP/WebSocket gateway should forward each payload unchanged to room `sessionId`.

**Envelope (every transition):**

```json
{
  "type": "state_change",
  "session_id": "<string>",
  "from": "<prior FSM label or logical prior>",
  "to": "<new FSM label>",
  "timestamp": "<ISO-8601>",
  "reason": "<short machine-oriented reason; may be empty string>"
}
```

**Ordered transitions (happy path, non-empty `install_commands`):**

| # | `from` | `to` | Typical `reason` |
|---|--------|------|------------------|
| 1 | `QUEUED` | `PROVISIONING` | `docker_provision` |
| 2 | `PROVISIONING` | `INSTALLING_DEPS` | `exec_install_chain` |
| 3 | `INSTALLING_DEPS` | `RUNNING` | `deps_ok` |
| 4 | `RUNNING` | `DESTROYING` | `entry_exited` / `container_stopped` / `ttl-expired` / other destroy reason |
| 5 | `DESTROYING` | `DESTROYED` | same as step 4 |

**Skip install (empty `install_commands`):** `PROVISIONING` → `RUNNING` with `skip_install_empty`, then entry polling as above.

**Failure during install:** `INSTALLING_DEPS` → `FAILED` with `install_command_rejected`, `install_exit_<code>`, or transition from `PROVISIONING` → `FAILED` on Docker create/start/cp (reason carries stderr slice / `docker_cp_failed`).

**Hard destroy (`destroyContainer`, e.g. TTL/watchdog):** emits `RUNNING` → `DESTROYING` → `DESTROYED` with the supplied `reason` (e.g. `ttl-expired`). *Note:* if the session FSM is not actually in `RUNNING` when destroy is invoked, the gateway may reconcile `from` with authoritative session state from the control plane.

Log lines are not WebSocket events; install/output streaming is via `logSink` callback (wire to Agent 15 log channel separately if required).

---

## (c) Key files

| Path | Purpose |
|------|---------|
| `dasdocker/services/orchestrator/src/lifecycle.js` | Registry + `provisionFromDetectedTree` + TTL hook attachment API |
| `dasdocker/services/orchestrator/src/container-manager.js` | Provision, exec install chain, entry + poll, destroy, `SessionEventBus` |
| `dasdocker/services/orchestrator/src/self-destruct.js` | Redis TTL + subscriber |
| `dasdocker/services/orchestrator/src/resource-enforcer.js` | `--pids-limit`, memory limits (tests: `DASDOCKER_TEST_*` overrides) |
| `dasdocker/services/orchestrator/scripts/watchdog.sh` | Cron-friendly GET + runner |
| `dasdocker/services/orchestrator/scripts/watchdog-runner.cjs` | Parses session JSON, DELETE overdue |
| `dasdocker/tests/lifecycle/lifecycle_helpers.js` | Shared `dockerAvailable()` (not a test file — lifecycle glob is `test_*.js`) |

---

## (d) Warnings / follow-ups

| Item | Severity | Note |
|------|----------|------|
| `destroyContainer` event `from` | Low | Often `RUNNING`; may not match rare edge states until control plane passes `fromState`. |
| Redis `CONFIG` | Medium | Managed Redis may block `CONFIG SET`; watchdog L2 mandatory in prod. |
| WebSocket gateway | Medium | Implement fan-out from `stateBus` → `ws …/events/{sessionId}` in API service. |

---

## Rule 3 — Git pointers

Feature branch: **`feat/container-lifecycle-complete`**. Conventional commit example in squad runbook; stage files individually per manifest.
