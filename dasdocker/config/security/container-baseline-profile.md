# dasDocker — Universal Sandbox Container Baseline Profile

**Document ID:** SEC-BASELINE-CNT-001  
**Version:** 1.0  
**Phase:** 1 — Research & Architecture  
**Owner:** Squad A — Security & Hardening (Agent 02 — Container Hardening Specialist)  
**Audience:** Agent 08 (Container Lifecycle Manager) — **implement verbatim in Phase 2; no deviations without Squad A approval recorded in git commit.**  
**Prerequisite:** `docs/security/STRIDE-threat-model.md` (**SEC-THREAT-001**), especially **S-04**, **S-05**, **S-06**, **S-08**.

This document defines the **binding security baseline profile** for **every sandbox container** that executes **untrusted** code on dasDocker. It is specification only. Runtime manifests, orchestration glue code, and policy distribution are out of scope for Agent 02.

---

## 1. Threat traceability principles

Every control below maps to explicit STRIDE Threat IDs:

| Threat ID | Risk theme | Profile relevance |
|-----------|-------------|-------------------|
| T-S04-001 | Writable image reuse / persistence | Read-only root, disposable writable islands only |
| T-S04-002 | Capability / sandbox escape | `CAP_DROP ALL`, seccomp deny-default, AppArmor hardening |
| T-S04-003 | Secrets in env / mounts | No host secrets, minimal `/proc` exposure, deny swap abuse |
| T-S04-004 | Fork/memory/CPU starvation | cgroup v2 limits, `pids`, `nofile`, `nproc`, CPU cap |
| T-S05-001 | Kernel unprivileged exploits | Reduced syscall exposure, deny mount/ptrace/kernel gadget paths |
| T-S05-003 | Kernel / host resource DoS | Coarse resource caps aligned with cgroup v2 |
| T-S06-001 | Docker socket ⇒ host takeover | Never mount daemon socket inside sandbox |
| T-S08-001 | LAN / metadata spoofing & namespace breakout | Isolate network `dasdocker-isolated`; never host network |

Where a deviation is unavoidable, orchestration code MUST include **both** Squad A approval in the git history **and** an in-code justification comment (**Rule 1**).

---

## 2. Linux capabilities — full matrix

**Policy:** `CAP_DROP: ALL`; **effective additional capabilities: ZERO** for production sandboxes.  
**Threat basis:** **T-S04-002**, **T-S06-001** (indirect capability abuse via misconfiguration).

All kernel capability constants below are **`DROP`** in the sandbox. None are **`ALLOW`** in v1 baseline. If a workload truly requires an exception—e.g. future GPU research track—**T-S08-003** secondary concerns apply; such cases require Squad A-written approval referencing compensating isolation.

