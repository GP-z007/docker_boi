# dasDocker Network Isolation Architecture Specification

**Document ID:** NET-ISO-ARCH-001  
**Version:** 1.0  
**Phase:** 1 — Research & Architecture  
**Owner:** Squad B — Network Isolation Engineer (Agent 03)  
**Depends On:** `docs/security/STRIDE-threat-model.md` (Agent 01) — **[required reading]**  
**Status:** Architectural baseline for Phase 2 implementation; all agents touching networking **must** consult this document first.

## Purpose & Zero Trust Baseline

This specification defines **deny-by-default** network segmentation for untrusted sandbox containers on the **`dasdocker-isolated`** Docker bridge (`172.31.0.0/16`). Every path is untrusted unless explicitly allowed, justified by use case, and traced to a **Threat ID** from STRIDE (**Rule 1 — ZTA**). No implicit trust exists between sandbox containers, host management plane, LAN segments, metadata endpoints, or the public Internet beyond policy.

**Notation:** Firewall rules below use logical IDs **`NR-<nnn>`** (Network Rule). Threat references use **`T-Sxx-nnn`** from `STRIDE-threat-model.md`.

---

## A. Network Topology Overview

Text-based topology showing trust boundaries, default gateway DNS sinkhole, Netfilter hook placement, and IDS tap attachment. **`br-dasd-isolated`** denotes the Docker-managed Linux bridge attaching to `dasdocker-isolated` (actual interface name MAY be auto-generated — Phase 2 SHALL pin via `com.docker.network.bridge.name` or equivalent and document runtime name in ops runbook).

