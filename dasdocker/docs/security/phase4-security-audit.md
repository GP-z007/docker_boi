# Phase 4 Security Audit (Implemented System)

**Author:** Lead Security Auditor (Phase 4)  
**Date:** 2026-05-09  
**Inputs reviewed:** `docs/security/STRIDE-threat-model.md`, orchestrator/runtime code, security configs, active test outputs, and `docs/security/container-escape-test-results.md`.

## Executive assessment

- This audit evaluates implemented code and runtime behavior, not architecture intent.
- Evidence confirms several hardening controls are present (cap-drop, read-only root, resource limits, schema validation, TTL watchdog paths).
- **Gate-blocking finding:** container LAN egress succeeded during red-team attempt; deny-by-default network isolation was not active in this environment.
- **Gate-blocking finding:** mandatory host profile deployment checks (seccomp/AppArmor) failed.
- Phase 4 status: **NOT APPROVED** pending remediation and re-validation.

## STRIDE status re-assessment (all threats)

Status values: `MITIGATED`, `PARTIALLY MITIGATED`, `OPEN`, `ACCEPTED`.

| Threat ID | Status | Evidence / gap |
|---|---|---|
| T-S01-001 | OPEN | No executed browser/session hijack validation evidence in this audit pass |
| T-S01-002 | OPEN | No API authz route-level proof for UI tampering attempts |
| T-S01-003 | OPEN | No production frontend build/error sanitization verification in this pass |
| T-S01-004 | OPEN | No WS/edge rate-limit test execution captured |
| T-S02-001 | OPEN | JWT validation/rotation implementation not evidenced end-to-end |
| T-S02-002 | OPEN | Ownership enforcement on all mutating routes not proven |
| T-S02-003 | PARTIALLY MITIGATED | `destroyContainer()` emits structured audit logs, but full action trace coverage not proven |
| T-S02-004 | OPEN | No comprehensive API error leakage test evidence |
| T-S02-005 | PARTIALLY MITIGATED | cgroup/resource caps present; API admission/rate controls not proven |
| T-S03-001 | MITIGATED | URL allowlist and negative tests passed in orchestrator suite |
| T-S03-002 | MITIGATED | Zip-slip/symlink and zip-bomb negative tests passed |
| T-S03-003 | PARTIALLY MITIGATED | Scanner fail-closed works; full log-redaction proof not captured |
| T-S03-004 | MITIGATED | Oversize/compression-abuse test coverage present and passing |
| T-S04-001 | MITIGATED | `--read-only` verified; root fs write attempt blocked |
| T-S04-002 | PARTIALLY MITIGATED | Cap-drop/no-new-privileges validated; host seccomp/AppArmor deployment missing |
| T-S04-003 | PARTIALLY MITIGATED | No docker.sock mount and private tmpfs verified; full secret-injection controls not proven |
| T-S04-004 | MITIGATED | pids/memory/cpu limits verified; exhaustion attempts contained |
| T-S04-005 | OPEN | No image signing/supply-chain attestation evidence |
| T-S05-001 | PARTIALLY MITIGATED | Userns breakout blocked; full kernel patch/CVE posture not evidenced |
| T-S05-002 | OPEN | No side-channel mitigation validation evidence |
| T-S05-003 | PARTIALLY MITIGATED | Host hardening script + sysctl checks pass; node-pool isolation/SLA not proven |
| T-S05-004 | PARTIALLY MITIGATED | Host hardening controls present; module enforcement policy not fully proven |
| T-S06-001 | PARTIALLY MITIGATED | No socket mount in target container; daemon socket permission check skipped |
| T-S06-002 | OPEN | No Docker API endpoint spoofing/mTLS validation evidence |
| T-S06-003 | OPEN | Cross-tenant Docker API authZ checks not proven |
| T-S06-004 | OPEN | Tamper-evident Docker command audit chain not proven |
| T-S07-001 | OPEN | eBPF program trust-chain and CAP_BPF scope not validated in this pass |
| T-S07-002 | OPEN | eBPF data scoping/redaction controls not proven |
| T-S07-003 | OPEN | eBPF map flood/rate-limiting behavior not verified |
| T-S08-001 | OPEN | **Critical:** LAN ping succeeded from sandbox; deny-by-default egress not enforced |
| T-S08-002 | PARTIALLY MITIGATED | Static iptables rules validated; runtime isolated network absent in test env |
| T-S08-003 | OPEN | mDNS/internal discovery blocking not proven at runtime |
| T-S09-001 | OPEN | Per-session pcap isolation/RBAC at rest not evidenced |
| T-S09-002 | OPEN | Suricata runtime hardening and namespace separation not validated |
| T-S09-003 | OPEN | pcap quota/watermark controls not validated end-to-end |
| T-S10-001 | OPEN | Secret scrubbing policy not verified with log payload tests |
| T-S10-002 | OPEN | WORM/append-only retention controls not evidenced |
| T-S10-003 | PARTIALLY MITIGATED | Docker log rotation settings validated; full pipeline limits not proven |
| T-S11-001 | OPEN | Redis ACL/TLS posture not validated in environment |
| T-S11-002 | PARTIALLY MITIGATED | TTL and watchdog delete flow tested; strict Redis write ACL not proven |
| T-S11-003 | OPEN | Dangerous Redis command lockdown not validated |
| T-S12-001 | OPEN | Inter-service identity signing/mTLS not proven |
| T-S12-002 | OPEN | Event integrity/transport tamper controls not proven |
| T-S12-003 | OPEN | Cross-session WebSocket isolation not validated end-to-end |
| T-S13-001 | PARTIALLY MITIGATED | JWT key exposure test passed; repo secret scanner test skipped (gitleaks missing) |
| T-S13-002 | OPEN | Key rotation retirement flow not validated |
| T-S13-003 | PARTIALLY MITIGATED | Vault policy test skipped (vault CLI missing), no least-privilege proof |
| T-S14-001 | PARTIALLY MITIGATED | TTL/watchdog logic present with test coverage; full race/clock skew proof incomplete |
| T-S14-002 | PARTIALLY MITIGATED | Watchdog overdue-delete test passed; false-positive kill controls not fully validated |

