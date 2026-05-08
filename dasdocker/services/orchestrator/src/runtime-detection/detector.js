'use strict';

const fs = require('fs');
const path = require('path');

const {
  validateInstallCommandList,
  sanitizeEntryCommand,
  generateCommandsForRuntime,
} = require('./command-generator');

/**
 * WHY depth cap (Rule 1 — ZTA): bounds worst-case DFS work against adversarial ultra-deep directories.
 */
const MAX_DETECTION_DEPTH = 5;

const MANIFEST_MAX_BYTES = 256 * 1024;

/** @typedef {{ type: 'file'|'directory'|'symlink', depth: number, absPath?: string }} TreeEntry */

/**
 * WHY lstat-first walk: symlink targets are opaque per runtime-detection §1 — we never traverse into symlink dirs.
 *
 * @param {string} sourceRoot absolute path from Agent 06 `{workspaceRoot}/{session}/source`
 * @returns {Map<string, TreeEntry>}
 */
function walkSourceTree(sourceRoot) {
  /** @type {Map<string, TreeEntry>} */
  const out = new Map();

  /** @param {string} dirAbs @param {string} rel */
  function walk(dirAbs, rel, depthSegments) {
    if (depthSegments > MAX_DETECTION_DEPTH) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const name = ent.name;
      /* WHY skip .git remnants: ingestion strips .git, but stray metadata should not perturb signals */
      if (name === '.git') continue;

      const relPath = rel ? `${rel}/${name}` : name;
      const full = path.join(dirAbs, name);
      /** @type {import('fs').Stats | undefined} */
      let st;
      try {
        st = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        /* Symlink opaque — record presence marker only without readable content */
        out.set(relPath.replace(/\\/g, '/'), { type: 'symlink', depth: depthSegments });
        continue;
      }
      if (st.isDirectory()) {
        out.set(relPath.replace(/\\/g, '/'), { type: 'directory', depth: depthSegments });
        walk(full, relPath, depthSegments + 1);
      } else if (st.isFile()) {
        out.set(relPath.replace(/\\/g, '/'), {
          type: 'file',
          depth: depthSegments,
          absPath: full,
        });
      }
    }
  }

  walk(sourceRoot, '', 1);
  return out;
}

/**
 * @param {string} fp
 */
