# dasDocker Orchestrator — Session State Machine (Phase 1 Blueprint)

**Document type:** Architecture / contract (no implementation).  
**Consumers:** Agent 05 (Orchestration), Agent 08 (implementation), Agents 15–17 (integration).  
**Rules:** ZTA (explicit states and authorised transitions), full-spectrum test IDs per transition and API (see companion `orchestrator-api-contract.md`).

---

## 1. State enumeration

All sessions exist in **exactly one** state at any time. There are **no undefined states**: any persistence read that yields an unknown value MUST be treated as `FAILED` after audit log emission (implementation detail; test `INT-PERS-001`, `RED-PERS-001`).

| State | Description | Entry condition | Max duration |
|-------|-------------|-----------------|--------------|
| **QUEUED** | Session accepted by the orchestrator and awaiting a worker slot; no container ID yet (or ID reserved but not created—see meta contract). | Successful validation of `POST /api/v1/sessions` (authZ pass + policy pass) and record persisted to Redis. | **60 s** |
| **PROVISIONING** | Worker holds the session; container create/start is in progress (image pull, create, start, attach network). | Worker claims session from queue **and** atomic transition `QUEUED → PROVISIONING` succeeds. | **120 s** |
| **INSTALLING_DEPS** | Dependency install phase (declared install commands) running inside the sandbox before the user entrypoint is considered “live”. | Container running **and** orchestrator/worker reports successful handoff to install phase (`PROVISIONING → INSTALLING_DEPS`). | **300 s** |
| **RUNNING** | Entrypoint process is live; operator streams and telemetry are allowed per policy. | Successful completion of install phase (`INSTALLING_DEPS → RUNNING`). If a session has **zero** install commands, transition is `PROVISIONING → RUNNING` (skipped state—see §3). | **User-defined TTL** (**60–3600 s**) from `running_deadline` in session meta |
| **DESTROYING** | SIGKILL / stop path engaged; volumes/tmpfs teardown and Docker resource removal in progress. | TTL expiry **or** authenticated destroy request **or** unrecoverable error path that requires tear-down **or** worker-reported hard failure during provision/install. | **30 s** |
| **DESTROYED** | Container gone; tmpfs/session storage wiped; session closed; no further mutations. | Successful completion of destroy pipeline (`DESTROYING → DESTROYED`). | Terminal (**∞** retained as record per retention policy) |
| **FAILED** | Unrecoverable error; session will not run; resource state MUST be consistent (no live container; any partial resources cleaned or marked for GC). | Admission deny, invalid transition attempt, persistent layer corruption, or worker error that cannot reach `DESTROYED` safely (document reason in meta). | Terminal |

**Authorisation note (ZTA):** Only the **orchestrator** (and explicitly authenticated **worker** callbacks defined in the API contract) may advance states. Clients may request **destroy** and **create**; they MUST NOT directly set state.

---

## 2. Transition matrix (all permutations)

**States (order):** `QUEUED` (Q), `PROVISIONING` (P), `INSTALLING_DEPS` (I), `RUNNING` (R), `DESTROYING` (D), `DESTROYED` (X), `FAILED` (F).

**Valid transition:** `true` if the orchestrator may perform this edge as part of normal or error handling.  
**Invalid:** callers MUST receive a documented error (`InvalidTransitionError` or `TerminalStateError`) and the system MUST NOT partially apply illegal edges.

**Error on invalid:** Unless noted, invalid edges from non-terminal states raise **`InvalidTransitionError`** (`code: invalid_transition`, HTTP **409** on client-driven transition endpoints).  
From terminal states, any transition attempt raises **`TerminalStateError`** (`code: terminal_state`, HTTP **409**).

| From \ To | Q | P | I | R | D | X | F |
|-----------|---|---|---|---|---|---|---|
| **Q** | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ |
| **P** | ❌ | ❌ | ✅ | ✅¹ | ✅ | ❌ | ✅ |
| **I** | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |
| **R** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| **D** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **X** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **F** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

