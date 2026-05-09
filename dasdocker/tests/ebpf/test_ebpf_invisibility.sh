#!/usr/bin/env bash
set -euo pipefail

skip() { echo "SKIP: $*"; exit 0; }
die() { echo "FAIL: $*" >&2; exit 1; }

command -v docker >/dev/null || skip "docker unavailable"
docker info >/dev/null 2>&1 || skip "docker daemon unavailable"

CID="ebpf-invisible-${RANDOM}"
cleanup() { docker rm -f "${CID}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "${CID}" alpine sleep 120 >/dev/null

tp="$(docker exec "${CID}" sh -c "cat /proc/self/status | grep -n 'TracerPid' || true" || true)"
echo "${tp}" | grep -Eq "TracerPid:[[:space:]]*0" || die "TracerPid is not zero in container"

# Best-effort: container must not be able to inspect host kernel ring buffer/logs.
docker exec "${CID}" sh -c "dmesg >/dev/null 2>&1" && die "dmesg unexpectedly readable inside container"

echo "PASS: monitoring remains invisible from container user space (TracerPid=0, dmesg blocked)"