function readTextFileBounded(fp, maxBytes = MANIFEST_MAX_BYTES) {
  try {
    const buf = fs.readFileSync(fp);
    return buf.slice(0, maxBytes).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * WHY bounded JSON reads: aligns with heuristic manifest window (ADV / zip bomb containment).
 *
 * @param {string} fp
 */
function tryParseJsonFile(fp) {
  const txt = readTextFileBounded(fp);
  if (!txt) return null;
  const clean = txt.replace(/^\uFEFF/, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

/** @returns {boolean} */
function pyprojectIndicatesPoetryOrPep(txt) {
  if (!txt) return false;
  return /\[project\]|tool\.poetry|\[tool\.poetry\]/.test(txt);
}

/** @returns {boolean} */
function makefileHasPipeShellRisk(txt) {
  if (!txt) return false;
  const head = txt.slice(0, 2048);
  return /\b(curl|wget)\s+[^|\n]+\|\s*(ba)?sh\b/i.test(head);
}

/** @returns {boolean} */
function dockerfileRunsPipeShell(txt) {
  if (!txt) return false;
  return /^\s*RUN\s+.*(\||`)[^#\n]*(ba)?sh/im.test(txt);
}

/** @typedef {{ runtime: string, numericConfidence: number, tier: number, signals: string[] }} ScoreRow */

/** @typedef {Map<string, ScoreRow>} Scores */

/**
 * @param {Map<string, TreeEntry>} tree
 * @param {string} rootAbs
 */
function collectManifests(tree, rootAbs) {
  /** @type {Record<string, unknown>} */
  const manifests = {};

  /** @param {string} rel */
  const fileAbs = (rel) =>
    path.join(rootAbs, rel.includes('/') ? path.normalize(rel) : rel);

  if (tree.get('package.json')?.type === 'file')
    manifests.packageJson = tryParseJsonFile(fileAbs('package.json'));
  else manifests.packageJson = null;

  const hasYarnLock = [...tree.keys()].some((k) => k === 'yarn.lock' && tree.get(k)?.type === 'file');
  manifests.yarnLockRoot = hasYarnLock;

  if (tree.get('pyproject.toml')?.type === 'file') {
    const t = readTextFileBounded(fileAbs('pyproject.toml'));
    manifests.pyprojectSnippet = t;
    manifests.poetryDetected = !!t && /\[tool\.poetry\]/.test(t);
    manifests.pep621Detected = !!t && /\[project\]/.test(t);
  }
  manifests.requirementsTxt = !!(
    [...tree.keys()].some((k) => k === 'requirements.txt') && tree.get('requirements.txt')?.type === 'file'
  );
  manifests.pipenv = !!(tree.keys().some((k) => k === 'Pipfile') && tree.get('Pipfile')?.type === 'file');

  manifests.goMod = !!(tree.keys().some((k) => k === 'go.mod') && tree.get('go.mod')?.type === 'file');

  manifests.cargoToml = !!(tree.keys().some((k) => k === 'Cargo.toml') && tree.get('Cargo.toml')?.type === 'file');

  const hasPom = tree.keys().some((k) => k === 'pom.xml' || k.endsWith('/pom.xml'));
  const hasGradle =
    [...tree.keys()].some((k) => k.endsWith('build.gradle') || k.endsWith('build.gradle.kts')) ||
    [...tree.keys()].some((k) => k.endsWith('/build.gradle') || k.endsWith('/build.gradle.kts'));

  manifests.hasPom = hasPom;
  manifests.hasGradle = hasGradle;
  manifests.javaBuild = hasPom ? 'maven' : hasGradle ? 'gradle' : null;

  manifests.gemfile = !!(tree.get('Gemfile')?.type === 'file');
  manifests.composerJson =
    !!(tree.get('composer.json')?.type === 'file');

  manifests.csprojLike = [...tree.keys()].some(
    (k) => /\.(csproj|sln)$/i.test(k) && tree.get(k)?.type === 'file',
  );

  manifests.dockerfile =
    !!(tree.get('Dockerfile')?.type === 'file') ||
    !!(tree.get('docker-compose.yml')?.type === 'file');

  manifests.makefileRisk = false;
  for (const k of tree.keys()) {
    if ((k.endsWith('Makefile') || k === 'Makefile') && tree.get(k)?.type === 'file') {
      const txt = tree.get(k).absPath ? readTextFileBounded(tree.get(k).absPath) : null;
      if (makefileHasPipeShellRisk(txt || '')) {
        manifests.makefileRisk = true;
        manifests.makefileSnippet = txt?.slice(0, 512);
      }
    }
  }
  manifests.dockerPipeRisk = false;
  const df = [...tree.keys()].find((k) => k.endsWith('Dockerfile') || k === 'Dockerfile');
  if (df && tree.get(df)?.absPath) {
    const txt = readTextFileBounded(tree.get(df).absPath);
    manifests.dockerPipeRisk = dockerfileRunsPipeShell(txt || '');
  }

  return manifests;
}

/**
 * @param {Map<string, TreeEntry>} tree
 */
function orphanedYarnWithoutPackage(tree, manifests) {
  return manifests.yarnLockRoot && !manifests.packageJson;
}

/**
 * @param {Scores} scores
 */
/**
 * WHY secondary ordering: deterministic tie-breaking that deprioritises `dotnet` until its install verbs ship on the
 * mandated Phase-3 allowlist (still detected + surfaced as alternates / failure metadata).
 */
const RUNTIME_RANK = ['nodejs', 'python', 'go', 'rust', 'java', 'ruby', 'php', 'dotnet', 'docker_native'];

function strongestRuntimes(scores) {
  /** @type {ScoreRow[]} */
  const rows = [...scores.values()].filter((r) => r.numericConfidence >= 0.45);
  rows.sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    if (b.numericConfidence !== a.numericConfidence) return b.numericConfidence - a.numericConfidence;
    const ra = RUNTIME_RANK.indexOf(a.runtime);
    const rb = RUNTIME_RANK.indexOf(b.runtime);
    const fa = ra === -1 ? 999 : ra;
    const fb = rb === -1 ? 999 : rb;
    if (fa !== fb) return fa - fb;
    return a.runtime.localeCompare(b.runtime);
  });
  return rows;
}

/**
 * @param {Map<string, TreeEntry>} tree
 * @param {string} rootAbs
 * @returns {Scores}
 */
function computeRuntimeScores(tree, rootAbs) {
  /** @type {Scores} */
  const scores = new Map();
  const m = collectManifests(tree, rootAbs);

  const add = (id, row) => scores.set(id, row);

  /* nodejs */
  if (m.packageJson) {
    const pkg = m.packageJson;
    const strong =
      pkg &&
      (pkg.private === true ||
        (pkg.engines && typeof pkg.engines === 'object' && pkg.engines.node) ||
        (pkg.dependencies && Object.keys(pkg.dependencies).length) ||
        (pkg.scripts && Object.keys(pkg.scripts).length));
    let conf = 0.45;
    const sig = ['package.json'];
    if (strong) {
      conf += 0.35;
      sig.push('package.json:dependency_or_scripts');
    }
    const lockHit = [...tree.keys()].some((k) =>
      ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(path.basename(k)),
    );
    if (lockHit) conf += 0.2;

    conf -= m.pep621Detected || m.requirementsTxt || m.pyprojectSnippet?.includes('[project]') ? 0.25 : 0;
    conf = clamp01(conf);
    add('nodejs', { runtime: 'nodejs', numericConfidence: conf, tier: strong ? 2 : 1, signals: sig });
  }

  /* python */
  const pyStrong =
    m.pep621Detected ||
    m.poetryDetected ||
    m.requirementsTxt ||
    [...tree.keys()].some((k) => k.startsWith('requirements/') && k.endsWith('.txt'));

  let pyTier = pyStrong ? 2 : m.pipenv ? 2 : m.pyprojectSnippet?.includes('[project]') ? 2 : 1;
  if (pyStrong || m.poetryDetected || m.pipenv || m.requirementsTxt) {
    let conf = 0.5;
    if (m.poetryDetected && [...tree.keys()].some((k) => k === 'poetry.lock'))
      conf += 0.25;
    /*
     * WHY conditional penalty: spec §3.2 — when a real manifest exists, Makefile must not suppress Python
     * detection; apply risk only for manifest-sparse trees that look like Makefile-driven fake installs.
     */
    if (m.makefileRisk && !(m.requirementsTxt || pyStrong)) conf -= 0.2;
    conf -= m.packageJson?.dependencies ? 0.05 : 0;
    conf = clamp01(conf);
    add('python', { runtime: 'python', numericConfidence: conf, tier: pyStrong ? 2 : 2, signals: ['python_manifest'] });
  }

  /* go */
  if (m.goMod) {
    let conf = 0.75;
    const cmds = [...tree.keys()].filter((k) =>
      /^cmd\/[^/]+$/.test(k.replace(/\\/g, '/')) && tree.get(k)?.type === 'directory');
    if (cmds.length === 1) conf += 0.15;
    add('go', {
      runtime: 'go',
      numericConfidence: clamp01(conf),
      tier: 2,
      signals: ['go.mod'],
    });
  }

  /* rust */
  if (m.cargoToml) {
    add('rust', { runtime: 'rust', numericConfidence: 0.82, tier: 2, signals: ['Cargo.toml'] });
  }

  /* java */
  if (m.hasPom) {
    add('java', {
      runtime: 'java',
      numericConfidence: 0.72,
      tier: 2,
      signals: ['pom.xml'],
      javaBuild: 'maven',
    });
  } else if (m.hasGradle) {
    add('java', {
      runtime: 'java',
      numericConfidence: 0.72,
      tier: 2,
      signals: ['gradle'],
      javaBuild: 'gradle',
    });
  }

  /* ruby */
  if (m.gemfile) {
    add('ruby', { runtime: 'ruby', numericConfidence: 0.65, tier: 2, signals: ['Gemfile'] });
  }

  /* php */
  if (m.composerJson) {
    add('php', { runtime: 'php', numericConfidence: 0.63, tier: 2, signals: ['composer.json'] });
  }

  /* dotnet */
  if (m.csprojLike) {
    add('dotnet', { runtime: 'dotnet', numericConfidence: 0.68, tier: 2, signals: ['csproj-or-sln'] });
  }

  /* docker_native track (cannot win automatically) */
  if (m.dockerfile) {
    add('docker_native', {
      runtime: 'docker_native',
      numericConfidence: 0.38,
      tier: 0,
      signals: ['Dockerfile_present'],
    });
  }

  return scores;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n)));
}

function confidenceBand(n) {
  if (n >= 0.72) return 'high';
  if (n >= 0.52) return 'medium';
  return 'low';
}

/** @typedef {ReturnType<typeof walkSourceTree>} TreeMap */

/** @typedef {{
 * runtime: string,
 * alternate_runtimes: string[],
 * multi_runtime: boolean,
 * numericConfidence: number,
 * signalsCombined: string[],
 * warnings: string[],
 * dotnet_detected_but_unsupported_allowlist?: boolean,
 * }} ResolvedWin */

function resolveConflictScores(scores, tree, manifests) {
  /** @type {string[]} */
  const warnings = [];
  if (orphanedYarnWithoutPackage(tree, manifests)) {
    warnings.push('ORPHAN_LOCKFILE_NO_PACKAGE_JSON');
    scores.delete('nodejs');
  }

  const ranked = strongestRuntimes(scores).filter((r) => r.runtime !== 'docker_native');
  /** @type {ScoreRow[]} */
  const langs = ranked.filter((r) => ['nodejs', 'python', 'go', 'rust', 'java', 'ruby', 'php', 'dotnet'].includes(r.runtime));

  if (manifests.dockerfile && langs.length > 0) {
    const top = langs[0];
    if (top && langs[0].numericConfidence - (langs[1]?.numericConfidence || 0) < 0.12) warnings.push('MULTI_HINT_DOCKERFILE_PLUS_LANGUAGE');
  }

  if (langs.length === 0 && scores.has('docker_native')) {
    warnings.push('DOCKER_NATIVE_ONLY_UNDERCONFIDENT');
    return {
      runtime: 'unknown',
      alternate_runtimes: ['docker_native'],
      multi_runtime: false,
      numericConfidence: 0.35,
      signalsCombined: ['docker_native'],
      warnings,
    };
  }

  if (langs.length === 0) {
    warnings.push('RUNTIME_UNDETECTABLE');
    return {
      runtime: 'unknown',
      alternate_runtimes: [],
      multi_runtime: false,
      numericConfidence: 0,
      signalsCombined: [],
      warnings,
    };
  }

  const [first, second] = langs;

  /*
   * Go + Rust both tier-2 and close → explicit multi flag (spec §3.2).
   * WHY fixed delta 0.05: mirrors §3.1 step 4 “confidence within 0.05”.
   */
  if (second && Math.abs(first.numericConfidence - second.numericConfidence) <= 0.05) {
    warnings.push('MULTI_RUNTIME');
    return {
      runtime: first.runtime,
      alternate_runtimes: langs.slice(1, 5).map((x) => x.runtime),
      multi_runtime: true,
      numericConfidence: first.numericConfidence,
      signalsCombined: [...first.signals, ...second.signals],
      warnings,
    };
  }

  /* Maven vs Gradle coexisting shallow */
  const hasPom = manifests.hasPom;
  const hasGradle = manifests.hasGradle;
  if (hasPom && hasGradle) warnings.push('JAVA_DUAL_BUILD_WARNING');

  /*
   * Dotnet emits no mandated-allowlisted install verbs — downgrade and flag for Agent 08 override.
   * WHY downgrade: dotnet restore isn't in mandated allowlist; auto-provisioning must fail closed.
   */
  if (first.runtime === 'dotnet') {
    warnings.push('DOTNET_REQUIRES_ALLOWLIST_EXTENSION');
    return {
      runtime: 'dotnet',
      alternate_runtimes: langs.slice(1).map((x) => x.runtime),
      multi_runtime: second && second.numericConfidence >= 0.45,
      numericConfidence: first.numericConfidence,
      signalsCombined: first.signals,
      warnings,
      dotnet_detected_but_unsupported_allowlist: true,
    };
  }

  return {
    runtime: first.runtime,
    alternate_runtimes: langs.slice(1, 5).map((x) => x.runtime),
    multi_runtime: !!(second && second.numericConfidence >= 0.45 && first.numericConfidence - second.numericConfidence < 0.12),
    numericConfidence: first.numericConfidence,
    signalsCombined: first.signals,
    warnings,
  };
}

/**
 * Main entry for Agent 08 — static analysis only.
 *
 * @param {{ sessionId: string, sourceRoot: string }} args
 */
function detectRuntimeSpec(args) {
  const { sessionId, sourceRoot } = args;

  /** @type {TreeMap} */
  const tree = walkSourceTree(sourceRoot);
  const manifests = collectManifests(tree, sourceRoot);
  /** @type {Scores} */
  const scores = computeRuntimeScores(tree, sourceRoot);
  /** @typedef {Awaited<ReturnType<typeof resolveConflictScores>>} R */
  const resolved = resolveConflictScores(scores, tree, manifests);

  const detection_signals = [
    ...resolved.signalsCombined.map((s) => `signal:${s}`),
    ...[...scores.keys()].map((k) => `candidate:${k}`),
  ].slice(0, 64);

  /** @typedef {{ session_id:string, runtime:string, runtime_version_hint:string|null, confidence:string, install_commands:string[], entry_point_command:string, env_vars:Record<string,string>, detection_signals:string[], warnings:string[], multi_runtime?:boolean, alternate_runtimes?:string[], failure_reason?:string }} RuntimeSpec */

  /** @type {string[]} */
  const warningsAcc = [...resolved.warnings];

  if (manifests.makefileRisk) warningsAcc.push('MAKEFILE_PIPELINE_RISK_SCANNED');
  if (manifests.dockerPipeRisk) warningsAcc.push('DOCKERFILE_PIPE_SHELL_RISK');

  if (
    resolved.runtime === 'unknown' ||
    resolved.warnings.includes('RUNTIME_UNDETECTABLE') ||
    resolved.numericConfidence < 0.45
  ) {
    return {
      ok: false,
      failure_reason: 'RUNTIME_UNDETECTABLE',
      spec: {
        session_id: sessionId,
        runtime: 'unknown',
        runtime_version_hint: readVersionHints(manifests, tree),
        confidence: confidenceBand(resolved.numericConfidence || 0),
        install_commands: [],
        entry_point_command: '',
        env_vars: {},
        detection_signals,
        warnings: warningsAcc,
      },
    };
  }

  const genInput = {
    runtime: resolved.runtime,
    tree,
    absRoot: sourceRoot,
    manifests: {
      ...manifests,
      javaBuild: manifests.javaBuild,
    },
    warnings: warningsAcc,
  };

  const gen = generateCommandsForRuntime(genInput);

  if (resolved.dotnet_detected_but_unsupported_allowlist) {
    return {
      ok: false,
      failure_reason: 'UNSAFE_COMMAND_GENERATED',
      spec: {
        session_id: sessionId,
        runtime: 'dotnet',
        runtime_version_hint: readVersionHints(manifests, tree),
        confidence: confidenceBand(resolved.numericConfidence),
        install_commands: [],
        entry_point_command: '',
        env_vars: {},
        detection_signals,
        warnings: [...warningsAcc, 'DOTNET_INSTALL_NOT_ON_MANDATED_ALLOWLIST'],
      },
    };
  }

  const allow = validateInstallCommandList(gen.install_commands);
  if (!allow.ok) {
    return {
      ok: false,
      failure_reason: allow.reason,
      spec: {
        session_id: sessionId,
        runtime: resolved.runtime === 'docker_native' ? 'unknown' : resolved.runtime,
        runtime_version_hint: readVersionHints(manifests, tree),
        confidence: confidenceBand(resolved.numericConfidence),
        install_commands: gen.install_commands,
        entry_point_command: gen.entry_point_command,
        env_vars: {},
        detection_signals,
        warnings: [...gen.warnings, allow.detail || ''],
      },
    };
  }

  const entrySan = sanitizeEntryCommand(gen.entry_point_command);
  if (!entrySan.ok) {
    return {
      ok: false,
      failure_reason: 'UNSAFE_COMMAND_GENERATED',
      spec: {
        session_id: sessionId,
        runtime: resolved.runtime,
        runtime_version_hint: readVersionHints(manifests, tree),
        confidence: confidenceBand(resolved.numericConfidence),
        install_commands: gen.install_commands,
        entry_point_command: gen.entry_point_command,
        env_vars: {},
        detection_signals,
        warnings: [...gen.warnings, entrySan.reason || 'ENTRY_INVALID'],
      },
    };
  }

  /** @type {RuntimeSpec} */
  const spec = {
    session_id: sessionId,
    runtime: resolved.runtime,
    runtime_version_hint: readVersionHints(manifests, tree),
    confidence: confidenceBand(resolved.numericConfidence),
    install_commands: gen.install_commands,
    entry_point_command: entrySan.entry,
    env_vars: {},
    detection_signals,
    warnings: [...gen.warnings, ...(resolved.multi_runtime ? ['MULTI_RUNTIME'] : [])],
    multi_runtime: resolved.multi_runtime,
    alternate_runtimes: resolved.alternate_runtimes,
  };

  return { ok: true, spec };
}

/**
 * WHY separate hint reader: manifests may encode engine pins without spawning semver tooling.
 *
 * @param {*} manifests @param {TreeMap} tree
 */
function readVersionHints(manifests, tree) {
  try {
    if (manifests.packageJson && manifests.packageJson.engines && manifests.packageJson.engines.node) {
      return String(manifests.packageJson.engines.node);
    }
    const nv = [...tree.keys()].find((k) => k === '.nvmrc' || k.endsWith('.nvmrc'));
    if (nv && tree.get(nv)?.absPath)
      return readTextFileBounded(tree.get(nv).absPath)?.trim()?.split(/\r?\n/)?.[0] ?? null;
  } catch {
    /* noop */
  }
  return null;
}

module.exports = {
  MAX_DETECTION_DEPTH,
  walkSourceTree,
  computeRuntimeScores,
  collectManifests,
  resolveConflictScores,
  strongestRuntimes,
  detectRuntimeSpec,
};
