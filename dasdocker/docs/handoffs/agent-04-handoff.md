# Agent 04 Handoff Report — Secrets & Authentication (Vault)

## (a) What was built

- **`scripts/setup-vault.sh`** — HashiCorp **Vault OSS** host layout under **`${VAULT_ROOT:-/opt/dasdocker/vault}`**: directories, **self-signed TLS** (operators replace with PKI-managed certs), **`vault.hcl`** from **`config/vault/vault.hcl.example`** (**file** storage backend, **TLS listener** on **`127.0.0.1:8200`**, **non-dev mode**).
- **`systemd/dasdocker-vault.service`** — runs **`vault server`** under **`vault` user**.
- **`config/vault/policies/*.hcl`** — per-service **`orchestrator`**, **`watchdog`**, **`frontend`**, **`monitor`** policies (**default deny** — only enumerated paths permitted).
- **Bootstrap helper** (**`bootstrap-engines`**) enabling:
  - **KV v2** mount **`dasdocker/`** (maps ADR **`secret/data/dasdocker/…`** nomenclature to **`dasdocker/data/…`** in this Phase 2 tree).
  - **PKI** engine **`pki/`** with internal CA + **`pki/issue/orchestrator`** role (**mTLS issuance** surface).
  - **Transit**: **`jwt-rs256`** (**RSA**) for RS256-compatible signing primitives; **`dasdocker-logs`** (**AES-GCM**) for encrypt/decrypt orchestration (**T-S10-001**).
- **`tests/security/vault/`** — policy segregation tests, JWT export red-team, repository **gitleaks** cleanliness.

**Auto-unseal decision (Rule 1):** **Manual Shamir (5 shares / threshold 3 recommended)** documented as **default** — avoids cloud KMS coupling for self-hosted OSS; **availability** gated on quorum ceremony. Alternatives (**Transit auto-unseal**, **KMS**) recorded in **`setup-vault.sh` header commentary** — require separate ADR for production freeze.

---

## (b) Vault path master map — ADR `Secret? = yes` → KV / engine → env var

Convention: **KV v2 logical mount** **`dasdocker`**. API reads use **`vault kv get -mount=dasdocker <path>`** (storage path **`dasdocker/data/<path>`**).

| Vault path *(KV unless noted)* | Engine | Consumer policy | Env var *(ADR registry)* |
|-------------------------------|--------|-----------------|----------------------------|
| `dasdocker/data/orchestrator/database_url` | KV v2 | `orchestrator` | **`DASDOCKER_ORCH_DATABASE_URL`** |
| `dasdocker/data/orchestrator/redis_url` | KV v2 | `orchestrator` | **`DASDOCKER_ORCH_REDIS_URL`** |
| `dasdocker/data/orchestrator/session_signing_key` | KV v2 | `orchestrator` | **`DASDOCKER_ORCH_SESSION_SIGNING_KEY`** *(HMAC/aux — separate from JWT)* |
| `dasdocker/data/orchestrator/docker_client_tls` *(keys as JSON blobs)* | KV v2 | `orchestrator` | **`DASDOCKER_ORCH_DOCKER_HOST`** *(certs injected per ADR)* |
| `dasdocker/data/platform/vault_approle_orchestrator` *(keys role_id / secret_id)* | KV v2 | `orchestrator` bootstrap only | **`DASDOCKER_VAULT_ROLE_ID`**, **`DASDOCKER_VAULT_SECRET_ID`** |
| `dasdocker/data/database/postgres_app_password` | KV v2 | `orchestrator` | **`DASDOCKER_POSTGRES_PASSWORD`** |
| `dasdocker/data/cache/redis_password` | KV v2 | `orchestrator` | **`DASDOCKER_REDIS_PASSWORD`** |
| `dasdocker/data/observability/grafana_admin` | KV v2 | `monitor` | **`DASDOCKER_GRAFANA_ADMIN_PASSWORD`** |
| `dasdocker/data/network/dns_upstreams` *(optional)* | KV v2 | `monitor`/`host-net` *(future tighten)* | **`DASDOCKER_DNS_UPSTREAMS`** *(optional Vault population)* |

**JWT RS256 orchestration *(no private KV)*:**

