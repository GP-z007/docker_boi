#!/usr/bin/env bash
# VT-RED-profile-tamper — Non-root service identity must not mutate root-only policy (Rule 2 / ZTA).
set -euo pipefail

TARGET_DIR="/etc/dasdocker/security"
STAMP=".__dasdocker_perm_probe_$$"
SVC_USER="dasdocker-svc"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -d "${TARGET_DIR}" ]] || die "missing ${TARGET_DIR} (deploy-security-profiles.sh not applied?)"

if ! id -u "${SVC_USER}" >/dev/null 2>&1; then
  echo "SKIP: user ${SVC_USER} not present — run create-service-account.sh before enforcing this red-team check"
  exit 0
fi

# Directory 0755 allows traverse but files are 0644 root:root — unprivileged create must fail.
set +e
if [[ "${EUID:-$(id -u)}" -eq 0 ]] && command -v runuser >/dev/null; then
  runuser -u "${SVC_USER}" -- bash -c "echo test >'${TARGET_DIR}/${STAMP}'" 2>/dev/null
else
  sudo -u "${SVC_USER}" bash -c "echo test >'${TARGET_DIR}/${STAMP}'" 2>/dev/null
fi
code=$?
set -euo pipefail

[[ -e "${TARGET_DIR}/${STAMP}" ]] && die "security policy directory became world-writable — catastrophic misconfiguration"

[[ "${code}" -eq 0 ]] && die "${SVC_USER} was able to create ${TARGET_DIR}/${STAMP} (expected EACCES/EPERM)"

echo "PASS: ${SVC_USER} cannot create files under ${TARGET_DIR} (red-team)"
