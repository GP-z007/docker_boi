# dasDocker

> **Execute untrusted code. Keep your environment untouchable.**
>
> [![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](#)
> [![License](https://img.shields.io/badge/license-MIT-blue)](#)
> [![Version](https://img.shields.io/badge/version-v0.1.0-informational)](#)

---

## Mission

`dasDocker` is a security-first, Any.Run-style web sandbox for **GitHub repositories** and **ZIP uploads**.

It exists to let developers, security engineers, and malware analysts execute unknown or untrusted code in a tightly controlled, disposable environment with deep runtime visibility and **zero persistent state**.

### Why dasDocker?

- Untrusted code is a daily reality in modern software and security workflows.
- Running it locally can expose your workstation, network, and secrets.
- `dasDocker` isolates execution behind hardened container boundaries and strict network controls, while still giving you rich, real-time observability.

---

## Core Features

- 🔬 **eBPF-Powered Runtime Observability**  
  Trace process trees, syscalls, file access patterns, and suspicious behavior in real time.

- 💻 **Live Interactive Console (xterm.js)**  
  Watch and interact with sandbox stdout/stderr directly in the browser with low-latency streaming.

- 🌐 **Secure Proxied Web Views**  
  Render sandboxed apps (for example, Node/Next.js services) through a hardened reverse proxy with browser isolation controls.

- 🧱 **Strict NAT-Based Network Isolation**  
  Block lateral movement into LAN environments and enforce controlled egress behavior.

- 🧠 **Volatile tmpfs Session Storage**  
  Keep runtime artifacts in RAM-only storage for clean teardown and no residue.

- ⏱️ **Non-Negotiable Self-Destruct Timers**  
  Every sandbox session is forcibly terminated and wiped on TTL expiry.

---

## High-Level Architecture

```text
┌────────────────────┐
│   Frontend UI      │
│ (Next.js / React)  │
│ - Session control  │
│ - Live terminal    │
│ - Telemetry views  │
└─────────┬──────────┘
          │ HTTPS + WebSocket
┌─────────▼──────────┐
│  Orchestrator API  │
│ - Auth / rate limit│
│ - Queue + lifecycle│
│ - Session state    │
└─────────┬──────────┘
          │ Docker API
┌─────────▼──────────────────────────────┐
│       Docker Sandbox Runtime           │
│ - Hardened container profile           │
│ - tmpfs ephemeral storage              │
│ - Self-destruct watchdog (TTL)         │
└─────────┬──────────────────────────────┘
          │ Host-level telemetry taps
┌─────────▼──────────────────────────────┐
│  eBPF + Network Telemetry Pipeline     │
│ - Process/syscall tracing              │
│ - pcap/IDS analysis                    │
│ - Event stream to UI                   │
└────────────────────────────────────────┘
```

### Separation of Concerns

- **Frontend UI**: Operator experience, session controls, terminal, and telemetry rendering.
- **Orchestrator API**: Intake, runtime detection handoff, container lifecycle, policy enforcement.
- **Docker Sandbox Layer**: Actual isolated execution boundary with resource and timer constraints.
- **Telemetry Layer**: Out-of-band runtime forensics (eBPF + network inspection + alert feeds).

---

## Tech Stack

### Runtime & Isolation

- **Docker / containerd**
- **Linux namespaces + cgroups**
- **seccomp, AppArmor/SELinux**
- **tmpfs (ephemeral RAM-backed storage)**

### Platform & Orchestration

- **Node.js / TypeScript services**
- **Redis** (TTL timers, queues, state signaling)
- **REST + WebSocket APIs**

### Frontend

- **Next.js**
- **React**
- **xterm.js** (browser terminal)

### Security & Observability

- **eBPF** (via libbpf or Cilium eBPF tooling)
- **pcap/tcpdump pipeline**
- **Suricata IDS**
- **Structured logging** (Loki/OpenSearch-compatible pipeline)

### DevSecOps

- **GitHub Actions**
- **Semgrep**
- **Trivy**

---

## Getting Started

> This section is intentionally scaffolded and will be finalized as implementation stabilizes.

### Prerequisites

```bash
# TODO: Add required software and minimum versions
# Example:
# - Docker Engine >= XX.X
# - Node.js >= XX
# - pnpm / npm / yarn
# - Linux kernel with eBPF support
```

### Local Installation

```bash
# TODO: Add setup steps
# 1) Clone repository
# 2) Install dependencies
# 3) Configure environment variables
# 4) Start platform services
```

### Usage

```bash
# TODO: Add usage examples
# - Start a sandbox from a GitHub URL
# - Upload and execute a ZIP
# - Open live console and telemetry dashboard
```

---

## Security Posture

`dasDocker` is designed around a **default-deny** model:

- Least-privilege execution profiles
- Immutable and disposable runtime sessions
- Strong network containment
- Forensic-grade observability by default

If you discover a security issue, please follow our responsible disclosure process (to be added).

---

## Project Status

🚧 **Active Development**  
The platform is currently being built in phased delivery with security gates and adversarial testing integrated into the release process.

---

## License

License information will be published here (`LICENSE`).
