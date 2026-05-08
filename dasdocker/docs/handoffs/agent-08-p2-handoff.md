# Agent 08 — Container Lifecycle Manager (Deliverable 2.6 continuation)

## (a) What was built

- **`container-manager.js`** — Applies **Agents 02/03/09** artefacts to every sandbox: hardening matrix (CPU/mem/pids, `CAP_DROP ALL`, tmpfs quotas, **`--read-only`**, **`no-new-privileges`**, **seccomp JSON mount path**, **`apparmor=dasdocker-container`**), deterministic naming via `provisionStorage(sessionId)`.  
  Exported hooks: **`buildLifecycleHooks` → `{ enqueueProvision, runSessionTeardown }`**, granular APIs `provisionContainer`, `startContainer`, `markRunning`, `destroyContainer` (delegates teardown FSM externally).
- **`self-destruct.js`** — Redis keyspace NOTIFY bridge (`dasdocker:sess:ttl:{id}` expiry → `runSessionTeardown(..., redis-ttl-expired)`).
- **`resource-enforcer.js`** — 30s poll of **RUNNING** sandboxes (`docker stats`); **PID cap breaching** triggers immediate teardown (`pids-limit-exceeded`); **>90 % cgroup memory sustained 60 s** logs `resource:warning`.
- **`scripts/watchdog.sh`** — Layer‑2 bearer (`system:watchdog`) reconcile against overdue **created_at + ttl_seconds**.
- **`index.js`** sidecars gated by **`DASDOCKER_KEYSPACE_EXPIRY=1`** (subscriber duplicate) / **`DASDOCKER_RESOURCE_ENFORCER≠0`** (default on for prod parity; harness disables via `./tests/disable-sidecars-env.js`).

## (b) Internal interfaces for downstream automation

| File | Exported surface |
|------|-------------------|
| `dasdocker/services/orchestrator/src/container-manager.js` | `buildLifecycleHooks`, `provisionContainer`, `startContainer`, `markRunning`, `runSessionTeardown`, `destroyContainer` |
| `dasdocker/services/orchestrator/src/self-destruct.js` | `startRedisKeyspaceExpiryWatcher(subscriberDup, commander, lifecycleHooks, log)` ⇒ async shutdown functor |
| `dasdocker/services/orchestrator/src/resource-enforcer.js` | `startResourceEnforcer(redis, lifecycleHooks, log)` ⇒ async shutdown functor |
| `dasdocker/services/orchestrator/scripts/watchdog.sh` | Cron entrypoint — env: `ORCHESTRATOR_URL`, `WATCHDOG_JWT_PATH`, optional `WATCHDOG_GRACE_SECONDS` |

### Runtime env knobs (beyond Agent 05)

| Variable | Meaning |
|---------|---------|
| `DASDOCKER_NETWORK` (*default **`dasdocker-isolated`**)* | Matches Agent 03 bridge name. |
| `SANDBOX_IMAGE` (*default **`alpine:3.19`**)* | Image subject to distro policy. |
| `DASDOCKER_SECCOMP_JSON` | Host path forwarded to **`--security-opt seccomp=`** (fallback repo `dasdocker/config/security/seccomp-dasdocker.json`). |
| `DASDOCKER_APPARMOR_PROFILE` (*default **`dasdocker-container`**)* | Must match Ops-enforced AA template. |
| `DASDOCKER_KEYSPACE_EXPIRY` | Set **`1`** when Redis emits `notify-keyspace-events Ex`. |
| `DASDOCKER_RESOURCE_ENFORCER` | Set **`0`** to disable cgroup polling (developer/test only). |

### Mandatory Docker knobs already merged programmatically

- Network `dasdocker-isolated`
- cgroup caps `512Mi` / `cpus=1.0` / `pids=100`
- tmpfs quotas per Agent 09 (**512 Mi `/workspace`** + **`uid/gid`** 1000, **64 Mi `/tmp`**)
- `CAP_DROP ALL`, `restart=no`, **`SIGKILL`** on destroy paths

*(See Agents 02–03–09 repositories for proofs / threat IDs.)*

## (c) Warnings / open issues

| Item | Severity | Notes |
|------|----------|-------|
| **AppArmor/seccomp portability** | High | Profiles must exist host-side; sandbox creation fails closed—CI should preload fixtures or skip `DOCKER_E2E=1`. |
| **Docker stats PID metric drift** | Medium | Uses `docker stats` PIDs column vs cgroup `pids.current` — reconcile if mismatch observed. |
| **Capacity / RL tests** | Low | Burst RL covered in red-team suite; exhaustion to **503** requires manual `STRESS_CAPACITY` harness (documented omission). |

**Needs Squad A adjudication:** switching default workload UID from **65534** (baseline spec) ↔ **1000** (mandated tmpfs symmetry) once golden images stabilized.
