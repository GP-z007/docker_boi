# Phase 4 Container Escape Test Results

**Author:** Agent 20 (QA Lead / Escape-Attempt Red Teamer)  
**Date:** 2026-05-09  
**Scope:** Active red-team validation of Phase 3 container hardening controls from `config/security/container-baseline-profile.md`.

## Test environment

- Docker daemon reachable on auditor host (`docker info` succeeded).
- Hardened target created as `dasdocker-audit-target` with:
  - `--cap-drop ALL`
  - `--security-opt no-new-privileges:true`
  - `--security-opt seccomp=/Users/gokulprasath/Desktop/LPU/docker_boi/dasdocker/config/security/seccomp-dasdocker.json`
  - `--read-only --pids-limit 100 --memory 512m --memory-swap 512m --cpus 1.0`
  - tmpfs mounts for `/workspace` and `/tmp`
- Platform hardening deployment gaps observed:
  - `tests/security/test_seccomp_profile.sh` failed: `/etc/dasdocker/security/seccomp-dasdocker.json` missing.
  - `tests/security/test_apparmor_profile.sh` failed: `/etc/apparmor.d/dasdocker-container` missing.
  - `tests/network/test_network_redteam.sh` skipped: `dasdocker-isolated` network missing.

## Escape matrix (active attempts)

| # | Technique | Command used | Expected result | Actual result | Status | Mitigating control / note |
|---|-----------|--------------|-----------------|---------------|--------|---------------------------|
| 1 | Privileged container check | `docker inspect ... {{.HostConfig.Privileged}}` | `false` | `false` | BLOCKED | `--privileged` not used |
| 2 | `CAP_SYS_ADMIN` / cap-add check | `docker inspect ... {{json .HostConfig.CapAdd}} {{json .HostConfig.CapDrop}}` | `CapAdd=null`, `CapDrop=["ALL"]` | `null ["ALL"]` | BLOCKED | Least privilege with full cap drop |
| 3 | Docker socket mount check | `docker inspect ... {{json .Mounts}}` | no `docker.sock` mount | `[]` | BLOCKED | No host socket mount in target |
| 4 | User namespace breakout | `docker exec ... unshare --user --map-root-user /bin/sh -c "id"` | denied | `Operation not permitted` | BLOCKED | Seccomp/capability restrictions + host policy |
| 5 | `nsenter` from container | `docker exec ... nsenter -t 1 -m -u -i -n -p /bin/sh -c "id"` | denied | `setns ... Operation not permitted` | BLOCKED | Namespace transition denied |
| 6 | `/proc/sysrq-trigger` write | `docker exec ... 'echo b > /proc/sysrq-trigger'` | denied | `Read-only file system` | BLOCKED | Read-only filesystem |
| 7 | Writable `/proc/sys` | `docker exec ... 'sysctl -w kernel.ngroups_max=65536'` | denied | `Read-only file system` | BLOCKED | Read-only filesystem + kernel guards |
| 8 | `ptrace` cross-process | `docker exec ... 'strace -p 1 -o /tmp/strace.out'` | denied | `strace: not found` | PARTIAL | Tool unavailable; must re-test with instrumented image |
| 9 | Raw socket creation | `docker exec ... 'python3 -c "import socket; socket.socket(AF_PACKET,SOCK_RAW)"'` | denied | `python3: not found` | PARTIAL | Tool unavailable; must re-test with Python image |
| 10 | Kernel module load | `docker exec ... 'modprobe dummy'` | denied | `can't change directory to /lib/modules` | BLOCKED | No modules + no module management in container |
| 11 | `kexec` syscall path | `docker exec ... 'kexec -l /bin/busybox'` | denied | `kexec: not found` | PARTIAL | Tool unavailable; must re-test with utility present |
| 12 | Mount host filesystem | `docker exec ... 'mount /dev/sda1 /mnt'` | denied | `permission denied` | BLOCKED | No `CAP_SYS_ADMIN` |
| 13 | Disk exhaustion (root fs) | `docker exec ... 'dd if=/dev/zero of=/test.img bs=1M count=32'` | denied | `Read-only file system` | BLOCKED | Read-only root |
| 14 | Disk exhaustion (tmpfs) | `docker exec ... 'dd if=/dev/zero of=/workspace/test.img bs=1M count=700'` | quota/container kill | container exit `137` | CONTAINED | Memory/tmpfs limit containment |
| 15 | CPU exhaustion | `docker exec ... 'timeout 2 sh -c "while true; do :; done"'` | bounded/terminated | exit `143` | CONTAINED | CPU quota + explicit timeout prevents runaway |
| 16 | Fork bomb | `docker exec ... 'sh -c ":(){ :|:& };:"'` | process-limited/blocked | `bad function name` (ash shell) | PARTIAL | Shell variant prevented payload; re-test with bash image |
| 17 | Metadata service access | `docker exec ... 'wget -qO- --timeout=2 http://169.254.169.254/latest/meta-data/'` | denied | `download timed out` | BLOCKED | Metadata path unreachable in current net path |
| 18 | LAN access attempt | `docker exec ... 'ping -n -c 1 192.168.1.1'` | denied | ping succeeded | ESCAPE | **Critical gap**: deny-by-default egress not active on this host |
| 19 | Network policy red-team suite | `bash tests/network/test_network_redteam.sh` | execute and pass | `SKIP: dasdocker-isolated missing` | PARTIAL | Required isolated network not provisioned |
| 20 | AppArmor enforcement suite | `bash tests/security/test_apparmor_profile.sh` | execute and pass | profile missing in `/etc/apparmor.d` | PARTIAL | Host profile deployment incomplete |
| 21 | Seccomp deployment suite | `bash tests/security/test_seccomp_profile.sh` | execute and pass | seccomp file missing in `/etc/dasdocker/security` | PARTIAL | Host seccomp deployment incomplete |

## Critical findings (must escalate)

1. **ESC-001 (Critical): LAN egress not blocked**  
   - Proof: `docker exec dasdocker-audit-target ping -n -c 1 192.168.1.1` returned success.  
   - Required remediation:
     - Provision isolated network: `scripts/setup-network.sh provision`
     - Apply firewall policy: `scripts/setup-network.sh apply-iptables`
     - Re-run `tests/network/test_network_integration.sh` and `tests/network/test_network_redteam.sh`
2. **ESC-002 (High): Security profile deployment incomplete**  
   - Proof: profile tests fail due missing `/etc/dasdocker/security/seccomp-dasdocker.json` and `/etc/apparmor.d/dasdocker-container`.
   - Required remediation:
     - Run `scripts/deploy-security-profiles.sh`
     - Re-run seccomp and AppArmor integration tests

## Security verdict (container hardening)

- Hardening flags in orchestrator configuration are largely present and effective for capability, mount, and read-only controls.
- **Phase 4 container hardening is NOT sign-off ready** until ESC-001 is remediated and profile deployment validation passes on target environment.
