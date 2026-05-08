# Agent 18 Phase 2 Handoff — Hardened Host Environment & GitHub Actions Skeleton

## (a) What was built

- **Authoritative sysctl contract** at `dasdocker/config/sysctl/99-dasdocker-hardening.conf` (**14** hardened parameters) with inline STRIDE Threat ID traceability per **SEC-THREAT-001** (`T-Sxx-###` cites).
- **Daemon configuration drop-in** at `dasdocker/config/docker/daemon.json` aligning with ADR-008 D-002: `icc=false`, `live-restore`, iptables datapath (`userland-proxy=false`), **global** `no-new-privileges=true`, capped **json-file** logging (**10 MiB × 3 rotations**), `overlay2`, and **nofile 1024:1024** default ulimits (**DoS containment / T-S04-004**, **T-S05-003** classes).
- **Operational scripts (`dasdocker/scripts/`)**  
  - `harden-host-fs.sh` — tmpfs `/tmp` **noexec,nosuid,nodev**, recursive live **proc hidepid=2**, strip world-writable bits under **`/etc` + `/opt`**, disable **Avahi**, **CUPS**, **Bluetooth** (each justified threat idempotently via `disable_svc`).
  - `install-docker.sh` — pins **Docker Engine `5:25.0.5-1~ubuntu.22.04~jammy`** (override via `DASDOCKER_DOCKER_CE_VERSION`), configures repo keys, **`apt-mark hold`**, publishes `daemon.json`, enforces **`/var/run/docker.sock` → `660 root:docker`** when socket exists post-start.
  - `create-service-account.sh` — provision **`dasdocker-svc`** with **`/usr/sbin/nologin`**, home **`/opt/dasdocker` (`0750`)**, seeds writable orchestrator subtree **`/opt/dasdocker/var`**, attaches **Docker group**, installs mirrored **`dasdocker-orchestrator.service`**.
- **Stub systemd unit**: `dasdocker/systemd/dasdocker-orchestrator.service` — **non-root** `User=`/`Group=`, `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict` (placeholder `ExecStart=/usr/bin/true` until orchestrator binary ships).
- **Full-spectrum infrastructure tests** under `dasdocker/tests/infrastructure/` plus controlled red-team fixtures (gitleaks + log4j-class Maven stub + shellcheck eval misuse).
- **Repo-wide secret baseline** via **`.gitleaks.toml`** allowlisting only the deliberate red-team directory.
- **GitHub Actions**: canonical workflow **`.github/workflows/ci.yml`** (mirrored at `dasdocker/.github/workflows/ci.yml` via symlink for spec parity) covering **hadolint**, **shellcheck**, **jq**, **trivy fs (CRITICAL)**, **gitleaks**, **semgrep** (`p/docker` + `p/bash`), bash acceptance suite, and **Squad A label gate** (`squad-a-approved`) for PRs targeting `main`.

## (b) Downstream contract — APIs, ports, paths, environment variables

| Kind | Value |
|------|-------|
| **Repository URL** | `https://github.com/<ORG>/<REPO>.git` — replace with the canonical remote for this monorepo (`docker_boi` today). |
| **Feature branch convention** | `feat/<agent>-<scope>` (Rule 3). |
| **CI workflow file (runtime)** | /.github/workflows/ci.yml (GitHub discovery requirement). Mirror path `dasdocker/.github/workflows/ci.yml` points to root workflow. |
| **CI invocation URL template** | `https://github.com/<ORG>/<REPO>/actions/workflows/ci.yml` |
| **Host sysctl drop-in (ship path)** | `dasdocker/config/sysctl/99-dasdocker-hardening.conf → /etc/sysctl.d/99-dasdocker-hardening.conf` |
| **Docker daemon drop-in** | `dasdocker/config/docker/daemon.json → /etc/docker/daemon.json` |
| **Service identity** | `dasdocker-svc` (`/etc/passwd`), home `/opt/dasdocker`, orchestrator writable state **`/opt/dasdocker/var`**. |
| **systemd stub install path** | `/etc/systemd/system/dasdocker-orchestrator.service` (installed by `create-service-account.sh`). |
| **Privileged IPC surface** | Docker UNIX socket **`/var/run/docker.sock`** (must remain **`0660 root:docker`**, never world-readable — **T-S06-001**). |
| **Listening ports exposed by this deliverable** | **None** (scripts + CI only). |
| **Mandatory internal APIs** | **N/A** — infrastructure scaffolding precedes orchestrator REST surface. |