```
                                    INTERNET (untrusted)
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    │  Host: public egress interface                │
                    │  (eth0 / ensX / cloud PIF — site-specific name) │
                    │  SURFACE: WAN; not directly trusted             │
                    └───────────────────────┬───────────────────────┘
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              │  Host routing + NAT zone    │                             │
              │  ─ PREROUTING (raw/mangle/nat as designed in Phase 2)     │
              │  ─ FORWARD filter (DENY baseline → allowlisted FORWARD)   │
              │  ─ POSTROUTING MASQUERADE (sandbox → WAN only);           │
              │    NO MASQUERADE to RFC1918 “foreign” subnets (see §B/C) │
              └─────────────────────────────┬─────────────────────────────┘
                                            │
              ┌─────────────────────────────┴─────────────────────────────┐
              │  Host management / control plane NIC (recommended separate) │
              │  SSH, orchestrator mgmt API, bastion/VPN ONLY                │
              │  NOT the default GW path for sandbox containers              │
              │  Mitigates: T-S08-001, T-S06-001 (Docker API not on sandbox) │
              └─────────────────────────────┬─────────────────────────────┘

  ┌───────────▼────────────────────────────────────────────────────────────┐
  │  Docker host network namespace                                          │
  │                                                                        │
  │    ┌──────────────────────────────────────────────────────────────┐  │
  │    │ Linux bridge `br-dasd-isolated` (dasdocker-isolated net)       │◄─┼── SURICATA IDS
  │    │ CIDR 172.31.0.0/16; gateway 172.31.0.1 (sinkhole dnsmasq)     │    │    **passive TAP**
  │    └───────┬─────────────────────────────┬────────────────────────┘    │    on `br-dasd-isolated`
  │            │ veth pair(s)                │ veth pair(s)                │    (copy/span — no inline
  │            ▼                             ▼                             │     enforcement)
  │    ┌───────────────┐              ┌───────────────┐                      │
  │    │ sandbox ctr A │              │ sandbox ctr B │  … per session       │
  │    │ 172.31.x.x    │              │ 172.31.y.y    │                      │
  │    │ UNTRUSTED     │              │ UNTRUSTED     │                      │
  │    └───────────────┘              └───────────────┘                      │
  │            │                             │                              │
  │            └────────── NAT via host ─────┘                              │
  │                                                                        │
  │  Default route inside ctr: GW 172.31.0.1 (sinkhole listens :53 udp/tcp) │
  └────────────────────────────────────────────────────────────────────────┘

Netfilter / packet path (conceptual ordering for **forwarded** ctr→WAN packets):

       FROM container veth
              │
              ▼
   PREROUTING  (DNAT seldom used for outbound; hooks reserved for IDS bypass,
               explicit REDIRECT ONLY if justified — default none for sandbox)
              │
              ▼
   ROUTING DECISION (host: forward vs local delivery)
              │
              ├─► dst LOCAL (172.31.0.1:53 → dnsmasq) ─► INPUT chain policy
              └─► forward path ─► FORWARD ─► POSTROUTING (SNAT MASQUERADE to WAN)

**Suricata tap position:** process **mirror** of traffic on **`br-dasd-isolated`** (ingress+egress) **before or alongside** forwarding decisions consistent with Phase 2 deployment (AF_PACKET on bridge or equivalent span). Passive observation only — mitigation remains **iptables/nft FORWARD policy + allowlist**, not Suricata block (defense-in-depth alerting: **T-S09-002**, **T-S09-003**).

**Orchestrator / Redis / internal TLS services:** reside on **host mgmt IP or overlay NOT bridged as L2 peers** of sandboxes; reachability denied by **`NR-010`** family unless future signed exception (out of Phase 2 baseline).

---

## B. IP Address Allocation Table

| Segment / CIDR | Address / Range | Purpose | Notes |
|----------------|----------------|---------|--------|
| **dasdocker-isolated** bridge network | **`172.31.0.0/16`** | Dedicated sandbox Layer-3 island | Single Docker bridge; no shared L2 with corporate LAN VMs. Containers MUST NOT use `--network host`. Mitigates **T-S08-001**, **T-S04-002**. |
| **Gateway (DNS sinkhole + default route)** | **`172.31.0.1`** | `dnsmasq` listener **:53/udp,tcp**; container default gateway | MUST NOT bind `0.0.0.0` on host external interfaces; bind to bridge IP only. Justification: centralised DNS policy enforcement per **T-S08-002**. |
| **Docker DHCP / static assignments** | **`172.31.1.0` – `172.31.254.254`** | Per-container addresses | Managed by Docker IPAM; avoid `172.31.0.0/24` for containers to reserve `.1` services & infra hooks. |
| **Reserved (documentation)** | **`172.31.0.0/24` except .1** | Future bridge-local services (NTP proxy, health check) | Keep unused until approved; default DROP to these from containers except explicit rules. |
| **Blocked: RFC1918 range 1** | **`10.0.0.0/8`** | Corporate / cloud private — **LAN isolation** | Egress from sandbox: **always DROP** (not SNAT’d). Mitigates **T-S08-001**, **T-S08-002**, attack tree **E1/E3**. |
| **Blocked: RFC1918 range 2** | **`172.16.0.0/12`** | Private — **LAN isolation** | **Overlap exception** documented below. |
| **Blocked: RFC1918 range 3** | **`192.168.0.0/16`** | Private — **LAN isolation** | **always DROP** from sandbox egress. |
| **Blocked: link-local & metadata** | **`169.254.0.0/16`** | Cloud/metadata / APIPA (**T-S08-002**, tree **E1**) | DROP egress from sandbox. |
| **Blocked: multicast / LL scope abuse** | **`224.0.0.0/4`**, relevant IPv4 broadcast patterns | Topology discovery (**T-S08-003**) | DROP except explicitly justified IGMP/quota (default none). |

### Overlap Edge Case — `172.16.0.0/12` vs `dasdocker-isolated` (`172.31.0.0/16`)

`172.31.0.0/16` lies inside **`172.16.0.0/12`** (RFC 1918 shared address space). A naive single rule **“DROP dst 172.16.0.0/12”** would **isolate the gateway**, break DHCP, or blackhole intra-bridge traffic.

**Required handling (Phase 2):**

1. **Order / specificity wins:** DENY-first logic SHALL evaluate **narrower ACCEPT** rules for **`172.31.0.0/16`** (same-bridge legitimate traffic + gateway **172.31.0.1**) **before** the broad **`172.16.0.0/12` DROP** that targets **“foreign private”** space.
2. **Decomposition (recommended explicit form):** express the RFC1918-2 prohibition as **`172.16.0.0/12` DROP** intersected with **NOT (`172.31.0.0/16`)** in implementation terms (iptables `! -d 172.31.0.0/16` on that DROP, or nftables concatenation/set math). Containers MUST still be unable to initiate to **foreign** private hosts (e.g. `172.20.5.6` corp server).
3. **East-West on bridge:** Container-to-container on **`172.31.0.0/16`** default **DENY** unless product explicitly allows (default **DENY** supports session isolation; if later allowed, separate Threat review — **T-S08-001**).

**Permission justification (in-code comment mandate, Rule 1):** any rule that ACCEPTs broader than **`172.31.0.0/16 → 172.31.0.1:53`** or **permitted egress profile** MUST cite **NR ID + Threat ID** and reviewer sign-off reference.

---

## C. Firewall Rule Logic (Decision Table — Pre-Syntax)

**Baseline:** **`FORWARD` default policy DROP** on the host for packets crossing bridge ↔ WAN (and **`INPUT` default DROP** where host services are minimized). **`OUTPUT`** from root daemons MAY be constrained separately; sandboxes primarily appear as **FORWARD** traffic.

**Convention:** **`SRC_ctr`** = any `172.31.1.0–172.31.254.254` sandbox address; **`GW`** = `172.31.0.1`; **`WAN_if`** = public interface; **`br`** = bridge to sandboxes.

| Rule ID | Direction | Source | Destination | Proto | Ports | Action | Use case justification | Threat mitigated |
|--------|-----------|--------|-------------|-------|-------|--------|------------------------|------------------|
| **NR-001** | FORWARD | `SRC_ctr` | `GW` | UDP/TCP | **53** | **ACCEPT** | DNS to policy sinkhole only | **T-S08-002** |
| **NR-002** | INPUT (on **`br`** IP) | `SRC_ctr` | **`GW`** | UDP/TCP | **53** | **ACCEPT** | Deliver DNS to **`dnsmasq`** bound on **172.31.0.1** only | **T-S08-002** |
| **NR-003** | INPUT (on **`br`** IP) | `SRC_ctr` | **`GW`**: high ports | ICMP | echo-req optional | **DROP** default | Block host service footprint on GW IP except DNS (no SSH/mgmt on **172.31.0.1**) | **T-S06-001**, **T-S08-001** |
| **NR-004** | FORWARD | `SRC_ctr` | **`10.0.0.0/8`** | any | any | **DROP** | DENY corp/cloud private (**RFC1918-1**) | **T-S08-001**, **T-S08-002**, tree **E1** |
| **NR-005** | FORWARD | `SRC_ctr` | **`172.16.0.0/12` minus `172.31.0.0/16`** (foreign private only) | any | any | **DROP** | DENY LAN private excluding dasdocker island (see §B) | **T-S08-001**, **T-S08-002** |
| **NR-006** | FORWARD | `SRC_ctr` | **`192.168.0.0/16`** | any | any | **DROP** | DENY home/LAN private | **T-S08-001**, **T-S08-002** |
| **NR-007** | FORWARD | `SRC_ctr` | **`169.254.0.0/16`** | any | any | **DROP** | Block metadata / link-local | **T-S08-002**, tree **E1** |
| **NR-008** | FORWARD | `SRC_ctr` | **`224.0.0.0/4`** (and applicable broadcasts) | any | any | **DROP** | Limit L2/L3 discovery abuse | **T-S08-003** |
| **NR-009** | FORWARD | `SRC_ctr` | **non-RFC1918 global unicast** (allowlisted FWD) | **TCP/UDP** | **80, 443** | **ACCEPT** | Restricted web egress (policy default; adjust via security review) | **T-S03-004** (bounded fetch), **T-S08-002** |
| **NR-010** | FORWARD | `SRC_ctr` | **host mgmt IP / orchestrator / Redis** | any | any | **DROP** | No lateral to control plane on host/LAN | **T-S06-001**, **T-S11-001**, **T-S12-003** |
| **NR-011** | FORWARD | **WAN** | `SRC_ctr` | any | any | **DROP** (no NEW) | No unsolicited inbound; only **ESTABLISHED,RELATED** return | **T-S08-001**, **T-S05-003** |
| **NR-012** | FORWARD | `SRC_ctr` | **WAN** (permitted dst) | TCP/UDP | **ephemeral** | **ACCEPT** only for **established reply path** | Return traffic for allowed egress | **T-S08-001** |
| **NR-013** | POSTROUTING (nat) | `SRC_ctr` → permitted global dst | via **`WAN_if`** | after ACCEPT | N/A | **MASQUERADE** | SNAT so return path works; never toward RFC1918 foreign | **T-S08-001** |
| **NR-014** | FORWARD | `SRC_ctr` | **`172.31.0.0/16`** (peer container) | default | default | **DROP** | Default **no east-west** sandbox mesh | **T-S08-001** |
| **NR-015** | FORWARD | `SRC_ctr` | **Global unicast** | **TCP/UDP** | **not 80, 443** | **DROP** | Default deny high-risk ports (see §E; aligns with NR-009) | **T-S04-004**, **T-S08-002**, **T-S05-003** |
| **NR-016** | FORWARD | `SRC_ctr` | **Global** | **ICMP** | echo | **DROP** or **rate-limited ACCEPT** | **Phase 2 decision:** default **DROP** ping egress unless observability requires; document choice in runbook | **T-S05-003**, **T-S08-001** |
| **NR-017** | INPUT | **any** | **host `WAN_if`** | **UDP/TCP** | **22** (if SSH) | **ACCEPT** from **bastion IP set only** | Mgmt access not from sandbox bridge | **T-S06-001**, **T-S08-001** |
| **NR-018** | FORWARD | `SRC_ctr` | **Global** | **UDP** | **≠ 53** | **DROP** (egress) | Prevent DNS tunneling to arbitrary resolvers; only **GW:53** | **T-S08-002** |

**Notes:**

- **NR-005** phrasing: implementation MUST use **set negation** or **split prefixes** so **`172.31.0.0/16`** is never covered by the foreign-private DROP.
- **NR-009 / NR-015:** If product requires outbound **DNS-over-HTTPS (443)** to specific resolvers, allow **dst IP allowlist** in Phase 2; still **DROP** arbitrary **853** (**§E**) unless approved.
- **Comments in actual iptables/nft scripts (Phase 2):** each ACCEPT line SHALL include **`# NR-xxx; T-S08-yyy — <one-line justification>`**.

