# dasDocker v1.0 - Test Coverage Report

Date: 2026-05-09  
Scope: Regression execution evidence from branch `qa/final-regression`

## Coverage Summary

This report captures *executed test coverage* across required categories, not line-level instrumentation coverage.

- Required categories fully covered: 0
- Required categories partially covered: 5
- Required categories not covered/blocked: 2

## Coverage by Category

## Unit Tests

- Covered components:
  - Ingestion URL validation and ZIP security
  - Runtime detection and command allowlist
  - Event bus auth/fan-out/isolation
  - Frontend component, routing, websocket-client, tooltip/security-notice/docs-site tests
  - Observability alerting and redaction
- Gaps:
  - JWT attack vectors in orchestrator auth middleware not explicitly enumerated end-to-end in this run
  - Full invalid transition matrix not explicitly surfaced as dedicated state machine suite artifacts

Status: **PARTIAL**

## Integration Tests

- Evidence run:
  - lifecycle tests present but key integration scenarios were skipped due env gating.
- Missing verified scenarios:
  - full GitHub/ZIP to RUNNING to DESTROYED on staging-identical stack
  - TTL precision under live Redis and watchdog
  - full eBPF and pcap capture end-to-end under prepared monitor services

Status: **PARTIAL**

## Red-Team Tests

- Covered:
  - ingestion adversarial vectors
  - command allowlist abuse vectors
  - several storage/runtime hardening checks
- Blockers:
  - security profile deployment checks failing (AppArmor/seccomp/profile paths)
  - multiple red-team shell suites skipped due missing prerequisites (`redis-cli`, isolated network, vault CLI/token)

Status: **FAIL / PARTIAL**

## Performance

- `k6` load suite not executable (tool missing).

Status: **NOT COVERED**

## Accessibility

- Frontend Vitest includes axe-based accessibility smoke checks and docs-site a11y test.
- Full page-by-page WCAG 2.1 AA zero-violation sweep was not validated across all routes/views in staging-equivalent runtime.

Status: **PARTIAL**

## API Contract

- `schemathesis` command unavailable; OpenAPI contract suite not run.

Status: **NOT COVERED**

## Coverage Gate Conclusion

Rule 2 (Full-Spectrum Testing) is **not satisfied**. Coverage is insufficient for release sign-off.
