# dasDocker STRIDE Threat Model

**Document ID:** SEC-THREAT-001  
**Version:** 1.0  
**Phase:** 1 — Research & Architecture  
**Owner:** Squad A — Security & Hardening (Agent 01)  
**Classification:** Internal — Engineering  
**Status:** Pending stakeholder sign-off (Phase Gate)

## Executive Summary

dasDocker is a web-based sandbox that executes **untrusted** code from GitHub repositories and ZIP archives inside hardened containers. This document is the **authoritative** security baseline for the project. Attack surfaces not enumerated here are **out of scope** for formal assurance until added by amendment.

**Master engineering rules applied:**

1. **Zero Trust Architecture (ZTA):** Every threat is tied to an attack surface and a ZTA-aligned control (least privilege, deny-by-default, explicit verification).
2. **Full-spectrum testing:** Each threat lists a **Verification Test ID** (Unit, Integration, or Red-Team).
3. **Governance:** Changes to this document require security review and stakeholder approval.

---

## Scope & System Context

| Layer | Components |
|-------|------------|
| User / Internet | Public Web UI (React), browser |
| Control plane | Orchestrator REST API, WebSocket bus to frontend |
| Data / ingestion | GitHub URL parsing, clone, ZIP extraction |
| Execution | Docker/containerd sandboxes, seccomp, cgroups, RAM disk |
| Host | Linux kernel, eBPF agent, iptables/NAT, DNS |
| Observability | pcap, Suricata, Fluent Bit → Loki/OpenSearch |
| State | Redis (sessions, TTL, self-destruct) |
| Secrets | JWT keys, internal API keys, vault tokens |

---

## Risk Rating Criteria

| Rating | Definition |
|--------|------------|
| **Critical** | Container escape, arbitrary LAN access, or host compromise |
| **High** | Cross-session data access, authentication bypass, or unauthorised persistent state |
| **Medium** | DoS, resource exhaustion, or material information leakage |
| **Low** | Minor disclosure or non-exploitable misconfiguration |

---

## STRIDE Threat Tables by Attack Surface

Naming: `T-<Surface>-###` (e.g., `T-S01-001`).  
Verification tests: `VT-UNIT-*` (config/unit validation), `VT-INT-*` (live system state), `VT-RED-*` (adversarial).

### S-01 — Public Web UI

*React frontend accessible to unauthenticated users.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S01-001 | Spoofing | Attacker impersonates another user or session in the browser (e.g., token fixation, XSS-stolen session). | High | Short-lived HttpOnly/SameSite cookies or Bearer tokens; server-side session binding; CSP and strict DOM sanitisation; deny UI actions without validated session from API. | VT-RED-S01-001, VT-INT-S01-001 | Planned |
| T-S01-002 | Tampering | Attacker modifies client-side routing or local storage to call privileged API paths without authorisation. | High | All authorisation enforced server-side; UI is untrusted; route guards only for UX; API returns 401/403 for unauthorised resources. | VT-RED-S01-002, VT-UNIT-S01-002 | Planned |
| T-S01-003 | Information Disclosure | Source maps, error overlays, or API error messages leak stack traces, paths, or internal hostnames. | Medium | Disable source maps in production builds; generic error pages; API errors mapped to stable codes without internals. | VT-UNIT-S01-003, VT-INT-S01-003 | Planned |
| T-S01-004 | Denial of Service | Aggressive polling or WebSocket floods from the browser exhaust API or WS connections. | Medium | Rate limiting at edge/API; WS connection caps per IP/session; backpressure and idle timeouts. | VT-RED-S01-004, VT-INT-S01-004 | Planned |

### S-02 — Orchestrator REST API

