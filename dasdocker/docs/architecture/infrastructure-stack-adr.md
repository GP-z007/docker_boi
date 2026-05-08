# ADR-008: dasDocker Infrastructure Stack

| Field | Value |
|-------|--------|
| **Status** | Proposed — **Phase-Gate: Stakeholder sign-off required before Phase 2** |
| **Date** | 2026-05-09 |
| **Deciders** | Platform Engineering Lead (Agent 18); Stakeholder (approval) |
| **Supersedes** | — |
| **Superseded by** | — (future ADRs only, with Stakeholder sign-off) |

## Context

dasDocker is a **security-first** web sandbox: isolated containers, strict network policy, real-time telemetry, and **zero trust** between operator plane, control plane, and untrusted workloads (**Rule 1 — ZTA**). The platform needs a **minimal, defensible** infrastructure stack with **predictable CVE response**, **observable behavior**, and **testable** deployments (**Rule 2**).

Informal stack notes exist in the repository README; **this ADR is the binding contract**. Technology choices **must not** change after Stakeholder approval except via **new ADR + explicit Stakeholder sign-off**.

## Decision Drivers

1. Smaller operational and **software attack surfaces** where trade-offs permit.  
2. **Alignment** with existing architecture (Docker-isolated workloads, orchestrator API, IDS/logging/metrics pipelines).  
3. **OSS-first** runway: self-hosted on commodity Linux without mandatory SaaS.  
4. **Proving configuration** via **acceptance tests** per subsystem.  

---

## D-001 — Host Operating System

### Decision

**Ubuntu Server 22.04 LTS (amd64/arm64)** as the **primary** supported bare-metal and VM baseline for Phase 2 production-style deployments.

### Rationale

- **Long-term security maintenance**: Ubuntu Pro / ESM pathway and predictable **five-year LTS** cadence align with CVE-driven patching expectations.  
- **Ecosystem parity**: Documentation, CIS/STIG-derived hardening guides, Ansible modules, and **Docker Engine** vendor packages are mature on Ubuntu 22.04.  
- **Hardware & cloud coverage**: Runs on bare metal, VMware/KVM, and major cloud machine images without vendor lock-in to a single hypervisor or AWS-only OS.  

### Alternatives Considered & Why Rejected

| Alternative | Rejection reason |
|-------------|------------------|
| **Fedora CoreOS** | Strong immutable model, but **shorter support windows** and **rpm-ostree** operational model increase retraining cost; smaller pool of operators vs Ubuntu LTS for mixed skill teams. |
| **Flatcar Linux** | Excellent for **Kubernetes**-centric immutable fleets; dasDocker Phase 2 targets **single- or few-node Docker Engine** control; **operational overhead** (update channels, Ignition) not justified until a K8s migration ADR exists. |
| **Bottlerocket** | **AWS-only**; violates OSS self-host runway and on-prem requirements; acceptable only if a future **cloud-specific** ADR scopes AWS-only deployments. |

### Security Implications

- Standard **unattended-upgrades** / patch orchestration must be **mandatory**; **CIS-hardened** sshd, firewall, and **AppArmor** profiles align with container baseline docs.  
- Immutable OS options (CoreOS/Flatcar/Bottlerocket) trade **smaller mutable root** for **different** update and debugging risks — deferred, not dismissed.  

### Acceptance Test

1. **Install gate**: `ubuntu-distro-info --all | grep 22.04` (or `/etc/os-release` `VERSION_ID=22.04`).  
2. **Kernel & modules**: `uname -r` documents supported HWE/kernel for **eBPF** and **nftables** features required by network/telemetry specs.  
3. **Hardening smoke**: `ss -lntp` shows **no unexpected listeners** on management interfaces; `ufw status` or documented **nftables** ruleset applied per runbook; **automatic security updates** enabled.  

---

## D-002 — Container Runtime

### Decision

**Docker Engine** (pinned major version range in Phase 2 runbook) **with embedded containerd** as the runtime shim — operator and orchestrator use the **Docker API** (`unix:///var/run/docker.sock` or **TCP TLS** proxy in hardened topology).

### Rationale

