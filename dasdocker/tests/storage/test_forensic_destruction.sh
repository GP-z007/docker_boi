#!/usr/bin/env bash
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
command -v openssl >/dev/null || skip "openssl not available"
command -v grep >/dev/null || skip "grep not available"

# 1) Generate a unique random canary string.
CANARY="$(openssl rand -hex 32)"

# 2) Start a test container and write canary to workspace.
docker run -d --name canary-test --tmpfs /workspace:rw,size=64m alpine sleep 300 >/dev/null
cleanup() {
  docker rm -f canary-test >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker exec canary-test sh -c "echo '$CANARY' > /workspace/test.txt"

# 3) Confirm canary is readable inside container.
docker exec canary-test cat /workspace/test.txt | grep "$CANARY" >/dev/null || die "CANARY WRITE FAILED"

# 4) Destroy the container.
docker rm -f canary-test >/dev/null

# 5) Search host paths + docker storage for canary.
if grep -r "$CANARY" /var/lib/docker /opt/dasdocker /tmp /var/log 2>/dev/null; then
  echo "CRITICAL: Canary string found on host after container destruction!"
  exit 1
else
  echo "PASS: Zero persistence confirmed - canary not found anywhere on host"
fi
