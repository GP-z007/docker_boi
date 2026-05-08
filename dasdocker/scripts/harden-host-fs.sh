#!/usr/bin/env bash
# harden-host-fs.sh — Filesystem & non-essential daemon reductions for dasDocker nodes (ADR-008 D-001).
# Each change cites STRIDE / threat class in comments (Rule 1 — justified permissions & surface).
set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "error: must run as root (sudo)" >&2
  exit 1
fi

FSTAB="/etc/fstab"
TMP_LINE='tmpfs /tmp tmpfs rw,nosuid,nodev,noexec,relatime,size=2G 0 0'

if ! grep -Eq '[[:space:]]/tmp[[:space:]]+tmpfs' "${FSTAB}" 2>/dev/null; then
  # noexec,nosuid,nodev on /tmp — blocks dropped malicious binary execution & setuid abuse (T-S03-002, T-S04-002).
  echo "${TMP_LINE}" >>"${FSTAB}"
fi
mountpoint -q /tmp && mount -o remount,nosuid,nodev,noexec /tmp 2>/dev/null || mount -a

if mountpoint -q /proc; then
  # hidepid=2 — hides foreign /proc entries from unprivileged users reducing ASLR mapping leaks (T-S05-002).
  mount -o remount,rw,nosuid,nodev,noexec,hidepid=2 /proc 2>/dev/null || echo "warn: hidepid proc remount unsupported on this kernel — document manual CIS proc mount (T-S05-002)" >&2
fi

# Strip world-writable bits under /etc and /opt — reduces TOCTOU & clutter persistence (T-S05-004).
find /etc /opt -xdev -type d -perm -0002 -exec chmod o-w {} + 2>/dev/null || true
find /etc /opt -xdev -type f -perm -0002 -exec chmod o-w {} + 2>/dev/null || true

disable_svc() {
  local u="$1"
  local reason="$2"
  if systemctl list-unit-files "${u}.service" &>/dev/null; then
    systemctl disable --now "${u}.service" 2>/dev/null || true
    echo "disabled ${u}: ${reason}"
  fi
}

# avahi-daemon — mDNS reflection aids reconnaissance in shared labs (T-S08-003) — not needed on headless sandboxes.
disable_svc avahi-daemon "mDNS surface not required (T-S08-003 Information Disclosure class)"
# cups — print stack is unrelated attack surface (T-S05-003 DoS / supply chain).
disable_svc cups "printing stack out of scope for sandbox workers"
# bluetooth — radio stack unused on server role (T-S05-003 / radio attack surface).
disable_svc bluetooth "Bluetooth not required for dasDocker control/data plane"

echo "ok: filesystem hardening applied — verify mounts with findmnt /tmp /proc"
