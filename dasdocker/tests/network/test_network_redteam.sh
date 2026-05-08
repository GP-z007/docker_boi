#!/usr/bin/env bash
# VT-RED-S08 adversarial egress suite (requires docker + applied iptables).
set -euo pipefail

NET="${DASDOCKER_ISOLATED_NET:-dasdocker-isolated}"
IMG="alpine:3.19"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

skip() {
  echo "SKIP: $*"
  exit 0
}

die() {
  echo "FAIL: $*" >&2
  exit 1
}

command -v docker >/dev/null || skip "docker unavailable"
docker info >/dev/null 2>&1 || skip "docker daemon down"
docker network inspect "${NET}" >/dev/null 2>&1 || skip "${NET} missing"

# 1 — LAN-style TCP probe simulation (RFC1918) — NR-004/005/006
docker run --rm --network "${NET}" "${IMG}" sh -eu -c '
  apk add -q netcat-openbsd
  if nc -z -w 3 192.168.100.99 8443; then exit 199; fi
'
ncode=$?
[[ "${ncode}" -eq 0 ]] || die "expected blocked path to 192.168.100.99:8443 (container exit ${ncode})"

# 2 — DNS tunneling-style external resolver bypass (NR-018)
set +e
docker run --rm --network "${NET}" "${IMG}" sh -eu -c '
  apk add -q bind-tools
  dig @1.1.1.1 example.com +notcp +time=3 +tries=1 >/dev/null
'
dcode=$?
set -euo pipefail
[[ "${dcode}" -ne 0 ]] || die "UDP DNS to upstream 1.1.1.1 should fail (tunnel/bypass)"

# 3 — ICMP toward host-derived management IP placeholder (simulate metadata abuse)
mgmt="${DASDOCKER_HOST_MGMT_IP:-}"
[[ -z "${mgmt}" ]] && mgmt="$(ip -4 route get 8.8.8.8 2>/dev/null | awk '{for(i=1;i<NF;i++) if ($i=="src"){print $(i+1); exit}}')" || true
[[ -n "${mgmt}" ]] || skip "cannot derive host mgmt IP on this runner"

set +e
docker run --rm --network "${NET}" "${IMG}" ping -n -c 1 -W 1 "${mgmt}" >/dev/null 2>&1
pcode=$?
set -euo pipefail
[[ "${pcode}" -ne 0 ]] || die "ICMP to host management IP (${mgmt}) must be denied (NR-016/NR-010)"

# 4 — Setup idempotency: double apply should not multiply DOCKER-USER jumps
SETUP="${ROOT}/scripts/setup-network.sh"
[[ -x "${SETUP}" ]] || skip "setup-network.sh not executable"

if [[ "${EUID:-0}" -ne 0 ]]; then
  skip "iptables idempotency test requires root (sudo ${SETUP} apply-iptables x2)"
fi

lines() {
  iptables -t filter -S DOCKER-USER 2>/dev/null | grep -c -- '-j DASDOCKER-FORWARD' || true
}
before="$(lines)"
bash "${SETUP}" apply-iptables >/dev/null
after="$(lines)"
[[ "${before}" -eq "${after}" ]] || die "DOCKER-USER DASDOCKER-FORWARD jump count unstable (${before}!=${after}) after re-apply"

echo "PASS: red-team LAN/DNS bypass/ICMP tests + iptables idempotency"