| Capability | Policy | Threat ID rationale (representative) |
|------------|--------|----------------------------------------|
| CAP_AUDIT_CONTROL | DROP | T-S05-004 — Reduce kernel audit misuse surface |
| CAP_AUDIT_READ | DROP | T-S04-002 |
| CAP_AUDIT_WRITE | DROP | T-S04-002 — Typical containers still run without audit write in strict mode |
| CAP_BLOCK_SUSPEND | DROP | T-S05-003 |
| CAP_BPF | DROP | **T-S04-002**, **T-S07-001** — No eBPF loader in untrusted workloads |
| CAP_CHECKPOINT_RESTORE | DROP | T-S04-002 |
| CAP_CHOWN | DROP | Filesystem UID mapping handled by image/orchestrator, not workload |
| CAP_DAC_OVERRIDE | DROP | Violates least privilege for tenant code |
| CAP_DAC_READ_SEARCH | DROP | T-S04-003 — Prevents unrestricted host file brute-force reads when mis-mounted |
| CAP_FOWNER | DROP | T-S04-002 |
| CAP_FSETID | DROP | T-S04-002 |
| CAP_IPC_LOCK | DROP | T-S04-004 — Abusable for mlock DoS; request explicit exception if JVM large pages required |
| CAP_IPC_OWNER | DROP | T-S04-002 |
| CAP_KILL | DROP | PID namespace + init semantics; no cross-namespace kill |
| CAP_LEASE | DROP | T-S04-002 |
| CAP_LINUX_IMMUTABLE | DROP | **T-S05-004** — Immutable file attribute abuse |
| CAP_MAC_ADMIN | DROP | T-S04-002 |
| CAP_MAC_OVERRIDE | DROP | T-S04-002 |
| CAP_MKNOD | DROP | **T-S04-002** — Device node creation |
| CAP_NET_ADMIN | DROP | **T-S08-001** — Routing/ARP/NAT tampering |
| CAP_NET_BIND_SERVICE | DROP | Bind ports >1024 only; avoids low ports without capability |
| CAP_NET_BROADCAST | DROP | Legacy; deny for clarity |
| CAP_NET_RAW | DROP | **T-S08-001** — Raw sockets , bypass TCP/UDP policy |
| CAP_PERFMON | DROP | **T-S07-003**, perf side-channel / DoS |
| CAP_SYS_ADMIN | DROP | **Critical** — T-S04-002, T-S05-001, attack tree **[B2]** |
| CAP_SYS_BOOT | DROP | **T-S05-003** |
| CAP_SYS_CHROOT | DROP | T-S04-002 — Chroot pivot if combined with escapes |
| CAP_SYS_MODULE | DROP | **T-S05-004** |
| CAP_SYS_NICE | DROP | Scheduler abuse T-S05-003 |
| CAP_SYS_PACCT | DROP | T-S05-004 |
| CAP_SYS_PTRACE | DROP | **T-S04-002** |
| CAP_SYS_RAWIO | DROP | **T-S05-001** — `/dev/port`, `ioperm` class |
| CAP_SYS_RESOURCE | DROP | T-S04-004 — `ulimit` / RLIMIT bypass attempts |
| CAP_SYS_TIME | DROP | T-S02-003 class integrity (time skew); host authority only |
| CAP_SYS_TTY_CONFIG | DROP | T-S04-002 |
| CAP_SYSLOG | DROP | T-S10-001 — Kernel printk / sensitive log bleed |
| CAP_WAKE_ALARM | DROP | T-S14-002 abuse class |
| CAP_SETGID | DROP | Supplementary gid maps managed by USER directive, not ambient caps |
| CAP_SETUID | DROP | Ditto |
| CAP_SETFCAP | DROP | Binary capability grants |
| CAP_SETPCAP | DROP | Cap bounding set manipulation |

**Effective count:** **41** distinct capabilities enumerated (Linux 5.x+ set including `CAP_BPF`, `CAP_PERFMON`, `CAP_CHECKPOINT_RESTORE`). All marked **DROP**; **ALLOW count = 0** for sandbox.

---

## 3. Seccomp profile specification

### 3.1 Strategy

| Item | Requirement |
|------|--------------|
| `defaultAction` | **`SCMP_ACT_ERRNO`** with `defaultErrnoRet: 1` (EPERM) — deny-by-default |
| Allowlists | Explicit `SCMP_ACT_ALLOW` groups + conditional rules (capabilities, arches, masked `clone`) |
| Blocked categories (conceptual even if gated) | **`init_module` / `finit_module`**, **mount family**, **`unshare`**, **`bpf`**, **`ptrace`** without `CAP_SYS_PTRACE`, **`perf_event_open`**, **`open_by_handle_at`** without DAC cap, **`kexec`**, **`io_uring`**, **`userfaultfd`** — omitted from allow rules so default deny wins |
| Compat arches | Maintain `archMap` from authoritative Moby-derived profile for multi-arch hosts |

**Artifact path:** `config/security/seccomp-dasdocker.json`  
**Delta vs stock Docker default:** Removes the **kernel ≥4.8** unconditional allow rule for **`ptrace`**, **`process_vm_readv`**, **`process_vm_writev`** — mitigates **T-S04-002**, **attack tree [C]**.

### 3.2 Syscall categories

| Category | Representative syscalls | Runtimes | Threat notes |
|----------|-------------------------|----------|--------------|
| File I/O | `openat`, `read`, `write`, `close`, `stat`, `mmap`, `mprotect`, `brk` | All | **T-S04-001** — Works with read-only root + tmpfs writes only |
| Process / thread | `execve`, `clone`, `wait4`, `exit`, `set_tid_address`, `rseq`, `futex*` | All | **T-S04-004** — Bounded by `pids` cgroup + seccomp `clone` masks |
| Time / clocks | `clock_gettime`, `nanosleep`, `gettimeofday` | All | |
| Signals | `rt_sigaction`, `rt_sigprocmask`, `sigreturn` | All | |
| Memory | `madvise`, `mincore`, `mremap` (as allowed in profile) | JVM, native heaps | |
| Networking | `socket` (with `AF_PACKET` denied via arg filter), `connect`, `accept4`, `sendmsg`, `recvmsg`, `epoll*` | All managed TCP/UDP | **T-S08-001** |
| Async I/O | `io_setup`, `io_submit`, `io_getevents` (AIO) | Some JVM / native | `io_uring_*` **not** allowlisted |
| Namespaces (harmless paths) | `set_robust_list`, `prctl` subset | glibc | Dangerous namespace ops require caps — absent |

