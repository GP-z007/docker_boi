# Agent 19 — CI/CD & Security Scanning (Deliverable 2.x enhanced pipeline)

## (a) What was wired

Canonical workflows live under **repository root** [`/.github/workflows/`](../../../.github/workflows/) (GitHub discovers only this path); `dasdocker/.github/workflows/ci.yml` stays a symlink to the root file.

| Workflow / Artifact | Purpose |
|---------------------|---------|
| [`ci.yml`](../../../.github/workflows/ci.yml) | Primary CI gate on `push`/`pull_request` to `main`: extended jobs below augment Agent 18 scaffolding. |
| [`pr-security-gate.yml`](../../../.github/workflows/pr-security-gate.yml) | PR-only compliance: Deliverable-ID body pattern, **`security-approved`** label enforcement, seeded checklist comment. |
| [`dast-staging.yml`](../../../.github/workflows/dast-staging.yml) | **DAST hook** (`workflow_dispatch`) documents OWASP ZAP baseline invocation parameters — crawler never runs blind without Vault-delivered staging auth. |
| [`tests/test_pipeline_blocks_bad_pr.sh`](../../../.github/workflows/tests/test_pipeline_blocks_bad_pr.sh) | **Negative test harness** asserting `gitleaks` exits **1** on hardcoded **`AKIAIOSFODNN7EXAMPLE`**. |

## (b) CI jobs — pass / fail semantics

### From `dasdocker-ci` (`ci.yml`)

| Job | Pass when | Fail (non-zero / blocked) |
|-----|-----------|---------------------------|
| `lint-validate` | jq parses `daemon.json`, Hadolint stubs, Shellcheck cleans, sysctl file non-empty | Any guard fails |
| `security-scan` | Trivy **fs** ignores CVE fixture exclude; GitLeaks clean tree; Semgrep ERROR-free on scripted docker paths | **CRITICAL** Trivy, secret leak, Semgrep ERROR |
| **`sast-enhanced`** *(new)* | **`njsscan`** over `dasdocker/services/orchestrator/src` clean **or directory absent → notice skip** | `njsscan` finds actionable issues *(exit ≠0)* |
| **`frontend-lint`** *(new)* | **If** `services/frontend/package.json` absent → skips pass; otherwise `npm ci`, `npm run lint` (eslint-plugin-security), `npm audit --audit-level=high`, forbidden `eval`/`innerHTML`/dangerous JSX sinks absent | Lint/audit/sink grep hits |
| **`docker-build-verify`** *(new)* | **If no orchestrator `Dockerfile` → informational skip PASS**; else Buildx builds `dasdocker-orchestrator:ci` locally + **Trivy image CRITICAL=block** | Build failure OR CRITICAL vuln |
| **`dependency-review`** *(new, PR-only)* | `actions/dependency-review-action` introduces **no new Critical CVE** transitive deps | New Critical finding |
| `infrastructure-tests` | Existing bash infra suite succeeds | Scripted failures |
| `mandatory-review-gate` *(PR-only)* | Adds reminder comment AND requires label **`squad-a-approved`** (legacy Agent 18 path) — still active | Missing label |

`mandatory-review-gate` **`needs`** now also wait for **`frontend-lint`, `sast-enhanced`, `docker-build-verify`** ensuring extended surface finishes before Squad reminder step.

### `pr-security-gate.yml`

| Check | Requirement |
|-------|--------------|
| Deliverable citation | `/Refs:\s*Phase-\d+[\s\S]*Deliverable\s+[\d.]+/im` OR looser fallback containing `Deliverable X.Y`. |
| Security label | PR must bear **`security-approved`**. |

> **Operational note:** `ci.yml` still enforces **`squad-a-approved`**. Releases may require **both** labels until Squad harmonises nomenclature.

### `dast-staging.yml`

Manual dispatch only — documents ZAP invocation; failures should be handled by invoking maintainer playbook (no unattended crawl secrets).

### Negative regression harness

Local proof (requires `gitleaks` CLI ≥8.x installed — mirror CI installers):

```bash
cd /path/to/docker_boi
bash ".github/workflows/tests/test_pipeline_blocks_bad_pr.sh"
```

Interpretation:

- Exit **0** → scanner correctly **blocked** ephemeral leak file (desired).
- Exit **1** → regression (scanner silent).
- Exit **2** → tool missing locally (install tarball per `ci.yml` GitLeaks install step).

## (c) Open decisions / Squad A

| Topic | Recommendation |
|-------|----------------|
| **Dual labels** (`squad-a-approved` vs `security-approved`) | Merge to single authoritative label via branch-protection update. |
| **Orchestrator Dockerfile absence on `main`** | `docker-build-verify` skips with notice until orchestrator image lands — flip `has_df` path after merge to avoid lingering blind spot. |
