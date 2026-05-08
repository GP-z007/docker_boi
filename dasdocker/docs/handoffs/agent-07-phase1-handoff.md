# Agent 07 — Phase 1 Handoff Report (Runtime Detection Heuristics)

**Role:** Runtime Detection & Dependency Specialist.  
**Phase:** 1 (Research & Architecture).  
**Deliverable:** **1.4** — Runtime detection heuristic specification (Phase 2 implementation only).

---

## (a) What Was Built

1. **`dasdocker/docs/architecture/runtime-detection-spec.md`** — authoritative **static-only** heuristic engine blueprint covering:
   - **Nine** packaged runtimes: **Node.js**, **Python**, **Go**, **Rust**, **Java** (Maven/Gradle), **Ruby**, **PHP**, **Docker-native**, **.NET** (exceeding the ≥ **8** requirement).
   - Per-runtime **detection signals**, **priority tiers**, **install command templates** (allowlist-backed), **entry heuristics**, and **confidence arithmetic**.
   - **Conflict resolution** (weighted ladder + combination table), **`multi_runtime` flag** UX/API semantics, **`RUNTIME_UNDETECTABLE`** / orchestrator **`FAILED`** alignment.
   - **Command allowlist (§5)** and **forbidden pattern** catalogue (pipes, `sudo`, substitutions, chaining, wrappers like `curl | bash`, `wget | sh`).
   - **Docker-native stance:** **nested Docker / DinD forbidden**; alternatives are **controlled out-of-band image build**, **subset-validated Dockerfile**, or **STATIC `COPY`/layer inference** (Phase 2).
   - **Full-spectrum test specifications:** golden **file-tree fixtures** plus **seven** adversarial scenarios (Makefile masquerade, Node+Python conflict, orphaned lock, path traversal, requirement-line injection, hostile Dockerfile `RUN`, `gradlew` rejection).

Phase 1 ships **documents only**; no detection service binary or parsers.

---

## (b) Downstream Contract — APIs, Ports, Paths, Environment Variables

### HTTP / RPC (this deliverable)

| Item | Detail |
|------|--------|
| Listening ports | **None** introduced (specification-only). Detection runs **inline** inside Orchestrator/session admission in Phase 2 **or** behind an internal **`POST /internal/v1/detect`** (to be authored with Agent 08). |

### File paths

| Path | Purpose |
|------|---------|
| `dasdocker/docs/architecture/runtime-detection-spec.md` | Normative heuristic + allowlist + tests |
| `dasdocker/docs/architecture/orchestrator-state-machine.md` | Consume `failure_reason` / pre-queue FAILED semantics |
| `dasdocker/docs/security/STRIDE-threat-model.md` | Supply-chain / execution abuse controls |

### Environment variables (Phase 2 checklist — illustrative)

| Variable | Required | Purpose |
|----------|----------|---------|
| `RUNTIME_DETECT_MAX_ARCHIVE_BYTES` | Recommended | Caps ZIP/Git bundle extract volume (ZIP bomb guard). |
| `RUNTIME_DETECT_MAX_MANIFEST_BYTES` | Recommended | Overrides default **256 KiB** read window. |
| `RUNTIME_DETECT_SYMLINK_MODE` | Optional | Default `ignore` per §1. |
| `RUNTIME_DETECT_REQUIRE_ACK_THRESHOLD` | Optional | Overrides confidence **0.62** autopilot cutoff. |

**Rule 1:** Secrets are **not** required for detection; configuration MUST remain non-secret URLs/paths unless integrating private Git clones (then use existing vault-fed git credentials elsewhere — never in detection code).

---

## (c) Warnings, Known Limitations, Squad A Review

| Item | Severity | Notes |
|------|----------|-------|
| **Poetry/Pipenv in minimal sandboxes** | Medium | Sandbox base images MUST ship matching tools or detector falls back to `multi_runtime`/manual install. |
| **Rack / Rails entry** | Medium | `./config.ru` detection returns **`requires_ack`** — allowlist Phase 2 for `bundle exec`-style starters. |
| **Docker-first repos** | High | Operational model (external BuildKit vs language extraction) requires **Squad A** freeze before Worker implementation. |
| **Gradle Kotlin DSL parsing** | Low | Lightweight static parse only; malformed scripts may downgrade confidence or force manual. |
| **Cross-session cache** | Medium | Detector MUST remain stateless OR use signed content-addressed cache — no trust in prior sessions (STRIDE tenancy). |

**Squad A review triggers:** Dockerfile handling policy, **`pip install .`** widening, Gradle wrapper exceptions, multilingual auto-run threshold.

---

## Required reading — Agents 08, 15–17 (+ Frontend)

- Entire **`runtime-detection-spec.md`** (especially §1 intake, §3 conflicts, §5 allowlist).
- **`orchestrator-api-contract.md`** — how `install_commands` and future `runtime_override` surface.

---

*Agent 07 · Squad B specialist · Phase 1 Dispatch **06** of **08***