*Backend API for session create/read/destroy.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S02-001 | Spoofing | Forged JWT or session tokens allow API access as another identity. | High | RS256 JWT with key rotation; `iss`/`aud` validation; short TTL; deny-default on missing/invalid claims. | VT-UNIT-S02-001, VT-RED-S02-001 | Planned |
| T-S02-002 | Tampering | Attacker alters session or container ID in requests to access another tenant’s sandbox. | Critical | Mandatory authorisation check: subject must own resource; UUID-backed IDs; no predictable sequential IDs; server-side ACL on every mutating call. | VT-RED-S02-002, VT-INT-S02-002 | Planned |
| T-S02-003 | Repudiation | Operator cannot prove who created/destroyed a session or which policy applied. | Medium | Structured audit logs (who/when/what); signed or append-only stream to central log pipeline; correlation IDs. | VT-INT-S02-003, VT-UNIT-S02-003 | Planned |
| T-S02-004 | Information Disclosure | Verbose errors or debug endpoints leak orchestrator config or paths. | Medium | Deny-default on routes; no debug in prod; error schema without stack traces to clients. | VT-INT-S02-004, VT-UNIT-S02-004 | Planned |
| T-S02-005 | Denial of Service | Session creation storm exhausts Docker or host resources. | Medium | Per-IP and global rate limits; quotas; queue with shedding; cap concurrent sessions per user/tenant. | VT-RED-S02-005, VT-INT-S02-005 | Planned |

### S-03 — GitHub Ingestion Pipeline

*URL parsing, repository cloning, ZIP extraction.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S03-001 | Spoofing | Malicious URL or redirect causes clone from unintended repo (dependency confusion / typosquat). | High | Allowlist Git hosts; pin org/repo; verify commit SHA after fetch; TLS certificate validation; no credential reuse across repos. | VT-UNIT-S03-001, VT-INT-S03-001 | Planned |
| T-S03-002 | Tampering | Zip-slip or symlink escape during extraction writes outside the build context into host-mounted paths. | Critical | Extract only into disposable chroot/RAM-backed workspace; path canonicalisation; reject `..`, symlinks, and absolute paths; run extractor as non-root with no host bind mounts. | VT-RED-S03-002, VT-UNIT-S03-002 | Planned |
| T-S03-003 | Information Disclosure | Clone logs or error messages leak tokens, SSH URLs, or internal proxy addresses. | Medium | Redact secrets in logs; use anonymous read-only clone where possible; secret scanners on CI outputs. | VT-UNIT-S03-003, VT-INT-S03-003 | Planned |
| T-S03-004 | Denial of Service | Gigantic repo or LFS objects exhaust disk, memory, or clone time, starving other jobs. | Medium | Shallow clone; max repo size; timeout; subtree/sparse checkout; cgroup limits on ingest worker. | VT-RED-S03-004, VT-INT-S03-004 | Planned |

### S-04 — Container Runtime (Docker/containerd)

*The sandbox container itself.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S04-001 | Tampering | Writable container root allows persistence of malware for the next user on same image reuse. | High | Non-persistent root except RAM disk; never reuse writable layers across tenants; image digest pinning. | VT-INT-S04-001, VT-UNIT-S04-001 | Planned |
| T-S04-002 | Elevation of Privilege | Process gains extra Linux capabilities or escapes seccomp sandbox. | Critical | Drop all capabilities except required set; default-deny seccomp; no `CAP_SYS_ADMIN`; AppArmor/SELinux profiles; read-only root where feasible. | VT-INT-S04-002, VT-RED-S04-002 | Planned |
| T-S04-003 | Information Disclosure | Mounted secrets or env vars leak into untrusted workload. | High | No host secrets in container env; inject only session-scoped tokens via one-time sidechannel with TTL; deny `/proc` and sensitive paths as policy allows. | VT-UNIT-S04-003, VT-RED-S04-003 | Planned |
| T-S04-004 | Denial of Service | Fork bomb or memory spike denies CPU/RAM to co-located workloads. | Medium | pids limit, memory/cpu quotas, OOM behaviour per cgroup; scheduler shares. | VT-RED-S04-004, VT-INT-S04-004 | Planned |
| T-S04-005 | Tampering | Attacker replaces binaries on read-only image by exploiting package manager in build. | Medium | Distroless or minimal base; verify image signature; reproducible build; scan images in registry. | VT-UNIT-S04-005, VT-INT-S04-005 | Planned |

