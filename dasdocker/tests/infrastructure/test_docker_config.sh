#!/usr/bin/env bash
# VT-INT-S04/S06 — daemon.json structural validation + conditional socket assertions (ADR-008 D-002).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CFG="${ROOT}/config/docker/daemon.json"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

command -v jq >/dev/null || die "jq required for docker daemon contract tests"

jq -e . >/dev/null 2>&1 <"${CFG}" || die "daemon.json invalid JSON"

[[ "$(jq -r '.icc' "${CFG}")" == "false" ]] || die "daemon icc must be false (ICC bridge abuse / T-S04-004)"

[[ "$(jq -r '."live-restore"' "${CFG}")" == "true" ]] \
  || die "live-restore enables safe daemon upgrades without session drop (availability / T-S04-004)"

[[ "$(jq -r '."userland-proxy"' "${CFG}")" == "false" ]] \
  || die "userland-proxy=false enforces iptables path (deterministic NAT / T-S08-001)"

[[ "$(jq -r '."no-new-privileges"' "${CFG}")" == "true" ]] \
  || die "no-new-privileges MUST default true (T-S04-002)"

[[ "$(jq -r '."log-driver"' "${CFG}")" == "json-file" ]] \
  || die "structured json-file logging prerequisite for Fluent Bit ingestion (ADR D-007)"

[[ "$(jq -r '."log-opts"."max-size"' "${CFG}")" == "10m" ]] \
  || die "log rotation max-size 10m mitigation for disk DoS (T-S10-003)"

[[ "$(jq -r '."log-opts"."max-file"' "${CFG}")" == "3" ]] \
  || die "bounded max-file retains forensics tail without WAL growth (T-S10-003)"

[[ "$(jq -r '."storage-driver"' "${CFG}")" == "overlay2" ]] \
  || die "overlay2 mandated for deterministic graph driver (supply chain reproducibility)"

soft="$(jq -r '."default-ulimits".nofile.Soft' "${CFG}")"
hard="$(jq -r '."default-ulimits".nofile.Hard' "${CFG}")"
[[ "${soft}" == "1024" && "${hard}" == "1024" ]] \
  || die "default ulimits must cap nofile 1024 soft/hard for fork/socket DoS (T-S05-003)"

if [[ "$(uname -s)" == "Linux" && -S /var/run/docker.sock ]]; then
  sock_stat="$(stat -c '%a:%U:%G' /var/run/docker.sock)"
  perms="${sock_stat%%:*}"
  [[ "${perms}" == "660" ]] \
    || die "Docker socket expects 660 permissions (observed ${sock_stat}; T-S06-001)"
  echo "${sock_stat}" | grep -Fq ':docker' || echo "warn: socket group not docker — verify distro packaging"
  echo "${sock_stat}" | grep -Fq 'root:' || die "Docker socket ownership must retain root trustee"
elif [[ ! -S /var/run/docker.sock ]] || [[ "$(uname -s)" != "Linux" ]]; then
  echo "skip: linux docker.sock hardened permission check (${SKIP_DOCKER_SOCK_ASSERT:-unset}; CI=${CI:-false})"
fi

echo "PASS: docker daemon baseline JSON satisfied"
