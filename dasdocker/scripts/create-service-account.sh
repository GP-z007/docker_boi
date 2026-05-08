#!/usr/bin/env bash
# create-service-account.sh — Provision dasDocker non-root service identity (ADR-008 D-001/D-002).
# Justification (ZTA / least privilege): Orchestrator MUST NOT run as root; Docker API access is
# delegated via UNIX group `docker` membership with socket 660 root:docker (T-S06-001).
set -euo pipefail

SERVICE_USER="dasdocker-svc"
HOME_DIR="/opt/dasdocker"
# World cannot traverse home — operators use sudo for break-glass admin (T-S05-004 / filesystem integrity).
HOME_MODE="0750"
ORCH_HOME_VAR="/opt/dasdocker/var"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "error: must run as root (sudo)" >&2
  exit 1
fi

if ! id -u "${SERVICE_USER}" &>/dev/null; then
  # --system: predictable low UID reserved for daemon class; shell nologin blocks interactive abuse.
  useradd \
    --system \
    --user-group \
    --home-dir "${HOME_DIR}" \
    --create-home \
    --shell /usr/sbin/nologin \
    "${SERVICE_USER}"
fi

chmod "${HOME_MODE}" "${HOME_DIR}"
chown "${SERVICE_USER}:${SERVICE_USER}" "${HOME_DIR}"

install -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0750 -d "${ORCH_HOME_VAR}"

# Docker group: REQUIRED so dasdocker-svc can talk to /var/run/docker.sock without running as root.
# Security implication: docker group is effectively root-equivalent on the node — restrict membership
# to break-glass admins + this single svc account; never add human users in prod (STRIDE T-S06-001).
if getent group docker >/dev/null; then
  usermod -aG docker "${SERVICE_USER}"
else
  echo "warn: docker group missing — run install-docker.sh before granting socket access (T-S06-001 workflow)" >&2
fi

install -m 0644 -o root -g root \
  "$(dirname "$0")/../systemd/dasdocker-orchestrator.service" \
  /etc/systemd/system/dasdocker-orchestrator.service

systemctl daemon-reload

echo "ok: ${SERVICE_USER} configured; review docker group implication before enabling orchestrator."
