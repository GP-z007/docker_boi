# dasDocker Observability Pipeline Specification

**Document ID:** ARCH-OBS-001  
**Version:** 1.0  
**Owners:** Telemetry Architecture Lead (Phase 1)  
**Phase:** 1 — Research & Architecture  
**Related:** [`ebpf-program-spec.md`](ebpf-program-spec.md) — kernel hooks, scoping, overhead, evasion analysis.

---

## Cardinal rule

Monitoring is **host-level and read-only**. No telemetry daemon runs **inside** the monitored container’s trusted observation path for authoritative signals. Containers must not be able to disable host eBPF instrumentation, the ring buffer exporter, or the control-plane message bus from within the sandbox (**privilege-separated by design**).

---

## Pipeline architecture

Hosts correlate kernel events with orchestrator **`session_id`** using cgroup identity propagated from provisioning (details in **`ebpf-program-spec.md`**).

```text
eBPF programs (kernel; privileged loader on host)
        │
        │  BPF_MAP_TYPE_RINGBUF / perf-buffer
        ▼
Userspace collector (host)
        │
        │  structured JSON (+ schema_version, retention tags)
        ▼
Message bus ──► Redis Streams  OR  Apache Kafka (authenticated producers)
        │
        ▼
WebSocket gateway (JWT + TLS)
        │
        ▼
Frontend dashboard / SIEM exporters
```

---

## Event schemas (normative shapes)

Implementations SHOULD validate outbound JSON against these field sets. Omit unknown keys at the gateway boundary (`additionalProperties` rejected in strict mode).

### `process_event`

`{ session_id, timestamp, event_type: "exec" | "fork" | "exit", pid, ppid, comm, args, uid }`

### `file_event`

`{ session_id, timestamp, event_type: "open" | "read" | "write" | "unlink", pid, comm, path, flags }`

### `network_event`

`{ session_id, timestamp, event_type: "connect" | "bind" | "dns_query", pid, comm, dst_ip, dst_port, proto }`

### `alert_event`

`{ session_id, timestamp, severity: "info" | "warn" | "critical", rule_id, description, evidence }`

**Common metadata** (recommended): `schema_version`, `event_id`, `cgroup_key` opaque host hash (never raw cgroup path secrets).

---

## Data sensitivity rules (must never ship in payloads)

| Forbidden | Allowed substitute |
|-----------|---------------------|
| File contents, memory dumps, stack traces with heap | Path strings (capped length), syscall metadata, hashes |
| Environment variable **values** | Optional **names** only when matched by explicit redaction policy lists |
| Private keys, tokens, PEM blocks | Omitted entirely; alerts reference rule ids only |

---

## WebSocket channel namespacing

- **Production URL:** `wss://{gateway_host}/events/{session_id}`  
- **Auth:** Bearer / cookie-transported **session-scoped JWT**: claims MUST bind `session_id` (or equivalent `sid`) to the path segment; gateways MUST reject mismatches and enumeration-friendly errors (uniform denial).  
- **Scope:** Narrow `aud`/`obs:subscribe` (or successor claim) restricted to telemetry read.

---

## Retention policy

| Tier | Contents | Rule |
|------|-----------|------|
| **Raw stream** | `process_event`, `file_event`, `network_event`, `alert_event` | Purged **with session destruction** (+ short clock skew ≤ 15 min default). |
| **Audit summary** | Counts / taxonomies without raw payloads | Retained **90 days** baseline for compliance dashboards (hashed/path-bucket aggregates only). |

Orchestrator session state remains authoritative for “session destroyed”; collector MUST stop emitting for recycled cgroup identifiers without explicit re‑binding.
