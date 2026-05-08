#!/usr/bin/env bash
# setup-network.sh — dasdocker-isolated bridge + iptables NR-* policy + ancillary file install (NET-ISO-ARCH-001).
# Rule 1 (ZTA): iptables NEVER uses iptables-restore for whole filter/nat tables (Docker owns them); we recreate
# DASDOCKER-* chains and splice DOCKER-USER / INPUT jump idempotently.
set -euo pipefail

: "${DASDOCKER_ROOT:=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RULES_SRC="${DASDOCKER_ROOT}/config/network/iptables-dasdocker.rules"
NET_ENV="/etc/dasdocker/network/network.env"
RULES_RENDERED_TMP="${TMPDIR:-/tmp}/dasdocker-iptables.$$.rules"

log() {
  printf '%s\n' "$*"
}

die() {
  log "error: $*"
  exit 1
}

require_root() {
  [[ "${EUID:-0}" -eq 0 ]] || die "run as root (sudo)"
}

detect_wan_if() {
  if [[ -n "${DASDOCKER_WAN_INTERFACE:-}" ]]; then
    echo "${DASDOCKER_WAN_INTERFACE}"
    return 0
  fi
  ip -4 route show default 2>/dev/null | awk '{print $5; exit}'
}

detect_host_mgmt_cidr() {
  if [[ -n "${DASDOCKER_HOST_MGMT_IP:-}" ]]; then
    if [[ "${DASDOCKER_HOST_MGMT_IP}" == *"/"* ]]; then
      echo "${DASDOCKER_HOST_MGMT_IP}"
    else
      echo "${DASDOCKER_HOST_MGMT_IP}/32"
    fi
    return 0
  fi
  local src
  src="$(ip -4 route get 8.8.8.8 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
  [[ -n "${src}" ]] || die "could not derive host mgmt IP; set DASDOCKER_HOST_MGMT_IP"
  echo "${src}/32"
}

render_rules() {
  local wan="$1" host="$2"
  sed -e "s/@WAN_IF@/${wan}/g" -e "s|@HOST_MGMT_IP@|${host}|g" "${RULES_SRC}" >"${RULES_RENDERED_TMP}"
}

ipt() {
  iptables -w 10 "$@"
}

apply_chain_filter() {
  local chain="$1"
  grep "^-A ${chain} " "${RULES_RENDERED_TMP}" | while IFS= read -r line; do
    # shellcheck disable=SC2086
    eval "ipt -t filter ${line}"
  done
}

remove_input_jump_once() {
  while ipt -t filter -D INPUT -j DASDOCKER-INPUT 2>/dev/null; do :; done
}

purge_docker_user_custom() {
  while ipt -t filter -D DOCKER-USER -j RETURN 2>/dev/null; do :; done
  while ipt -t filter -D DOCKER-USER -j DASDOCKER-FORWARD 2>/dev/null; do :; done
}

recreate_chain() {
  local table="$1" chain="$2"
  ipt -t "${table}" -F "${chain}" 2>/dev/null || true
  ipt -t "${table}" -X "${chain}" 2>/dev/null || true
  ipt -t "${table}" -N "${chain}"
}

ensure_docker_user_chain() {
  if ! ipt -t filter -L DOCKER-USER -n >/dev/null 2>&1; then
    ipt -t filter -N DOCKER-USER
  fi
}

apply_iptables() {
  require_root
  [[ -f "${RULES_SRC}" ]] || die "missing ${RULES_SRC}"
  modprobe iprange >/dev/null 2>&1 || true

  local wan_host host_cidr
  wan_host="$(detect_wan_if)"
  [[ -n "${wan_host}" ]] || die "WAN interface detection failed; set DASDOCKER_WAN_INTERFACE"
  host_cidr="$(detect_host_mgmt_cidr)"

  render_rules "${wan_host}" "${host_cidr}"

  remove_input_jump_once
  purge_docker_user_custom

  recreate_chain filter DASDOCKER-INPUT
  apply_chain_filter DASDOCKER-INPUT
  ipt -t filter -I INPUT 1 -j DASDOCKER-INPUT

  ipt -t filter -N DASDOCKER-FORWARD 2>/dev/null || true
  ipt -t filter -F DASDOCKER-FORWARD
  apply_chain_filter DASDOCKER-FORWARD

  ensure_docker_user_chain
  ipt -t filter -A DOCKER-USER -j DASDOCKER-FORWARD
  ipt -t filter -A DOCKER-USER -j RETURN

  while ipt -t nat -C POSTROUTING -s 172.31.0.0/16 ! -d 172.31.0.0/16 -o "${wan_host}" -j MASQUERADE 2>/dev/null; do
    ipt -t nat -D POSTROUTING -s 172.31.0.0/16 ! -d 172.31.0.0/16 -o "${wan_host}" -j MASQUERADE
  done
  ipt -t nat -A POSTROUTING -s 172.31.0.0/16 ! -d 172.31.0.0/16 -o "${wan_host}" -j MASQUERADE

  install -d -m 0755 /etc/dasdocker/network
  grep "^-A" "${RULES_RENDERED_TMP}" | head -500 >"/etc/dasdocker/network/iptables.rules.applied.snippet"
  rm -f "${RULES_RENDERED_TMP}"

  log "iptables: WAN_IF=${wan_host} HOST_MGMT=${host_cidr} applied."
}