### S-05 — Host Kernel

*Linux kernel underlying all containers.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S05-001 | Elevation of Privilege | Unprivileged container exploit in kernel cgroup, namespace, or eBPF grants host root. | Critical | Kernel ≥ supported LTS; KPTI, lockdown mode where compatible; minimal modules; rapid CVE patch SLA; user namespaces policy explicit. | VT-INT-S05-001, VT-RED-S05-001 | Planned |
| T-S05-002 | Information Disclosure | Kernel side-channel (Spectre class) leaks host or other tenant data. | Medium | Hardware/firmware mitigations on; isolate noisy workloads; security microcode; consider untrusted workload scheduling. | VT-INT-S05-002, VT-UNIT-S05-002 | Planned |
| T-S05-003 | Denial of Service | Container triggers kernel panic or resource exhaustion on host. | High | ulimits; `unprivileged_userns_clone` policy; fuzz/chaos excluded from prod; separate node pools for sandbox. | VT-RED-S05-003, VT-INT-S05-003 | Planned |
| T-S05-004 | Tampering | Attacker loads unsigned kernel module via misconfiguration. | Critical | Disable module loading where policy allows (`module.sig_enforce`); immutable infrastructure; verified boot optional roadmap. | VT-INT-S05-004, VT-UNIT-S05-004 | Planned |

### S-06 — Docker Socket (`/var/run/docker.sock`)

*Management interface to Docker daemon.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S06-001 | Elevation of Privilege | Any workload with socket access can create privileged container and take host. | Critical | **Never** mount Docker socket inside user sandboxes; orchestrator only on trust-separated host network; mTLS or Unix socket permissions 660 root:docker only. | VT-INT-S06-001, VT-RED-S06-001 | Planned |
| T-S06-002 | Spoofing | Fake or rogue Docker API endpoint tricks orchestrator. | High | TLS client auth to Docker API or local socket only from known UID; certificate pinning for remote daemon. | VT-UNIT-S06-002, VT-INT-S06-002 | Planned |
| T-S06-003 | Tampering | Attacker stops, replaces, or snapshots other users’ containers via API confusion. | Critical | Per-request authZ on container labels; namespaces; no cross-tenant labels; validate names/IDs on every op. | VT-RED-S06-003, VT-INT-S06-003 | Planned |
| T-S06-004 | Repudiation | Malicious admin denies issuing destructive Docker commands. | Low | Auditd / Docker audit plugin; remote log shipping; tamper-evident retention. | VT-INT-S06-004 | Planned |

### S-07 — eBPF Monitor

*Kernel-level process tracing agent.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S07-001 | Elevation of Privilege | Vulnerable eBPF verifier bypass or program loads arbitrary kernel read/write. | Critical | Only signed/allowlisted BPF programs; BTF required where applicable; load from root-only path; CAP_BPF limited to dedicated agent user; regular kernel upgrades. | VT-INT-S07-001, VT-RED-S07-001 | Planned |
| T-S07-002 | Information Disclosure | eBPF maps or perf buffers leak other tenants’ syscalls or paths. | High | Per-session cgroup PID filters; no global hooks without namespace filter; redact paths in userland exporter. | VT-INT-S07-002, VT-UNIT-S07-002 | Planned |
| T-S07-003 | Denial of Service | bpf map flood or program complexity crashes kernel path. | Medium | Instruction complexity limits; map size caps; rate limit events exported to userspace. | VT-RED-S07-003, VT-INT-S07-003 | Planned |

### S-08 — Network Layer

