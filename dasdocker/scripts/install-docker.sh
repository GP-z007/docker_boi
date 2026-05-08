#!/usr/bin/env bash
# install-docker.sh — Pin Docker Engine to a audited minor for supply-chain reproducibility (ADR-008 D-002).
# Justification (ZTA): `latest` is non-deterministic for CVE regressions — explicit pin enables rollback.
set -euo pipefail

# Pinned Ubuntu 22.04 (jammy) docker-ce version — bump only after trivy/govulncheck review.
DOCKER_CE_VERSION="${DASDOCKER_DOCKER_CE_VERSION:-5:25.0.5-1~ubuntu.22.04~jammy}"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "error: must run as root (sudo)" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release

install -d -m 0755 /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" >/etc/apt/sources.list.d/docker.list

apt-get update -y
apt-get install -y "docker-ce=${DOCKER_CE_VERSION}" "docker-ce-cli=${DOCKER_CE_VERSION}" containerd.io docker-buildx-plugin docker-compose-plugin

# Hold package to prevent unpinned upgrades breaking orchestrator API contracts.
apt-mark hold docker-ce docker-ce-cli

install -d -m 0755 /etc/docker
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
install -m 0644 -o root -g root "${SCRIPT_DIR}/../config/docker/daemon.json" /etc/docker/daemon.json

# Socket hardening: 660 root:docker — world must never read Docker API (T-S06-001).
chown root:docker /var/run/docker.sock 2>/dev/null || true
chmod 660 /var/run/docker.sock 2>/dev/null || true

systemctl enable --now docker.service

docker version