- **Product alignment**: dasDocker orchestration maps naturally to **Docker networks, volumes, and lifecycle** APIs already assumed in architecture diagrams.  
- **Supply chain clarity**: Docker **Moby** Engine is widely audited; **pinned versions** + **CVE watch** (`trivy`, vendor advisories) satisfy ZTA operational discipline.  
- **Developer and ops ergonomics**: `docker compose` parity for integration tests and staged environments.  

### Alternatives Considered & Why Rejected

| Alternative | Rejection reason |
|-------------|------------------|
| **pure containerd (ctr/nerdctl only)** | **Smaller daemon surface** but **no stable Docker Compose v2 equivalence** across teams; orchestrator code would diverge (`containerd`/CRI idioms vs **Docker API**); Phase 2 would ship **duplicate** tooling. |
| **Podman (rootless)** | **Excellent** ZTA story for rootless workloads; however **Docker API compatibility** varies, **rootless networking** complicates **bridge-level IDS tap** and **fixed bridge names** in `network-isolation-spec.md`; reassessment via **future ADR** if rootless becomes mandatory. |

### Security Implications

- **Docker socket** is **high privilege**; orchestrator **must not** expose raw socket to UI; **TLS + mTLS** or **SSH tunnel** patterns for remote daemons documented in Phase 2.  
- **seccomp, AppArmor, no-new-privileges** enforced per **`container-baseline-profile.md`**.  

### Acceptance Test

1. `docker version` — Client **and** Server report **semver within pinned range**.  
2. `docker info -f '{{.SecurityOptions}}'` includes expected security options per baseline.  
3. **Integration**: Orchestrator CI job **creates** a throwaway bridge-attached container and **dies** cleanly (no orphaned netns).  

---

## D-003 — Orchestrator Language & Framework

### Decision

**Go (toolchain 1.22+)** with **Gin** HTTP router and **`gorilla/websocket`** (or stdlib-compatible wrapper) for **interactive terminal and telemetry** streams — **Orchestrator API** shipped as **static linux binary** plus **minimal container image** (`distroless` or `scratch` + certs).

### Rationale

- **Attack surface**: **Compiled binary** avoids **npm/PyPI** runtime dependency explosions on the **control plane**; dependency graph **auditable** with `govulncheck`.  
- **Operational fit**: **Native concurrency**, **static linking option**, low memory footprint for **session-per-connection** websocket fan-out.  
- **Maintenance**: Active **CVE** remediation culture in Go stdlib release notes.  

### Alternatives Considered & Why Rejected

| Alternative | Rejection reason |
|-------------|------------------|
| **Node.js / Fastify** | **Strong DX** and matches historical README sketches, but **`node_modules`** **supply-chain blast radius** and **dynamic runtime** patching burden are **less favorable** on the **privileged orchestrator** than a **compiled** service; reassess only via new ADR. |
| **Python / FastAPI** | **Fast iteration** and rich security libs; weaker **deployment hardening defaults** (venv/pinning discipline) and **GIL-centric** workloads under **heavy WS** load without careful process model. |

### Security Implications

- **Images**: multi-stage builds; **no shell** in production image unless debug ADR-approved.  
- **Authn/z**: JWT/OIDC validation in **middleware**; **rate limits** per operator; **no** plaintext secrets in flags — **Vault** injection only (see D-007).  

### Acceptance Test

1. **`govulncheck ./...`** passes in CI on **every** merged commit to orchestrator module.  
2. **Binary**: `go version -m ./orchestrator` lists **embedded** `-buildvcs`/module versions; **`CGO_ENABLED=0`** for portable static build (unless cgo explicitly justified).  
3. **Smoke**: `/healthz` returns **200**; **authenticated** WS endpoint rejects **anonymous** handshake with **401/403**.  

---

## D-004 — Message Bus / Event Stream

### Decision

**Redis 7.x** — **Redis Streams** as the primary **telemetry and task event** backbone (consumers: orchestrator workers, UI fan-out gateways where applicable).

### Rationale

- **Operational unity**: Same Redis deployment serves **TTL signals**, **stream buffers**, and **bounded** pub/sub patterns without introducing **Kafka-level** JVM/ops tax for Phase 2 scale targets.  
- **Performance**: Streams provide **consumer groups**, **ACK**, and **approximate at-least-once** processing adequate for **IDS and process-event** ingestion at initial scale.  

### Alternatives Considered & Why Rejected

