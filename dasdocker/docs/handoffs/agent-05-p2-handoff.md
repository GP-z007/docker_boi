# Agent 05 — Orchestration Architect (Deliverable 2.6 subset)

## (a) What was built

- **Fastify** HTTP control plane mounted at **`/api/v1`**, JWT **RS256** enforcement, centralized schema validation (`POST /sessions`), Redis-backed lifecycle state (`state-machine.js`), SSE scaffold for **`GET /sessions/:id/logs`**.
- **Operational guardrails**: per-IP RL on session creation (**5**/min ⇒ **429**), global capacity gate (**non-DESTROYED ≤ 50** ⇒ **503** via atomic Redis counter **`dasdocker:sessions:active`**), structured auth reject audit hook (caller supplies logger — **never** logs raw tokens).
- **Tests** under `dasdocker/services/orchestrator/tests/**` targeting auth, JWT abuse classes, validators, deterministic state transitions (needs live Redis optional).
- **`Dockerfile`** (multi-stage Slim → Distroless) with pinned digests (`node` builder + `gcr.io/distroless/nodejs20-debian12`), non-root **`nonroot`** user — **final image has no shell**.

## (b) Exact internal APIs, ports, files, env

| Endpoint | Scope / Auth | Behaviour |
|-----------|---------------|-----------|
| `GET /api/v1/health` | *none* | Returns `{ version, uptime_seconds, active_sessions }`; `active_sessions` reads **`dasdocker:sessions:active`**. |
| `POST /api/v1/sessions` | `session:create` | Validates payload; allocates capacity slot; persists **QUEUED** row + TTL key `dasdocker:sess:ttl:{uuid}`; queues Docker side via Agent 08 hook `enqueueProvision` when wired. |
| `GET /api/v1/sessions/:id` | `session:read` + JWT `sess` binding | **`403`** if Redis state **`DESTROYED`** (replay class). |
| `DELETE /api/v1/sessions/:id` | operator `session:destroy` (`sess`) **or** `system:watchdog` bearer | Executes Agent 08 `runSessionTeardown` when present; Redis-only teardown path retained for scaffolding. |
| `GET /api/v1/sessions/:id/logs` | `session:read` binding | SSE heartbeats awaiting Agent 08 log pipe. |
| `GET /api/v1/sessions` | `system:watchdog` | JSON manifest for reconcile scripts/watchdog. |

| Env Var | Meaning |
|---------|---------|
| `JWT_PUBLIC_KEY_PATH` *(required prod)* | PEM for RS256 **verify**. |
| `REDIS_URL` | Connection string (**default `redis://127.0.0.1:6379`**). |
| `PORT`, `HOST` | Listen knobs (**defaults `8080` / `0.0.0.0`**). |
| `TRUST_PROXY` | **`1`** allows first `X-Forwarded-For` hop for RL IP extraction (ops must terminate TLS cleanly). |

**Architecture references (downstream):**

- `dasdocker/docs/architecture/orchestrator-api-contract.md`
- `dasdocker/docs/architecture/orchestrator-state-machine.md`

## (c) Warnings / limitations / Squad A review

| Topic | Severity | Detail |
|-------|----------|--------|
| **Distributed RL + capacity** | Medium | Implements Redis-backed RL + LUA capacity; multi-region clusters still need federation / Envoy edge RL. |
| **JWT claims** | Medium | Validates algorithm + scopes + expiry; **JWKS rotation** pending IdP Phase 3. Watchdog bearer must rotate via Vault (**Rule 1**). |
| **SSE buffering** | Low | Proxies must disable buffering (`X-Accel-Buffering: no`). |
| **Lifecycle auto-load side-effect** | Low | Omitting explicit `lifecycleHooks` on `buildApp()` now auto-loads `container-manager`; tests override with `{ lifecycleHooks: null }`; disable sidecars by env / `--require ./tests/disable-sidecars-env.js`. |

**Suggested Squad A checkpoints:** widen GitHub regex for enterprise hosts (`github.company.com`), policy for `zip` artefacts (storage never hits host disks per Agent 09), dual-layer timers vs compliance retention.
