#!/usr/bin/env bash
# VT-INT-S04-001 — tmpfs mount options for workspace + /tmp (Rule 2).
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

cid="dasdocker-tmpfs-verify-$$"
cleanup() {
  docker rm -f "${cid}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "${cid}" \
  --tmpfs /workspace:rw,size=512m,noexec,nosuid,nodev,uid=1000,gid=1000 \
  --tmpfs /tmp:rw,size=64m,noexec,nosuid,nodev \
  alpine:3.19 sleep 120 >/dev/null

docker exec "${cid}" sh -c 'command -v findmnt >/dev/null || apk add -q util-linux' >/dev/null 2>&1 || true

ws="$(docker exec "${cid}" findmnt -n -o TARGET,FSTYPE,OPTIONS /workspace)"
tm="$(docker exec "${cid}" findmnt -n -o TARGET,FSTYPE,OPTIONS /tmp)"

grep -Fq /workspace <<<"${ws}" || die "findmnt workspace missing (${ws})"
grep -Fq tmpfs <<<"${ws}" || die "/workspace not tmpfs (${ws})"
grep -Fq /tmp <<<"${tm}" || die "findmnt /tmp missing (${tm})"
grep -Fq tmpfs <<<"${tm}" || die "/tmp not tmpfs (${tm})"

grep -Fq 'noexec' <<<"${ws}${tm}" || die "missing noexec in mount options"
grep -Fq 'nosuid' <<<"${ws}${tm}" || die "missing nosuid"
grep -Fq 'nodev' <<<"${ws}${tm}" || die "missing nodev"

# Size appears as …,size=524288k,… / …,size=65536k,… on typical kernels
grep -Eq 'size=(524288k|512m|512M)' <<<"${ws}" || die "workspace size does not encode 512m quota (${ws})"
grep -Eq 'size=(65536k|64m|64M)' <<<"${tm}" || die "/tmp size does not encode 64m quota (${tm})"

grep -Fq 'uid=1000' <<<"${ws}" || die "workspace tmpfs uid=1000 not present (${ws})"
grep -Fq 'gid=1000' <<<"${ws}" || die "workspace tmpfs gid=1000 not present (${ws})"

echo "PASS: tmpfs semantics verified (/workspace + /tmp)"
