#!/usr/bin/env bash
set -euo pipefail

skip() { echo "SKIP: $*"; exit 0; }
die() { echo "FAIL: $*" >&2; exit 1; }

command -v docker >/dev/null || skip "docker unavailable"
command -v redis-cli >/dev/null || skip "redis-cli unavailable"
docker info >/dev/null 2>&1 || skip "docker daemon unavailable"
redis-cli ping >/dev/null 2>&1 || skip "redis not reachable"

[[ "${DASDOCKER_EBPF_MONITOR_RUNNING:-0}" == "1" ]] || skip "set DASDOCKER_EBPF_MONITOR_RUNNING=1 when collector is running"

SID_A="scope-a-$RANDOM"
SID_B="scope-b-$RANDOM"
STREAM_A="dasdocker:events:${SID_A}"
STREAM_B="dasdocker:events:${SID_B}"
CID_A="scope-a-${RANDOM}"
CID_B="scope-b-${RANDOM}"

cleanup() {
  docker rm -f "${CID_A}" "${CID_B}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "${CID_A}" --label "dasdocker.session_id=${SID_A}" alpine sleep 120 >/dev/null
docker run -d --name "${CID_B}" --label "dasdocker.session_id=${SID_B}" alpine sleep 120 >/dev/null

docker exec "${CID_A}" ls >/dev/null
docker exec "${CID_B}" ls >/dev/null

sleep 1
rows_a="$(redis-cli XREVRANGE "${STREAM_A}" + - COUNT 10 2>/dev/null || true)"
rows_b="$(redis-cli XREVRANGE "${STREAM_B}" + - COUNT 10 2>/dev/null || true)"

echo "${rows_a}" | grep -Eq "${SID_B}" && die "cross-contamination detected: session B data in stream A"
echo "${rows_b}" | grep -Eq "${SID_A}" && die "cross-contamination detected: session A data in stream B"

echo "PASS: no cross-session event contamination observed"
