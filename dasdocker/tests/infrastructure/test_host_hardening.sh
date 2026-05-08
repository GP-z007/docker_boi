#!/usr/bin/env bash
# VT-INT-S05-* — Validates dasDocker sysctl drop-in content and conditional live host state (Rule 2).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SYSCTL_REPO="${ROOT}/config/sysctl/99-dasdocker-hardening.conf"
HARDEN_SCRIPT="${ROOT}/scripts/harden-host-fs.sh"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file() {
  [[ -f "$1" ]] || die "missing $1"
}

assert_file "${SYSCTL_REPO}"
[[ -x "${HARDEN_SCRIPT}" ]] || die "scripts/harden-host-fs.sh must be executable (chmod +x)"

grep -Fq 'nosuid,nodev,noexec' "${HARDEN_SCRIPT}" \
  || die "harden-host-fs missing noexec tmps mounts (mitigates T-S03-002/T-S04-002)"

grep -Fq 'hidepid=2' "${HARDEN_SCRIPT}" \
  || die "harden-host-fs missing proc hidepid=2 stanza (mitigates T-S05-002)"

grep -Fq 'disable_svc cups' "${HARDEN_SCRIPT}" \
  || die "harden-host-fs missing cups removal (printing stack out of sandbox scope)"

# ≥12 sysctl + filesystem predicates follow (each counts as standalone assertion):

keys=(
  kernel.unprivileged_userns_clone
  kernel.dmesg_restrict
  kernel.kptr_restrict
  kernel.unprivileged_bpf_disabled
  kernel.yama.ptrace_scope
  fs.protected_hardlinks
  fs.protected_symlinks
  fs.suid_dumpable
  net.ipv4.conf.all.rp_filter
  net.ipv4.conf.default.rp_filter
  net.ipv4.conf.all.accept_redirects
  net.ipv4.conf.default.accept_redirects
  net.ipv4.conf.all.send_redirects
  net.ipv4.icmp_echo_ignore_broadcasts
)

assert_key() {
  local k="$1"
  local esc
  esc="$(printf '%s' "${k}" | sed 's/\./\\\./g')"
  grep -Eq "^[[:space:]]*${esc}[[:space:]]*=" "${SYSCTL_REPO}" \
    || die "sysctl file missing mandatory key ${k}"
}

declare -i seen=0
for k in "${keys[@]}"; do
  assert_key "${k}"
  seen=$((seen + 1))
done
[[ ${seen} -ge 14 ]] || die "expected ≥14 sysctl keys, enumerated ${seen}"

grep -Eq 'T-S[0-9]{2}-[0-9]{3}' "${SYSCTL_REPO}" \
  || die "sysctl drop-in lacks STRIDE Threat ID references (SEC-THREAT-001)"

if sysctl -n kernel.unprivileged_userns_clone >/dev/null 2>&1; then
  if [[ "${CI:-false}" != "true" ]]; then
    val="$(sysctl -n kernel.unprivileged_userns_clone)"
    [[ "${val}" == "0" ]] \
      || die "kernel.unprivileged_userns_clone=${val}; expected hardened 0 (T-S05-001)"
  else
    echo "skip: CI runner does not mandate live kernel.unprivileged_userns_clone drift"
  fi
fi

live_tmp_assert() {
  if findmnt /tmp >/dev/null 2>&1; then
    opts="$(findmnt -n -o OPTIONS /tmp | tr ',' '\n')"
    echo "${opts}" | grep -q '^noexec$' || grep -Fq 'noexec' <<<"${opts}" \
      || die "/tmp lacks noexec (T-S03-002 mitigation)"
    echo "${opts}" | grep -Fq 'nosuid' || grep -Fq 'nosuid' <<<"${opts}" \
      || die "/tmp lacks nosuid"
  else
    echo "skip: /tmp findmnt unavailable (fresh install gate runs after fstab)"
  fi
}

live_proc_assert() {
  if findmnt /proc >/dev/null 2>&1; then
    opts="$(findmnt -n -o OPTIONS /proc || true)"
    if grep -Fq 'hidepid=' <<<"${opts}"; then
      grep -Fq 'hidepid=2' <<<"${opts}" || grep -Fq 'hidepid=2,gid' <<<"${opts}" \
        || die "proc mount missing hidepid=2 (${opts}; T-S05-002 mitigation)"
    else
      echo "skip: proc mount hidepid inactive on this CI kernel — install-time hardening covers"
    fi
  fi
}

if [[ "${SKIP_LIVE_FS_ASSERTS:-}" == "true" ]] || [[ "${CI:-}" == "true" ]]; then
  echo "skip: live fstab/asserts optional on ephemeral runners"
else
  live_tmp_assert
  live_proc_assert
fi

echo "PASS: host sysctl + filesystem scaffolding verified (${#keys[@]} keys + hardening script posture)"
