# Vault Production Hardening (Agent 04)

**Date:** 2026-05-09  
**Objective:** Production-hardening of Vault for dasDocker Phase 4.

## Configuration delivered

- Added production Vault config: `config/vault/vault-production.hcl`
  - `ui = false` (UI disabled for production)
  - TLS-only listener
  - `max_lease_ttl = "24h"` for bounded secret lifetime
  - `default_lease_ttl = "1h"`
  - Raft storage baseline for production deployments

## Bootstrap hardening updates

Updated `scripts/setup-vault.sh` in `bootstrap_engines`:

1. **Audit logging enabled (file device)**
   - Audit path default: `${VAULT_ROOT}/logs/audit.log`
   - Enable command:
     - `vault audit enable file file_path=<audit_file> mode=0600`
   - Ensures every read/write action is audit-recorded.

2. **JWT RS256 key auto-rotation (90 days)**
   - Default rotation period:
     - `VAULT_JWT_KEY_ROTATE_PERIOD=2160h` (90 days)
   - Applied to transit key:
     - `transit/keys/jwt-rs256` with `auto_rotate_period`
     - `transit/keys/jwt-rs256/config` with `auto_rotate_period`

3. **Lease hardening**
   - KV mount tuned to `max-lease-ttl=24h`.

## Operational commands (production)

```bash
cd dasdocker
sudo VAULT_ROOT=/opt/dasdocker/vault ./scripts/setup-vault.sh prepare

export VAULT_ADDR="https://127.0.0.1:8200"
export VAULT_TOKEN="<bootstrap-admin-token>"
export VAULT_JWT_KEY_ROTATE_PERIOD="2160h"
export VAULT_AUDIT_FILE="/opt/dasdocker/vault/logs/audit.log"
./scripts/setup-vault.sh bootstrap-engines
```

## Verification checklist

1. UI disabled:
   - `grep '^ui' config/vault/vault-production.hcl` -> `ui = false`
2. Audit device enabled:
   - `vault audit list -format=json | jq '.\"file/\"'`
3. JWT key rotation period:
   - `vault read -format=json transit/keys/jwt-rs256 | jq -r '.data.auto_rotate_period'` -> `2160h`
4. Lease max TTL:
   - `vault secrets tune -path=dasdocker` shows `max_lease_ttl` = `24h`

## Security posture outcome

- Vault production posture is hardened for headless operation, forensic traceability, bounded secret lifetime, and periodic key hygiene aligned with Phase 4 requirements.