| Vault path | Engine | Consumer | Behaviour |
|-----------|--------|----------|-----------|
| `transit/sign/jwt-rs256` | Transit | **`orchestrator` policy**: `update` | Orchestrator obtains **Detached / raw signatures** via Sign API (**private key NEVER exportable**) |
| `transit/keys/jwt-rs256` | Transit | **`orchestrator` read**; **`watchdog` NO access** *(public JWKS mirrored to KV separately)* |
| **`dasdocker/data/watchdog/jwt-public-key`** | KV v2 | **`watchdog`** | Published **verification** PEM/JWKS fragments only |

**mTLS issuance:**

| Path | Engine | Policy |
|------|--------|--------|
| `pki/issue/orchestrator` | PKI | `orchestrator` (`create/update`) |

**Log encryption:**

| Path | Engine | Policy |
|------|--------|--------|
| `transit/encrypt/dasdocker-logs` / `transit/decrypt/dasdocker-logs` | Transit | `orchestrator` *(tighten to Fluent Bit OIDC/AppRole later)* |

**Out of Vault (explicit ADR exclusions):**

- **`GITHUB_TOKEN`** — **`GitHub Actions / OIDC` only**.

---

## (c) How services authenticate (dynamic vs static)

1. **Runtime:** each workload uses **Vault AppRole**, **GCP/AWS auth**, **or OIDC JWT** (**GitHub/GitLab**) mapped to **`orchestrator` / `frontend` / `monitor` / `watchdog`** token roles — root token **never** embedded in systemd units (**revoke after bootstrap per runbook printed by `setup-vault.sh operator-docs`**).
2. **JWT issuance:** orchestrator invokes **`transit/sign/jwt-rs256`** for token signing payloads; verifier services load **public artifacts** exclusively from **`watchdog`** KV (**or JWKS fetched through orchestrator** but **cryptographic trust** originates from mirrored material).
3. **PKI certs:** **`pki/issue/orchestrator`** issues **≤720h leaf** certs for **`*.svc.dasdocker.local`**.

---

## (d) Test commands

```bash
# Live Vault (needs unsealed node + bootstrap + VAULT_TOKEN_ADMIN)
export VAULT_ADDR=https://127.0.0.1:8200 VAULT_SKIP_VERIFY=true VAULT_TOKEN_ADMIN=...

bash dasdocker/tests/security/vault/test_vault_policies.sh
SKIP_LIVE_TRANSIT_CHECKS=1 bash dasdocker/tests/security/vault/test_jwt_key_never_exposed.sh  # static grep only

bash dasdocker/tests/security/vault/test_no_hardcoded_secrets.sh
```

---

## (e) Unresolved warnings / Squad A gates

| Item | Severity | Owner action |
|------|----------|----------------|
| **Self-signed Vault TLS | Medium | Swap to organisation PKI CA + pin `VAULT_CACERT`; disable `VAULT_SKIP_VERIFY` in staging. |
| **Single-node Vault file backend | Medium | HA raft + integrated storage ADR prior to GA. |
| **PKI CRL distribution URL hardcoded localhost | Medium | Rewrite `pki/config/urls` for routable CRL/issuer endpoints behind reverse proxy + TLS pinning. |

---

## (f) Conventional-commit git commands *(Rule 3)*

From repository root **`docker_boi`**:

```bash
cd dasdocker

git checkout -b feat/secrets-vault

git add scripts/setup-vault.sh

git add config/vault/vault.hcl.example
git add config/vault/policies/orchestrator.hcl
git add config/vault/policies/watchdog.hcl
git add config/vault/policies/frontend.hcl
git add config/vault/policies/monitor.hcl

git add systemd/dasdocker-vault.service

git add tests/security/vault/test_vault_policies.sh
git add tests/security/vault/test_jwt_key_never_exposed.sh
git add tests/security/vault/test_no_hardcoded_secrets.sh

git add docs/handoffs/agent-04-handoff.md

git commit -m "feat(secrets): deploy HashiCorp Vault with per-service policies and RS256 JWT keys"

git push -u origin feat/secrets-vault
```

---

*Agent 04 — Secrets & Authentication Specialist · Phase 2 Deliverable 2.5 · Rules 1–4*
