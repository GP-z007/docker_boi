# Agent 06 — Ingestion & Source Resolver Handoff

**Role:** Ingestion & Source Resolver Engineer (Squad B — Backend).  
**Deliverable:** Phase 3 — **3A.1** hardened GitHub + ZIP ingestion pipeline with ClamAV pre-scan and full-spectrum tests.  
**Depends on:** STRIDE **S-03** controls, `runtime-detection-spec.md` §1 intake (downstream consumer).

---

## (a) What Was Built

1. **`services/orchestrator/src/ingestion/github-resolver.js`**  
   - Strict allowlist URL validation: `^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\.git)?$` (no network until pass).  
   - `git clone --depth=1 --single-branch` into session workspace; **120s** timeout; **512 MiB** cap via periodic `du -sk` polling; `.git` stripped after success.  
   - **Static only** — never executes repository contents.

2. **`services/orchestrator/src/ingestion/zip-resolver.js`**  
   - **256 MiB** max buffer before parse; **adm-zip** with per-entry path validation (`..`, absolute paths, `.git`, root-level `etc/`, `.ssh`, `authorized_keys`, `~` segments).  
   - **Zip bomb:** per-entry and archive-level checks — reject if uncompressed **> 1 GiB** or **> 10×** compressed (non-trivial entries).  
   - **Symlink:** reject entries whose ZIP UNIX external mode is **symlink** (`S_IFLNK`).  
   - Secondary **resolved-path** guard under extraction root (`assertResolvedUnderRoot`).  
   - Files written with `fs.writeFile(…, { flag: 'wx' })` to reduce overwrite/TOCTOU race.

3. **`services/orchestrator/src/ingestion/pre-scanner.js`**  
   - **`clamdscan --no-summary --fdpass <sourceRoot>`**; **60 s** timeout; **fail-closed** if spawn fails, timeout, or exit code ≠ clean **0** without detections.  
   - Malware: exit **1** or any `FOUND` line → `MALWARE_DETECTED`.  
   - **Optional** VirusTotal: `VIRUSTOTAL_API_KEY` (Vault-mapped in prod) — queries file hash for a small candidate file; positives block ingest.

4. **`services/orchestrator/src/ingestion/ingestion-service.js`**  
   - `runIngestion({ sessionId, kind, githubUrl | zipBuffer, workspaceRoot, transition, emit, preScan, github })` — allocates `{workspaceRoot}/{sessionId}/`, materializes **`source`**, runs pre-scan, then `transition(sessionId, 'PROVISIONING', { source_root })` and `emit('ingestion:complete', { sourceTreePath, … })`.  
   - Any failure: recursive cleanup of session dir, `transition(sessionId, 'FAILED', { failure_reason, detail })`.

5. **Tests** under `tests/ingestion/` — **47** cases: URL (20+ adversarial patterns), ZIP path + bomb + extract, ClamAV mocks, full ingest with AV fail-closed, symlink ZIP (when `zip` CLI available), optional live GitHub clone behind `DASDOCKER_INGEST_NET_TEST=1`.

6. **`services/orchestrator/package.json`** — Node **≥ 20**, dependency **adm-zip**, `npm test` runs the ingestion suite.

---

## (b) Contract for Agent 07 (Runtime Detection Engine)

### Output directory layout (normative)

After successful ingestion, the **runtime auto-detection engine MUST** read the tree at:

```text
{workspaceRoot}/{sessionId}/source/
```

- **`workspaceRoot`:** host tmpfs (or session-scoped RAM disk) base path **configured by the orchestrator** — same trust boundary as `storage-controller` `/workspace` tmpfs intent.  
- **`sessionId`:** matches `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$` (aligned with `storage-controller` sanitiser).  
- **Repository root for heuristics:** the directory **`source`** itself (equivalent to “scanned root” in `runtime-detection-spec.md` §1).  
- **No `.git` directory** after GitHub ingest (stripped deliberately).

Helper (orchestrator-internal): `resolveIngestPaths(workspaceRoot, sessionId)` → `{ sessionRoot, sourceTreePath }`.

### Internal module API (Node `require`)

| Module | Exports (primary) |
|--------|-------------------|
| `github-resolver.js` | `GITHUB_URL_REGEX`, `validateGithubUrl`, `cloneGithubRepository`, `MAX_CLONE_BYTES`, `CLONE_TIMEOUT_MS` |
| `zip-resolver.js` | `validateZipEntryPath`, `extractZipBuffer`, `MAX_ZIP_UPLOAD_BYTES`, `MAX_ENTRY_UNCOMPRESSED_BYTES`, `ZIP_BOMB_RATIO`, `isUnixSymlinkZipAttr` |
| `pre-scanner.js` | `scanTreeWithClamAV`, `optionalVirusTotalScan`, `parseClamDetections`, `DEFAULT_CLAM_SCAN_TIMEOUT_MS` |
| `ingestion-service.js` | `runIngestion`, `resolveIngestPaths` |

### Listening ports

**N/A** — library modules only; HTTP wiring is Agent 08’s orchestrator surface.

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `VIRUSTOTAL_API_KEY` | No | Optional second opinion; must be injected via Vault/KMS in prod — **never** commit. |
| `DASDOCKER_INGEST_NET_TEST` | No (CI) | Set to `1` to enable live `git clone` integration test. |

**ClamAV:** expects `clamdscan` on `PATH` and a reachable **clamd** (typical local socket). Unavailable daemon → **session FAILED** (by design).

---

## (c) Warnings, Limitations, Squad A Review

| Item | Severity | Notes |
|------|----------|--------|
| **ZIP symlinks without UNIX mode bit** | Medium | Rejection uses ZIP external attributes; archives that encode links only via vendor-specific extras might not classify as symlink — Squad A may require extra-field parser hardening or “no links” policy at API. |
| **Conservative ZIP path rules** | Low | Paths with segment `etc` **as first segment** (or combined `etc`+`passwd` segments) are rejected; nested `proj/etc/nginx.conf`-style paths may be denied — acceptable for hostile ingest; review if legitimate monorepos need exceptions. |
| **`wx` extract semantics** | Low | Duplicate archive entries targeting the same path fail closed on second write. |
| **`node_modules` scope** | Medium | **`npm install` for orchestrator rewrote `services/orchestrator/package.json` + lockfile** to the minimal ingestion set; merging Agent 08’s Fastify/other deps MUST reconcile lockfile without collapsing security pins. |
| **Commit SHA pinning** | High | Architecture calls for verifying commit SHA after fetch — **not implemented** here (URL allowlist only). Squad A should require pin before production trust. |

---

*Agent 06 · Squad B — Ingestion & Source Resolver · Phase 3 Dispatch **02** of **04***