*Isolated NAT, iptables rules, DNS resolver.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S08-001 | Spoofing | Container forges source IP to reach orchestrator or metadata service. | High | Separate network namespaces; egress SNAT only via controlled bridge; rp_filter; no `--net=host` for sandboxes. | VT-INT-S08-001, VT-RED-S08-001 | Planned |
| T-S08-002 | Tampering | DNS rebinding or poisoned resolver reaches internal APIs. | High | Dedicated sandbox DNS view; block RFC1918 and link-local to browser except via approved proxy; DNSSEC optional; deny internal suffixes. | VT-UNIT-S08-002, VT-RED-S08-002 | Planned |
| T-S08-003 | Information Disclosure | Internal service discovery via multicast/mDNS leaks topology. | Low | Disable mDNS in sandbox; firewall deny inbound except established; minimal broadcast domains. | VT-INT-S08-003 | Planned |

### S-09 — pcap / IDS Pipeline

*Network capture and Suricata analysis.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S09-001 | Information Disclosure | Captures contain other sessions’ traffic on shared span. | High | Per-session tap/NAT namespace only; VLAN or veth isolation; RBAC on pcap object store; encryption at rest for pcaps. | VT-INT-S09-001, VT-UNIT-S09-001 | Planned |
| T-S09-002 | Elevation of Privilege | Suricata or socket buffer RCE on hostile traffic. | Critical | Run Suricata as non-root; seccomp; offline rule updates; resource limits; separate network namespace from production control plane. | VT-RED-S09-002, VT-INT-S09-002 | Planned |
| T-S09-003 | Denial of Service | Terabyte pcap fill disk or Suricata CPU saturation. | Medium | Quotas; ring buffer rotate; sampling under pressure; kill switch on storage watermark. | VT-INT-S09-003, VT-RED-S09-003 | Planned |

### S-10 — Log Aggregation Pipeline

*Fluent Bit → Loki / OpenSearch.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S10-001 | Information Disclosure | Logs aggregate secrets (tokens, payloads) from apps. | Medium | Fluent Bit scrub filters; deny-list field names; structured logging policy; sample not body by default. | VT-UNIT-S10-001, VT-INT-S10-001 | Planned |
| T-S10-002 | Tampering | Attacker deletes or alters logs to hide exfiltration. | High | Write-once or WORM bucket; separate admin ACL; append-only streams; SIEM correlation IDs. | VT-INT-S10-002, VT-RED-S10-002 | Planned |
| T-S10-003 | Denial of Service | Log volume spike indexes entire cluster storage. | Medium | Ingest rate limits; per-tenant indices; ILM hot/warm/delete; drop debug in sandboxes. | VT-RED-S10-003, VT-INT-S10-003 | Planned |

### S-11 — Redis State Store

*Session state, TTL timers, self-destruct keys.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S11-001 | Spoofing | Client connects to Redis without auth and reads session keys. | High | TLS + ACL or strong password; bind to internal VPC only; no public exposure; separate DB index per tier if needed. | VT-INT-S11-001, VT-RED-S11-001 | Planned |
| T-S11-002 | Tampering | Attacker extends TTL or deletes self-destruct key to keep container alive. | Critical | Only orchestrator service account may write TTL keys; use Lua or transactions; validate session IDs; separate reader roles. | VT-RED-S11-002, VT-UNIT-S11-002 | Planned |
| T-S11-003 | Information Disclosure | `KEYS *` or debug command leaks all session metadata. | Medium | Rename `DEBUG`; disable dangerous commands; Redis 7+ ACL default deny; VPC only. | VT-INT-S11-003, VT-UNIT-S11-003 | Planned |

### S-12 — Inter-Service Communication

*Orchestrator ↔ Monitor ↔ Frontend WebSocket bus.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S12-001 | Spoofing | Rogue service publishes fake events to WebSocket bus. | High | mTLS between services; JWT or HMAC per message with audience; mutual service identity (SPIFFE optional). | VT-UNIT-S12-001, VT-INT-S12-001 | Planned |
| T-S12-002 | Tampering | MITM alters monitor events or console stream. | High | TLS everywhere; channel binding; signed event envelopes where ordering matters. | VT-INT-S12-002, VT-RED-S12-002 | Planned |
| T-S12-003 | Information Disclosure | WebSocket delivers another user’s console or kernel events. | Critical | Authorise subscription by session ID + user binding; server-side fan-out filtering; no client-side topic wildcards. | VT-RED-S12-003, VT-INT-S12-003 | Planned |

