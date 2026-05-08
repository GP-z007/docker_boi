#!/usr/bin/env bash
# VT-INT-VAULT-* — Validates least-privilege; cross-service denies (Rule 2).
set -euo pipefail

skip() {
  echo "SKIP: $*"
  exit 0
}

die() {
  echo "FAIL: $*" >&2
  exit 1
}

command -v vault >/dev/null || skip "vault CLI not installed"

export VAULT_ADDR="${VAULT_ADDR:-https://127.0.0.1:8200}"
export VAULT_SKIP_VERIFY="${VAULT_SKIP_VERIFY:-true}"
[[ -n "${VAULT_TOKEN_ADMIN:-}" ]] || skip "VAULT_TOKEN_ADMIN unset — run bootstrap then export admin token locally"

ADMIN="${VAULT_TOKEN_ADMIN}"

svc_token() {
  local pol="$1"
  VAULT_TOKEN="${ADMIN}" vault token create -policy="${pol}" -field=token -ttl=30m -orphan 2>/dev/null
}

export VAULT_TOKEN="${ADMIN}"

# Ensure smoke secrets exist (bootstrap should have seeded)
vault kv put -mount=dasdocker orchestrator/test marker=vt-int >/dev/null 2>&1 || true

or_tok="$(svc_token orchestrator)"
wd_tok="$(svc_token watchdog)"
fe_tok="$(svc_token frontend)"
mo_tok="$(svc_token monitor)"

set +e
VAULT_TOKEN="${or_tok}" vault kv get -mount=dasdocker orchestrator/test >/dev/null 2>&1
orc_self=$?

VAULT_TOKEN="${wd_tok}" vault kv get -mount=dasdocker watchdog/jwt-public-key >/dev/null 2>&1
wd_self=$?

VAULT_TOKEN="${wd_tok}" vault kv get -mount=dasdocker orchestrator/test >/dev/null 2>&1
wd_cross=$?

VAULT_TOKEN="${fe_tok}" vault kv get -mount=dasdocker frontend/build >/dev/null 2>&1
fe_self=$?

VAULT_TOKEN="${fe_tok}" vault kv get -mount=dasdocker orchestrator/test >/dev/null 2>&1
fe_cross=$?

VAULT_TOKEN="${mo_tok}" vault kv get -mount=dasdocker monitor/prometheus >/dev/null 2>&1
mo_self=$?

VAULT_TOKEN="${mo_tok}" vault kv get -mount=dasdocker orchestrator/test >/dev/null 2>&1
mo_cross=$?

payload="$(printf '{}' | base64 | tr -d '\n')"
VAULT_TOKEN="${or_tok}" vault write transit/sign/jwt-rs256 "input=${payload}" >/dev/null 2>&1
orc_sign=$?
set -euo pipefail

[[ "${orc_self}" -eq 0 ]] || die "orchestrator must read own KV"
[[ "${orc_sign}" -eq 0 ]] || die "orchestrator must sign via transit jwt-rs256"
[[ "${wd_self}" -eq 0 ]] || die "watchdog must read watchdog/jwt-public-key KV"
[[ "${wd_cross}" -ne 0 ]] || die "watchdog MUST NOT read orchestrator KV"
[[ "${fe_self}" -eq 0 ]] || die "frontend must read frontend KV"
[[ "${fe_cross}" -ne 0 ]] || die "frontend MUST NOT read orchestrator KV"
[[ "${mo_self}" -eq 0 ]] || die "monitor must read monitor KV"
[[ "${mo_cross}" -ne 0 ]] || die "monitor MUST NOT read orchestrator KV"

echo "PASS: per-service Vault policies behaved (least privilege + JWT sign bound to orchestrator)"
