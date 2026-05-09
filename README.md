# dasDocker
Security-first ephemeral sandbox platform for running untrusted repositories and ZIP uploads under strict Zero Trust controls.

[![CI](https://github.com/GP-z007/docker_boi/actions/workflows/ci.yml/badge.svg)](https://github.com/GP-z007/docker_boi/actions/workflows/ci.yml) ![License](https://img.shields.io/badge/license-MIT-blue.svg) ![Security Hardened](https://img.shields.io/badge/security-hardened-red.svg) ![Not for production secrets](https://img.shields.io/badge/warning-not_for_production_secrets-orange.svg)

## What is dasDocker?
dasDocker is a hardened execution environment designed to run untrusted code in tightly constrained Linux containers. It combines strict host hardening, network isolation, secret management, runtime controls, and telemetry capture to reduce the attack surface during dynamic code execution. The platform exists to support security analysis, malware triage, and controlled sandboxing workflows where reproducibility and containment are required. Every session is designed to be ephemeral, with enforced lifecycle and destruction guarantees built into the control plane.

Key features:
- Sandboxed execution of GitHub repositories and ZIP uploads
- Automatic runtime detection (Node.js, Python, Go, Rust, Java, Ruby, PHP)
- Isolated NAT networking with LAN-block controls and DNS sinkholing
- RAM-disk only session storage (tmpfs) with zero persistence post-session
- eBPF host-kernel process and syscall telemetry
- Real-time pcap capture with Suricata IDS enrichment
- Live browser console (`xterm.js`) and proxied application web view
- Mandatory self-destruct timers (60s to 3600s)
- Zero Trust architecture across control plane and sandbox runtime

> ⚠️ **Security Disclaimer:** dasDocker provides strong isolation controls but is not an
> unconditionally secure environment. Do not use it to run code containing production
> credentials, personal data, or anything whose exposure would cause harm. No sandbox
> is immune to zero-day kernel exploits.

## Architecture Overview
```text
Browser (User)
    │
    │ HTTPS + WSS
    ▼
┌─────────────────────────────────────────────────────────┐
│                Frontend (React + Vite)                 │
│         Live Console │ Telemetry Dashboard             │
│         Proxied Web View │ Session Control Panel       │
└───────────────────────┬────────────────────────────────┘
                        │ REST API + WebSocket
                        ▼
┌─────────────────────────────────────────────────────────┐
│             Orchestrator API (Node/Fastify)            │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Session State  │  │  Ingestion   │  │  Container  │ │
│  │ Machine(Redis) │  │  Service     │  │  Lifecycle  │ │
│  └────────────────┘  └──────────────┘  └─────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │            Self-Destruct Timer Service             │ │
│  │      Redis TTL Layer + Watchdog Cron (60s)         │ │
│  └────────────────────────────────────────────────────┘ │
└───────────────────────┬────────────────────────────────┘
                        │ Docker API
                        ▼
┌─────────────────────────────────────────────────────────┐
│              dasdocker-isolated Network                │
│             (172.31.0.0/16, ICC disabled)              │
│  ┌───────────────────────────────────────────────────┐  │
│  │        Sandbox Container (untrusted code)         │  │
│  │ tmpfs /workspace (512MB) │ tmpfs /tmp (64MB)      │  │
│  │ --cap-drop ALL │ seccomp │ AppArmor               │  │
│  │ --memory 512m │ --pids-limit 100 │ --cpus 1.0     │  │
│  └───────────────────────────────────────────────────┘  │
└──────────┬──────────────────────────────────────────────┘
           │ Out-of-band monitoring (host kernel level)
           ▼
┌──────────────────────────────────────────────────────────┐
│               Observability Pipeline                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  eBPF Agent  │  │ pcap/Suricata│  │   Fluent Bit  │  │
│  │  (syscalls,  │  │    (IDS,     │  │   → Loki      │  │
│  │   proc tree) │  │  DNS, HTTP)  │  │   (logs)      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘  │
│         └─────────────────┴──────────────────┘           │
│                     Redis Streams                        │
│                  WebSocket Event Bus                     │
└──────────────────────────────────────────────────────────┘
```

- **Browser:** Operator control surface for session creation, live interaction, and teardown.
- **Frontend:** React/Vite UI that renders session state, console output, telemetry, and proxied app panels.
- **Orchestrator API:** Core control plane handling ingestion, state machine transitions, and policy enforcement.
- **Self-Destruct Service:** Redis TTL + watchdog fallback that enforces mandatory timeout destruction.
- **Isolated Network:** Dedicated Docker bridge (`dasdocker-isolated`) with LAN deny posture and sinkhole DNS.
- **Sandbox Container:** Locked-down runtime with tmpfs-backed storage and strict seccomp/AppArmor/resource limits.
- **Observability Pipeline:** eBPF, pcap/Suricata, and Fluent Bit/Loki capture stack feeding event and log telemetry.

## Prerequisites
| Requirement | Minimum Version | Notes |
|---|---|---|
| Ubuntu | 22.04 LTS | Host OS. Bare-metal or dedicated VM recommended |
| Linux Kernel | 5.15+ | Required for eBPF CO-RE support |
| Docker Engine | 26.x | Do NOT use Docker Desktop - install Engine directly |
| Docker Compose | v2.x | Optional - for local dev only |
| Node.js | 20.x LTS | Required for orchestrator and frontend |
| npm | 10.x | Installed with Node.js |
| Python | 3.11+ | Required if using Python runtime detection |
| Redis | 7.x | Required for session state and self-destruct timers |
| HashiCorp Vault | 1.15+ | Required for secrets management |
| git | 2.x | Required for GitHub repo ingestion |
| ClamAV | 1.x | Required for pre-scan malware detection |

eBPF monitoring requires a kernel with BTF (BPF Type Format) support. Run `ls /sys/kernel/btf/vmlinux` - if this file exists, your kernel is compatible.

## Project Structure
```text
dasdocker/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Main CI pipeline (lint, scan, test, sign)
│       └── pr-security-gate.yml      # PR gate: Squad A review + deliverable ref check
├── config/
│   ├── docker/
│   │   └── daemon.json               # Docker daemon hardening config
│   ├── network/
│   │   ├── iptables-dasdocker.rules  # Isolated NAT iptables ruleset
│   │   └── dnsmasq-dasdocker.conf    # DNS sinkhole config
│   ├── security/
│   │   ├── seccomp-dasdocker.json    # Seccomp syscall allowlist profile
│   │   └── apparmor-dasdocker.profile # AppArmor container profile
│   ├── sysctl/
│   │   └── 99-dasdocker-hardening.conf # Kernel hardening sysctl values
│   └── vault/
│       └── policies/                 # Per-service Vault access policies
├── docs/
│   ├── api/
│   │   └── openapi.yaml              # OpenAPI 3.x API specification
│   ├── architecture/                 # Phase 1 architecture decision records
│   ├── handoffs/                     # Inter-agent handoff reports
│   ├── operations/
│   │   └── runbook.md                # Incident response runbook
│   ├── security/                     # STRIDE model, audit reports, red team results
│   └── user/                         # End-user documentation
├── infrastructure/
│   └── terraform/                    # IaC for production deployment
├── scripts/
│   ├── harden-host-fs.sh             # Filesystem hardening (tmpfs, hidepid)
│   ├── install-docker.sh             # Docker Engine installation script
│   ├── setup-network.sh              # dasdocker-isolated network provisioning
│   ├── deploy-security-profiles.sh   # Seccomp + AppArmor deployment
│   └── create-service-account.sh     # dasdocker-svc non-root user creation
├── services/
│   ├── orchestrator/                 # Backend API (Node.js/Fastify or Python/FastAPI)
│   │   ├── src/
│   │   │   ├── routes/               # API route handlers
│   │   │   ├── middleware/           # JWT auth, rate limiting
│   │   │   ├── ingestion/            # GitHub + ZIP ingestion pipeline
│   │   │   ├── runtime-detection/    # Static runtime heuristic engine
│   │   │   ├── container-manager.js  # Docker lifecycle manager
│   │   │   ├── self-destruct.js      # Redis TTL + watchdog timer
│   │   │   └── state-machine.js      # Session state machine
│   │   ├── scripts/
│   │   │   └── watchdog.sh           # Host-level cron watchdog script
│   │   └── Dockerfile
│   ├── frontend/                     # React + Vite web UI
│   │   └── src/
│   │       ├── components/           # ConsolePanel, TelemetryDashboard, ProxiedWebView
│   │       ├── pages/                # SubmitPage, SessionWorkspace, SessionHistory
│   │       └── lib/
│   │           └── websocket-client.js # Authenticated WebSocket client
│   ├── event-bus/                    # WebSocket event bus service
│   ├── ebpf-monitor/                 # eBPF kernel tracing agent
│   └── network-monitor/              # pcap capture + Suricata IDS pipeline
├── systemd/
│   ├── dasdocker-orchestrator.service
│   └── dasdocker-network.service
└── tests/
    ├── infrastructure/               # Host hardening tests
    ├── security/                     # Vault, seccomp, AppArmor tests
    ├── network/                      # Network isolation tests
    ├── storage/                      # tmpfs and data destruction tests
    ├── ingestion/                    # Ingestion service tests
    ├── runtime-detection/            # Runtime heuristic tests
    ├── lifecycle/                    # Container lifecycle tests
    ├── ebpf/                         # eBPF program tests
    ├── network-monitor/              # pcap and Suricata tests
    ├── load/                         # k6 load test scripts
    └── qa/                           # Final regression suite
```

## Environment Configuration
dasDocker uses environment variables for all runtime configuration. In production, secrets are sourced from Vault at runtime and must never be stored in plaintext `.env` files.

```bash
# .env.example - Copy to .env for local development ONLY
# NEVER commit .env to git. It is in .gitignore.
# In production, all values marked [VAULT] are read from HashiCorp Vault.

# -- Orchestrator API --------------------------------------
ORCHESTRATOR_PORT=3001
NODE_ENV=development
JWT_PUBLIC_KEY_PATH=/etc/dasdocker/keys/jwt.pub
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=5
MAX_CONCURRENT_SESSIONS=50

# -- Redis --------------------------------------------------
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

# -- HashiCorp Vault ---------------------------------------
VAULT_ADDR=https://127.0.0.1:8200
VAULT_TOKEN=

# -- Docker -------------------------------------------------
DOCKER_SOCKET=/var/run/docker.sock
DASDOCKER_NETWORK=dasdocker-isolated
SECCOMP_PROFILE_PATH=/etc/dasdocker/security/seccomp-dasdocker.json
APPARMOR_PROFILE=dasdocker-container

# -- ClamAV -------------------------------------------------
CLAMAV_SOCKET=/var/run/clamav/clamd.sock

# -- Event Bus ----------------------------------------------
EVENT_BUS_PORT=3002
EVENT_BUS_REDIS_STREAM_PREFIX=dasdocker:events

# -- Frontend -----------------------------------------------
VITE_API_BASE_URL=http://localhost:3001
VITE_WS_BASE_URL=ws://localhost:3002
```

> 🔒 **Security Rule:** `.env` is listed in `.gitignore`. Running `git add .env`
> will be caught by `gitleaks` in the CI pipeline and the commit will be blocked.
> In production, use `systemd` `EnvironmentFile` directives pointing to root-owned
> files, or retrieve secrets directly from Vault using the AppRole auth method.

## Setup Guide
All commands below have been verified on Ubuntu 22.04 LTS with Docker Engine 26.x.

### Step 1 — Clone the Repository
```bash
git clone https://github.com/YOUR_ORG/dasdocker.git
cd dasdocker
```

### Step 2 — Host Hardening
```bash
# Apply kernel hardening (sysctl values)
sudo cp config/sysctl/99-dasdocker-hardening.conf /etc/sysctl.d/
sudo sysctl --system

# Verify critical values were applied
sysctl kernel.unprivileged_userns_clone
sysctl kernel.yama.ptrace_scope
sysctl kernel.kptr_restrict

# Run the filesystem hardening script (mounts /tmp and /proc with secure options)
sudo bash scripts/harden-host-fs.sh

# Install Docker Engine (if not already installed)
sudo bash scripts/install-docker.sh

# Verify Docker Engine installation
docker --version

# Create the non-root service account for the orchestrator
sudo bash scripts/create-service-account.sh

# Deploy seccomp and AppArmor security profiles
sudo bash scripts/deploy-security-profiles.sh

# Verify AppArmor profile is loaded
sudo aa-status | grep dasdocker
```

### Step 3 — Configure Environment Variables
```bash
# Copy the example env file and edit for your environment
cp .env.example .env
nano .env

# IMPORTANT: Never commit .env to git.
# Confirm it is gitignored:
rg "^\Q.env\E$" .gitignore
```

### Step 4 — Start the Secrets Vault
```bash
# Install HashiCorp Vault if not already installed
curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install vault

# Run the Vault setup script (initialises, unseals, applies policies, generates JWT keys)
sudo bash scripts/setup-vault.sh

# Verify Vault is running and unsealed
vault status

# Store unseal keys and bootstrap token securely.
# Use root token only for bootstrap, then revoke and switch services to AppRole auth.
```

### Step 5 — Set Up the Isolated Docker Network
```bash
# Provision the dasdocker-isolated Docker network and load iptables rules
sudo bash scripts/setup-network.sh provision

# Verify the network was created
docker network inspect dasdocker-isolated | rg "Subnet"

# Verify LAN blocking rules are active
sudo iptables -L DASDOCKER-FORWARD -n | rg DROP

# Verify DNS sinkhole is listening on the gateway only
sudo ss -ulnp | rg ":53"

# Enable the network systemd service to load rules on boot
sudo systemctl enable dasdocker-network.service
sudo systemctl start dasdocker-network.service
```

### Step 6 — Start the Backend Services
Option A — Local Development (Docker Compose-style local run)

```bash
# Install dependencies for the orchestrator
cd services/orchestrator
npm install
cd ../..

# Start Redis (required before orchestrator)
docker run -d \
  --name dasdocker-redis \
  --restart unless-stopped \
  -p 127.0.0.1:6379:6379 \
  redis:7-alpine redis-server --requirepass "${REDIS_PASSWORD}"

# Start the Orchestrator API
cd services/orchestrator
npm run dev
# In a new terminal:

# Start the WebSocket Event Bus
cd ../event-bus
npm install
npm run dev
# In a new terminal:

# Start the eBPF Monitor (requires root for kernel access)
cd ../ebpf-monitor
make build
sudo ./dasdocker-ebpf-monitor
# In a new terminal:

# Start ClamAV daemon (required for pre-scan)
sudo systemctl start clamav-daemon
sudo systemctl status clamav-daemon
```

Option B — Production (systemd)

```bash
# Copy service unit files
sudo cp systemd/dasdocker-orchestrator.service /etc/systemd/system/
sudo systemctl daemon-reload

# Enable and start all services in order
sudo systemctl enable --now clamav-daemon
sudo systemctl enable --now redis-server
sudo systemctl enable --now dasdocker-orchestrator
sudo systemctl enable --now dasdocker-event-bus
sudo systemctl enable --now dasdocker-ebpf-monitor
sudo systemctl enable --now dasdocker-network-monitor

# Check key services are running
sudo systemctl status dasdocker-orchestrator
```

### Step 7 — Start the Frontend Dev Server
```bash
cd services/frontend

# Install dependencies
npm install

# Copy the environment config
cp .env.example .env.local
# Edit .env.local to set VITE_API_BASE_URL and VITE_WS_BASE_URL

# Start the development server
npm run dev

# For a production build:
npm run build
npm run preview
```

### Step 8 — Verify Everything is Running
```bash
# 1. Check the orchestrator health endpoint
curl http://localhost:3001/api/v1/health

# 2. Confirm the Docker network exists
docker network ls | rg dasdocker-isolated

# 3. Confirm the seccomp profile is accessible
ls -la /etc/dasdocker/security/seccomp-dasdocker.json

# 4. Run the infrastructure test suite
sudo bash tests/infrastructure/test_host_hardening.sh

# 5. Run the network test suite
sudo bash tests/network/test_network_unit.sh

# 6. Open the web interface
echo "Open http://localhost:5173 in your browser"
```

## Running the Full Stack (Quick Start for Experienced Users)
```bash
# -- Bring everything up ------------------------------------
sudo systemctl start clamav-daemon redis-server dasdocker-network
sudo systemctl start dasdocker-orchestrator dasdocker-event-bus
sudo systemctl start dasdocker-ebpf-monitor dasdocker-network-monitor
cd services/frontend && npm run dev

# -- Check everything is healthy ----------------------------
curl http://localhost:3001/api/v1/health

# -- Tail service logs --------------------------------------
sudo journalctl -f -u dasdocker-orchestrator -u dasdocker-event-bus -u dasdocker-ebpf-monitor

# -- Bring everything down ----------------------------------
sudo systemctl stop dasdocker-orchestrator dasdocker-event-bus dasdocker-ebpf-monitor dasdocker-network-monitor
sudo systemctl stop dasdocker-network
```

## Running Tests
| Test Suite | Command | What it Tests |
|---|---|---|
| Host hardening | `sudo bash tests/infrastructure/test_host_hardening.sh` | sysctl values, socket permissions, service account posture |
| Docker config | `sudo bash tests/infrastructure/test_docker_config.sh` | `daemon.json` hardening values and `icc` setting |
| Network unit | `sudo bash tests/network/test_network_unit.sh` | iptables and dnsmasq rule existence |
| Network integration | `sudo bash tests/network/test_network_integration.sh` | live-container LAN block and internet access |
| Network red-team | `sudo bash tests/network/test_network_redteam.sh` | LAN scan, DNS tunnel, and ICMP exfil attempts |
| Security profiles | `sudo bash tests/security/test_seccomp_profile.sh` | seccomp allowlist behaviour for allowed/blocked syscalls |
| AppArmor | `sudo bash tests/security/test_apparmor_profile.sh` | AppArmor path and capability enforcement |
| Storage / tmpfs | `sudo bash tests/storage/test_tmpfs_mount.sh` | mount options and quota enforcement |
| Data destruction | `sudo bash tests/storage/test_forensic_destruction.sh` | zero persistence after container destruction |
| Orchestrator unit | `cd services/orchestrator && npm test` | auth guards, state machine rules, input validation |
| Orchestrator integration | `cd services/orchestrator && npm run test:integration` | full session lifecycle against Docker |
| Red-team (API) | `cd services/orchestrator && npm run test:redteam` | JWT abuse, input injection, resource exhaustion |
| Frontend unit | `cd services/frontend && npm test` | component rendering and WebSocket client behaviour |
| Load test | `k6 run tests/load/k6-load-test.js` | concurrent multi-session load behaviour |
| Full regression | `sudo bash tests/qa/run-full-regression.sh` | all suites in sequence |

## API Reference
The complete API reference is available as an OpenAPI 3.x specification.

- **Interactive Docs (Redoc):** http://localhost:3001/docs/api
- **Raw YAML spec:** `docs/api/openapi.yaml`

### Quick Reference
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/sessions` | Bearer (`session:create`) | Create a new sandbox session |
| GET | `/api/v1/sessions/:id` | Bearer (`session:read`) | Get session status and metadata |
| DELETE | `/api/v1/sessions/:id` | Bearer (`session:destroy`) | Force-kill a session immediately |
| GET | `/api/v1/sessions/:id/logs` | Bearer (`session:read`) | Stream session logs (SSE) |
| GET | `/api/v1/health` | None | Service health check |

All authenticated endpoints require `Authorization: Bearer <token>`. Tokens are RS256-signed JWTs issued by the dasDocker auth service.

## Security Notes
- **What dasDocker protects against:** lateral LAN access from sandbox containers, inter-container east-west traffic, persistent local session storage, unconstrained process/resource abuse, and many known container escape classes mitigated by seccomp/AppArmor/cap drop.
- **What dasDocker does not protect against:** zero-day kernel exploits, hardware/side-channel classes (Spectre/Meltdown-style), timing channels, and physical host compromise.
- **Responsible use:** never submit production secrets, private keys, access tokens, customer data, or regulated personal data into a sandbox run.
- **Vulnerability reporting:** see `SECURITY.md`. Do not open public issues for active vulnerabilities.
- **Self-destruct guarantee:** session timeout enforcement uses two layers (Redis TTL expiration subscriber + 60-second watchdog cron fallback). When destruction completes, tmpfs-backed container data is removed; this does not recover data exfiltrated during an active session.

## Troubleshooting
| Symptom | Likely Cause | Fix |
|---|---|---|
| `curl /api/v1/health` returns connection refused | Orchestrator not running | `sudo systemctl status dasdocker-orchestrator` and inspect logs with `journalctl -u dasdocker-orchestrator` |
| Container starts but cannot install dependencies | DNS sinkhole blocking required queries | Check DNS service and sinkhole binding on `172.31.0.1:53`; verify `dasdocker-dnsmasq.service` |
| `aa-status` does not show `dasdocker-container` | AppArmor profile not loaded | Run `sudo bash scripts/deploy-security-profiles.sh` |
| eBPF monitor fails to start | Kernel lacks BTF support | Run `ls /sys/kernel/btf/vmlinux`; upgrade kernel if missing |
| `setup-network.sh` fails with `iptables: No chain` | iptables package/rules not present | Install `iptables` and rerun `sudo bash scripts/setup-network.sh provision` |
| Vault returns 403 on service startup | AppRole credentials invalid/expired | Re-run `sudo bash scripts/setup-vault.sh` and rotate service auth material |
| Frontend shows WebSocket connection failed | Event bus stopped or wrong port | Check event bus process and ensure `VITE_WS_BASE_URL` matches active port |
| Session stuck in `PROVISIONING` | ClamAV daemon not running | Start daemon: `sudo systemctl start clamav-daemon` and refresh signatures with `sudo freshclam` |
| Self-destruct timer did not fire | Redis TTL subscriber crashed | Watchdog should enforce delete in <=60s; inspect orchestrator logs for subscriber errors |

## Contributing
All contributions require:
1. A feature branch (never commit directly to `main`)
2. Conventional Commits format for all commit messages
3. Tests alongside all code changes (unit + integration minimum)
4. A passing CI pipeline (all required jobs green)
5. Squad A (Security) review approval for PRs touching:
   - Container security controls (`seccomp`, AppArmor, capabilities, no-new-privileges)
   - Network isolation (`iptables`, DNS sinkhole, bridge policy)
   - Authentication and secret management (JWT, Vault, identity enforcement)
   - Self-destruct enforcement (TTL/watchdog lifecycle)

See `CONTRIBUTING.md` for the complete policy and checklist.

## License
This project is currently documented as **MIT** for development continuity. License terms must be confirmed by the stakeholder before public release.