write_env_stub() {
  require_root
  install -d -m 0755 /etc/dasdocker/network
  umask 077
  {
    echo "DASDOCKER_WAN_INTERFACE=$(detect_wan_if)"
    echo "DASDOCKER_HOST_MGMT_IP=$(detect_host_mgmt_cidr)"
  } >"${NET_ENV}.tmp"
  mv "${NET_ENV}.tmp" "${NET_ENV}"
  chmod 0644 "${NET_ENV}"
}

ensure_docker_network() {
  command -v docker >/dev/null || die "docker CLI missing"
  docker info >/dev/null 2>&1 || die "Docker daemon not available"
  if docker network inspect dasdocker-isolated >/dev/null 2>&1; then
    log "docker network dasdocker-isolated already exists"
    return 0
  fi
  docker network create \
    --driver bridge \
    --subnet 172.31.0.0/16 \
    --gateway 172.31.0.1 \
    -o com.docker.network.bridge.name=br-dasd-isolated \
    -o com.docker.network.bridge.enable_icc=false \
    --dns 172.31.0.1 \
    dasdocker-isolated
  log "created docker network dasdocker-isolated (ICC disabled)."
}

emit_internal_flag_rationale() {
  cat <<'DOC'
Docker --internal suppresses explicit default routing to external gateways; many sandboxes still require
immutable-image package installs during controlled bootstrap. This deployment omits --internal and instead
relies on compensating NR-* controls already loaded: enforced DNS sinkhole (172.31.0.1:53 only), iptables
DASDOCKER-FORWARD DENY toward all RFC1918 foreign + link-local + multicast paths, ICMP DROP, outbound
TCP narrowed to {80,443} for NEW flows, ICC=false on the Docker network, plus SNAT toward WAN_IF only after
those filters (T-S08-001 / T-S08-002 mitigation stack).
DOC
}

install_artifacts() {
  require_root
  install -d -m 0755 /etc/dasdocker/network
  install -d -m 0755 /var/log/dasdocker
  install -m 0644 "${DASDOCKER_ROOT}/config/network/dnsmasq-dasdocker.conf" /etc/dasdocker/network/dnsmasq-dasdocker.conf
  install -m 0644 "${DASDOCKER_ROOT}/config/network/iptables-dasdocker.rules" /etc/dasdocker/network/iptables-dasdocker.rules
  if [[ -f "${DASDOCKER_ROOT}/config/network/logrotate-dasdocker-dns" ]]; then
    install -m 0644 "${DASDOCKER_ROOT}/config/network/logrotate-dasdocker-dns" /etc/logrotate.d/dasdocker-dns
  fi

  install -m 0644 "${DASDOCKER_ROOT}/systemd/dasdocker-network.service" /etc/systemd/system/dasdocker-network.service || true
  install -m 0644 "${DASDOCKER_ROOT}/systemd/dasdocker-dnsmasq.service" /etc/systemd/system/dasdocker-dnsmasq.service || true
  systemctl daemon-reload
}

full_install() {
  install_artifacts
  write_env_stub
  apply_iptables
  ensure_docker_network
}

usage() {
  cat <<USAGE
Commands:
  apply-iptables     Render + load filter/nat snippets (called from systemd Before=docker.service).
  write-env          Write /etc/dasdocker/network/network.env with detected WAN + host IPs.
  install-files      Deploy dnsmasq/iptables configs + systemd units + logrotate.
  ensure-docker-net  Idempotent docker network create (ICC=false, pinned bridge name).
  rationale-internal Print why --internal is intentionally omitted (--network still routes).
  provision          install-files + write-env + apply-iptables + ensure-docker-net
USAGE
}

main() {
  local cmd="${1:-}"
  case "${cmd}" in
    apply-iptables)
      apply_iptables
      ;;
    write-env)
      require_root
      write_env_stub
      ;;
    install-files)
      install_artifacts
      ;;
    ensure-docker-net)
      require_root
      ensure_docker_network
      ;;
    rationale-internal)
      emit_internal_flag_rationale
      ;;
    provision | install)
      require_root
      full_install
      ;;
    "" | help | -h)
      usage
      ;;
    *)
      die "unknown command ${cmd}; try help"
      ;;
  esac
}

main "${1:-}"
