#!/usr/bin/env bash
# setup-vault.sh — HashiCorp Vault OSS deployment scaffolding (ADR-008 D-006).
# Secrets never embedded in repo; bootstrap uses operator-supplied ephemeral token env vars only (Rule 1 ZTA).
#
# Auto-unseal choice (defaults to manual Shamir):
# - Manual Shamir (-key-shares=5/-threshold=3 recommended): strongest OSS self-hosted story with no KMS vendor;
#   operators store key shards offline. Implication — availability requires quorum at cold start / seal break.
# - Transit auto-unseal (Vault cluster B seals cluster A): adds HA dependency chain — document separately if adopted.
# - Cloud KMS seals (GCP/AWS/Azure): reduces human key ceremony; implies cloud trust & IAM blast radius documentation.
#
# After first bootstrap: revoke root bootstrap token (`vault login` with AppRole for automation only).
set -euo pipefail

: "${DASDOCKER_ROOT:=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
VAULT_ROOT="${VAULT_ROOT:-/opt/dasdocker/vault}"
BOOTSTRAP_TOKEN_ENV="VAULT_TOKEN"

die() {
  echo "error: $*" >&2
  exit 1
}

require_root() {
  [[ "${EUID:-0}" -eq 0 ]] || {
    echo "error: root required for install paths under ${VAULT_ROOT}" >&2
    exit 1
  }
}

install_package() {
  if command -v apt-get >/dev/null; then
    apt-get update -y
    apt-get install -y curl gpg lsb-release jq openssl vault 2>/dev/null || apt-get install -y curl gpg lsb-release jq openssl unzip
    if ! command -v vault >/dev/null; then
      curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg 2>/dev/null || true
      echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg arch=$(dpkg --print-architecture)] https://apt.releases.hashicorp.com $(lsb_release -cs) main" >/etc/apt/sources.list.d/hashicorp.list
      apt-get update -y && apt-get install -y vault
    fi
  elif command -v brew >/dev/null; then
    brew list vault >/dev/null 2>&1 || brew install vault
  fi
}

prepare_tls() {
  require_root
  install -d -m 0750 -o root -g vault "${VAULT_ROOT}/tls" 2>/dev/null || install -d -m 0750 "${VAULT_ROOT}/tls"
  if [[ ! -f "${VAULT_ROOT}/tls/vault-cert.pem" ]]; then
    openssl req -x509 -nodes -newkey rsa:3072 \
      -subj "/CN=dasdocker-vault.lab" \
      -days 397 \
      -keyout "${VAULT_ROOT}/tls/vault-key.pem" \
      -out "${VAULT_ROOT}/tls/vault-cert.pem" >/dev/null
    chmod 0640 "${VAULT_ROOT}/tls/vault-key.pem"
  fi
}

prepare_dirs() {
  require_root
  install -d -o root -g vault -m 0750 "${VAULT_ROOT}/"{data,config,logs} 2>/dev/null || install -d -m 0750 "${VAULT_ROOT}/"{data,config,logs}
  prepare_tls
}

write_config() {
  require_root
  install -m 0644 "${DASDOCKER_ROOT}/config/vault/vault.hcl.example" "${VAULT_ROOT}/config/vault.hcl"
  chown vault:vault "${VAULT_ROOT}/config/vault.hcl" 2>/dev/null || chown root:root "${VAULT_ROOT}/config/vault.hcl"
}

