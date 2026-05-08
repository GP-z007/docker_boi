#!/usr/bin/env bash
# deploy-security-profiles.sh — Idempotent seccomp + AppArmor distribution (Phase 2 / Rule 1 ZTA).
# Permissions: /etc/dasdocker/security is 0755 root:root (world-traverse only; writes root-only);
# profile blobs 0644 root:root so dasdocker-svc cannot tamper (VT-RED profile-perms).
set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "error: must run as root (sudo)" >&2
  exit 1
fi

# Default layout matches platform contract: sync repo under /opt/dasdocker (Agent 18 home tree).
: "${DASDOCKER_ROOT:=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SEC_SRC="${DASDOCKER_ROOT}/config/security/seccomp-dasdocker.json"
AA_SRC="${DASDOCKER_ROOT}/config/security/apparmor-dasdocker.profile"
SEC_DST_DIR="/etc/dasdocker/security"
SEC_DST="${SEC_DST_DIR}/seccomp-dasdocker.json"
AA_DST="/etc/apparmor.d/dasdocker-container"

[[ -f "${SEC_SRC}" ]] || {
  echo "error: missing seccomp source ${SEC_SRC}" >&2
  exit 1
}
[[ -f "${AA_SRC}" ]] || {
  echo "error: missing AppArmor source ${AA_SRC}" >&2
  exit 1
}

# 0755: operators need traverse to audit; only root can create files (sticky umask + root ownership).
install -d -m 0755 -o root -g root "${SEC_DST_DIR}"
install -m 0644 -o root -g root "${SEC_SRC}" "${SEC_DST}"
install -m 0644 -o root -g root "${AA_SRC}" "${AA_DST}"

if ! command -v apparmor_parser >/dev/null; then
  echo "error: apparmor_parser not installed (apparmor package)" >&2
  exit 1
fi

apparmor_parser -r -W "${AA_DST}"

UNIT_SRC="${DASDOCKER_ROOT}/systemd/dasdocker-security-profiles.service"
if [[ -f "${UNIT_SRC}" && "${DASDOCKER_INSTALL_SYSTEMD_UNIT:-1}" == "1" ]]; then
  if [[ "${DASDOCKER_ROOT}" == "/opt/dasdocker" ]] || [[ "${DASDOCKER_FORCE_SYSTEMD_UNIT:-0}" == "1" ]]; then
    install -m 0644 -o root -g root "${UNIT_SRC}" /etc/systemd/system/dasdocker-security-profiles.service
    systemctl daemon-reload
    systemctl enable dasdocker-security-profiles.service
  else
    echo "warn: skip systemd unit install (DASDOCKER_ROOT=${DASDOCKER_ROOT}; use tree at /opt/dasdocker or set DASDOCKER_FORCE_SYSTEMD_UNIT=1)." >&2
  fi
fi

# Smoke: AppArmor profile parse result visible in kernel audit of parser; runtime check via aa-status.
if ! aa-status --enabled 2>/dev/null; then
  echo "warn: AppArmor not enabled on this kernel — aa-status check skipped" >&2
else
  aa-status | grep -Fq dasdocker-container || {
    echo "error: profile dasdocker-container not reported by aa-status" >&2
    exit 1
  }
fi

if ! command -v jq >/dev/null; then
  echo "warn: jq not installed — skipping seccomp JSON structural parse" >&2
else
  jq -e '.defaultAction == "SCMP_ACT_ERRNO" and .defaultErrnoRet == 1' "${SEC_DST}" >/dev/null
fi

echo "ok: seccomp -> ${SEC_DST}; AppArmor -> ${AA_DST}; systemd unit enabled (if shipped)."
