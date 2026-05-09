# Red Team Campaign 5 - Web UI and API Penetration

**Campaign ID:** RT-C5  
**Date:** 2026-05-09  
**Objective:** Attack frontend/API authz, token handling, and proxy surfaces.

## Test matrix

| Test ID | Attack simulated | Exact command / method | Observed result | Verdict | Recommended remediation |
|---|---|---|---|---|---|
| RT-C5-001 | JWT algorithm confusion (`alg:none`) on event bus | Manual Node check against `validateJwtForSession` | Rejected: `jwt_alg_mismatch` | BLOCKED | Keep strict RS256 verification |
| RT-C5-002 | JWT signature stripping | Manual Node check against `validateJwtForSession` | Rejected: `jwt_signature_invalid` | BLOCKED | Keep signature verification hard-fail |
| RT-C5-003 | JWT replay of valid token | Manual Node check (`replay_same_token`) | Accepted (`ok:true`) without nonce/jti replay guard | **PARTIAL (HIGH)** | Add `jti` + replay cache / short TTL with one-time bind |
| RT-C5-004 | Proxy auth bypass with forged unsigned token | Manual Node execution against `createProxyHandler` with forged `Bearer` token | Request reached proxy path; error occurred later in upstream request (`ERR_HTTP_INVALID_HEADER_VALUE`), not auth rejection | **FAILED TO BLOCK (P0)** | Replace `decodeJwtNoVerify` with signature verification |
| RT-C5-005 | IDOR via token without `session_id` claim | Manual Node execution on `/api/v1/sessions/victim-session/proxy/` with forged scope-only token | Passed auth gate and reached proxy path (`ERR_HTTP_INVALID_HEADER_VALUE`) | **FAILED TO BLOCK (P0)** | Require mandatory `session_id` claim and ownership check |
| RT-C5-006 | Proxy traversal attempt | URL `/api/v1/sessions/s1/proxy/../../internal-api` | Handler allows path through to upstream assembly; no normalization guard | **PARTIAL (HIGH)** | Canonicalize and validate subpath; block traversal patterns |
| RT-C5-007 | WebSocket cross-session subscription | `npm test` in `services/event-bus` (includes `test_session_isolation.js`) | Session mismatch rejected (`4003`) and fanout isolated | BLOCKED | Keep session-scoped subscription checks |
| RT-C5-008 | CSRF posture check | Code review + test coverage check on destructive APIs | No explicit anti-CSRF token/origin check evidence captured in this run | PARTIAL | Enforce CSRF token + origin/referrer validation |
| RT-C5-009 | XSS injection via submit inputs | Frontend tests + source review (`SubmitPage.jsx`) | React-escaped rendering, no raw HTML sink found in tested path | BLOCKED (tested scope) | Add dedicated XSS regression cases for every field |
| RT-C5-010 | iframe escape from proxied view | Static control check in `ProxiedWebViewPanel` + proxy CSP sanitizer tests | `sandbox` iframe + CSP headers present | BLOCKED | Add runtime browser test for frame navigation attempts |

## Key findings

1. **P0-C5-001 - Proxy route accepts unverified JWTs**
   - Root cause: `decodeJwtNoVerify()` used in proxy auth path.
2. **P0-C5-002 - Session claim optionality enables IDOR-style access**
   - Root cause: claim mismatch check only enforced when `claims.session_id` exists.
3. **H-C5-001 - Replay resistance not enforced for valid JWT reuse**
   - Root cause: no nonce / `jti` replay tracking in observed validation path.

## Immediate remediation sequence

1. Replace proxy auth flow with strict signature verification (shared verifier).
2. Make `session_id` mandatory and exact match for all session-scoped routes.
3. Add replay defense (`jti`, `exp`, one-time use cache where applicable).
4. Add red-team regression tests for forged token, missing claim, traversal path.