### S-13 — Secrets & Credentials

*JWT signing keys, internal API keys, vault tokens.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S13-001 | Information Disclosure | Secrets in repo or env files committed to git. | High | Pre-commit secret scan; CI block; vault/KMS only; short-lived dynamic creds. | VT-UNIT-S13-001, VT-INT-S13-001 | Planned |
| T-S13-002 | Tampering | Stale or compromised JWT signing key still accepted. | High | Key rotation with overlap window; `kid` header; deny retired keys after cutover; automated revocation list. | VT-UNIT-S13-002, VT-INT-S13-002 | Planned |
| T-S13-003 | Elevation of Privilege | Vault token with broad policy creates super-user access. | Critical | Least-privilege Vault policies; namespace per env; periodic token renewal; audit all secret reads. | VT-INT-S13-003, VT-RED-S13-003 | Planned |

### S-14 — Self-Destruct Timer

*Redis TTL + watchdog cron mechanism.*

| Threat ID | STRIDE Category | Threat Description | Risk Rating | Recommended Control (ZTA) | Verification Test ID | Status |
|-----------|-----------------|-------------------|-------------|---------------------------|----------------------|--------|
| T-S14-001 | Tampering | User disables timer via API race or clock skew. | Critical | Authoritative time from orchestrator; monotonic deadline stored server-side; watchdog independent of client; idempotent destroy. | VT-RED-S14-001, VT-INT-S14-001 | Planned |
| T-S14-002 | Denial of Service | Watchdog kills benign long-running jobs incorrectly or fails to kill zombie sessions. | Medium | Bounded kill retries; metrics on stuck sessions; alert if `TTL - now` drifts past threshold. | VT-INT-S14-002, VT-UNIT-S14-002 | Planned |

**Threat count:** 44 distinct threats (≥ 40 required).

---

## Attack Tree — Container Escape

Text-based attack tree: paths from adversary **inside container** toward **host kernel compromise** or **LAN access** beyond sandbox policy.

```
GOAL: Host compromise or unauthorised LAN access
│
├─ [A] Abuse Linux namespaces/cgroups
│   ├─ A1: Escape via user namespace + vulnerable kernel API
│   │   └─ LEAF: BLOCKED — User ns policy + LTS kernel + VT-INT-S05-001
│   ├─ A2: cgroup release agent path traversal
│   │   └─ LEAF: BLOCKED — cgroup v2 + no release_agent in untrusted ns + VT-RED-S04-002
│   └─ A3: core_pattern pipe to root helper
│       └─ LEAF: BLOCKED — fs namespaces read-only + sysctl deny + VT-INT-S04-002
│
├─ [B] Exploit Docker / container runtime misconfig
│   ├─ B1: Mount docker.sock into container
│   │   └─ LEAF: BLOCKED — Never mount socket in user workload + VT-INT-S06-001
│   ├─ B2: Privileged container or dangerous capability
│   │   └─ LEAF: BLOCKED — Cap drop + no --privileged + VT-INT-S04-002
│   └─ B3: Host path bind mount read-write
│       └─ LEAF: BLOCKED — Deny host RW mounts for sandbox + VT-UNIT-S04-001
│
├─ [C] Kernel exploit from unprivileged context
│   ├─ C1: eBPF unsafe program load from container
│   │   └─ LEAF: BLOCKED — CAP_BPF not granted to container + VT-INT-S07-001
│   ├─ C2: TTY ioctl or timerfd race (example class)
│   │   └─ LEAF: OPEN — Requires kernel patch cadence + VT-RED-S05-001
│   └─ C3: Use-after-free in networking stack
│       └─ LEAF: OPEN — Mitigated only by version/supply chain; track CVEs
│
├─ [D] Escape via file system / proc
│   ├─ D1: `/proc` and `/sys` writable misconfiguration
│   │   └─ LEAF: BLOCKED — Read-only masks + AppArmor + VT-INT-S04-002
│   └─ D2: escape via overlayfs whiteouts on malicious layers
│       └─ LEAF: OPEN — Image supply chain + signed base images + VT-UNIT-S04-005
│
├─ [E] Network path to host / internal APIs
│   ├─ E1: Access 169.254.169.254 or internal metadata
│   │   └─ LEAF: BLOCKED — Egress firewall + no host network + VT-INT-S08-001
│   ├─ E2: ARP spoof peer container on shared L2 (if ever shared)
│   │   └─ LEAF: BLOCKED — Isolated bridge per session + VT-INT-S08-001
│   └─ E3: DNS rebinding to hit orchestrator loopback
│       └─ LEAF: BLOCKED — DNS policy + no internal DNS from sandbox + VT-RED-S08-002
│
└─ [F] Host shared memory / device access
    ├─ F1: GPU or device passthrough abuse
    │   └─ LEAF: OPEN — Mitigation: no device passthrough in v1 product
    └─ F2: unix socket to host service left in mount
        └─ LEAF: BLOCKED — Minimal mounts + seccomp socket connect deny + VT-INT-S04-002
```

