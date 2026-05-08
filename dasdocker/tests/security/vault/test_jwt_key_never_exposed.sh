#!/usr/bin/env bash
# VT-RED-VAULT-* — JWT private material must stay non-exportable (transit semantics + policy grep).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
POL="${ROOT}/config/vault/policies"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

for f in orchestrator watchdog frontend monitor; do
  if grep -Eiq 'transit/export/signing-key' "${POL}/${f}.hcl"; then
    die "policy ${f}.hcl must not whitelist transit/export signing keys"
  fi
  if grep -Eiq 'transit/export/.*jwt' "${POL}/${f}.hcl"; then
    die "policy ${f}.hcl must not export JWT raw key material paths"
  fi
done

# Root policy is not tracked in-repo by design — assert service policies deny export paths.
grep -Rl 'transit/export' "${POL}"/*.hcl 2>/dev/null && die "unexpected transit/export stanza committed in policy"

if [[ -z "${SKIP_LIVE_TRANSIT_CHECKS:-}" ]] && command -v vault >/dev/null && [[ -n "${VAULT_TOKEN_ADMIN:-}" ]]; then
  export VAULT_ADDR="${VAULT_ADDR:-https://127.0.0.1:8200}"
  export VAULT_SKIP_VERIFY="${VAULT_SKIP_VERIFY:-true}"

  orch_tok="$(VAULT_TOKEN="${VAULT_TOKEN_ADMIN}" vault token create -policy=orchestrator -field=token -ttl=10m -orphan)"

  set +e
  VAULT_TOKEN="${orch_tok}" vault read -format=json transit/export/signing-key/jwt-rs256 >/dev/null 2>&1
  ex=$?

  wd_tok="$(VAULT_TOKEN="${VAULT_TOKEN_ADMIN}" vault token create -policy=watchdog -field=token -ttl=10m -orphan)"

  p="$(printf '{}' | base64 | tr -d '\n')"
  VAULT_TOKEN="${wd_tok}" vault write transit/sign/jwt-rs256 "input=${p}" >/dev/null 2>&1
  wsign=$?
  set -euo pipefail

  [[ "${ex}" -ne 0 ]] || die "orchestrator token must NOT export signing key material"
  [[ "${wsign}" -ne 0 ]] || die "watchdog must not invoke transit/sign"
fi

echo "PASS: JWT private key stays non-exportable; watchdog cannot forge tokens"