¹ **`PROVISIONING → RUNNING`:** Valid **only** when `install_commands` is empty (install phase skipped). Otherwise use `PROVISIONING → INSTALLING_DEPS → RUNNING`.

### 2.1 Row-by-row triggers and invalid-edge errors

| From | To | Valid? | Authorised trigger (who / what) | Error on invalid |
|------|-----|--------|----------------------------------|------------------|
| Q | Q | ❌ | — | `InvalidTransitionError` |
| Q | P | ✅ | Worker slot available; atomic dequeue + claim (`worker_id` set). | — |
| Q | I | ❌ | — | `InvalidTransitionError` |
| Q | R | ❌ | — | `InvalidTransitionError` |
| Q | D | ✅ | Client `DELETE /api/v1/sessions/{id}` **or** operator revoke **or** global shutdown (authZ scoped). | — |
| Q | X | ❌ | — | `InvalidTransitionError` (must pass through `DESTROYING` if any resources exist; if none, `Q→D→X` MAY collapse internally but observability MUST still emit `DESTROYING`—implementation choice; test `INT-LIFE-012`) |
| Q | F | ✅ | Pre-scan rejection, policy deny, malformed request after accept, **QUEUED timeout**, Redis corruption on admit. | — |
| P | Q | ❌ | — | `InvalidTransitionError` (no “un-provision” to queue) |
| P | P | ❌ | — | `InvalidTransitionError` |
| P | I | ✅ | Container started; install phase required. | — |
| P | R | ✅ | Container started; **no** install commands. | — |
| P | D | ✅ | Client destroy; provision timeout; worker-initiated abort (authenticated). | — |
| P | X | ❌ | — | `InvalidTransitionError` |
| P | F | ✅ | Container create/start failure, network attach failure, image policy violation. | — |
| I | Q | ❌ | — | `InvalidTransitionError` |
| I | P | ❌ | — | `InvalidTransitionError` |
| I | I | ❌ | — | `InvalidTransitionError` |
| I | R | ✅ | Install exit code 0 and policy checks pass. | — |
| I | D | ✅ | Client destroy; **INSTALLING_DEPS timeout**; install failure leading to tear-down path. | — |
| I | X | ❌ | — | `InvalidTransitionError` |
| I | F | ✅ | Install non-zero exit, critical hook failure **when** policy chooses fail-fast without full destroy (rare); normally prefer `I→D→X` or `I→D→F` (see §4). | — |
| R | Q | ❌ | — | `InvalidTransitionError: RUNNING→QUEUED` |
| R | P | ❌ | — | `InvalidTransitionError` |
| R | I | ❌ | — | `InvalidTransitionError` |
| R | R | ❌ | — | `InvalidTransitionError` (heartbeats MUST NOT duplicate state) |
| R | D | ✅ | TTL soft deadline reached; SIGKILL path; client destroy; runtime guard failure. | — |
| R | X | ❌ | — | `InvalidTransitionError` |
| R | F | ✅ | Unrecoverable runtime error where destroy cannot complete in time → record `FAILED` after best-effort `DESTROYING` (see §4). | — |
| D | Q | ❌ | — | `InvalidTransitionError` |
| D | P | ❌ | — | `InvalidTransitionError` |
| D | I | ❌ | — | `InvalidTransitionError` |
| D | R | ❌ | — | `InvalidTransitionError` |
| D | D | ❌ | — | `InvalidTransitionError` |
| D | X | ✅ | Container removed, tmpfs cleared, keys archived per policy. | — |
| D | F | ✅ | Destroy timeout or irrecoverable Docker error after max cleanup attempts. | — |
| X | * | ❌ | — | `TerminalStateError` |
| F | * | ❌ | — | `TerminalStateError` |

---

## 3. Skipped `INSTALLING_DEPS` (explicit, not undefined)

If `install_commands.length === 0`, the machine **skips** `INSTALLING_DEPS`:

- Allowed path: `PROVISIONING → RUNNING`.
- **Forbidden:** `PROVISIONING → INSTALLING_DEPS` when there is no work (would be undefined); workers MUST NOT emit this edge (test `UNIT-SM-010`, `RED-SM-002`).

---

## 4. Failure mode analysis (timeouts, cleanup, terminal state)

| State | On timeout of max duration | Cleanup | Terminal / next |
|-------|----------------------------|---------|-----------------|
| **QUEUED** | No container; session never started. | Delete queue entry, remove from `sessions:active` if present, clear `session:{id}:*` keys per retention. | **`FAILED`** (reason `queue_timeout`) preferred; **`DESTROYING→DESTROYED`** only if resources were partially allocated (implementation MUST document which). |
| **PROVISIONING** | Stop partial container if create partially succeeded; detach networks; delete container. | Worker/orchestrator best-effort `docker rm -f` equivalent; clear assignments. | **`DESTROYING` → `DESTROYED`** on success; **`FAILED`** if destroy impossible (reason `provision_timeout`). |
| **INSTALLING_DEPS** | Kill install process tree; escalate to destroy path. | Same as destroying from mid-life: SIGKILL session cgroup/container per policy. | **`DESTROYING` → `DESTROYED`**; **`FAILED`** if cleanup exhausts retries. |
| **RUNNING** | TTL watchdog triggers destroy (not “failed” unless cleanup fails). | Stop container, wipe tmpfs, purge proxy mappings. | **`DESTROYING` → `DESTROYED`**; **`FAILED`** if teardown exhausts **`DESTROYING`** timeout. |
| **DESTROYING** | Retry bounded N times with backoff; escalate to fenced GC job (out of band). | Mark session `gc_required` in meta; alert. | **`FAILED`** with `destroy_timeout` **or** eventual consistency via GC (Squad A review for dual-write). |
| **DESTROYED** | N/A (terminal). | N/A | **`DESTROYED`** |
| **FAILED** | N/A (terminal). | Async GC MAY continue for orphans. | **`FAILED`** |

---

## 5. State persistence — Redis key schema

**Justification (least privilege):** Keys are namespaced under `session:` and `sessions:` so Redis ACLs can use key patterns; no secret values in key names. TTL keys enable keyspace notifications without exposing wall-clock to workers.

| Key | Type | Value | TTL / expiry | Justification |
|-----|------|-------|--------------|---------------|
| `session:{id}:state` | String | One of the seven state enums (uppercase). | No automatic TTL (state is authoritative until terminal + retention). | Minimal read path for workers; ACL `+@read +GET` on `session:*` pattern for workers. |
| `session:{id}:meta` | String (JSON) | See **Meta JSON** below. | Optional TTL mirrors session retention after terminal. | Single-field JSON avoids Redis `JSON.SET` dependency in minimal deployments. |
| `session:{id}:ttl` | String or empty marker | **`1`** (presence) or timestamp string—**implementation MUST fix one representation in Phase 2**; notify uses keyspace. | **EX** = seconds until hard kill from “now” when entering `RUNNING`, reset on extend if policy allows. | Enables `notify-keyspace-events Ex` for self-destruct without polling. |
| `sessions:active` | Sorted set | Member: `session_id`; Score: **unix epoch seconds** of `expires_at` (hard kill / queue deadline as applicable). | ZSet members removed on terminal. | Cheap “what is running / expiring soon” for observability & reaper. |

**Meta JSON (normative keys):**

- `created_at` (RFC3339 string)  
- `expires_at` (RFC3339 string) — wall-clock hard stop for `RUNNING` / legal hold  
- `source_type` (`github` \| `zip` \| enum from API)  
- `container_id` (nullable string)  
- `worker_id` (nullable string) — **permission:** only orchestrator/worker roles may set  
- `correlation_id` (string) — trace id  
- `failure_reason` (nullable string) — set on `FAILED`  
- `policy_version` (string) — for replay/debug  

