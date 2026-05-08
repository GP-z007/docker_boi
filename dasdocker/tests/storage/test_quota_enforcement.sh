#!/usr/bin/env bash
# VT-INT-S04-004 — tmpfs quota must surface ENOSPC past 512MiB /workspace (Rule 2).
set -euo pipefail

skip() {
  echo "SKIP: $*"
  exit 0
}

die() {
  echo "FAIL: $*" >&2
  exit 1
}

command -v docker >/dev/null || skip "docker not available"
docker info >/dev/null 2>&1 || skip "docker daemon down"

cid="dasdocker-quota-$$"
cleanup() {
  docker rm -f "${cid}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "${cid}" \
  --tmpfs /workspace:rw,size=512m,noexec,nosuid,nodev,uid=1000,gid=1000 \
  --tmpfs /tmp:rw,size=64m,noexec,nosuid,nodev \
  alpine:3.19 sleep 120 >/dev/null

set +e
# BusyBox dd (Alpine) does not support conv=fdatasync; sync flushes pagecache so ENOSPC is observable.
log="$(docker exec -u1000:1000 "${cid}" sh -eu -c 'dd if=/dev/zero of=/workspace/fill bs=1M count=600 2>&1; sync' | tail -6)"
code=$?
set -euo pipefail

grep -Eq 'No space left on device|errno=28' <<<"${log}" || grep -Fq 'No space left' <<<"${log}" \
  || {
    echo "--- dd output --- "
    echo "${log}"
    die "expected ENOSPC from 512m tmpfs exhaustion (dd exit=${code})"
  }

docker exec "${cid}" rm -f /workspace/fill 2>/dev/null || true

echo "PASS: workspace tmpfs enforced ENOSPC under oversize write"
