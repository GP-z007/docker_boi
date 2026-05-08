#!/usr/bin/env bash
# VT-INT-S08-* — Live container egress behaviour (requires docker + provisioned dasdocker-isolated).
set -euo pipefail

NET="${DASDOCKER_ISOLATED_NET:-dasdocker-isolated}"

skip() {
  echo "SKIP: $*"
  exit 0
}

die() {
  echo "FAIL: $*" >&2
  exit 1
}

command -v docker >/dev/null || skip "docker CLI absent"
docker info >/dev/null 2>&1 || skip "docker daemon unavailable"
docker network inspect "${NET}" >/dev/null 2>&1 || skip "network ${NET} missing — run setup-network.sh provision"

IMG="alpine:3.19"

# 1 — Permitted WAN HTTPS (NR-009)
docker run --rm --network "${NET}" "${IMG}" sh -eu -c '
  apk add -q curl
  curl -fsS --max-time 25 https://example.com >/dev/null
' || die "HTTPS to internet should succeed (NR-009)"

# 2 — RFC1918 10/8 blocked (NR-004)
set +e
docker run --rm --network "${NET}" "${IMG}" sh -eu -c '
  apk add -q curl
  curl -fsS --max-time 5 http://10.42.42.42:12345 >/dev/null
' >/dev/null 2>&1
code=$?
set -euo pipefail
[[ "${code}" -ne 0 ]] || die "expected failure reaching 10.42.42.42 from sandbox"

# 3 — ICC / east-west isolation (NR-014) — second container pings first
cid="$(docker run -d --network "${NET}" "${IMG}" sleep 120)"
cleanup() {
  docker rm -f "${cid}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ip_primary="$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${cid}")"
[[ -n "${ip_primary}" ]] || die "container IP unavailable"

set +e
docker run --rm --network "${NET}" "${IMG}" ping -c 2 -W 2 "${ip_primary}" >/dev/null 2>&1
pcode=$?
set -euo pipefail
[[ "${pcode}" -ne 0 ]] || die "inter-container ICMP should fail (ICC + NR-014)"

# 4 — Sinkhole resolver path (NR-002) optional if dnsmasq running
set +e
docker run --rm --network "${NET}" "${IMG}" sh -eu -c '
  apk add -q bind-tools
  dig @172.31.0.1 example.com +time=3 +tries=1 +short | head -n1 | grep -E "^[0-9.]+$" >/dev/null
'
dcode=$?
set -euo pipefail
if [[ "${dcode}" -ne 0 ]]; then
  echo "warn: dnsmasq probe failed — ensure dasdocker-dnsmasq.service active (skipped hard fail)"
else
  echo "ok dnsmasq reachable on gateway"
fi

# 5 — NR-018: external UDP/53 recursion must fail (iptables must be applied on host)
set +e
docker run --rm --network "${NET}" "${IMG}" sh -eu -c '
  apk add -q bind-tools
  dig @8.8.8.8 example.com +time=3 +tries=1 +short >/dev/null
'
d8=$?
set -euo pipefail
[[ "${d8}" -ne 0 ]] || die "direct dig @8.8.8.8 should fail (NR-018 sinkhole mandate)"

# 6 — ICMP to example.com unreachable (NR-016 default deny)
set +e
docker run --rm --network "${NET}" "${IMG}" ping -4 -c 1 -W 2 example.com >/dev/null 2>&1
iping=$?
set -euo pipefail
[[ "${iping}" -ne 0 ]] || die "ICMP egress should not succeed for sandbox (NR-016)"

echo "PASS: integration matrix satisfied (WAN OK, LAN/ICC/external-DNS blocked, ICMP denied)"
