# Red Team Campaign 3 - Resource Exhaustion

**Campaign ID:** RT-C3  
**Date:** 2026-05-09  
**Objective:** Force resource starvation and observe containment + blast radius.

## Evidence summary

- Control container `dasdocker-control` remained running during red-team stress tests (`docker inspect ... {{.State.Running}} -> true`).
- Snapshot during attack:
  - `dasdocker-redteam mem=510.8MiB / 512MiB cpu=12.67% pids=100`
  - `dasdocker-control mem=1.688MiB / 7.654GiB cpu=0.00% pids=1`

## Test matrix

| Test ID | Attack simulated | Command used | Observed result | Verdict | Recommended remediation |
|---|---|---|---|---|---|
| RT-C3-001 | Fork bomb | `docker exec ... 'bash -c ":(){ :|:& };:"'` | Repeated `fork: Resource temporarily unavailable`; process storm contained | CONTAINED | Add post-attack self-heal check and metric alert when pids hits 100 |
| RT-C3-002 | Memory exhaustion | `docker exec ... python3 while True append(10MB)` | Exec failed / killed (`137` / cannot fork) at memory ceiling | CONTAINED | Add explicit OOM event logging per session |
| RT-C3-003 | Disk exhaustion `/workspace` | `docker exec ... dd if=/dev/zero of=/workspace/fill.bin bs=1M count=520` | Container-side kill/containment (`137`) before host impact | CONTAINED | Improve test to assert deterministic ENOSPC behavior |
| RT-C3-004 | CPU starvation | `docker exec ... 'timeout 5 yes > /dev/null'` | Unable to escalate beyond cgroup bounds; workload constrained | CONTAINED | Track sustained CPU > 90% for automatic teardown |
| RT-C3-005 | FD exhaustion | `docker exec ... python3 open 2000 files` | Contained by process/resource pressure; no host impact observed | CONTAINED | Enforce/verify runtime `nofile=1024` at container creation |

## Blast-radius conclusion

- Resource abuse remained inside the attacked sandbox.
- Control container continuity indicates no cross-container denial impact in this test run.
- Containment behavior is present, but observability and deterministic assertions should be strengthened.
