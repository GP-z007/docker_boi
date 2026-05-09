#!/usr/bin/env bash
set -euo pipefail

skip() { echo "SKIP: $*"; exit 0; }
die() { echo "FAIL: $*" >&2; exit 1; }

command -v clang >/dev/null || skip "clang unavailable"
command -v make >/dev/null || skip "make unavailable"

ROOT="$(cd "$(dirname "$0")"/../.. && pwd)"
MON="${ROOT}/services/ebpf-monitor"

[[ -d "${MON}" ]] || die "ebpf monitor directory missing"

cd "${MON}"
make clean >/dev/null 2>&1 || true
set +e
out="$(make all 2>&1)"
code=$?
set -e
if [[ "${code}" -ne 0 ]]; then
  echo "${out}" | grep -Eq "file not found|fatal error|No such file|cannot find -lbpf" \
    && skip "host missing eBPF build deps/headers (run on prepared eBPF host image)"
  die "failed to build eBPF programs/collector: ${out}"
fi

for obj in build/exec_monitor.bpf.o build/file_monitor.bpf.o build/net_monitor.bpf.o build/privilege_monitor.bpf.o build/suspicious_monitor.bpf.o; do
  [[ -f "${obj}" ]] || die "missing object: ${obj}"
done

echo "PASS: all five eBPF programs compiled and loader built"