| Alternative | Rejection reason |
|-------------|------------------|
| **Apache Kafka** | **Durable replay** and **massive throughput**; **overkill** for initial **single-region** deployments; **ZooKeeper/KRaft** ops burden and ** JVM CVE class** contradict **minimal surface** mandate **unless** scale ADR mandates. |
| **RabbitMQ** | Solid **AMQP** and **routing**; ** Erlang OTP** footprint and **cluster complexity** higher than Redis for **streaming + cache** consolidation. |

### Security Implications

- **ACLs**, **`requirepass`** or TLS mutual auth, **`rename-command`** to disable **`FLUSHALL`** / **`CONFIG`** where feasible.  
- **AUTH** credential **only** via Vault; **no** `--requirepass` in compose literals in git (**Rule 1**).  

### Acceptance Test

1. `redis-cli ACL WHOAMI` (or `AUTH` probe) verifies **authenticated** session.  
2. **Functional**: `XADD` sample stream + **`XREADGROUP`** consumer acknowledges **replay** semantics in **staging** harness.  
3. **Forbidden command check**: scripted attempt to invoke **renamed/disabled** admin commands **fails**.  

---

## D-005 — Durable State Store

### Decision

**PostgreSQL 15+** as the **system of record** for **operator accounts**, **session metadata**, **audit records**, and **lifecycle correlation IDs**. **Redis** remains **non-authoritative** (cache, streams, ephemeral coordination) — see D-004.

### Rationale

- **ACID** semantics for **session history**, **billing/quota hooks**, and **compliance-aligned** retention queries.  
- **Mature** backup/replication tooling (**pgBackRest**, **WAL archiving**).  

### Alternatives Considered & Why Rejected

| Alternative | Rejection reason |
|-------------|------------------|
| **Redis as sole store** | **No** rich query model or durable **relational integrity** for **audit** and **multi-tenant isolation** proofs; **RDB/AOF** alone insufficient for **authoritative** compliance posture. |
| **etcd** | **Strong** for **distributed consensus**; **Kubernetes** control-plane fit; **not** a substitute for **relational** session/audit modeling without significant **application-layer** burden. |

### Security Implications

- **Encryption at rest** (LUKS or cloud KMS); **`scram-sha-256` auth** minimum; **row-level security** evaluated for multi-tenant Phase 3.  
- **Network**: PostgreSQL listens **localhost** or **private VIP** **only**.  

### Acceptance Test

1. `SELECT version()` returns **PostgreSQL 15** or newer.  
2. **TLS**: `sslmode=verify-full` from orchestrator staging to Postgres **succeeds**; **fails** on **certificate hostname mismatch**.  
3. **Migration gate**: **`golang-migrate`** / **`goose`** (or chosen tool — Phase 2) applies **baseline** migrations **idempotently** in CI **ephemeral DB**.  

---

## D-006 — Secrets Management

### Decision

**HashiCorp Vault OSS** (**KV v2** secrets engine initially) as the **canonical** secrets store for **all** non-development environments. Development **may** use **`.env`** **only** from **`direnv` + gitignored templates** — **never** committed.

### Rationale

- **Dynamic secrets**, **fine-grained policies**, **audit log**, and **namespace** isolation for **multi-environment** rollout.  
- **Self-hosted** runway without **hyperscaler lock-in**.  

### Alternatives Considered & Why Rejected

| Alternative | Rejection reason |
|-------------|------------------|
| **AWS Secrets Manager** | **Strong** when **100% AWS**; **rejected** as **primary** ADR choice due to **vendor coupling** and **egress/IAM** complexity for **on-prem** target; **permitted** as **downstream Vault secret backend** via plugin or **dual-write** **only if** future ADR approves hybrid cloud. |
| **Infisical** | Modern UX and **OSS** trajectory; **smaller** **organizational pedigree** vs Vault for **SOC2-aligned** audits **today**; **revisit** via ADR **if** operational simplification outweighs Vault **HA** maturity in org context. |

### Security Implications

- **Seal config** (**Shamir** vs cloud KMS); **minimal root token** usage; **`orphan`** periodic tokens for CI via **JWT auth** (**GitHub OIDC** → Vault role).  

### Acceptance Test

