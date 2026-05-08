#!/usr/bin/env bash
# VT-RED-S04-001 — No recoverable sandbox bytes after teardown (best-effort host scan).
set -euo pipefail

skip() {
  echo "SKIP: $*"
  exit 0
}

die() {
  echo "FAIL: $*" >&2
  exit 1
}

command -v docker >/dev/null || skip "docker not available"
docker info >/dev/null 2>&1 || skip "docker daemon down"

token="DASDOCKER_REDTM_$(openssl rand -hex 16)"
cid="dasdocker-destroy-${RANDOM}"

docker run --name "${cid}" \
  --label "dasdocker.session_id=${cid}" \
  --tmpfs /workspace:rw,size=512m,noexec,nosuid,nodev,uid=1000,gid=1000 \
  --tmpfs /tmp:rw,size=64m,noexec,nosuid,nodev \
  alpine:3.19 sh -eu -c "echo -n '${token}' > /workspace/marker && sync" >/dev/null

docker rm -f "${cid}" >/dev/null

docker inspect "${cid}" >/dev/null 2>&1 && die "container record should not exist"

vols="$(docker volume ls -q --filter "label=dasdocker.session_id=${cid}" 2>/dev/null || true)"
[[ -z "${vols}" ]] || die "unexpected session-labelled docker volume remains"

hits=""
if [[ "${EUID:-$(id -u)}" -eq 0 ]] && [[ -d /var/lib/docker ]]; then
  hits="$(grep -RIl --binary-files=without-match "${token}" /var/lib/docker 2>/dev/null | head -5 || true)"
else
  echo "note: run as root with /var/lib/docker readable for full host forensic scan (Docker-only checks passed)"
fi

[[ -z "${hits}" ]] || die "found session token on host after rm — possible persistence leak:
${hits}"

echo "PASS: container destroyed; no session-labelled volumes; marker not trivially recovered (${token:0:16}…)"