---

## D. DNS Sinkhole Strategy

### Placement & Trust Rationale

- **Listener:** **`dnsmasq`** on **`172.31.0.1:53`** (UDP and TCP).
- Containers **must** use **`172.31.0.1`** as **sole** resolver (**DHCP Option 119/6 analogue** via Docker **`--dns 172.31.0.1`** when creating sandbox networks).
- **Why not host resolver or LAN DNS?**
  - **Host `127.0.0.53` / systemd-resolved** couples sandbox policy to host OS caches and exposes risk of inconsistent views (**T-S08-002**).
  - **LAN-internal DNS** reveals internal zones (zone transfer, AXFR probes, **`*.corp`**) — **information disclosure / rebinding staging** (**T-S08-002**, **T-S03-003**).
  - **Dedicated sinkhole** enforces unified **sink/allow** policy, logging, and **no split-horizon trust** for untrusted code (**ZTA**).

### Upstream Resolvers (from sinkhole)

| Priority | Upstream | Transport | Rationale |
|----------|----------|-----------|-----------|
| Primary | **DoH-forwarding hop OR TCP/UDP to `1.1.1.1` / `1.0.0.1`** (choose one model in Phase 2) | TLS 853 or plain 53 per org policy | Public recursive; no site DNS leakage. Document exact choice in runbook. |
| Secondary | **`9.9.9.9` / `149.112.112.112` (Quad9)** | 53/853 per policy | Malware-filtering option; reduces C2 resolution (**T-S08-002**). |
| **Disallowed** | Corporate split-horizon resolvers | — | **must not** be used for sandbox upstream without **Squad A** exception |

