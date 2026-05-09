# dasDocker v1.0 - Regression Test Results

Date: 2026-05-09  
Branch: `qa/final-regression`  
Environment: Local candidate validation host (not production-identical staging)

## Release Gate Decision

Status: **BLOCKED (NO QA SIGN-OFF)**

Reason: Master Engineering Rules 1 and 2 are not satisfied:
- Mandatory suites include skips.
- Multiple mandatory security tests fail.
- Required tooling for load and contract tests is missing.

## Executed Suites

## 1) Unit and Service Tests

- `services/orchestrator` (`node --test ...ingestion/runtime-detection/lifecycle`)
  - Passed: 89
  - Failed: 0
  - Skipped: 5
- `services/alerting` (`node --test ../../tests/observability/*.js`)
  - Passed: 3
  - Failed: 0
  - Skipped: 0
- `services/event-bus` (`node --test ../../tests/event-bus/*.js`)
  - Passed: 6
  - Failed: 0
  - Skipped: 0
- `services/frontend` (`vitest run`)
  - Passed: 47
  - Failed: 0
  - Skipped: 0

## 2) Shell-based Security/Infrastructure/Runtime Suites

Command executed: all `tests/**/*.sh` scripts.

- Total scripts: 27
- Hard failures: 4
- Scripts reporting SKIP conditions: 13
- Clean pass (no skip markers): 10

### Hard failures

- `tests/infrastructure/test_ci_pipeline_negative.sh`
  - FAIL: gitleaks required for red-team gate
- `tests/security/test_apparmor_profile.sh`
  - FAIL: missing `/etc/apparmor.d/dasdocker-container`
- `tests/security/test_profile_permissions.sh`
  - FAIL: missing `/etc/dasdocker/security`
- `tests/security/test_seccomp_profile.sh`
  - FAIL: seccomp JSON missing at `/etc/dasdocker/security/seccomp-dasdocker.json`

### SKIP blockers (sample)

- eBPF and network-monitor checks skipped due missing `redis-cli`.
- network integration/red-team skipped due missing `dasdocker-isolated` network.
- vault checks skipped due missing `vault` CLI and token prerequisites.
- seccomp/eBPF syscall check skipped when profile path is absent.

## 3) Performance and Contract Tooling

- Load test (`k6 run tests/load/k6-load-test.js`): **NOT EXECUTED**
  - blocker: `k6` command not found
- API contract (`schemathesis run docs/api/openapi-v1.0.yaml`): **NOT EXECUTED**
  - blocker: `schemathesis` command not found

## Checklist Outcome vs Required Gate

- Unit tests: PARTIAL PASS (contains skipped mandatory lifecycle tests)
- Integration tests: NOT FULLY VERIFIED (skips/blockers present)
- Red-team tests: FAIL (hard failures + skipped required vectors)
- Performance: NOT VERIFIED (k6 unavailable)
- Accessibility: PARTIAL (frontend axe smoke tests pass; full all-pages audit not proven)
- API contract: NOT VERIFIED (schemathesis unavailable)
- Documentation rendering checks: PARTIAL (frontend docs/tooltip/security notice tests pass)

## Final QA Position

Release is **blocked** until all mandatory suites run in production-identical staging with:
- zero skips,
- zero P0/P1 failures,
- successful load and contract tooling execution.
