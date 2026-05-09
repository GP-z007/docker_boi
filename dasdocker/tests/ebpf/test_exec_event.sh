#!/usr/bin/env bash
set -euo pipefail

skip() { echo "SKIP: $*"; exit 0; }
die() { echo "FAIL: $*" >&2; exit 1; }

command -v docker >/dev/null || skip "docker unavailable"
command -v redis-cli >/dev/null || skip "redis-cli unavailable"
docker info >/dev/null 2>&1 || skip "docker daemon unavailable"
redis-cli ping >/dev/null 2>&1 || skip "redis not reachable"

[[ "${DASDOCKER_EBPF_MONITOR_RUNNING:-0}" == "1" ]] || skip "set DASDOCKER_EBPF_MONITOR_RUNNING=1 when collector is running"

SID="ebpf-exec-$RANDOM"
STREAM="dasdocker:events:${SID}"
CID="ebpf-exec-test-${RANDOM}"

cleanup() {
  docker rm -f "${CID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

CGID="$(docker run -d --name "${CID}" --label "dasdocker.session_id=${SID}" alpine sleep 120)"
CGROUP_ID="$(docker inspect -f '{{.HostConfig.CgroupParent}}' "${CGID}" >/dev/null 2>&1 || true)"

[[ -n "${CGID}" ]] || die "failed to start test container"
docker exec "${CID}" ls -la >/dev/null

# Expected contract: collector maps cgroup_id -> session_id via control event.
redis-cli publish dasdocker:control:container_started \
  "{\"event\":\"container:started\",\"container_id\":\"${CGID}\",\"cgroup_id\":\"${CGROUP_ID}\",\"session_id\":\"${SID}\"}" >/dev/null || true

deadline=$((SECONDS + 1))
found=0
while (( SECONDS <= deadline )); do
  row="$(redis-cli XREVRANGE "${STREAM}" + - COUNT 5 2>/dev/null || true)"
  if echo "${row}" | grep -Eq "process_event|exec"; then
    found=1
    break
  fi
done

[[ "${found}" -eq 1 ]] || die "process_event not observed on ${STREAM} within 1s"
echo "PASS: exec event observed in ${STREAM}"
