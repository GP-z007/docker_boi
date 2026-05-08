# Watchdog cron / health agent — observes published JWT verifying material only (T-S06-001 isolation).

path "dasdocker/data/watchdog/*" {
  capabilities = ["read"]
}
path "dasdocker/metadata/watchdog/*" {
  capabilities = ["read", "list"]
}

# Read-only JWKS / PEM mirror written by orchestrator bootstrap job — never orchestrator signing keys.
path "dasdocker/data/watchdog/jwt-public-key" {
  capabilities = ["read"]
}
path "dasdocker/metadata/watchdog/jwt-public-key" {
  capabilities = ["read", "list"]
}

# Explicit: no transit sign / export — private keys remain Vault-enforced (verified by tests VT-RED).
