# Agent 07 — Runtime Detection Engine Handoff

**Role:** Runtime Detection & Dependency Specialist (Squad B — Backend).  
**Deliverable:** Phase 3 · **3A.2** — static runtime heuristic engine (no execution).  
**Consumes:** `docs/architecture/runtime-detection-spec.md` (Phase‑1 heuristic source of truth where not overridden below).  
**Input tree:** `{workspaceRoot}/{sessionId}/source/` ([`agent-06-handoff.md`](agent-06-handoff.md)).

---

## (a) What Was Built

| Path | Responsibility |
|------|----------------|
| `services/orchestrator/src/runtime-detection/detector.js` | Bounded tree walk (**max depth 5** POSIX segments from scan root via `walkSourceTree`), static manifest reads (≤ 256 KiB), scoring + conflict ladder, `MULTI_RUNTIME` signalling, Dockerfile / Makefile risk flags. |
| `services/orchestrator/src/runtime-detection/command-generator.js` | Template-based **`install_commands`** + **`entry_point_command`**. Every install line MUST match mandated `ALLOWED_COMMAND_PATTERNS`. Entry strings pass `sanitizeEntryCommand` (**structural rejection** for `;`, `\|`, `` ` ``, **`$()`,** subshell tails, redirection, URLs, globs beyond safe literals). |

**Exported API (`require`)**

```javascript
const { detectRuntimeSpec, walkSourceTree, MAX_DETECTION_DEPTH } = require('./runtime-detection/detector');
const { validateAllowlistCommand, generateCommandsForRuntime } = require('./runtime-detection/command-generator');
```

- **`detectRuntimeSpec({ sessionId, sourceRoot })`** → `{ ok: true, spec }` OR `{ ok: false, failure_reason, spec }` (partial spec for auditing).

---

## (b) `RuntimeSpec` JSON — contract for **`provisionContainer()`** (Agent 08)

Canonical success object:

```typescript
interface RuntimeSpec {
  session_id: string;
  /** Primary selection for provisioning */
  runtime: 'nodejs' | 'python' | 'go' | 'rust' | 'java' | 'ruby' | 'php' | 'dotnet' | 'unknown';

  runtime_version_hint: string | null; // engines.node | .nvmrc first line, etc.

  confidence: 'high' | 'medium' | 'low';

  /** Ordered allowlist-validated primitives only — never chained with `&&`/`;`*/
  install_commands: string[];

  /** Single sanitized command phrase (typically `binary ./path`). */
  entry_point_command: string;

  env_vars: Record<string, string>; // presently `{}` — reserved for future vault-fed pins

  /** Machine-readable breadcrumbs (signals + candidate list). */
  detection_signals: string[];

  /** UX / audit strings including risk markers and `MULTI_RUNTIME` when ambiguity remains. */
  warnings: string[];

  /** Present when ambiguity requires operator/runtime picker (confidence tie band). */
  multi_runtime?: boolean;
  alternate_runtimes?: string[];
}
```

**Failure discriminator (`detectRuntimeSpec` return envelope)**

```json
{
  "ok": false,
  "failure_reason": "RUNTIME_UNDETECTABLE | UNSAFE_COMMAND_GENERATED | EMPTY_INSTALL_CHAIN",
  "spec": { "...partial RuntimeSpec for forensics..." }
}
```

WHY **`dotnet` provisional:** `dotnet restore`/`dotnet publish` are **not** in the Phase‑3 mandated install allowlist; pure-.NET repos return `ok:false` with `failure_reason: "UNSAFE_COMMAND_GENERATED"` and `warnings` containing **`DOTNET_INSTALL_NOT_ON_MANDATED_ALLOWLIST`** until Squad A extends the regex table.

Agent 08 SHOULD map:

| `failure_reason` | Recommended session handling |
|------------------|-------------------------------|
| `RUNTIME_UNDETECTABLE` | Transition `FAILED` / block provision |
| `UNSAFE_COMMAND_GENERATED` | Transition `FAILED` with `UNSAFE_COMMAND_GENERATED` meta |
| `EMPTY_INSTALL_CHAIN` | Same as unsafe / undetectable (no valid install primitives) |

---

## (c) Allowlist baseline (dispatch mandate)

Mirrored in **`command-generator.js`** — extend only via Squad A‑reviewed PR:

1. `/^npm (install|ci)$/`
2. `/^yarn( install)?$/`
3. `/^pip install -r [a-zA-Z0-9._\-/]+\.txt$/`
4. `/^pip install \.$/`
5. `/^go mod download$/`
6. `/^cargo build( --release)?$/`
7. `/^bundle install$/`
8. `/^composer install( --no-dev)?$/`
9. `/^mvn (package|install)( -DskipTests)?$/`
10. `/^\.\/gradlew (build|assemble)$/`

---

## (d) Ports & environment variables

| Item | Value |
|------|-------|
| Listening ports | **N/A** (library-only) |
| Env vars introduced | **None** |

---

## (e) Warnings / limitations / Squad A review

| Topic | Notes |
|-------|-------|
| **Gradle without `gradlew`** | May yield **empty install chain** (`EMPTY_INSTALL_CHAIN`) — system `gradle …` verbs are deliberately absent from the mandated allowlist. |
| **`go build` omission** | Install stage emits **`go mod download` only** per allowlist — binary build must occur in hardened build phase orchestrated by Agent 08. |
| **Rust binary name | Heuristic uses `./target/release/app` placeholder | Real artifact naming needs image contract. |
| **Phase‑1 vs Phase‑3 tension** | Architecture doc forbids `gradlew` by default; dispatch **mandated** `./gradlew` regex — operational risk owned by Squad A. |
| **Symlink manifests** | Symlink nodes are recorded but **not followed** (opaque per §1). |

---

*Agent 07 · Squad B — Runtime Detection · Phase 3 Dispatch **03** of **04***