**Leaf nodes:** 14 (≥ 10 required). **OPEN** leaves require explicit engineering or operational mitigation ownership before GA.

---

## Trust Boundaries Diagram (Text)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ INTERNET (Untrusted)                                                          │
│  Browser ────────────────────────────────────────────────────────────────────  │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │ HTTPS (TLS 1.2+) + CSP
                                 │ Auth: session cookie / Bearer (validated S-02)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ TRUST BOUNDARY TB-1: Edge / API Gateway                                       │
│  Validation: JWT signature (RS256), rate limits, request size, route ACL      │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │ mTLS or internal TLS (service mesh optional)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ TRUST BOUNDARY TB-2: Orchestrator (controls identity ↔ resource ownership)    │
│  Validation: Authorisation on every session op; no implicit trust by ID alone │
└───────────────┬──────────────────────────────┬───────────────────────────────┘
                │                              │
                │ Docker API (Unix/TLS)        │ Internal TLS + ACL
                ▼                              ▼
┌───────────────────────────┐    ┌─────────────────────────────────────────────┐
│ TRUST BOUNDARY TB-3:       │    │ TRUST BOUNDARY TB-4: Monitor / Observability │
│ Docker Daemon + Host NS    │    │ Validation: service credentials; event filter │
│ Validation: root-equivalent│    │ per session cgroup; no raw cross-tenant data │
│ ops ONLY from orchestrator │    └─────────────────────────────────────────────┘
└───────────────┬───────────┘
                │
                │ container create (no socket inside workload)
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ TRUST BOUNDARY TB-5: Sandbox Container (UNTRUSTED workload)                    │
│  Validation: seccomp, cap drop, read-only root, RAM disk, network policy      │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │ syscall interface
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ TRUST BOUNDARY TB-6: Host Kernel / Device Model                               │
│  Validation: namespaces, cgroups, LSM; patches; no CAP in container          │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ TRUST BOUNDARY TB-7: Data Plane — Redis / Logs / Object store                 │
│  Validation: TLS + ACL; network segmentation; orchestrator-only write to TTL  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Approved Cryptographic Standards

All implementations **must** conform to the following. Exceptions require written security exception with compensating controls.