1. **`vault status`** — **`Sealed`** false on healthy node; **HA** replication mode documented.  
2. **KV read**: Orchestrator staging resolves **`secret/data/dasdocker/orchestrator`** (exact path convention in registry below) via **AppRole** or **K8s auth** (**Phase 2**).  
3. **Lease**: Short-lived dynamic credential (**Postgres** or **Redis** if enabled) **expires** as expected (**integration** test **with** TTL **≤ 1h** sandbox).  

---

## D-007 — Log Aggregation Pipeline

### Decision

**Fluent Bit** (**forward** output) → **Grafana Loki** for **structured** and **plaintext** ingest; **Docker** container logs and **host** syslog/journal scraped per Phase 2 runbook.

### Rationale

- **Fluent Bit** — **C** implementation, **low footprint**, **CNCF** alignment, **wide** input plugins.  
- **Loki** pairs with **Prometheus/Grafana** (D-009) for **unified** investigation of **IDS + orchestrator** timelines.  

### Alternatives Considered & Why Rejected

| Alternative | Rejection reason |
|-------------|------------------|
| **Fluent Bit → OpenSearch** | **Full-text** and **security analytics** strength; **heavier** JVM/heap operations and **index management** cost **for Phase 2** single-region targets. |
| **Vector → Loki** | **Excellent** performance and **VRL**; **smaller** operational mindshare on team **unless** team standardizes Vector — **deferred**; **rejection** is **phase scope**, not technical inferiority. |

### Security Implications

- **TLS** end-to-end; **mutual TLS** between Fluent Bit and Loki **where** cross-node.  
- **PII / secret redaction** filters **mandatory** in Fluent Bit (`lua` or `nest` drop rules) — **never** ship raw **JWT** or **Vault tokens** to Loki.  

### Acceptance Test

1. **Synthetic log**: **`logger`** / **`curl`** generates **structured** JSON line ingested into Loki (**query** verifies **label**: `job=dasdocker-orchestrator`).  
2. **Redaction**: **Unit** fixture log line containing fake **`Bearer`** token **never** appears in Loki **`logfmt`** search in **staging**.  

---

## D-008 — Metrics & Monitoring

### Decision

**Prometheus** (**scraping**) + **Grafana** (**dashboards/alerting**) — **self-hosted** baseline. **Commercial SaaS APM** (e.g. **Datadog**) **out of scope** for **baseline** OSS commitment.

### Rationale

- **Prometheus** pull model aligns with **orchestrator** `/metrics` and **node_exporter**/`cadvisor`.  
- **Grafana** alerting channels (**PagerDuty**/email/webhook) without **mandatory SaaS**.

### Alternatives Considered & Why Rejected

| Alternative | Rejection reason |
|-------------|------------------|
| **Datadog** | **Strong managed** UX; **rejected as primary** due to **data egress**, **subscription coupling**, **on-prem/offline impossible** deployments; **permitted overlay** via **vendor integration** **only after** stakeholder cost & data-residency ADR. |
| **Other self-hosted** (VictoriaMetrics, Thanos…) | **Valid** scaling paths — **defer** until **Cardinality** / **Retention** Phase 3 ADRs; Prometheus **adequate for launch**. |

### Security Implications

- **Prometheus**: **listen localhost** / **reverse proxy SSO** for Grafana; **TLS** ingress.  

### Acceptance Test

1. **`/-/healthy`** **and** Prometheus **Targets** UI shows **orch**, **redis**, **postgres exporter** (if used) **UP**.  
2. **Grafana**: **Dashboard UID** `dasdocker-overview` **loads**; **alert** rule **“OrchestratorDown”** **fires** on **staged** stop (and **resolves** on start).  

---

## D-009 — Frontend Framework

### Decision

**React 18+** with **TypeScript** and **Vite** as the **build tool**; operator UI shipped as **static SPA** behind **nginx** (or **Caddy**) **reverse proxy** — **no** Node server in **production** serving operator HTML.

### Rationale

- **Smaller production attack surface** than **Next.js Node server** for a UI that is **primarily** WebSocket/API client to **Go orchestrator** (**ZTA**: separate origin for **ProxiedWebView** already in UI spec).  
- **Vite** — **fast** CI builds, **ESM-native**, **small** config.  

### Alternatives Considered & Why Rejected

