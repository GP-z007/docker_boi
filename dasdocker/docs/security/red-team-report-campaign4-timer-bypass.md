# Red Team Campaign 4 - Self-Destruct Timer Bypass

**Campaign ID:** RT-C4  
**Date:** 2026-05-09  
**Objective:** Bypass or delay guaranteed session destruction.

## Test matrix

| Test ID | Attack simulated | Command used | Observed result | Verdict | Recommended remediation |
|---|---|---|---|---|---|
| RT-C4-001 | `sleep infinity` to outlive timer | `docker exec ... 'timeout 8 sleep infinity; echo exit:$?'` | `Terminated` and exit `143` under timeout probe | CONTAINED | Maintain hard kill path independent of process behavior |
| RT-C4-002 | Signal trapping to evade teardown | `trap "" TERM INT; ... kill -TERM ... kill -KILL ...` | `term_ignored` then `kill_enforced` | CONTAINED | Ensure orchestrator destroy path always includes SIGKILL fallback |
| RT-C4-003 | Redis key manipulation from sandbox | `docker exec ... 'timeout 3 nc -zv 127.0.0.1 6379'` and `redis-cli` probe | Redis not reachable (`connection refused`; no redis-cli in container) | BLOCKED | Keep Redis out of sandbox network path; add explicit ACL telemetry |
| RT-C4-004 | Watchdog recovery when subscriber missed | `node --test tests/lifecycle/test_watchdog_recovery.js` | Pass: overdue session DELETE issued by watchdog runner | BLOCKED (bypass failed) | Keep 60s cadence and alert on missed cycle |
| RT-C4-005 | Docker pause via container context | `docker exec ... 'docker pause dasdocker-redteam'` | `docker: not found` (no socket/tools) | BLOCKED | Keep no Docker CLI/socket in sandbox |

## Campaign conclusion

- No successful timer bypass was achieved in this campaign.
- Watchdog recovery path is validated by automated red-team test.
- Full end-to-end TTL timing under heavy concurrent load remains pending load-test infra.