| Use Case | Approved Algorithm / Protocol | Notes |
|----------|-------------------------------|--------|
| TLS (all external and internal service-to-service) | TLS **1.2** minimum; **1.3** preferred | Cipher suites: AEAD only (e.g., AES-GCM, CHACHA20-POLY1305); disable SSLv3/TLS1.0/1.1 |
| Certificate authentication | RSA ≥2048 or ECDSA P-256+ / Ed25519 | mTLS for service mesh paths per architecture |
| JWT signing | **RS256** (RSA-PSS acceptable: PS256) | HMAC only for internal non-federated machine tokens with key in KMS; asymmetric preferred for user-facing |
| Symmetric encryption at rest | **AES-256-GCM** (or ChaCha20-Poly1305 where GCM unsuitable) | Unique IV per object; key in KMS/HSM |
| Password hashing (if any local accounts) | **Argon2id** (memory-hard params per OWASP) | Not applicable if IdP-only |
| Git / artifact integrity | **SHA-256** commit pinning; optional Sigstore/cosign for images | Verify digests before run |
| Randomness | `/dev/urandom` or `getrandom()`; **never** MT19937 for secrets | Use crypto libraries only |
| Redis / queue wire encryption | TLS 1.2+ with strong cipher | Prefer mutual TLS in zero trust layout |

Legacy algorithms (MD5, SHA-1, DES, 3DES, RC4) are **prohibited** for security-sensitive operations.

---

## Mandatory Security Controls Checklist (Pre-merge to `main`)

Each PR author and reviewer **must** confirm:

- [ ] **No hardcoded secrets** — credentials only from env/KMS/Vault; scanners pass (git-secrets, trufflehog, or equivalent).
- [ ] **Seccomp profile applied** to all sandbox containers (default Docker profile minimum; custom profile reviewed).
- [ ] **Capabilities dropped** — Dockerfile and runtime use `--cap-drop ALL` plus explicit minimal add if required.
- [ ] **No Docker socket** mounted into user or untrusted containers; only orchestrator host can use Docker API.
- [ ] **Network isolation verified** — no `--net=host` for workloads; egress policy matches S-08; tests or integration proof for new ports.
- [ ] **Read-only root filesystem** where architecture specifies it; explicit writable paths only on RAM disk or tmpfs.
- [ ] **Resource limits** — memory, CPU, pids, and storage quotas set for sandbox and ingestion jobs.
- [ ] **Authorisation** — new API routes enforce ownership/tenant checks; no open-by-default endpoints.
- [ ] **Structured logging** — no secret material in logs; PII/policy compliant scrubbing for Fluent Bit.
- [ ] **Dependencies** — `npm audit` / `pip-audit` / OS CVE scan addressed or risk accepted in ticket.

---

## Traceability Summary

| Risk | Threat IDs (sample) | All Critical threats have named control + Test ID |
|------|---------------------|-----------------------------------------------------|
| Critical | T-S02-002, T-S03-002, T-S04-002, T-S05-001, T-S05-004, T-S06-001, T-S06-003, T-S07-001, T-S09-002, T-S11-002, T-S12-003, T-S13-003, T-S14-001 | Yes — see tables |

---

## Git Commands (Deliverable Governance)

After stakeholder sign-off, initialise or update the repository and publish this document (adjust remote URL):

```bash
git init dasdocker 2>/dev/null || true
cd dasdocker
git checkout -b main 2>/dev/null || git checkout main
mkdir -p docs/security docs/handoffs
git add docs/security/STRIDE-threat-model.md
git add docs/handoffs/agent-01-handoff.md
git commit -m "docs(security): add STRIDE threat model for all 14 attack surfaces

- Document 40+ threats across web UI, API, container runtime, host kernel, and pipelines
- Classify all threats by STRIDE category and risk rating (Critical/High/Med/Low)
- Include attack tree for container escape and trust boundaries diagram
- Define approved cryptographic standards (RS256, TLS 1.2+, AES-256-GCM)
- Add mandatory security controls checklist for all agent PRs

Refs: Phase-1 Deliverable 1.1
Phase-Gate: Stakeholder sign-off required"
git remote add origin https://github.com/YOUR_ORG/dasdocker.git
git push -u origin main
```

**Note:** If `dasdocker` already exists inside a monorepo, run `git add` and `git commit` from the repository root without `git init`.

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Phase 1 | Agent 01 | Initial STRIDE model |

**Stakeholder sign-off:** _________________________ **Date:** __________  

Phase 1 gate **cannot** clear until signed.