| Alternative | Rejection reason |
|-------------|------------------|
| **Next.js** | **SSR/ISR** **not required** for **authenticated operator console**; **Node** **attack surface** and **complex** **middleware** story **on edge** of **zero-trust** boundary; **README** historical note **superseded** by this ADR for **production topology**. |
| **SvelteKit** | **Excellent** DX; **smaller** hiring pool and **ecosystem** for **security enterprise** integrations (**Grafana embeds**, **auth** libs) vs **React**; **revisit** if performance mandates. |

### Security Implications

- **CSP** headers at **ingress**; **`unsafe-inline`** **disallowed** in **production**; **nonce/hash** pipeline in Phase 2.  
- **Dependencies**: **`pnpm audit`** + **Dependabot** in CI (**mandatory**).  

### Acceptance Test

1. **`pnpm build`** (**or npm**) produces **`dist/`** with **immutable hashed** assets **only**.  
2. **`trivy fs`** / **`npm audit --production`** **gate** (**no** **critical** **unaccepted** vulns — **risk acceptance** tracked in **`SECURITY.md`**).  
3. **Lighthouse CI** optional; **baseline** **CSP** **header present** verified by **integration** curl.  

---

## D-010 — CI/CD Platform

### Decision

**GitHub Actions** as the **sole** canonical CI/CD orchestrator for **`docker_boi`** (build, **SAST**, **container scan**, **integration** smoke).

### Rationale

- Repository **already** on GitHub; **OIDC** to **Vault**/**AWS** (**optional**) **without** long-lived **`GITHUB_TOKEN`** secrets for cloud deploy (**when** enabled).  

### Alternatives Considered & Why Rejected

| Alternative | Rejection reason |
|-------------|------------------|
| **GitLab CI** | **Excellent** parity; **rejected** to **avoid** duplicative **runner estate**/**source-of-truth** split while **canonical repo** resides on GitHub. |
| **Drone** | Lightweight **containers-as-steps** runner; **rejected** for **initial** rollout due to **separate UI/RBAC plane** maintenance **before** Phase 2 stabilizes pipelines on **GHA**. |

### Security Implications

- **Branch protection**, **required** reviews, **`CODEOWNERS`**, **`environment`** protection rules **for** **`production`**.  
- **`actions: read` minimal** pinning via **`pinact`** or renovate **recommended**.  

### Acceptance Test

1. **`ci`** workflow **`on: pull_request`** **passes**: **lint**, **unit**, **`trivy`**, **`semgrep`** (per DevSecOps README intent).  
2. **OIDC staging**: **JWT** **`aud`** matches Vault role **dry-run** (Phase 2).  

---

## Environment Variables Master Registry

**Convention:** **`Secret: yes`** values **never** reside in plaintext in git or CI logs — **population** solely from Vault path **shown**. **`Secret: no`** may have **defaults** in **Compose** (**non-prod**) but **still** parameterized for **staging/prod**.

