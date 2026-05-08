# Orchestrator Go service — narrow read for ADR KV paths + JWT signing via transit (never export private material).
# T-S02-001 T-S06-001 — Principle of least privilege; no sibling service paths.

# KV v2 (mount path "dasdocker" per setup-vault bootstrap)
path "dasdocker/data/orchestrator/*" {
  capabilities = ["read"]
}
path "dasdocker/metadata/orchestrator/*" {
  capabilities = ["read", "list"]
}

# Supporting secrets referenced by orchestrator startup (ADR registry)
path "dasdocker/data/platform/vault_approle_orchestrator" {
  capabilities = ["read"]
}
path "dasdocker/metadata/platform/vault_approle_orchestrator" {
  capabilities = ["read", "list"]
}
path "dasdocker/data/database/postgres_app_password" {
  capabilities = ["read"]
}
path "dasdocker/metadata/database/postgres_app_password" {
  capabilities = ["read", "list"]
}
path "dasdocker/data/cache/redis_password" {
  capabilities = ["read"]
}
path "dasdocker/metadata/cache/redis_password" {
  capabilities = ["read", "list"]
}

path "pki/sign/orchestrator" {
  capabilities = ["create", "update"]
}
path "pki/issue/orchestrator" {
  capabilities = ["create", "update"]
}

# RS256 via transit — orchestrator signs JWTs via /transit/sign (private key non-exportable; T-S04-003)
path "transit/sign/jwt-rs256" {
  capabilities = ["update"]
}
path "transit/sign/jwt-rs256/*" {
  capabilities = ["update"]
}
path "transit/keys/jwt-rs256" {
  capabilities = ["read"]
}

# Encrypt logs at rest helpers (narrow)
path "transit/encrypt/dasdocker-logs" {
  capabilities = ["update"]
}
path "transit/decrypt/dasdocker-logs" {
  capabilities = ["update"]
}