**Environment variables (host provisioning)**

| Variable | Secret? | Meaning |
|-----------|---------|---------|
| `DASDOCKER_DOCKER_CE_VERSION` | no | Overrides apt pin in `scripts/install-docker.sh` (still must stay on an audited semver). |

**Operational ordering (recommended)**

1. `./dasdocker/scripts/harden-host-fs.sh`  
2. `./dasdocker/scripts/install-docker.sh`  
3. `sudo sysctl --system && sudo sysctl -a | grep dasDocker markers` (**verify**)  
4. `./dasdocker/scripts/create-service-account.sh`

## (c) Warnings / limitations needing Squad A review

| Item | Severity | Notes |
|------|----------|-------|
| **Docker group membership** (`dasdocker-svc`) | **High** | `docker` group == **effective root** on Linux nodes (**T-S06-001**). Acceptable **only** when membership is confined to orchestrator UID + audited break-glass admins; Squad A must sign off roster + sudo policy. |
| **`kernel.unprivileged_userns_clone = 0`** | **Medium** | Breaks **rootless** Docker/Podman flows; aligned with ADR **Docker Engine (rootful)** path but blocks developer rootless experiments—document exception process. |
| **`kernel.unprivileged_bpf_disabled = 1`** | **Medium** | Prevents **unprivileged** eBPF; verify agent **T-S07** roadmap for privileged loader accounts only. |
| **Semgrep / Trivy DB drift** | **Low** | Supply-chain rules evolve; pin bumps require joint security + platform review to avoid silent green builds. |
| **Mandatory label gate bootstrap** | **Medium** | First PR to `main` **fails** until maintainers apply `squad-a-approved`; require branch protection **Allow specified actors to bypass** for break-glass OR pre-label during import. |
| **ADR-008 Phase Gate** | **Gate** | ADR still **Proposed** in doc — treat stack choices as **draft** until stakeholder signature captured. |

## Toolchain pins (CI & scripts)

| Tool | Version / channel |
|------|-------------------|
| Runner OS | `ubuntu-22.04` |
| Hadolint | `docker.io/hadolint/hadolint:2.12.1-alpine` (stdin scan) |
| ShellCheck | distro `apt` package on jammy runners |
| jq | distro package |
| Trivy | `v0.53.0` (install script) |
| GitLeaks | `v8.18.4` |
| Semgrep | `v1.93.2` via `pipx` |
| Docker Engine (host pin) | `5:25.0.5-1~ubuntu.22.04~jammy` (confirm with `apt-cache madison docker-ce` before freezing gold images) |

## Branch protection checklist (manual in GitHub)

> GitHub CLI / API varies by org policy — platform owner applies in `/settings/rules` or legacy branch protections.

1. **Require PR** before merging to `main`.  
2. **Require status checks**: `Lint & Static Config Validation`, `Security Scanners (supply chain)`, `Bash Infrastructure Acceptance`, `Mandatory Squad A review gate`.  
3. **Require CODEOWNERS** or minimum **two** reviewers for Squad A hotspots once `CODEOWNERS` lands (future Agent).  
4. **Block force pushes**, **linear history recommended**.  
5. **Allow exemptions** ONLY for admins during bootstrap (remove after first green merge).  

## sysctl values Docker commonly overrides — why residual risk is managed

| Sysctl touched | Typical Docker rationale | Risk acceptance |
|----------------|---------------------------|----------------|
| `net.ipv4.ip_forward = 1` | Enables bridged/NAT egress for containers (**ADR D-002 networking**); required when `iptables` forwards between `docker0` and WAN. | Acceptable **only** with **`icc=false`**, non-default bridge policies (Agent 03 backlog), upstream firewall (`ufw`/`nft`), and **SNAT-controlled** egress paths (**T-S08-001** / **T-S08-004** mitigation stack). Squad A validates those compensating controls. |
| `net.bridge.bridge-nf-call-{iptables,ip6tables}` (kernel params) | Ensures iptables filtering sees bridged frames. | Must remain aligned with IDS tap + isolation spec; conflicting `firewalld` rules need explicit runbooks. |

> **Observation:** Deployed daemons SHOULD be reviewed with `sysctl -a | sort` post-`sysctl --system` + after `docker` start — anything diverging from the drop-in lands in Ansible/Salt state, not ephemeral shell hacks.

---

*Agent 18 · Principal Platform Engineer · Phase 2 / Dispatch Host & CI scaffolding · Rules 1–4 satisfied in deliverable boundaries.*
