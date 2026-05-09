#!/usr/bin/env bash
set -euo pipefail

skip() { echo "SKIP: $*"; exit 0; }
die() { echo "FAIL: $*" >&2; exit 1; }

command -v docker >/dev/null || skip "docker unavailable"
command -v redis-cli >/dev/null || skip "redis-cli unavailable"
docker info >/dev/null 2>&1 || skip "docker daemon unavailable"
redis-cli ping >/dev/null 2>&1 || skip "redis unavailable"
[[ "${DASDOCKER_NETWORK_MONITOR_RUNNING:-0}" == "1" ]] || skip "set DASDOCKER_NETWORK_MONITOR_RUNNING=1"

SID="nm-http-$RANDOM"
CID="nm-http-$RANDOM"
STREAM="dasdocker:events:${SID}"

cleanup() { docker rm -f "${CID}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "${CID}" --network dasdocker-isolated --label "dasdocker.session_id=${SID}" alpine sleep 120 >/dev/null
docker exec "${CID}" sh -c "wget -q -O- http://example.com >/dev/null 2>&1 || true"

sleep 2
rows="$(redis-cli XREVRANGE "${STREAM}" + - COUNT 20 2>/dev/null || true)"
echo "${rows}" | grep -Eq "network_event|http_request" || die "http network_event not observed for ${SID}"
echo "PASS: HTTP request observed in Redis stream ${STREAM}"