bootstrap_engines() {
  command -v vault >/dev/null || die "vault binary missing"

  export VAULT_ADDR="${VAULT_ADDR:-https://127.0.0.1:8200}"
  export VAULT_SKIP_VERIFY="${VAULT_SKIP_VERIFY:-false}"
  if [[ "${VAULT_SKIP_VERIFY:-false}" == "true" ]]; then
    export VAULT_CLIENT_TIMEOUT=120s
  fi

  # shellcheck disable=SC2154
  [[ -n "${VAULT_TOKEN:-}" ]] || die "set ${BOOTSTRAP_TOKEN_ENV} with an initial admin token capable of mounts (not committed)"

  echo ">>> Enabling secret engines..."
  vault secrets enable -path=dasdocker kv-v2 2>/dev/null || echo "dasdocker KV already enabled"
  vault secrets enable transit 2>/dev/null || echo "transit already enabled"
  vault secrets enable pki 2>/dev/null || echo "pki already enabled"

  vault secrets tune -max-lease-ttl=87600h pki >/dev/null
  vault write -field=certificate pki/root/generate/internal \
    common_name="dasdocker-internal-ca" ttl=87600h >/dev/null

  vault write pki/config/urls \
    issuing_certificates="https://127.0.0.1:8200/v1/pki/ca" \
    crl_distribution_points="https://127.0.0.1:8200/v1/pki/crl" >/dev/null

  vault write pki/roles/orchestrator allowed_domains="svc.dasdocker.local" allow_subdomains=true max_ttl="720h" >/dev/null

  echo ">>> Transit keys..."
  vault write -f transit/keys/jwt-rs256 type="rsa-2048" >/dev/null 2>&1 || vault write transit/keys/jwt-rs256 type="rsa-2048"

  vault write transit/keys/dasdocker-logs type=aes256-gcm96 derived=true >/dev/null 2>&1 \
    || vault write transit/keys/dasdocker-logs type=aes256-gcm96 derived=true

  echo ">>> Policies..."
  pol_dir="${DASDOCKER_ROOT}/config/vault/policies"
  for p in orchestrator watchdog frontend monitor; do
    vault policy write "${p}" "${pol_dir}/${p}.hcl"
  done

  echo ">>> Seeding KV smoke secrets (REPLACE in production) ..."
  vault kv put -mount=dasdocker orchestrator/test lease="audit-only-smoke-delete-me" >/dev/null
  vault kv put -mount=dasdocker watchdog/jwt-public-key pubkey="REPLACE_WITH_PUBLISHED_JWKS_FRAGMENT" >/dev/null
  vault kv put -mount=dasdocker frontend/build marker="vite-secrets-namespace" >/dev/null
  vault kv put -mount=dasdocker monitor/prometheus marker="infra-readonly" >/dev/null

  echo "BOOTSTRAP_OK — rotate root token ASAP; orchestrator MUST use AppRole + wrapped secret_ids only."
}

print_operator_runbook() {
  cat <<'DOC'
OPERATOR STEPS (not automated — secret material NEVER committed):

1. sudo ./scripts/setup-vault.sh prepare
2. Copy vault systemd unit OR run: vault server -config=/opt/dasdocker/vault/config/vault.hcl
3. vault operator init -key-shares=5 -key-threshold=3 \
     -recovery-shares=0 \
     > /run/vault-init.json  # permissions 0600, move offline immediately
4. vault operator unseal   # repeat until threshold met
5. export VAULT_ADDR=https://127.0.0.1:8200
   export VAULT_TOKEN=<initial-root-token>
6. sudo -E ./scripts/setup-vault.sh bootstrap-engines
7. vault auth enable approle
8. vault write auth/approle/role/orchestrator token_policies="orchestrator"
9. Rotate & revoke Initial Root Token: vault operator generate-root ... OR create admin policy + revoke old root
DOC
}

prepare_all() {
  require_root
  install_package || true
  prepare_dirs
  write_config
  install -m 0644 "${DASDOCKER_ROOT}/systemd/dasdocker-vault.service" /etc/systemd/system/dasdocker-vault.service 2>/dev/null || true
  systemctl daemon-reload 2>/dev/null || true
}

usage() {
  cat <<USAGE
Usage: $0 {prepare|bootstrap-engines|operator-docs}
  prepare          Install deps (best-effort), directories, TLS, example config + systemd stub.
  bootstrap-engines  Requires unsealed Vault + \$VAULT_TOKEN admin — enables KV/PKI/transit + policies + smoke data.
  operator-docs    Print manual init/unseal + root token revocation guidance.
USAGE
}

main() {
  case "${1:-}" in
    prepare)
      prepare_all
      ;;
    bootstrap-engines)
      bootstrap_engines
      ;;
    operator-docs | docs)
      print_operator_runbook
      ;;
    *)
      usage
      ;;
  esac
}

main "$@"
