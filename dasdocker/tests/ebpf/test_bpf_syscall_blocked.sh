#!/usr/bin/env bash
set -euo pipefail

skip() { echo "SKIP: $*"; exit 0; }
die() { echo "FAIL: $*" >&2; exit 1; }

command -v docker >/dev/null || skip "docker unavailable"
docker info >/dev/null 2>&1 || skip "docker daemon unavailable"

SECCOMP_PROFILE="${DASDOCKER_SECCOMP_PATH:-/etc/dasdocker/security/seccomp-dasdocker.json}"
[[ -f "${SECCOMP_PROFILE}" ]] || skip "seccomp profile not found at ${SECCOMP_PROFILE}"

set +e
out="$(
  docker run --rm \
    --security-opt "seccomp=${SECCOMP_PROFILE}" \
    alpine:3.19 \
    sh -c "apk add -q --no-cache python3 >/dev/null 2>&1 && python3 - <<'PY'
import ctypes
import os
libc = ctypes.CDLL(None, use_errno=True)
nr = 321  # x86_64 bpf syscall number
ret = libc.syscall(nr, 0, 0, 0)
err = ctypes.get_errno()
print('ret', ret, 'errno', err)
raise SystemExit(0 if ret == -1 and err in (1, 38, 95) else 1)
PY" 2>&1
)"
code=$?
set -e

[[ "${code}" -ne 0 ]] && die "container bpf syscall probe unexpectedly succeeded: ${out}"
echo "PASS: container bpf() syscall blocked by seccomp/policy (${out})"