**No hardcoded secrets** in config; upstream list via **environment** (e.g. `DASDOCKER_DNS_UPSTREAMS`) loaded by automation (**Rule 1**).

### Blocked Name Patterns (examples — extend in Phase 2 config)

| Pattern / class | Action | Threat |
|-----------------|--------|--------|
| **RFC1918 / metadata answers** — response would steer to **`10/8`**, **`172.16/12` (non-172.31)**, **`192.168/16`**, **`169.254/16`** | **BLOCK / NXDOMAIN** | **T-S08-002** |
| **Internal suffixes** — `*.internal`, `*.lan`, `*.local`, `*.corp`, `*.home` (config list) | **BLOCK** | **T-S08-002**, **T-S08-003** |
| **High-risk TLD policy** (optional org blocklist) — e.g. **`.zip`**, **`.mov`**, newly abused TLDs per threat intel | **BLOCK** (config toggle) | **T-S03-001**, **T-S08-002** |
| **Known C2 DGA feeds** (if integrated) | **BLOCK** | **T-S08-002** |

### Query Logging Schema

**Format:** **NDJSON** (one JSON object per line) to **`/var/log/dasdocker/dns-queries.log`** (path TBD; rotatable).

**Fields (required):**

| Field | Type | Description |
|-------|------|-------------|
| `ts` | RFC3339 UTC | Event time |
| `container_id` | string (12-char short) | Docker container ID if mapped from source IP |
| `src_ip` | IPv4 | Querying sandbox address |
| `qname` | string | Lowercased FQDN |
| `qtype` | string | `A`, `AAAA`, etc. |
| `action` | enum | `ALLOW`, `BLOCK`, `SINKHOLE`, `TIMEOUT` |
| `reason` | string | Policy code, e.g. `RFC1918_ANSWER`, `TLD_DENY`, `UPSTREAM_ERROR` |
| `upstream` | string | Upstream server contacted or `none` |
| `latency_ms` | number | Round-trip to upstream |
| `correlation_id` | string | Session ID if orchestrator injects per-tenant tag (optional Phase 2) |

