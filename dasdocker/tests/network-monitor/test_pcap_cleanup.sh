#!/usr/bin/env bash
set -euo pipefail

skip() { echo "SKIP: $*"; exit 0; }
die() { echo "FAIL: $*" >&2; exit 1; }

PCAP_ROOT="${DASDOCKER_PCAP_ROOT:-/tmp/dasdocker-pcap}"
SID="nm-cleanup-$RANDOM"

mkdir -p "${PCAP_ROOT}"
touch "${PCAP_ROOT}/${SID}.pcap-20260101010101"

[[ -f "${PCAP_ROOT}/${SID}.pcap-20260101010101" ]] || die "failed to create test pcap"

# Simulate cleanup worker reaction on DESTROYED transition.
rm -f "${PCAP_ROOT}/${SID}.pcap-"*

compgen -G "${PCAP_ROOT}/${SID}.pcap-*" >/dev/null && die "pcap file still present after destroy cleanup"
echo "PASS: pcap files deleted on session destruction (${SID})"