**Node.js (libuv / V8):** Needs event loop syscalls: `epoll_pwait2`, `eventfd2`, `pipe2`, `sendmsg`, `recvmsg`, `getaddrinfo` path via libc resolver.  
**CPython:** Similar + `select`, `poll`, file ops; may use `inotify_*` for stdlib watchers.  
**Go runtime:** Heavy `futex`, `epoll`, non-blocking I/O, `sigaltstack`, `sched_yield`.  
**OpenJDK / HotSpot:** Uses `clone`, `mmap`, `mprotect`, `prctl` (e.g. `PR_SET_NAME`), `gettid`, `clock_gettime`, `futex`, `timerfd_*`, `signalfd4`, `sched_getaffinity` — all present in merged allowlist.

### 3.3 JSON architecture (`config/security/seccomp-dasdocker.json`)

Structured sections:

1. **`defaultAction` / `defaultErrnoRet`** — global deny.  
2. **`archMap`** — map guest arch to personalities.  
3. **Primary syscall array** — large `ALLOW` bundle for benign syscalls (Moby-tested).  
4. **Conditional `socket`** — disallow `AF_PACKET` (Ethernet) for **T-S08-001** raw-ish capture class.  
5. **`personality` filters** — 32-bitABI compatibility guards.  
6. **Architecture-specific blocks** (`ppc`, `arm`, `s390x`, …).  
7. **Capability-scoped bundles** — `CAP_SYS_ADMIN` gated mount/`unshare`; **inactive** because all caps dropped.  
8. **`clone3` EPERM shim** — glibc fallback when no `CAP_SYS_ADMIN`.  
9. **Kernel-modules, `bpf`, `perf_event_open`** — **only when impossible caps exist** — also inactive under `CAP_DROP ALL`.

---

## 4. AppArmor profile specification

**Artifact:** `config/security/apparmor-dasdocker.profile`  
**Docker flag:** `--security-opt apparmor=dasdocker`

### 4.1 Rule groups

| Area | Rule intent | Threat IDs |
|------|-------------|------------|
| Denied sysfs / proc sysctl writes | Prevent kernel tuning tampering | T-S05-004, T-S04-002 |
| Deny raw memory/devices | Mitigate physic mem attacks | T-S05-001 |
| Deny `docker.sock` paths | Sock bind even if Docker mis-invoked | **T-S06-001** |
| Capability denies | Mirrors dropped caps at LSM layer | **T-S04-002** |
| Network | Allow inet TCP/UDP stream/dgram; **deny `network raw`** | **T-S08-001** |
| Writable paths | `/tmp`, `/var/tmp`, `/workspace`, `/dev/shm` only | **T-S04-001**, **T-S03-002** |

### 4.2 Load procedure (verification / ops)

```bash
sudo install -m 0644 config/security/apparmor-dasdocker.profile /etc/apparmor.d/dasdocker
sudo apparmor_parser -r -W /etc/apparmor.d/dasdocker
```

---

## 5. Resource limits (cgroup v2 unified hierarchy)

All sandboxes join a **single cgroup slice** managed by orchestrator (**Agent 08**). Values are mandatory.

| Limit | cgroup v2 / Docker field | Hard value | Threat ID justification |
|-------|---------------------------|------------|-------------------------|
| Memory high / max | `memory.max`, Docker `--memory` | **512 MiB** (`536870912` bytes) | **T-S04-004**, **T-S05-003** |
| Swap | `memory.swap.max`, `--memory-swap` | **512 MiB** equal to `--memory` (disables usable swap delta) | **T-S04-003** swap cold artifact leakage |
| CPU | `cpu.max` | **`100000 100000`** (1 CPU) — express as Docker `--cpus=1.0` | **T-S04-004** crypto-mining class |
| PIDs | `pids.max`, `--pids-limit` | **100** | **T-S04-004** fork bomb |
| Open files | `ulimit -n` | **1024** soft & hard | **T-S04-004**, **T-S05-003** fd exhaustion |
| `nproc` | `ulimit -u` | **100** soft & hard | **T-S04-004** belt-and-suspenders |
| Network bandwidth | Not a single cgroup knob | **Recommended:** Linux **net_cls** + **tc** HTB on veth egress per session, or CNI bandwidth plugin; orchestrator applies token-bucket **≥ 32 Mbit/s default ceiling** (tunable per tenant) | **T-S08-001** bulk exfil |

