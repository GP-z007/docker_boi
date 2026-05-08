# Orchestrator HTTP API Contract (Phase 2)

Base path: **`/api/v1`**. All JSON bodies are **`application/json`**. Unless noted, errors return JSON `{ "error": string, "code"?: string }`.

## Authentication

| Route pattern | Auth |
|---------------|------|
| `GET /health` | **None** (liveness; no session data). |
| All other routes | **Bearer JWT**, **RS256** only. Claims: `exp` required; `scope` space-delimited string (e.g. `session:create session:read`); session-bound routes include claim **`sess`** matching path `{id}`. |

Rejected attempts are logged with **timestamp, client IP, reason** — **never** the raw token (**Rule 1**).

## Endpoints

### `GET /api/v1/health`

Response **200**: `{ "version": string, "uptime_seconds": number, "active_sessions": number }`.

### `POST /api/v1/sessions`

- **Scope:** `session:create`
- **Rate limit:** **5** requests / minute / source IP → **429**
- **Capacity:** **50** concurrent non-`DESTROYED` sessions → **503**

Body:

```json
{
  "source_url": "https://github.com/org/repo",
  "ttl_seconds": 300,
  "source_type": "github"
}
```

Validation:

- `source_url`: `^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\.git)?$`
- `ttl_seconds`: integer **60–3600** inclusive
- `source_type`: **`github`** | **`zip`**

Response **201**: `{ "id": "<uuid>", "state": "QUEUED", ... }`

### `GET /api/v1/sessions/:id`

- **Scope:** `session:read`; **`sess`** claim must equal `:id`

Response **200**: full session metadata including `state` and state-machine fields.

### `DELETE /api/v1/sessions/:id`

- **Scope:** `session:destroy`; **`sess`** must equal `:id` (or operator policy; default strict bind)

Triggers **`destroyContainer()`** (Agent 08). Response **202** or **204** when accepted.

### `GET /api/v1/sessions/:id/logs`

- **Scope:** `session:read`
- **Content-Type:** `text/event-stream` (SSE). Heartbeats + session log events (implementation may start as minimal stream).

### `GET /api/v1/sessions` (watchdog / control plane)

- **Scope:** `system:watchdog`
- **200:** list of active sessions for expiry reconciliation (see `scripts/watchdog.sh`).

## Environment (non-secret config)

| Variable | Purpose |
|----------|---------|
| `JWT_PUBLIC_KEY_PATH` | PEM path for RS256 verification |
| `REDIS_URL` | Redis connection URL |
| `PORT` | Listen port (default **8080**) |
| `DASDOCKER_SECCOMP_JSON` | Host path for `--security-opt seccomp=` |
| `DASDOCKER_APPARMOR_PROFILE` | AppArmor profile name (e.g. `dasdocker-container`) |
| `SANDBOX_IMAGE` | Container image for sandboxes |
| `DASDOCKER_NETWORK` | Docker network name (default `dasdocker-isolated`) |

Secrets (signing keys, internal PSKs) **must** come from Vault at runtime — **never** committed (**Rule 1**).