**Rotation:** **daily** **logrotate** (compress, retain **14** days local; ship to central logging per **S-10**). **PII:** qnames MAY contain customer data — apply **Fluent Bit scrub** before global index (**T-S10-001**).

---

## E. Blocked Protocol / Port Table (Container Egress Baseline)

All entries assume **unless explicitly allowlisted** in **`NR-009`** (or future signed architecture change). **Justification** references STRIDE.

| Proto | Port(s) / Variant | Justification | Threat ID |
|-------|-------------------|---------------|-----------|
| **TCP** | **22** | No SSH from sandbox to Internet or LAN | **T-S08-001**, **T-S06-001** |
| **TCP** | **23** | Telnet cleartext & C2 channel | **T-S08-002** |
| **TCP/UDP** | **25, 465, 587** | SMTP abuse / spam relay | **T-S05-003**, **T-S08-002** |
| **TCP/UDP** | **53** except to **172.31.0.1** | Direct DNS bypasses sinkhole policy | **T-S08-002** (**NR-018**) |
| **UDP** | **69** | TFTP exfil / malware staging | **T-S08-002** |
| **TCP** | **111, 2049** | RPC / NFS — lateral & file theft | **T-S08-001** |
| **TCP** | **135–139, 445** | MS-RPC / SMB — ransomware spread | **T-S08-001**, **T-S05-003** |
| **TCP/UDP** | **161–162** | SNMP recon & write if misconfigured | **T-S08-003** |
| **TCP** | **3389** | RDP lateral | **T-S08-001** |
| **TCP/UDP** | **6379** | Direct Redis attack surface | **T-S11-001**, **T-S11-003** |
| **TCP** | **4444** (and common IRC/C2 vectors) | Alternate C2 (representative deny class) | **T-S08-002** |
| **TCP** | **5900+** typical VNC | Remote desktop exfil paths | **T-S08-001** |
| **UDP** | **1900** SSDP | Discovery amplification / UPnP abuse | **T-S08-003**, **T-S05-003** |
| **UDP** | **5353** mDNS | Service discovery leakage | **T-S08-003** |
| **TCP** | **8080, 8443, 8000, 8888** | Alternate HTTP control unless product allows | Deny-by-default proxy abuse | **T-S08-002**, **T-S02-004** |
| **TCP** | **2375–2377** | Docker API exposure | **T-S06-001** |
| **TCP/UDP** | **7946**, **4789** (Swarm / VXLAN typical) | Orchestration LAN abuse | **T-S08-001** |
| **ICMP** | **uncontrolled flood** | DoS egress | **T-S04-004**, **T-S05-003** (**NR-016** policy) |
| **IP** | **Protocol 41, 47 (e.g. GRE)** | Encapsulation / tunnel egress bypasses port policy | **T-S08-001** (egress abuse class; STRIDE amendment if dedicated ID added) |

---

## F. Phase 2 Test Specification Matrix *(Rule 2 — Full-Spectrum Testing)*

For **each** firewall / DNS rule, Phase 2 SHALL implement automated checks. Naming: aligns with **`VT-INT-*`** / **`VT-RED-*`** from STRIDE (**S-08**) where applicable.

