# Agent 05 — Phase 1 Handoff Report (Orchestrator Architecture)

**Role:** Orchestration Architect — Orchestrator state machine + public HTTP API contract.  
**Phase:** 1 (Research & Architecture).  
**Deliverable:** 1.5 — Session state machine design + API contract (blueprint only; **no runtime code**).

---

## (a) What Was Built

1. **`dasdocker/docs/architecture/orchestrator-state-machine.md`**  
   - **Seven** session states (`QUEUED`, `PROVISIONING`, `INSTALLING_DEPS`, `RUNNING`, `DESTROYING`, `DESTROYED`, `FAILED`) with descriptions, **entry conditions**, and **max durations**.  
   - **7×7 transition matrix** plus explicit **row-by-row** authorised triggers; **no undefined states**; invalid transitions map to **`InvalidTransitionError`** or **`TerminalStateError`** (`409` problem codes in HTTP contract).  
   - **Skipped `INSTALLING_DEPS`** rule when `install_commands` is empty (`PROVISIONING → RUNNING`).  
   - **Failure mode analysis** per state timeout (cleanup steps + terminal outcomes).  
   - **Redis key schema** (`session:{id}:state`, `session:{id}:meta`, `session:{id}:ttl`, `sessions:active`) with **permission / ACL justifications** in-table; optional queue and lock keys for workers.  
   - **Full-spectrum test IDs** for every transition class: **Unit**, **Integration**, **Red-team** (maps directly to Phase 2 test files).

2. **`dasdocker/docs/architecture/orchestrator-api-contract.md`**  
   - **OpenAPI 3.1.0** YAML (embedded) covering **five** HTTP operations: `POST /v1/sessions`, `GET /v1/sessions`, `GET /v1/sessions/{session_id}`, `DELETE /v1/sessions/{session_id}`, `GET /v1/health`.  
   - **Authentication** on every operation: **Bearer JWT (RS256)** or **mutual TLS** (`mutualTLS` security scheme).  
   - **Rate limits** as `x-rate-limit` extensions; **error catalogue** (`application/problem+json`).  
   - **Endpoint-level** Unit / Integration / Red-team test matrix (Phase 2 obligations).

3. **This handoff** — Rule 4 artefact for Agent 08 and downstream squads.

---

## (b) Downstream Contract — APIs, Ports, Paths, Environment Variables

### Internal / external HTTP APIs (normative for Phase 2)

| Method | Path (relative to `/api` base) | Auth | Purpose |
|--------|---------------------------------|------|---------|
| `POST` | `/v1/sessions` | Bearer or mTLS | Create session → `QUEUED` |
| `GET` | `/v1/sessions` | Bearer or mTLS | List sessions (tenant-scoped) |
| `GET` | `/v1/sessions/{session_id}` | Bearer or mTLS | Read session + `state` |
| `DELETE` | `/v1/sessions/{session_id}` | Bearer or mTLS | Request destroy → `DESTROYING` when valid |
| `GET` | `/v1/health` | Bearer or mTLS | Liveness + Redis/Docker checks |

**Base URL example:** `https://orchestrator.dasdocker.internal/api` (see OpenAPI `servers`).  
**Not in this contract (Phase 2 decision required):** authenticated **worker → orchestrator** callbacks to advance `QUEUED→PROVISIONING→…` (REST vs gRPC vs queue-only). Agent 08 MUST add a **separate internal** contract or extend this file with Squad A sign-off.

### Listening ports (planned; not bound in Phase 1)

| Port | Protocol | Service | Notes |
|------|----------|---------|-------|
| **8080** | TCP | Orchestrator HTTP | **Example** dev binding from OpenAPI `servers`; production SHOULD use TLS 1.3 + mTLS ingress. |

### Repository paths (this deliverable)

| Path | Purpose |
|------|---------|
| `dasdocker/docs/architecture/orchestrator-state-machine.md` | State machine, transitions, Redis schema, FMECA, test IDs |
| `dasdocker/docs/architecture/orchestrator-api-contract.md` | OpenAPI 3.1 YAML + operational matrix + error catalogue |
| `dasdocker/docs/handoffs/agent-05-phase1-handoff.md` | This Rule 4 handoff |

### Environment variables (Agent 08 implementation checklist)

Secrets MUST be injected via vault / KMS / CI — **never hardcoded** (Rule 1). Defaults are illustrative only.

| Variable | Required | Purpose |
|----------|----------|---------|
| `ORCHESTRATOR_HTTP_ADDR` | Yes | Listen address (e.g. `:8080`). |
| `ORCHESTRATOR_TLS_CERT_PATH` | Prod Yes | Server TLS certificate path (TLS 1.3). |
| `ORCHESTRATOR_TLS_KEY_PATH` | Prod Yes | Server TLS private key path. |
| `ORCHESTRATOR_MTLS_TRUST_ANCHOR_PATH` | Recommended | CA bundle for client cert verification when `mTLS` enabled. |
| `ORCHESTRATOR_JWT_ISSUER` | Yes (JWT mode) | Expected JWT `iss`. |
| `ORCHESTRATOR_JWT_AUDIENCE` | Yes (JWT mode) | Expected JWT `aud`. |
| `ORCHESTRATOR_JWT_JWKS_URL` OR `ORCHESTRATOR_JWT_PUBLIC_KEY_PATH` | Yes (JWT mode) | Key material for RS256 verification. |
| `REDIS_URL` | Yes | Redis connection URI (ACL-scoped credentials). |
| `REDIS_KEY_PREFIX` | No | Optional global prefix before `session:` (default empty). |
| `DOCKER_HOST` | Yes | Docker API endpoint (prefer TLS socket or SSH, not naked TCP across zones). |
| `ORCHESTRATOR_POLICY_BUNDLE_PATH` | Recommended | Admission / SSRF policy for `github_url` and ZIP handles. |
| `ORCHESTRATOR_HEALTH_REQUIRE_AUTH` | Yes | **MUST default `true` in prod**; if `false`, requires Squad A written exception + network binding controls. |

---

## (c) Warnings, Known Limitations, Squad A Review

| Item | Severity | Notes |
|------|----------|-------|
| **Worker transition transport not specified** | High | Five endpoints are **operator-facing**. State advances from workers need an **authenticated** channel (token scope `sessions:transition` or mTLS SAN list). Freeze design before Phase 2 merge. |
| **Collapsed `QUEUED→DESTROY` path** | Medium | §4/state doc allows internal `DESTROYING` observability quirks; logging contract must satisfy forensics (INT-LIFE-012). |
| **`session:{id}:ttl` representation** | Low | Orchestrator MUST pick one encoding in code + document; unblock Redis NOTIFY handlers. |
| **Dual terminal from `DESTROYING`** (`DESTROYED` vs `FAILED`) | Medium | GC / compliance story for `FAILED` after destroy timeout needs owner. |
| **OpenAPI validation** | Low | Embedded YAML validated structurally (`swagger-cli`); re-paste stripped YAML in Swagger Editor after edits. |

**Decisions requiring Squad A review:** worker API surface; whether `GET /health` may ever bypass auth inside service mesh; rate-limit source of truth (edge vs app); JWT vs mTLS for browser-initiated creates.

---

## Required reading (Agent 08 + Agents 15–17)

- `dasdocker/docs/architecture/orchestrator-state-machine.md`  
- `dasdocker/docs/architecture/orchestrator-api-contract.md`  
- `dasdocker/docs/security/STRIDE-threat-model.md` (Rules 1–4, Redis TTL authority S-11/S-14).

---

*Agent 05 · Orchestration Architect · Phase 1 Dispatch 05 of 08*