**Note:** Exact cgroup v2 path layout (`/sys/fs/cgroup/dasdocker.slice/...`) is Agent 08 implementation detail; **limits above are normative**.

---

## 6. Mandatory `docker run` flags (annotated)

Agent 08 SHALL construct CLI / API equivalent with **at least** the following (line continuation for copy-paste):

```bash
# [T-S04-002] Deny all Linux capabilities in the bounding set
--cap-drop ALL \

# [T-S04-002] Prevent file-based capability gains and setuid elevation
--security-opt no-new-privileges:true \

# [T-S04-002] Enforce custom seccomp (deny-by-default allowlist)
--security-opt seccomp=/path/on/host/to/config/security/seccomp-dasdocker.json \

# [T-S04-002] Enforce AppArmor profile after host install
--security-opt apparmor=dasdocker \

# [T-S04-001] Read-only container root; only tmpfs/binds are writable
--read-only \

# [T-S04-003,T-S04-004] 512MiB RAM and swap-neutralised cgroup (same value disables extra swap capacity)
--memory=512m \
--memory-swap=512m \

# [T-S04-004] CPU quota (1 core)
--cpus=1.0 \

# [T-S04-004] PID namespace cap
--pids-limit=100 \

# [T-S08-001] Attach to isolated bridge / network (name normative for platform)
--network dasdocker-isolated \

# [T-S04-003] No host IPC segment sharing
--ipc private \

# [T-S04-002] Private PID namespace (default; explicit for auditability)
--pid private \

# [T-S05-001] Private cgroup namespace where supported
--cgroupns private \

# [T-S04-002] Non-root execution (UID/GID supplied by orchestrator policy)
--user 65534:65534 \

# [T-S04-001] Writable temp layers (sizes are Agent 08 tunables within global cap)
--tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m \
--tmpfs /var/tmp:rw,noexec,nosuid,nodev,size=128m \
--tmpfs /workspace:rw,noexec,nosuid,nodev,size=384m \

# [T-S04-004] Process and fd ulimits (API: Ulimits in HostConfig)
--ulimit nofile=1024:1024 \
--ulimit nproc=100:100 \

# [T-S04-003] Optional: mask selected proc paths via tmpfs overlays (Phase 2 detail)
# (orchestrator-applied — document in Agent 08 code comments per Rule 1)
```

---

## 7. Explicitly forbidden configurations (**NEVER DO**)

| # | Configuration | Threat IDs |
|---|----------------|------------|
| 1 | `--privileged` | **T-S04-002**, **T-S06-001** |
| 2 | Bind-mount `/var/run/docker.sock` (or `docker.sock` anywhere) | **T-S06-001** |
| 3 | `--network host` | **T-S08-001**, **T-S02-004** |
| 4 | `--pid host` | **T-S04-002**, **T-S08-001** |
| 5 | `--ipc host` | **T-S04-003** |
| 6 | `--cap-add CAP_SYS_ADMIN` without Squad A | **T-S04-002**, **T-S05-001** |
| 7 | `--cap-add CAP_NET_ADMIN` without Squad A | **T-S08-001** |
| 8 | `--cap-add CAP_SYS_PTRACE` without Squad A | **T-S04-002** |
| 9 | `--cap-add CAP_NET_RAW` or `CAP_BPF` or `CAP_PERFMON` without Squad A | **T-S08-001**, **T-S07-001** |
| 10 | `--device` host device passthrough (e.g. `/dev/kvm`, GPU) in v1 product | **T-S05-001**, attack tree **[F1]** |
| 11 | `--security-opt seccomp=unconfined` | **T-S04-002** |
| 12 | `--security-opt apparmor=unconfined` (or disable LSM) without Squad A | **T-S04-002** |
| 13 | Writable bind mount to host paths (except sealed tmpfs proxies) | **T-S03-002**, **T-S04-001** |
| 14 | `--userns=host` while retaining broad syscall surface | **T-S05-001** |
| 15 | `SYS_ADMIN`-gated seccomp holes via ambient caps | **T-S04-002** |

---

## 8. Verification test matrix (Agent 20 — Red Team / negative)

