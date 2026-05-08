# Agent 03 Phase 2 Handoff — Network Isolation (dasdocker-isolated)

## Mandatory contract for Agent 08 (lifecycle)

| Constant | Value |
|----------|--------|
| **Docker network `--network` flag** | `dasdocker-isolated` |
| **Sandbox subnet / CIDR** | `172.31.0.0/16` |
| **Gateway / DNS sinkhole IP** | `172.31.0.1` (:53/tcp,udp handled by **`dasdocker-dnsmasq.service`**) |
| **Pinned Linux bridge (`com.docker.network.bridge.name`)** | `br-dasd-isolated` |
| **`docker run ...` attachment** | `--network dasdocker-isolated` (**plus baseline secopts from Agent 02**) |
| **`--dns` inside network** | Host resolver pre-set to **`172.31.0.1`** on network creation (`setup-network.sh`). |

Operational notes:

- iptables posture is authored in **`config/network/iptables-dasdocker.rules`** and applied idempotently by **`scripts/setup-network.sh apply-iptables`** via **`iptables -w`** (never full-table **`iptables-restore`** — preserves Docker-managed tables).
- **`dasdocker-network.service`** (**`Before=docker.service`**) pre-creates an empty **`DOCKER-USER`** hook if needed **and** installs **`DASDOCKER-*`** chains **before** the daemon attaches its FORWARD jump. Moby **may** revisit **`DOCKER-USER`** on daemon upgrades — **always re-run `sudo ./scripts/setup-network.sh apply-iptables` after Docker daemon maintenance** so jumps stay canonical.
- Full bootstrap (files + iptables + bridge + systemd enable hints): **`sudo ./scripts/setup-network.sh provision`** (requires Docker up for **`ensure-docker-net`** portion).

---

## `--internal` decision (Technical Constraint A)

Deliverable deliberately **does not** pass Docker **`--network ... internal`** so sandboxes retain **explicitly filtered** egress for package/bootstrap flows and observability workloads. Risk is compensated by **`DASDOCKER-FORWARD`** (RFC1918/metadata/multicast denies, ICMP/new-UDP bans except sinkhole allowance, ICC=false, **`NR-015`** TCP enforcement, WAN-only **`MASQUERADE`**) plus centralized **`dnsmasq`** on **`172.31.0.1` only**.

---

## File map

| Path | Role |
|------|------|
| `dasdocker/scripts/setup-network.sh` | Provision / iptables / Docker network (**idempotent**) |
| `dasdocker/config/network/iptables-dasdocker.rules` | NR-* audited policy (embedded `@WAN_IF@` / `@HOST_MGMT_IP@` tokens substituted at apply time) |
| `dasdocker/config/network/dnsmasq-dasdocker.conf` | Sinkhole binds **`listen-address=172.31.0.1`** only |
| `dasdocker/config/network/logrotate-dasdocker-dns` | 7‑day rotations for **`/var/log/dasdocker/dns-queries.log`** |
| `dasdocker/systemd/dasdocker-network.service` | Applies iptables before Docker |
| `dasdocker/systemd/dasdocker-dnsmasq.service` | Keeps **`dnsmasq`** foreground-bound to conf + appends stdout to log file |

---

## Environment variables / host metadata

| Name | Meaning |
|------|---------|
| `DASDOCKER_WAN_INTERFACE` | Override auto-detected default-route NIC for **`MASQUERADE`** |
| `DASDOCKER_HOST_MGMT_IP` | Host management IP as **`x.x.x.x` or **`x.x.x.x/32`** (falls back to **`ip route get 8.8.8.8` src**) |
| `DASDOCKER_ISOLATED_NET` | Test override (`tests/network/*`, default **`dasdocker-isolated`**) |

---

## iptables semantics (Threat traceability snapshot)

Custom chain **`DASDOCKER-FORWARD`** anchored from **`DOCKER-USER`**; **`DASDOCKER-INPUT`** handles anti-spoof + DNS-only hits to **`172.31.0.1`**.

- **`DASDOCKER_LAN_BLOCK`** log prefix — RFC **`10/8`**, foreign **`172.16–172.30.*`**, **`192.168/16`**, **`169.254/16`**, multicast **`224/4`**.
- **`DASDOCKER_HOST_BLOCK`** log prefix — host management IP (**`NR-010`** lateral control-plane block).
- **ICC / east-west**: **`NR-014`** drop container↔container inside **`172.31/16`** excluding gateway services.
- **Egress allowance**: Established/related **`NR-012`**, DNS **`NR-001/002`**, HTTP/S **`NR-009`**, ICMP **`NR-016`** default deny.

---

## Test suite expectations

Located at **`dasdocker/tests/network/`**:

1. **`test_network_unit.sh`** — static asserts **≥6** iptables/dnsmasq contract strings.
2. **`test_network_integration.sh`** — **≥6** live-container checks (skips courteously if Docker/network absent).
3. **`test_network_redteam.sh`** — **≥4** adversarial behaviours + root-only iptables double-apply drift guard.

Hardware CI should execute **`provision`** once, **`systemctl restart dasdocker-dnsmasq`** after **`ensure-docker-net`**, then run the trio as root.

---

## Open risks / Squad A review triggers

| Item | Severity | Notes |
|------|----------|-------|
| **Docker daemon resets `DOCKER-USER`** | Medium | Operational runbook MUST re-run `apply-iptables` post-upgrade; consider future `cron` watchdog. |
| **WAN_IF autodetection drift** (`USB tether`, multihomed) | Medium | Set explicit `DASDOCKER_WAN_INTERFACE` in **`/etc/dasdocker/network/network.env`**. |
| **Strict TCP 80/443 policy** breaks non-HTTPS telemetry | Medium | Requires signed exception + ADR amendment for extra destination ports/CIDR allowlists. |
| **`dnsmasq` query log sensitivity** (`T-S10-001`) | Medium | Fluent Bit scrub before central indexes per NET spec §D. |

---

*Agent 03 · Network Isolation Engineer · Phase 2 Deliverable 2.2 · Rules 1–4*