## New threats discovered during implementation audit

1. **NT-001 (Critical): Runtime egress policy drift enables LAN reachability**  
   - Discovery: active container ping to `192.168.1.1` succeeded.
   - Impact: direct violation of ZTA deny-by-default network policy; potential pivot into internal network.
   - Recommended remediation:
     - Enforce network provisioning and iptables application in environment bootstrap.
     - Add preflight gate that refuses session creation if isolated network/rules are missing.

2. **NT-002 (High): Security profile deployment dependency is externalized and not enforced preflight**  
   - Discovery: seccomp/AppArmor test scripts fail because required host files are absent.
   - Impact: runtime behavior can silently degrade from intended baseline.
   - Recommended remediation:
     - Add startup hard-fail in orchestrator if seccomp/AppArmor artifacts are missing.
     - Add CI and runtime health probes for profile presence.

3. **NT-003 (Medium): Test image/tool mismatch leaves partial blind spots in escape matrix**  
   - Discovery: several techniques returned `command not found` due minimal `alpine` tooling.
   - Impact: false confidence risk for controls requiring tool-based confirmation (`ptrace`, raw socket with Python, kexec).
   - Recommended remediation:
     - Add dedicated red-team image with required offensive tooling and immutable digest.

## Recommendations for Phase 5 gate

1. Block Phase 5 sign-off until NT-001 and NT-002 are closed and re-tested.
2. Add mandatory preflight check script invoked by orchestrator startup:
   - seccomp file exists and hash matches repo baseline
   - AppArmor profile loaded
   - `dasdocker-isolated` network exists
   - `DASDOCKER-FORWARD` chain active
3. Re-run and archive:
   - `tests/security/test_seccomp_profile.sh`
   - `tests/security/test_apparmor_profile.sh`
   - `tests/network/test_network_integration.sh`
   - `tests/network/test_network_redteam.sh`
4. File tracking issues for NT-001..NT-003 with severity labels (`critical`, `high`, `medium`).

## Evidence summary (commands executed)

- `npm test` in `services/orchestrator` (89 pass, 5 skip, 0 fail)
- `bash tests/infrastructure/test_docker_config.sh` (pass)
- `bash tests/infrastructure/test_host_hardening.sh` (pass with expected environment skip lines)
- `bash tests/network/test_network_unit.sh` (pass)
- `bash tests/network/test_network_integration.sh` (skip: isolated network missing)
- `bash tests/network/test_network_redteam.sh` (skip: isolated network missing)
- `bash tests/security/test_seccomp_profile.sh` (fail: profile missing in `/etc`)
- `bash tests/security/test_apparmor_profile.sh` (fail: profile missing in `/etc`)
- Active escape attempts and outcomes documented in `docs/security/container-escape-test-results.md`
