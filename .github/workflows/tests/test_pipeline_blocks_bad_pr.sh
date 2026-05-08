#!/usr/bin/env bash
# VT-NEG-GITLEAK-AWS-PR — verifies secret scanners BLOCK obvious AWS leaked keys outside allowlisted fixtures (Rule 2).
#
# SUCCESS (exit 0): gitleaks exits 1 (secret detected).
# FAILURE (exit 1): leaked key NOT detected → pipeline would regress.
#
# Local run after installing https://github.com/gitleaks/gitleaks/releases (or use bundled CI installers):
#
#     bash ".github/workflows/tests/test_pipeline_blocks_bad_pr.sh"

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "SKIP: install gitleaks v8.x (CI mirrors install.sh tarball) — see .github/workflows/ci.yml gitleaks job" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

# Explicit AWS-ish material per user mandate (controlled sample string).
cat >"${TMP}/leaked-key.js" <<'EOF'
// negative-test fixture — must NEVER land in-repo
process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
EOF

set +e
gitleaks detect --no-banner --source "${TMP}" --redact --exit-code 1
code=$?
set -e

if [[ "${code}" -eq 1 ]]; then
  echo "PASS: gitleaks blocked hardcoded AKIA-sample material (exit ${code})"
  exit 0
fi

echo "FAIL: expected gitleaks exit code 1 (findings); got ${code}" >&2
exit 1
