#!/usr/bin/env bash
# VT-INT-S04-002 / T-S05-004 — AppArmor enforce + denied gadget path (Rule 2).
set -euo pipefail

PROFILE="dasdocker-container"
AA_RULE="/etc/apparmor.d/${PROFILE}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "${AA_RULE}" ]] || die "missing ${AA_RULE} (run deploy-security-profiles.sh)"

if aa-status --enabled 2>/dev/null; then
  aa-status | grep -Fq "${PROFILE}" || die "profile ${PROFILE} not loaded (check apparmor_parser -r)"
else
  die "AppArmor not enabled — cannot validate LSM gate"
fi

command -v docker >/dev/null || die "docker CLI required"
docker info >/dev/null 2>&1 || die "Docker daemon not reachable"

# /proc/sysrq-trigger is explicitly denied by profile; expect operator permission failure inside container.
tmp="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp}"
}
trap cleanup EXIT

set +e
docker run --rm \
  --security-opt "apparmor=${PROFILE}" \
  alpine:3.19 \
  cat /proc/sysrq-trigger >"${tmp}/out" 2>"${tmp}/err"
code=$?
set -euo pipefail

if [[ "${code}" -eq 0 ]]; then
  die "cat /proc/sysrq-trigger should be denied under ${PROFILE}; host regression"
fi

echo "PASS: AppArmor profile ${PROFILE} loaded and blocks sysctl/sysrq gadget read (exit ${code})"
