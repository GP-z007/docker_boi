# Orchestrator Session State Machine (Phase 2)

Authoritative lifecycle for sandbox sessions stored in **Redis** (see `services/orchestrator/src/state-machine.js`).

## States

| State | Description |
|-------|-------------|
| `QUEUED` | Session accepted; waiting for provision. |
| `PROVISIONING` | Container being created (Docker `create`). |
| `INSTALLING_DEPS` | Container started; dependency step (orchestrator-defined). |
| `RUNNING` | Workload running; health verified via `docker inspect`. |
| `DESTROYING` | Teardown in progress (SIGKILL / `rm`). |
| `DESTROYED` | Terminal; session data paths must be gone (tmpfs + storage verification). |

## Allowed transitions

```
QUEUED → PROVISIONING
PROVISIONING → INSTALLING_DEPS
INSTALLING_DEPS → RUNNING
RUNNING → DESTROYING
DESTROYING → DESTROYED
```

Illegal transitions throw **`InvalidTransitionError`** (HTTP **409** when surfaced from the API layer).

## Redis key schema (Phase 2)

| Key | Type | Purpose |
|-----|------|---------|
| `dasdocker:sess:{sessionId}:state` | string | Current state enum. |
| `dasdocker:sess:{sessionId}:meta` | string (JSON) | `source_url`, `ttl_seconds`, `source_type`, `created_at`, `jti`, `container_id` (when set). |
| `dasdocker:sess:ttl:{sessionId}` | string + TTL | Dead-man key; expiry **must** match session **TTL** for keyspace self-destruct (enable `notify-keyspace-events Ex` on Redis). |
| `dasdocker:metric:active_sessions` | integer | Count of sessions not in **DESTROYED** (capacity gate **50**). |

Only the orchestrator service account may write these keys (**T-S11-002**).