**Auxiliary keys (optional but recommended for Agent 08 — same ACL namespace):**

| Key | Type | Purpose | Justification |
|-----|------|---------|---------------|
| `orchestrator:queue:pending` | List or Stream | FIFO of `session_id` waiting for workers. | Backpressure; deny-by-default workers cannot pop without auth. |
| `session:{id}:lock` | String | Short-lived worker lock (`SET NX EX`). | Prevents split-brain transitions. |

---

## 6. Full-spectrum test specifications (state machine)

Each row is a **Phase 2** test obligation. IDs are stable across agents.

### 6.1 Unit tests (isolated logic)

| ID | Transition / rule | Assertion |
|----|-------------------|-----------|
| UNIT-SM-001 | `Q→P` | Only if dequeue atomic succeeds. |
| UNIT-SM-002 | `Q→F` | Pre-scan flags map to terminal meta. |
| UNIT-SM-003 | `P→I` vs `P→R` | Branch on `install_commands` empty. |
| UNIT-SM-004 | `R→Q` | Raises `InvalidTransitionError`. |
| UNIT-SM-005 | `X→R` | Raises `TerminalStateError`. |
| UNIT-SM-006 | `D→D` | Raises `InvalidTransitionError`. |
| UNIT-SM-007 | Terminal states | No outbound degree. |
| UNIT-SM-008 | Unknown persisted state | Normalise to `FAILED` + audit (pure function). |
| UNIT-SM-009 | Score ordering | `sessions:active` score == `expires_at` epoch. |
| UNIT-SM-010 | Skip install | `install_commands` empty forbids `P→I`. |

### 6.2 Integration tests (real Redis / Docker contract)

| ID | Scenario | Assertion |
|----|----------|-----------|
| INT-LIFE-001 | Happy path ZIP | `Q→P→I→R→D→X` within timeouts. |
| INT-LIFE-002 | Happy path no install | `Q→P→R→D→X`. |
| INT-LIFE-003 | QUEUED timeout | Terminal `FAILED` or documented `D→X` collapse with events. |
| INT-LIFE-004 | PROVISIONING timeout | Destroy path cleans container. |
| INT-LIFE-005 | INSTALL timeout | Kill + destroy. |
| INT-LIFE-006 | RUNNING TTL | Keyspace / zset drives destroy. |
| INT-LIFE-007 | Client destroy from each non-terminal | Reaches `DESTROYED`. |
| INT-LIFE-008 | Redis down on transition | No partial state without rollback plan. |
| INT-LIFE-009 | Worker auth failure | No state change. |
| INT-LIFE-010 | Concurrent workers | Lock prevents double `Q→P`. |
| INT-LIFE-011 | DESTROYING timeout | `FAILED` or GC flag set per §4. |
| INT-LIFE-012 | Collapsed destroy from `QUEUED` | Observability still shows `DESTROYING` if required by policy. |

### 6.3 Red-team / negative tests (adversarial)

| ID | Attack / abuse | Expected |
|----|----------------|----------|
| RED-SM-001 | Forged worker callback without token | 401 + no state change. |
| RED-SM-002 | Worker tries `P→I` with empty installs | Rejected; alert. |
| RED-SM-003 | Client tries to roll back `R→P` | 409 `InvalidTransitionError`. |
| RED-SM-004 | Session ID guessing | Rate limit + 404/403 per ZTA. |
| RED-SM-005 | Redis key injection in `id` | Normalised UUID only; reject. |
| RED-SM-006 | Race: destroy + TTL | Exactly one terminal outcome; no duplicate containers. |

---

## 7. Related documents

- `docs/architecture/orchestrator-api-contract.md` — OpenAPI 3.x, auth, rate limits, endpoint-level tests.  
- `docs/security/STRIDE-threat-model.md` — ZTA controls and verification mapping.

---

*Orchestration Architect — Agent 05 · Phase 1 · Dispatch 05 of 08*
