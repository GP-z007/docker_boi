#!/usr/bin/env bash
# VT-INT-S04-002 — Seccomp allow/deny validation (Rule 2).
set -euo pipefail

SCC_DEFAULT="/etc/dasdocker/security/seccomp-dasdocker.json"
SECCOMP_PROFILE="${DASDOCKER_SECCOMP_PATH:-${SCC_DEFAULT}}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "${SECCOMP_PROFILE}" ]] || die "seccomp JSON missing at ${SECCOMP_PROFILE} (run deploy-security-profiles.sh)"

command -v docker >/dev/null || die "docker CLI required"

docker info >/dev/null 2>&1 || die "Docker daemon not reachable"

# Allowed path: minimal syscall surface for echo/exec (Moby allowlist contract).
docker run --rm \
  --security-opt "seccomp=${SECCOMP_PROFILE}" \
  alpine:3.19 \
  echo "seccomp ok" >/dev/null \
  || die "expected echo under custom seccomp to succeed"

# Blocked: unshare(CLONE_NEWUSER) must not be granted without CAP_SYS_ADMIN in baseline profile.
set +e
out="$(docker run --rm \
  --security-opt "seccomp=${SECCOMP_PROFILE}" \
  alpine:3.19 \
  sh -c 'apk add -q --no-cache util-linux >/dev/null 2>&1; unshare --user true' 2>&1)"
code=$?
set -euo pipefail

if [[ "${code}" -eq 0 ]]; then
  die "unshare --user unexpectedly succeeded under seccomp — policy regression (expected EPERM / failure): ${out}"
fi

echo "PASS: seccomp allows baseline workload and rejects unshare --user (exit ${code})"