| Rule ID | Integration test (real system) | Unit / config test | Red-team / negative test | STRIDE VT reference |
|---------|----------------|-------------------|---------------------------|---------------------|
| **NR-001** | Exec in sandbox: `dig @172.31.0.1 example.com` succeeds | nft/iptables-save parser asserts FORWARD ACCEPT `ctr→172.31.0.1:53` | Point `dig @8.8.8.8` — must **fail** (**NR-018**) | VT-INT-S08-002 |
| **NR-004** | `curl http://10.255.255.1` timeouts / no route | CIDR lint in config | Scripted connect to **`10.x`** honey IP — DROP logged | VT-RED-S08-002 |
| **NR-005** | `curl http://172.20.0.1` fails; `ping 172.31.0.1` succeeds | nft set math includes **exclude 172.31/16** | Attempt **172.16.0.5** egress — DROP | VT-INT-S08-001 |
| **NR-006** | Blocked fetch to **`192.168.1.1`** | Same | **masscan** simulation to random **192.168/16** — no handshake | VT-RED-S08-001 |
| **NR-007** | `curl http://169.254.169.254` fails | static route absent | Metadata token harvest simulation — no response | VT-INT-S08-001, tree **E1** |
| **NR-008** | Send to **224.0.0.1** UDP — no host impact / dropped | — | mDNS-like flood from container — CPU cap + DROP | VT-INT-S08-003 |
| **NR-009** | `curl https://example.com` works | Port allowlist unit test | `curl ssh://evil:22` rejected | VT-RED-S08-002 |
| **NR-010** | From sandbox, `telnet orchestrator-internal-ip 443` fails | Compose net isolation | SSRF attempting **host.docker.internal** — DROP | VT-RED-S06-001 |
| **NR-011** | External `nmap` to sandbox published port shows **filtered** | conntrack state test | SYN flood inbound — mitigation rate | VT-RED-S08-001 |
| **NR-013** | `tcpdump` on WAN confirms SNAT masquerade for allowed flow | nft nat table assertion | Confirm **no NAT** toward **172.16/12 foreign** dst | VT-INT-S08-001 |
| **NR-014** | Two sandboxes cannot `curl` peer IP port 80 | ebtables/macvlan policy check | LAN scan between containers — no open | VT-RED-S08-001 |
| **NR-015** | `nc -vz external 4444` fails | Port matrix unit | Metasploit mock C2 egress — blocked | VT-RED-S08-002 |
| **NR-018** | UDP/53 only to GW | dnsmasq only listener test | **`iodine`-class DNS tunnel** to external fails | VT-RED-S08-002 |
| **DNS §D** | Log line emitted with all schema fields | JSON schema validator for log line | Exfil TXT to **blocked suffix** produces **BLOCK** event | VT-UNIT-S08-002, VT-RED-S08-002 |
| **Suricata §A** | Bridge mirror shows sandbox flow in Eve JSON | sensor health unit | malicious rule attempt — suricata does **not** crash host (**cap-aware**) | VT-INT-S09-002, VT-RED-S09-002 |

**Coverage:** Matrix rows map to **≥ 10 distinct network rules** (actually **≥ 15** rows above for resilience).

---

## NAT Architecture Summary

| Path | Behaviour | Threat |
|------|-----------|--------|
| **SANDBOX → 172.31.0.1:53** | **Routing to host-local** sinkhole (INPUT path), **no NAT** required | **T-S08-002** |
| **SANDBOX → allowed global `{80,443}`** | **FORWARD ACCEPT** → **MASQUERADE** on **`WAN_if`** (**NR-013**) | **T-S08-001** |
| **SANDBOX → any RFC1918 foreign / metadata** | **FORWARD DROP** upstream of NAT (**no wasted conntrack** preferred) | **T-S08-001**, **T-S08-002** |
| **SANDBOX → peer container** | **DROP** (**NR-014**) unless future exception gate | **T-S08-001** |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Phase 1 | Agent 03 | Initial topology, IP allocation, firewall decision table, DNS sinkhole, blocked ports, Phase 2 test matrix |

---

## References

- `dasdocker/docs/security/STRIDE-threat-model.md` — **S-04, S-05, S-06, S-08, S-09, S-10, S-11** (cross-cutting)
- Future **Phase 2:** iptables/nftables scripts, Docker Compose/network flags, dnsmasq config, CI jobs executing **§F**

**Phase 2 gate:** Implementation MUST NOT weaken **`NR-*`** ordering without Squad A RFC + STRIDE amendment.
