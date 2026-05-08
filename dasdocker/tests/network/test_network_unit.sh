#!/usr/bin/env bash
# VT-UNIT-S08 — Static assertions on signed NR-* policy file (Rule 2).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RULES="${ROOT}/config/network/iptables-dasdocker.rules"
DNSC="${ROOT}/config/network/dnsmasq-dasdocker.conf"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

ok() {
  printf 'ok %s\n' "$*"
}

[[ -f "${RULES}" ]] || die "missing ${RULES}"
[[ -f "${DNSC}" ]] || die "missing ${DNSC}"

grep -q '^:DASDOCKER-FORWARD' "${RULES}" || die "missing DASDOCKER-FORWARD chain declaration"
grep -Fq 'DASDOCKER_LAN_BLOCK' "${RULES}" || die "missing LOG prefix DASDOCKER_LAN_BLOCK (RFC1918 enforcement)"
grep -Fq 'DASDOCKER_HOST_BLOCK' "${RULES}" || die "missing LOG prefix DASDOCKER_HOST_BLOCK (host mgmt block)"
grep -Fq 'NR-014' "${RULES}" && grep -Fq 'ICC' "${RULES}" || die "missing NR-014 inter-container / ICC rationale"
grep -Fq 'NR-013' "${RULES}" && grep -Fq 'MASQUERADE' "${RULES}" || die "missing NR-013 MASQUERADE egress policy"
grep -Fq 'NR-018' "${RULES}" || die "missing NR-018 external DNS UDP block"

ok "≥6 iptables policy fragments present in ${RULES##*/}"

grep -Eq '^listen-address=172\.31\.0\.1$' "${DNSC}" \
  || die "dnsmasq must bind ONLY 172.31.0.1 (never 0.0.0.0 per ZTA)"

grep -Fq 'local=/corp/' "${DNSC}" || die "dnsmasq TLD sink missing .corp policy"

grep -Fq 'bogus-priv' "${DNSC}" || die "dnsmasq bogus-priv missing"

ok "DNS sinkhole config binds gateway IP only + internal TLD stubs"