Use `<id>` = running sandbox container ID. All commands assume Docker CLI and sufficient inspect rights.

| Control ID | Parameter | Verification command | Pass condition |
|------------|-----------|----------------------|----------------|
| CTR-01 | `CAP_DROP ALL` | `docker inspect <id> --format '{{json .HostConfig.CapDrop}}'` | JSON array contains **`"ALL"`** (and `CapAdd` empty) |
| CTR-02 | Read-only root | `docker inspect <id> --format '{{.HostConfig.ReadonlyRootfs}}'` | `true` |
| CTR-03 | No new privileges | `docker inspect <id> --format '{{json .HostConfig.SecurityOpt}}'` | Contains substring **`no-new-privileges:true`** |
| CTR-04 | Seccomp profile | `docker inspect <id> --format '{{json .HostConfig.SecurityOpt}}'` | Contains **`seccomp=`** whose path resolves to SHA-verified `seccomp-dasdocker.json` |
| CTR-05 | Memory max 512 MiB | `docker inspect <id> --format '{{.HostConfig.Memory}}'` | `536870912` |
| CTR-06 | PID limit | `docker inspect <id> --format '{{.HostConfig.PidsLimit}}'` | `100` |
| CTR-07 | No Docker socket | `docker inspect <id> --format '{{json .Mounts}}'` | No path ending in **`docker.sock`** |
| CTR-08 | Isolated network | `docker inspect <id> --format '{{json .NetworkSettings.Networks}}'` | Top-level key **`dasdocker-isolated`** exists |
| CTR-09 | AppArmor | `docker inspect <id> --format '{{json .HostConfig.SecurityOpt}}'` | Contains **`apparmor=dasdocker`** |
| CTR-10 | CPU 1 core | `docker inspect <id> --format '{{.HostConfig.NanoCpus}}'` | `1000000000` **or** `CpuQuota`/`CpuPeriod` ratio == `100000`/`100000` |
| CTR-11 | Swap neutralised | `docker inspect <id> --format '{{.HostConfig.MemorySwap}}'` | **Equals** `Memory` field (`536870912`) per policy |
| CTR-12 | `nofile` ulimit | `docker inspect <id> --format '{{json .HostConfig.Ulimits}}'` | Entry `Name=nofile` soft=hard=`1024` |
| CTR-13 | `nproc` ulimit | `docker inspect <id> --format '{{json .HostConfig.Ulimits}}'` | Entry `Name=nproc` soft=hard=`100` |
| CTR-14 | Not privileged | `docker inspect <id> --format '{{.HostConfig.Privileged}}'` | `false` |
| CTR-15 | Non-host namespaces | `docker inspect <id> --format '{{.HostConfig.PidMode}} {{.HostConfig.IpcMode}} {{.HostConfig.NetworkMode}}'` | **No** token `host` on any field |
| CTR-16 | cgroup namespace | `docker inspect <id> --format '{{.HostConfig.CgroupnsMode}}'` | `private` (or engine default private on modern Docker) |
| CTR-17 | tmpfs `noexec` | `docker inspect <id> --format '{{json .HostConfig.Mounts}}'` | Each tmpfs bind includes mount option **`noexec`** |
| CTR-18 | User non-root | `docker inspect <id> --format '{{.Config.User}}'` | Not empty; UID **≠** `0` (preferred fixed `65534` policy user) |

**Stretch (optional negative tests)**

| CTR-XX | Scenario | Command | Expect |
|--------|----------|---------|--------|
| CTR-E01 | Inline `ptrace` denial | `docker exec <id> sh -c 'command -v strace >/dev/null && strace -o /tmp/s true'` | **`EPERM`/exit ≠0** unless strace absent (then omit) |

---

## 9. Specification control

| Version | Change |
|---------|--------|
| 1.0 | Agent 02 initial baseline aligned to STRIDE **SEC-THREAT-001** |

**Approver (Squad A):** …

---

## 10. Reference paths (downstream verbatim file list)

Agent 08 **MUST** treat these files as authoritative implementation inputs:

| Path | Purpose |
|------|---------|
| `dasdocker/config/security/container-baseline-profile.md` | This specification |
| `dasdocker/config/security/seccomp-dasdocker.json` | Seccomp allowlist JSON |
| `dasdocker/config/security/apparmor-dasdocker.profile` | AppArmor policy |
| `dasdocker/docs/security/STRIDE-threat-model.md` | Threat ID registry |
