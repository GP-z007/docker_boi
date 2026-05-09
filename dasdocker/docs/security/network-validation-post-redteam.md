# Network Validation Post Red-Team (Agent 03)

**Date:** 2026-05-09  
**Input:** Agent 20 Campaign 2 findings in `docs/security/red-team-report-campaign2-network-breakout.md`  
**Objective:** Re-validate six breakout techniques after network policy hardening.

## Ruleset update applied

- Updated `config/network/iptables-dasdocker.rules`:
  - Added `NR-019` rule to explicitly block non-DNS traffic to gateway (`172.31.0.1`) in `DASDOCKER-FORWARD`.

```text
-A DASDOCKER-FORWARD -s 172.31.0.0/16 -d 172.31.0.1 -m comment --comment "NR-019 T-S08-001 deny non-DNS to gateway in FORWARD" -j DROP
```

Rationale: Campaign 2 showed unexpected network reachability when host firewall controls were not active. This rule removes ambiguity at gateway-forward path.

## Re-run evidence

### Static policy validation

- Command: `bash tests/network/test_network_unit.sh`
- Result: **PASS**

### Live matrix rerun

- Command: `bash tests/network/test_network_integration.sh`
  - Result: **FAIL** (`inter-container ICMP should fail`)
- Command: `bash tests/network/test_network_redteam.sh`
  - Result: **FAIL** (`UDP DNS to upstream 1.1.1.1 should fail`)

### Host policy apply attempt

- Command: `bash scripts/setup-network.sh apply-iptables`
- Result: `error: run as root (sudo)`

## Interpretation

- The failing live checks are consistent with `iptables` rules not being applied on this host (Docker Desktop/macOS environment without privileged Linux `iptables` enforcement path).
- The policy file is hardened and validated statically, but **live enforcement is not confirmed in this local environment**.

## Six-technique status (Campaign 2 mapping)

| Technique | Current local status | Required production/staging status |
|---|---|---|
| LAN subnet scanning | Not confirmed blocked locally | Must be BLOCKED |
| DNS tunneling via external resolver | Not blocked in local rerun | Must be BLOCKED |
| ICMP tunneling/egress | Not confirmed blocked locally | Must be BLOCKED |
| HTTP/HTTPS to LAN IPs | Not confirmed blocked locally | Must be BLOCKED |
| Direct host management IP access | Not confirmed blocked locally | Must be BLOCKED |
| Container-to-container reachability | Not blocked in local rerun | Must be BLOCKED |

## Required final validation on Linux staging (root-capable)

1. `sudo bash scripts/setup-network.sh provision`
2. `bash tests/network/test_network_integration.sh`
3. `bash tests/network/test_network_redteam.sh`
4. Archive `iptables -S DOCKER-USER` and `iptables -S DASDOCKER-FORWARD` output in this document as evidence.

## Gate statement

- **Phase 4 network gate remains open** until Linux staging rerun proves all six breakout techniques are fully blocked under applied host firewall controls.
