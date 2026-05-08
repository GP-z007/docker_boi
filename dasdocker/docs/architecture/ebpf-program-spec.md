# dasDocker eBPF Program Specification

**Document ID:** ARCH-EBPF-001  
**Version:** 1.0  
**Phase:** 1 — Deliverable **1.6** (normative for Phase 2 loaders)  
**Related:** [`observability-pipeline-spec.md`](observability-pipeline-spec.md) — bus, schemas, JWT `wss` channels, retention.

---

## Purpose

This document pins **exact kernel attach points** for Phase 1 observability, the **container/session scoping model**, **performance budgets**, and an **evasion-resistance** rationale. Loaders run **only on the host** with appropriate capabilities; sandbox workloads MUST NOT be able to detach these programs (see **STRIDE** / ZTA controls in `docs/security/STRIDE-threat-model.md`).

---

## Kernel hook points (normative)

Each row is the **primary** tracepoint hook for the listed concern. Implementations MAY add complementary `sys_exit_*` tracepoints for return-code / `errno` enrichment without changing the hook identity below.

| Security / telemetry concern | Event family (downstream JSON) | Exact eBPF attach target |
|------------------------------|--------------------------------|---------------------------|
| **Process execution** | `process_event` (`exec`) | `tracepoint/syscalls/sys_enter_execve` |
| **File open / openat** | `file_event` (`open`) | `tracepoint/syscalls/sys_enter_openat` |
| **Network connect** | `network_event` (`connect`) | `tracepoint/syscalls/sys_enter_connect` |
| **Privilege escalation attempt** | `alert_event` (via rules engine on host) | `tracepoint/syscalls/sys_enter_setuid` **and** `tracepoint/syscalls/sys_enter_setgid` |
| **Mount attempt** | `alert_event` | `tracepoint/syscalls/sys_enter_mount` |
| **`ptrace` attempt** | `alert_event` | `tracepoint/syscalls/sys_enter_ptrace` |
| **Kernel module load attempt** | `alert_event` | `tracepoint/syscalls/sys_enter_finit_module` |

### Notes

- **Return context:** pair `sys_enter_*` with `sys_exit_*` **only** where the verifier budget and event cardinality stay within § Performance constraints; otherwise sample or coalesce in the **host collector**.  
- **Architectures:** tracepoint names above follow **x86_64** `syscalls` class; **CO-RE** skeletons MUST abstract per-arch offsets.  
- **Alternative attach types** (e.g. `kprobe` fallbacks) are **non-normative** for dasDocker Phase 2 unless a platform kernel lacks a given tracepoint — any fallback requires Squad A exception + parity tests.

---

## Container scoping strategy

**Goal:** every ringbuf record attributable to exactly **zero or one** `session_id`, without executing code inside the guest rootfs for classification.

### Host-side cgroup resolution

1. **At syscall context:** obtain the **current task** (`struct task_struct *`) visible to BPF. Derive **`cgroup_id`** (preferred: kernel **cgroup v2 unified hierarchy** identifiers exposed to BPF — typically `bpf_get_current_cgroup_id` / equivalent stable cookie for the attach namespace, per kernel version).  
2. **Collector correlation:** maintain a **HASH map** (pinned on the host) `cgroup_key → session_id` populated **out-of-band** when the orchestrator creates the session (Docker/cgroup path already known to the control plane).  
3. **Cross-check (debug / anti-spoof):** the host collector MAY read **`/proc/{host_pid}/cgroup`** for the contributing task (using the **host** PID namespace) and compare the **container id** / cgroup path tail against the expected session slice (e.g. `…/docker/…` or custom `sandbox.slice/…`). This path is **not** copied into customer-facing JSON — only the **opaque `cgroup_id` / hashed key** leaves the node.  
4. **Miss policy:** if no map entry exists, **drop** the sample (default) or tag `session_id=unknown` **only** in engineering builds — production MUST drop to avoid cross-tenant leakage.

### Why `/proc/{pid}/cgroup`?

- Containers cannot hide the kernel’s cgroup membership from **the host PID namespace**.  
- The tracepoint firing **runs in kernel context with host truths** — not in a userspace veneer subject to tampering inside the sandbox.

---

## Performance constraints

| Metric | Budget | Measurement |
|--------|--------|-------------|
| **CPU overhead** per monitored container vs identical workload **without** observability probes | **≤ 3 %** normalized CPU (**95th percentile** over ≥ 300 s steady state) | A/B compare on isolated core sets with `perf stat` / cgroup `cpu.stat`; include **cold start** spike separately in reports. |
| **P99 latency amplification** syscall path | **≤ 250 ns** amortized probe body (excluding ringbuf reservation failures) | micro-benchmark harness + verifier-maximum loop limits |
| **Ringbuf drops** under flood | Bounded: drop counters MUST surface as `HOST-OBS-PRESSURE-*` operational metrics rather than silent loss | Synthetic fork/file storms |

Mitigations when budget threatened: adaptive sampling (`open`/`write` downgrade), move heavy parsing to collector, widen batching intervals.

---

## Evasion resistance analysis (≥ 5 techniques)

| # | Evasion technique (sandboxed workload) | Why host eBPF tracepoints defeat or bound it |
|---|----------------------------------------|-----------------------------------------------|
| 1 | **LD_PRELOAD / libc interposition** to replace `execve` wrappers | Tracepoints trigger on **kernel syscall entry** before return to userspace shims; interposed glibc is irrelevant. |
| 2 | **Hand-written assembly invoking `syscall` bypassing libc** | Same **`sys_enter_execve`** (and companions) executes regardless of how userspace formatted the ABI. |
| 3 | **Memfd-only / obscure binary staging** (“fileless”) run still using `execve`/`execveat` | Probe keys off **syscall** + file descriptor metadata hooks (supplementary `execveat` coverage recommended in Phase 2) rather than pathname presence alone. |
| 4 | **Disabling logging via tampering `/dev/log`, agent files** | Telemetry **never depended** on in-container filesystem state; exporters sit on host **ring buffer**. |
| 5 | **Namespace games:** hide pid tree from tools using nested pid namespaces while running children | cgroup membership is derived from **`task cgroup` identifiers** observable from host BPF / `/proc`; child processes inherit session cgroup unless breakout occurs (detected separately). |
| 6 *(bonus)* | **Blocking `bpf()` from container** attempting to perturb maps | Sandbox lacks `CAP_BPF`/`CAP_SYS_ADMIN` by policy; probes remain **attached from host privileged loader** — intra-container denial does not diminish visibility. |

**Explicit non-claim:** users who obtain **privileged escape** (`CAP_SYS_ADMIN` in host cgroup, ebpf detach rights) violate the sandbox model — detect via policy + escalate to `critical` **`alert_event`**.
