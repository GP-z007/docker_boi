# Vault production config for dasDocker.
# ZTA: no UI, TLS-only listener, constrained leases, and file audit device enabled via bootstrap API call.

ui            = false
disable_mlock = false

storage "raft" {
  path    = "/opt/dasdocker/vault/data"
  node_id = "vault-prod-1"
}

listener "tcp" {
  address         = "0.0.0.0:8200"
  cluster_address = "0.0.0.0:8201"
  tls_cert_file   = "/opt/dasdocker/vault/tls/vault-cert.pem"
  tls_key_file    = "/opt/dasdocker/vault/tls/vault-key.pem"
  tls_min_version = "tls12"
}

api_addr     = "https://vault.service.consul:8200"
cluster_addr = "https://vault.service.consul:8201"

default_lease_ttl = "1h"
max_lease_ttl     = "24h"

log_level = "info"

telemetry {
  disable_hostname = true
  prometheus_retention_time = "24h"
}

# NOTE:
# - File audit logging is enabled with:
#   vault audit enable file file_path=/opt/dasdocker/vault/logs/audit.log mode=0600
# - JWT RS256 key auto-rotation is configured in bootstrap:
#   transit/keys/jwt-rs256 auto_rotate_period=2160h (90 days)
