#!/usr/bin/env bash
set -euo pipefail

skip() { echo "SKIP: $*"; exit 0; }
die() { echo "FAIL: $*" >&2; exit 1; }

command -v docker >/dev/null || skip "docker unavailable"
command -v redis-cli >/dev/null || skip "redis-cli unavailable"
docker info >/dev/null 2>&1 || skip "docker daemon unavailable"
redis-cli ping >/dev/null 2>&1 || skip "redis not reachable"

[[ "${DASDOCKER_EBPF_MONITOR_RUNNING:-0}" == "1" ]] || skip "set DASDOCKER_EBPF_MONITOR_RUNNING=1 when collector is running"

SID="ebpf-net-$RANDOM"
STREAM="dasdocker:events:${SID}"
CID="ebpf-net-test-${RANDOM}"

cleanup() {
  docker rm -f "${CID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "${CID}" --label "dasdocker.session_id=${SID}" alpine sleep 120 >/dev/null
docker exec "${CID}" sh -c "wget -q -O- http://example.com >/dev/null 2>&1 || true"

deadline=$((SECONDS + 3))
found=0
while (( SECONDS <= deadline )); do
  row="$(redis-cli XREVRANGE "${STREAM}" + - COUNT 10 2>/dev/null || true)"
  if echo "${row}" | grep -Eq "network_event|connect|80"; then
    found=1
    break
  fi
done

[[ "${found}" -eq 1 ]] || die "network_event with dst_port 80 not observed on ${STREAM}"
echo "PASS: network_event observed in ${STREAM}"
