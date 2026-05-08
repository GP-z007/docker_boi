# Agent 10 / 11 — Phase 1 Observability Handoff

**Roles:** Agent 10 — Telemetry pipeline architecture; Agent 11 — eBPF hooks + scoping + performance + evasion analysis.  
**Phase:** 1 — Deliverables **telemetry pipeline** + **1.6 eBPF specification**.

---

## (a) What was built

1. **`dasdocker/docs/architecture/observability-pipeline-spec.md`** — Logical pipeline (**eBPF → ring buffer → JSON → Redis Streams → WebSocket → UI**); JSON shapes for **`process_event`**, **`file_event`**, **`network_event`**, **`alert_event`**; sensitivity rules (**no contents, no env values**); **`wss://…/events/{session_id}`** + JWT binding; retention (**purge raw with session**, **audit summary ~90 days**).  
2. **`dasdocker/docs/architecture/ebpf-program-spec.md`** — Exact tracepoint hooks (exec, openat, connect, setuid/setgid, mount, ptrace, finit_module); **cgroup_id** + **`/proc/{pid}/cgroup`** correlation model; **≤ 3 %** CPU overhead budget; **≥ 5 evasion patterns** vs eBPF rationale.  
3. **This handoff** — downstream pointers + corrected git paths for **`docker_boi`** monorepo root.

---

## (b) Repo paths / integration

| Path | Purpose |
|------|---------|
| `dasdocker/docs/architecture/observability-pipeline-spec.md` | Bus / schema / JWT / retention |
| `dasdocker/docs/architecture/ebpf-program-spec.md` | Hooks / scoping / perf / evasion |
| `dasdocker/docs/security/STRIDE-threat-model.md` | Master rules |

**Environment sketch (Phase 2):** `OBS_BROKER_URL`, JWT issuer/audience for gateway; `OBS_BPFFS_ROOT` for pinned maps — extend as needed during implementation.

---

## (c) Warnings / review

| Item | Severity | Note |
|------|----------|------|
| `sys_enter_*` cardinality | Medium | Mitigate via sampling under load to hold **≤ 3 %** CPU. |
| cgroup id recycle | Medium | Tie-break with orchestrator **destroy barrier** ordering. |

---

## Rule 3 — Git commands

The repository root is **`docker_boi`** (parent of **`dasdocker/`**). From that root:

```bash
git checkout main
git pull
git checkout -b docs/observability-spec

# Agent 10 — first commit
git add dasdocker/docs/architecture/observability-pipeline-spec.md
git commit -m "docs(observability): specify telemetry pipeline architecture and event schemas

- Define pipeline: eBPF → ring buffer → JSON events → Redis Streams → WebSocket gateway
- Specify JSON schemas for process, file, network, and alert event types
- Define data sensitivity rules (no file contents, no env var values in payloads)
- Specify WebSocket channel namespacing with session-scoped JWT authentication
- Define retention policy: raw events purged with session, audit summary retained"

# Agent 11 — second commit
git add dasdocker/docs/architecture/ebpf-program-spec.md
git add dasdocker/docs/handoffs/agent-10-phase1-handoff.md
git commit -m "docs(ebpf): specify eBPF hook points, container scoping, and evasion resistance

- Map 7 event types to exact tracepoint hook locations
- Specify cgroup_id-based container scoping strategy
- Define ≤3% CPU overhead constraint for monitoring pipeline
- Document 5 evasion techniques and eBPF countermeasures for each

Refs: Phase-1 Deliverable 1.6"

git push -u origin docs/observability-spec
```

### If development uses `cd dasdocker` as working directory

Use paths **`docs/architecture/...`** relative to **`dasdocker/`** only **if `dasdocker` is the Git root**. In **`docker_boi`**, prefixes MUST be **`dasdocker/docs/...`** as above.