| Variable name | Description | Consumer service(s) | Secret? | Vault path(s) *(KV v2 = `secret/data/...`)* |
|---------------|-------------|---------------------|---------|--------------------------------------------|
| `DASDOCKER_ENV` | Logical environment (`development`/`staging`/`production`) | All | no | — |
| `DASDOCKER_ORCH_HTTP_ADDR` | Orchestrator bind address (:8080 internal) | Orchestrator | no | — |
| `DASDOCKER_ORCH_DATABASE_URL` | PostgreSQL **DSN** | Orchestrator | **yes** | `secret/data/dasdocker/orchestrator/database_url` |
| `DASDOCKER_ORCH_REDIS_URL` | Redis **URL** (**ACL**) | Orchestrator, workers | **yes** | `secret/data/dasdocker/orchestrator/redis_url` |
| `DASDOCKER_ORCH_JWT_ISSUER` | OIDC issuer **URL** | Orchestrator | no | — |
| `DASDOCKER_ORCH_JWT_AUDIENCE` | Expected **`aud`** | Orchestrator | no | — |
| `DASDOCKER_ORCH_SESSION_SIGNING_KEY` | HMAC/session cookie signing (**rotatable**) | Orchestrator | **yes** | `secret/data/dasdocker/orchestrator/session_signing_key` |
| `DASDOCKER_ORCH_DOCKER_HOST` | Docker daemon endpoint | Orchestrator | no *(mTLS certs **yes**)* | certs: `secret/data/dasdocker/orchestrator/docker_client_tls` |
| `DASDOCKER_ORCH_STREAM_PREFIX` | Redis Stream key prefix | Orchestrator | no | — |
| `DASDOCKER_VAULT_ADDR` | Vault API base URL | All Vault clients | no | — |
| `DASDOCKER_VAULT_ROLE_ID` | AppRole Role ID | Orchestrator (**non-OIDC**) | **yes** | `secret/data/dasdocker/platform/vault_approle_orchestrator#role_id` |
| `DASDOCKER_VAULT_SECRET_ID` | AppRole Secret ID | Orchestrator | **yes** | `secret/data/dasdocker/platform/vault_approle_orchestrator#secret_id` |
| `DASDOCKER_POSTGRES_PASSWORD` | Superuser / app password | PostgreSQL, Orchestrator DSN (if split) | **yes** | `secret/data/dasdocker/database/postgres_app_password` |
| `DASDOCKER_REDIS_PASSWORD` | Redis AUTH (if ACL single-user) | Redis, Orchestrator | **yes** | `secret/data/dasdocker/cache/redis_password` |
| `DASDOCKER_GRAFANA_ADMIN_PASSWORD` | Grafana **bootstrap** (**change on first login**) | Grafana | **yes** | `secret/data/dasdocker/observability/grafana_admin` |
| `DASDOCKER_LOKI_HTTP_ADDR` | Loki ingest URL (**internal**) | Fluent Bit | no | — |
| `DASDOCKER_FLUENTBIT_CFG_PATH` | Path to Fluent Bit runtime config | Fluent Bit | no | — |
| `DASDOCKER_PROMETHEUS_RETENTION` | Prometheus storage retention (**e.g. 15d**) | Prometheus | no | — |
| `DASDOCKER_DNS_UPSTREAMS` | Comma-separated upstream resolvers for **dnsmasq** | Host / dnsmasq | no *(values **not** literals in git — env-injected)* | optional: `secret/data/dasdocker/network/dns_upstreams` |
| `DASDOCKER_WAN_IF` | WAN interface name for **MASQUERADE** | Host **netfilter** scripts | no | — |
| `DASDOCKER_BRIDGE_NAME` | Docker bridge for IDS tap | Suricata, ops | no | — |
| `DASDOCKER_UI_API_BASE_URL` | Public orchestrator **HTTPS** base | Frontend **(build-time `VITE_*`)** | no | — |
| `DASDOCKER_UI_SANDBOX_PROXY_ORIGIN` | Distinct **origin** for proxied iframe | Frontend | no | — |
| `VITE_DASDOCKER_API_BASE` | Build-time API base for SPA | Frontend build | no | — |
| `GITHUB_TOKEN` | **Ephemeral** fine-scoped token | GitHub Actions **only** | **yes** | **GitHub OIDC / GHA secrets store** — **not** Vault by default |

**Note:** Additional **`NR-*` / network** variables from `network-isolation-spec.md` **must** be merged into this registry **when** netops scripts land — **no duplicate conflicting names**.

---

## Consequences

- **Positive**: Coherent **OSS** stack, **strong ZTA alignment** on control plane, **testable** acceptance criteria per tier.  
- **Negative**: **Training** for **Vault** + **Go** + **Vite** trifecta; **README** “Node/Next” **narrative** **superseded** for **production** by this ADR — **documentation PR** recommended.  
- **Risks**: **Scale** triggers **Kafka/Thanos** class ADRs; **rootless Podman** may return if **strong** customer mandate.  

---

## Compliance

| Rule | Satisfied by |
|------|----------------|
| **Rule 1 — ZTA** | Per-decision **Security Implications**; Vault; Go binary; SPA static UI; Redis ACL; Postgres TLS |
| **Rule 2 — Testing** | **Acceptance Test** subsection per decision area |

---

## Approval *(Stakeholder)*

| Name | Role | Signature / Date |
|------|------|------------------|
| *TBD* | Product / Security Stakeholder | **Required before Phase 2** |

---

*ADR-008 — Infrastructure Stack — Agent 18 Phase 1 Deliverable **1.8***
