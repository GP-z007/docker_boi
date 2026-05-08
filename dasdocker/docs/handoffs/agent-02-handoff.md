# Agent 02 Handoff Report — Container Hardening Specialist

## (a) What was built

Phase 1 **security specification** (**Deliverable baseline for Agent 08 / Phase 2**):

1. **`config/security/container-baseline-profile.md`** — Master sandbox profile: capability matrix (41 capabilities, all **DROP**), seccomp strategy, AppArmor rule groups, cgroup v2 resource limits, mandatory `docker run` flag list, **≥10-item NEVER DO** table, **≥16-row verification matrix** (CTR-01–CTR-18 + optional negative test), and traceability to **STRIDE** Threat IDs (`T-S04-*`, `T-S05-*`, `T-S06-001`, `T-S08-001`).
2. **`config/security/seccomp-dasdocker.json`** — Executable **OCI/Moby-format** seccomp profile: **`defaultAction: SCMP_ACT_ERRNO`**, **`defaultErrnoRet: 1`**, explicit allowlists for **Node.js / Python / Go / Java**-class workloads based on Moby **`v25.0.3`** default profile with **critical hardening**: removed unguaranteed allow rule for **`ptrace`**, **`process_vm_readv`**, **`process_vm_writev`** (**T-S04-002**).
3. **`config/security/apparmor-dasdocker.profile`** — Loadable AppArmor profile (runtime name **`dasdocker-container`**, path **`/etc/apparmor.d/dasdocker-container`**) denying **`/sys/**`**, **`/proc/sys/**`**, **`/proc/sysrq-trigger`**, host memory gadgets, **`docker.sock`** paths; capability denials aligned with **`CAP_DROP ALL`** semantics; TCP/UDP only; **`deny network raw`**.

Agent 03 is listed in the squad dispatch memo as Network Isolation Engineer; this handoff deliberately names the **normative Docker network** **`dasdocker-isolated`** for CTR-08 alignment.

---

## (b) Downstream contract — internal APIs, ports, paths, environment variables

| Category | Detail |
|---------|--------|
| **Internal APIs** | **N/A** — specification phase only |
| **Listening ports** | **N/A** — containers outbound policy is **`dasdocker-isolated`** bridge (**Agent 03** architecture); sandbox **must not** expose host ports (`--publish` only via orchestrator allowlist, out of Agent 02 scope) |
| **Files Agent 08 must reference verbatim** | `dasdocker/config/security/container-baseline-profile.md`, `dasdocker/config/security/seccomp-dasdocker.json`, `dasdocker/config/security/apparmor-dasdocker.profile` |
| **Host install path for AppArmor (ops)** | `/etc/apparmor.d/dasdocker-container` (Phase 2 production path) |

**Environment variables (normative placeholders for orchestrator)**

| Variable | Required | Purpose |
|----------|----------|---------|
| `DASDOCKER_SECCOMP_JSON` | **Yes** (Phase 2) | Absolute host path to `seccomp-dasdocker.json` for `--security-opt seccomp=` |
| `DASDOCKER_APPARMOR_PROFILE` | **Yes** where AppArmor enforced | **`dasdocker-container`** (host: `/etc/apparmor.d/dasdocker-container`; Phase 2 deploy) |

**Threat model dependency:** `dasdocker/docs/security/STRIDE-threat-model.md`.

---

## (c) Warnings, known limitations, Squad A review

| Item | Severity | Notes |
|------|----------|-------|
| **Seccomp derivation** | Low | Starts from Moby default; deltas must be tracked on Moby bumps; each merge needs regression against **CTR-04**/**CTR-E01** |
| **`apparmor_parser` portability** | Medium | `#include <abstractions/base>` varies by distro; Ubuntu/Debian validated path assumed — smoke-test before prod |
| **Non-root UID `65534:nogroup`** | Medium | Images must tolerate `nogroup`; orchestrator should document image contract |
| **Java / exotic JIT** | Medium | Rare syscalls (**eBPF helpers**, **`io_uring`** for newer stacks) intentionally **blocked** — JVMs must fall back |
| **`--cpus=1.0` vs `NanoCpus` inspection drift** | Low | CTR-10 allows CpuQuota ratio alternative — engines differ |
| **Bandwidth policy** | Medium | cgroup v2 + **tc** approach is advisory in spec (**T-S08-001**); Agent 03/08 must converge on concrete implementation |

**Squad A review triggers:** Any **ALLOW** capability, **relaxation** of seccomp allowlist, **AppArmor abstraction** expansion, change to **`dasdocker-isolated`** naming, or **mount** beyond specified tmpfs layout.

---

*Agent 02 — Squad A — Container Hardening Specialist · Phase 1 Dispatch 02 of 08*
