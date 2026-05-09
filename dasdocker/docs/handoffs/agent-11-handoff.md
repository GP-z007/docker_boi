# Agent 11 — eBPF Process Monitor Handoff (Phase 3)

**Branch:** `feat/ebpf-monitor`  
**Deliverable:** 3B.1 kernel-level telemetry producer for downstream event bus and alerting.

## Implementation choice (ADR alignment)

Chosen stack: **libbpf CO-RE (C)** with host userspace collector in C.

Why:
- Phase-1 eBPF architecture spec standardises tracepoint hooks and CO-RE portability assumptions.
- CO-RE keeps probe binaries portable across compatible kernels without per-host rebuild.
- libbpf ring buffer path is low overhead and suited for 3% CPU budget target.

## Redis stream contract (for Agent 10 / Agent 17)

- **Per-session stream:** `dasdocker:events:{session_id}`
- **XADD field:** `payload` (JSON string)
- Collector does **not** write events back into containers; host-only publish path to Redis.

## Event schema emitted

Collector serialises events matching `observability-pipeline-spec` families:

- `process_event` (exec)
- `file_event` (openat)
- `network_event` (connect)
- `alert_event` (rate-limit overflow and suspicious syscall derived alerts)

Common fields include:
- `type`
- `session_id`
- `timestamp`
- syscall/event-specific metadata (`pid`, `uid`, `comm`, etc.)
- `cgroup_key` (opaque cgroup id value)

## cgroup-based session scoping

Source of truth:
- eBPF event contains `cgroup_id` via `bpf_get_current_cgroup_id()`.

Collector maintains in-memory map:
- `{ cgroup_id -> session_id }`
- populated from Redis control channel `dasdocker:control:container_started` messages with:
  - `event=container:started`
  - `container_id`
  - `cgroup_id`
  - `session_id`

Production miss policy:
- if `cgroup_id` has no session mapping, event is dropped to avoid cross-tenant leakage.

## Rate limiting

- Per-session limiter in collector: **1000 events/second max**
- Excess events dropped
- Overflow emits:
  - `type=alert_event`
  - `rule_id=ALERT-RATE-LIMIT`
  - severity `warn`

## Security posture

- eBPF programs are read-only tracepoints (observe only, no kernel mutation).
- Intended runtime identity: `dasdocker-ebpf` non-root user for collector.
- Runtime capability intent: `CAP_BPF` + `CAP_PERFMON` only (no full root runtime for collector process).

## Files delivered

- `services/ebpf-monitor/src/exec_monitor.bpf.c`
- `services/ebpf-monitor/src/file_monitor.bpf.c`
- `services/ebpf-monitor/src/net_monitor.bpf.c`
- `services/ebpf-monitor/src/privilege_monitor.bpf.c`
- `services/ebpf-monitor/src/suspicious_monitor.bpf.c`
- `services/ebpf-monitor/src/container-scope.c`
- `services/ebpf-monitor/Makefile`
- `services/ebpf-monitor/Dockerfile`
- `tests/ebpf/test_program_load.sh`
- `tests/ebpf/test_exec_event.sh`
- `tests/ebpf/test_net_event.sh`
- `tests/ebpf/test_session_scoping.sh`
- `tests/ebpf/test_ebpf_invisibility.sh`
- `tests/ebpf/test_bpf_syscall_blocked.sh`
