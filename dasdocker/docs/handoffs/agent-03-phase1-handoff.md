# Agent 03 Phase 1 Handoff Report — Network Isolation Architecture

## (a) What Was Built

Phase 1 Deliverable — **network isolation topology specification** (architecture only; **no iptables/Docker runtime implemented**):

- **`dasdocker/docs/architecture/network-isolation-spec.md`** — authoritative design for **`dasdocker-isolated`** (`172.31.0.0/16`), gateway **`172.31.0.1`** DNS sinkhole, **DENY-first** **`FORWARD`** baseline, RFC1918 blocking with **`172.16.0.0/12`** vs **`172.31.0.0/16`** overlap resolution, NAT **MASQUERADE** semantics, Suricata **passive tap** placement on the Docker bridge, **dnsmasq** policy/upstream/logging schema, blocked protocol/port matrix with **Threat ID** traceability, and **Phase 2** unit / integration / red-team test matrix mapped to **`NR-*`** rules and **`VT-*-S08`** / **`S-09`** references.

All networking agents MUST read this specification before implementing or altering paths, ports, or DNS (**Rule 1 — ZTA** / **Rule 4** downstream contract).

---

## (b) Downstream Contract — Internal APIs, Ports, File Paths, Environment Variables

Implementation is Phase 2; this handoff freezes **intent** only.

### Internal APIs

| Item | Detail |
|------|--------|
| **Orchestrator / HTTP APIs** | **N/A** in this deliverable — no sandbox-facing API listens on **`172.31.0.0/16`**; control plane MUST remain off that bridge per **`NR-010`**. |

### Listening ports / services (specified, not deployed)

| Port | Protocol | Listener (logical) | Address | Purpose |
|------|----------|-------------------|---------|---------|
| **53** | UDP/TCP | **dnsmasq** (Phase 2) | **`172.31.0.1`** on bridge | DNS sinkhole; sole resolver for sandboxes (**T-S08-002**) |
| **Suricata** | — | **AF_PACKET tap** | **`br-dasd-isolated`** (or runtime bridge name) | Passive IDS (**T-S09-002**, **T-S09-003**) |

No other services SHALL bind **`172.31.0.1`** except via **Squad A** change request (SSH/mgmt forbidden on GW IP — **`NR-003`**).

### Firewall / NAT hook contract

| Hook | Role |
|------|------|
| **PREROUTING** | Reserved; default **no REDIRECT/DNAT** into sandbox hostile paths |
| **FORWARD** | **DENY ALL** baseline; **`NR-001`–`NR-018`** allowlist sequencing |
| **POSTROUTING (nat)** | **MASQUERADE** only for **permitted sandbox → WAN** flows (**NR-013**); never toward blocked RFC1918 foreign |

### Repository file paths (this deliverable)

| Path | Purpose |
|------|---------|
| `dasdocker/docs/architecture/network-isolation-spec.md` | Network topology, **`NR-*`** decision table, DNS sinkhole, blocked ports, Phase 2 test matrix |
| `dasdocker/docs/handoffs/agent-03-phase1-handoff.md` | This Rule 4 handoff |

Paths are relative to the repository root that contains the **`dasdocker/`** directory.

### Environment variables (planned for Phase 2 — document in compose/runbooks when wired)

| Variable | Required (Phase 2) | Purpose |
|----------|-------------------|---------|
| `DASDOCKER_DNS_UPSTREAMS` | Yes (when scripted) | Comma-separated upstream resolvers for **dnsmasq** forwarders — **no literals in git** (**Rule 1**) |
| `DASDOCKER_WAN_IF` | Yes | Canonical WAN interface name for **MASQUERADE** (**NR-013**) |
| `DASDOCKER_BRIDGE_NAME` | Yes | Operational bridge interface name (**Suricata** tap target) |

**N/A:** no vault secrets introduced in Phase 1.

### Threat ID anchor set used in spec

Primarily **`T-S08-001`**, **`T-S08-002`**, **`T-S08-003`**; cross references **`T-S04-004`**, **`T-S05-003`**, **`T-S06-001`**, **`T-S09-002`**, **`T-S09-003`**, **`T-S10-001`**, **`T-S11-001`**, **`T-S03-004`**, **`T-S03-003`**.

---

## (c) Unresolved Warnings, Known Limitations, Decisions Needing Squad A Review

| Item | Severity | Notes |
|------|----------|-------|
| **Egress ports 80/443 only** (**NR-009**) | Medium | Git clone / toolchain may need **`git+https`** (443) OK; plain **FTP/DNSSEC/DoT (853)** — product must explicitly allow or remain blocked (**Squad A**). |
| **ICMP NR-016** | Low | Operational ping policy **DROP vs rate-limit** unresolved — pick before Phase 2 cut. |
| **DNS-over-HTTPS to arbitrary resolvers** | Medium | Bypasses **`NR-018`** port-53 stance if **443** is open — may need **SNI/DST IP allowlist** or TLS inspection policy (**Squad A**). |
| **East-west DENY (**`NR-014`**)** default | Medium | If product requires peer mesh (unlikely), Threat model revisit (**T-S08-001**). |
| **Suricata tap vs Docker bridge naming** | Low | Compose MUST pin bridge name; auto names break observability IaC (**T-S09-003** ops). |
| **Phase 2 test automation host** | Medium | Integration tests require privileged netns / CI kettle — carve out secured runner (**Rule 2**). |
| **STRIDE stakeholder sign-off** | Gate | Per Agent 01 — Phase gate before production coding. |

**Explicit Squad A RFC items:** widen egress beyond **`{80,443}`**, allow **ICMP**, corporate **upstream DNS** exceptions, relaxation of **`NR-014`**.

---

## Required Reading

- **`dasdocker/docs/security/STRIDE-threat-model.md`** — **S-08** (mandatory); **S-09** for IDS constraints.
- **`dasdocker/docs/architecture/network-isolation-spec.md`** — full **`NR-*`** / topology / **`§F`** tests.

---

*Agent 03 — Network Isolation Engineer · Phase 1 (architecture) · Dispatch per Master Engineering Rules 1–4*
