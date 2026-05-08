#!/usr/bin/env bash
# VT-UNIT-SECRETS — Repository-wide scanner must stay clean aside from sanctioned allowpaths (Rule 3).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "${REPO_ROOT}"

command -v gitleaks >/dev/null || {
  echo "SKIP: install gitleaks for gate"
  exit 0
}

if [[ ! -f "${REPO_ROOT}/.gitleaks.toml" ]]; then
  echo "SKIP: missing .gitleaks.toml at repo root"
  exit 0
fi

set +e
gitleaks detect --config "${REPO_ROOT}/.gitleaks.toml" --source "${REPO_ROOT}" --verbose --exit-code 1
gl="$?"
set -euo pipefail

if [[ "${gl}" -ne 0 ]]; then
  echo "FAIL: gitleaks exit ${gl} — remediate leaked material or adjust false positives deliberately"
  exit 1
fi

set -euo pipefail

echo "PASS: gitleaks returned zero actionable findings (baseline allowpaths respected)"
