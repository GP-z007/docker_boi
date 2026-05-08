#!/usr/bin/env bash
# VT-RED-CI suite — Validates security scanners catch representative abuse artefacts (Rule 2).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIX_GITLEAKS="${ROOT}/tests/infrastructure/fixtures/gitleaks-bad"
FIX_SH="${ROOT}/tests/infrastructure/fixtures/shellcheck-bad/ci-danger.sh"
FIX_CVE_FS="${ROOT}/tests/infrastructure/fixtures/cve-fs"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

tmp_pass() {
  echo "PASS(redteam): $*"
}

expects_failure() {
  local name="$1"
  shift
  set +e
  "$@"
  local code=$?
  set -euo pipefail
  if [[ "${code}" -eq 0 ]]; then
    die "${name}: expected nonzero exit acknowledging defect detection"
  fi
  tmp_pass "${name} detected (${code})"
}

command -v gitleaks >/dev/null || die "gitleaks required for VT-RED gitleaks test"
expects_failure "gitleaks fixture" \
  gitleaks detect --no-banner --exit-code 1 --source "${FIX_GITLEAKS}" --redact --verbose --log-level debug

command -v shellcheck >/dev/null || die "shellcheck required for VT-RED shellcheck test"
expects_failure "shellcheck eval \$INPUT misuse" shellcheck "${FIX_SH}"

command -v trivy >/dev/null || die "trivy required for Maven fixture CRITICAL assertion"
[[ -f "${FIX_CVE_FS}/pom.xml" ]] || die "CVE fixture pom missing (${FIX_CVE_FS})"
expects_failure "trivy fs log4shell-class fixture pom" \
  trivy fs --severity CRITICAL --exit-code 1 "${FIX_CVE_FS}"

echo "PASS: repository red-team scanners react to seeded defects"
