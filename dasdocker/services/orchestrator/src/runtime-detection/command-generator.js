'use strict';

const path = require('path');

/**
 * WHY strict allowlists (Rule 1 — ZTA): provisioning never consumes attacker-controlled shell — only verifier-approved
 * install verbs emitted here.
 */
const ALLOWED_COMMAND_PATTERNS = [
  /^npm (install|ci)$/,
  /^yarn( install)?$/,
  /^pip install -r [a-zA-Z0-9._\-/]+\.txt$/,
  /^pip install \.$/,
  /^go mod download$/,
  /^cargo build( --release)?$/,
  /^bundle install$/,
  /^composer install( --no-dev)?$/,
  /^mvn (package|install)( -DskipTests)?$/,
  /^\.\/gradlew (build|assemble)$/,
];

/** WHY allow spaces sparingly: `node ./foo.js`, `ruby ./main.rb`; structural blocking still forbids chaining. */
const SAFE_ENTRY_CHARS = /^[a-zA-Z0-9_\s./+:=-]+$/;

/**
 * WHY structural block: defeats `npm start`-style payloads that concatenate `;`, pipes, substitutions, redirection.
 */
const ENTRY_BLOCKED = /[;&|$`!'(){}[\]<>*?\\\n\r|]|(\.\.[\\/])|^(\.{2})$|\$\(/;

const SAFE_SCRIPT_FILE = /^\.?\/?[a-zA-Z0-9_.+-/]+\.(jsx?|tsx?|mjs|cjs)$/;

function validateAllowlistCommand(command) {
  if (typeof command !== 'string' || !command.trim()) {
    return false;
  }
  return ALLOWED_COMMAND_PATTERNS.some((re) => re.test(command.trim()));
}

function validateInstallCommandList(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return { ok: false, reason: 'EMPTY_INSTALL_CHAIN' };
  }
  const bad = commands.find((c) => !validateAllowlistCommand(c));
  return bad
    ? { ok: false, reason: 'UNSAFE_COMMAND_GENERATED', detail: bad }
    : { ok: true };
}

/**
 * @param {string} entryCandidate
 */
function sanitizeEntryCommand(entryCandidate) {
  const t = typeof entryCandidate === 'string' ? entryCandidate.trim() : '';
  if (!t || ENTRY_BLOCKED.test(t) || !SAFE_ENTRY_CHARS.test(t)) {
    return { ok: false, reason: 'ENTRY_REJECTED_SHELL_STRUCTURAL' };
  }
  /* WHY cap fragments: rejects hidden command lists without fully parsing POSIX shell */
  const parts = t.split(/\s+/);
  if (parts.length > 4) {
    return { ok: false, reason: 'ENTRY_REJECTED_TOO_MANY_PARTS' };
  }
  return { ok: true, entry: t };
}

/**
 * @param {Record<string, unknown>} pkg
 * @param {{ warnings: string[], detection_signals?: string[], hasRootFile?: (n: string) => boolean }} ctx
 */
function inferNodeEntryFromPackageJson(pkg, ctx) {
  if (!pkg || typeof pkg !== 'object') {
    ctx.warnings.push('ENTRY_UNCERTAIN_NO_PKG');
    return { entry: 'node ./index.js', uncertain: true };
  }

  const scripts =
    pkg.scripts && typeof pkg.scripts === 'object' && pkg.scripts !== null ? pkg.scripts : {};
  const startRaw = typeof scripts.start === 'string' ? scripts.start.trim() : '';

  if (startRaw) {
    if (ENTRY_BLOCKED.test(startRaw) || /\s([&|;])\s/.test(startRaw)) {
      ctx.warnings.push('ENTRY_BLOCKED_MALICIOUS_START_SCRIPT');
      return inferNodeStatics(pkg, ctx);
    }
    const nodeLiteral = /^node\s+(\.?\/[a-zA-Z0-9_.+-]+\.(jsx?|tsx?|mjs|cjs))$/.exec(startRaw);
    if (nodeLiteral) {
      ctx.detection_signals?.push('npm_script:start_static_node');
      return { entry: `node ${nodeLiteral[1]}`, uncertain: false };
    }
    const bareSafe = SAFE_SCRIPT_FILE.test(startRaw);
    if (bareSafe) {
      const p = startRaw.startsWith('./') ? startRaw : `./${startRaw}`;
      ctx.detection_signals?.push('npm_script:start_literal_js');
      return { entry: `node ${p}`, uncertain: false };
    }
    ctx.warnings.push('ENTRY_UNCERTAIN_NPM_SCRIPT');
    return inferNodeStatics(pkg, ctx);
  }

  return inferNodeStatics(pkg, ctx);
}

function inferNodeStatics(pkg, ctx) {
  const bin = pkg.bin;
  if (bin && typeof bin === 'object' && bin !== null) {
    const k = Object.keys(bin)[0];
    const p = typeof k === 'string' && typeof bin[k] === 'string' ? bin[k] : '';
    if (p && SAFE_SCRIPT_FILE.test(p)) {
      const np = p.startsWith('./') || p.startsWith('/') ? p : `./${p}`;
      return { entry: `node ${np}`, uncertain: false };
    }
  }
  const main =
    typeof pkg.main === 'string'
      ? pkg.main
      : typeof pkg.module === 'string'
        ? pkg.module
        : '';
  if (main && SAFE_SCRIPT_FILE.test(main)) {
    const np = main.startsWith('./') ? main : `./${main}`;
    return { entry: `node ${np}`, uncertain: false };
  }
  ctx.warnings.push('ENTRY_FALLBACK_INDEX');
  const hasIdx = typeof ctx.hasRootFile === 'function' && ctx.hasRootFile('index.js');
  if (!hasIdx) ctx.warnings.push('ENTRY_UNCERTAIN_DEFAULT_INDEX_MISSING');
  return { entry: 'node ./index.js', uncertain: !hasIdx };
}

/**
 * @typedef {{
 *   runtime: string,
 *   tree: Map<string, { type:'file'|'symlink'; depth: number; absPath?: string }>,
 *   absRoot: string,
 *   manifests: Record<string, unknown>,
 *   warnings?: string[],
 * }} GenCtxInput */

/**
 * WHY switch-based templates: aligns with heuristic spec §2 while mapping into the narrower Phase-3 mandated allowlist
 * (e.g., cargo build instead of unsupported `cargo fetch` here).
 *
 * @param {GenCtxInput} input
 * @returns {{ install_commands: string[], entry_point_command: string, warnings: string[], entry_uncertain?: boolean }}
 */
function generateCommandsForRuntime(input) {
  const warnings = [...(input.warnings || [])];
  const pkg = /** @type {Record<string,unknown>|null} */ (input.manifests.packageJson ?? null);
  const tree = input.tree;

  /** @type {string[]} */
  const install_commands = [];

  /** @type {boolean} */
  let entry_uncertain = false;

  /** @param {string} rel */
  function fileAt(rel) {
    const k = rel.replace(/\\/g, '/');
    return tree.get(k)?.type === 'file';
  }

  /** @returns {boolean} */
  const hasRootFile = (n) => fileAt(n);

  /** @returns {boolean} */
  const hasFileRel = (rel) => fileAt(rel.replace(/\\/g, '/'));

  switch (input.runtime) {
    case 'nodejs': {
      const yarnLockRoot = !!input.manifests.yarnLockRoot;
      if (yarnLockRoot) install_commands.push('yarn install');
      else if (
        [...tree.keys()].some((k) => path.basename(k) === 'package-lock.json' && tree.get(k)?.type === 'file')
      ) {
        install_commands.push('npm ci');
      } else install_commands.push('npm install');

      const e = inferNodeEntryFromPackageJson(pkg, {
        warnings,
        detection_signals: [],
        hasRootFile: (n) => hasRootFile(n),
      });
      entry_uncertain = e.uncertain;
      return {
        install_commands,
        entry_point_command: e.entry,
        warnings,
        entry_uncertain,
      };
    }
    case 'python': {
      const reqPaths = [...tree.keys()].filter(
        (k) =>
          k === 'requirements.txt' ||
          (k.startsWith('requirements/') && k.endsWith('.txt') && tree.get(k)?.type === 'file'),
      );
      if (reqPaths.length > 0) {
        reqPaths.sort((a, b) => a.split('/').length - b.split('/').length);
        install_commands.push(`pip install -r ${reqPaths[0]}`);
      } else install_commands.push('pip install .');
      let entry = '';
      const ord = ['src/__main__.py', 'main.py', 'app.py', '__main__.py', 'public/index.py'];
      for (const o of ord) {
        if (hasFileRel(o)) {
          entry = `python ./${o.replace(/\\/g, '/')}`;
          break;
        }
      }
      if (!entry) entry = hasFileRel('wsgi.py') ? 'python ./wsgi.py' : 'python ./main.py';
      return { install_commands, entry_point_command: entry, warnings, entry_uncertain: false };
    }
    case 'go': {
      install_commands.push('go mod download');
      const cmdRoots = [...tree.keys()].filter((k) => /(^|\/)cmd\/[^/]+\/main\.go$/.test(k));
      if (cmdRoots.length === 1) {
        const m = /cmd\/([^/]+)\//.exec(cmdRoots[0].replace(/\\/g, '/'));
        const nm = m ? m[1] : 'app';
        return {
          install_commands,
          entry_point_command: `./cmd/${nm}`,
          warnings,
          entry_uncertain: false,
        };
      }
      if (hasRootFile('main.go'))
        /* WHY `./` literal: aligns with heuristic “root main package”; actual binary name isProvisioner-owned (never `go run`). */
        return { install_commands, entry_point_command: './', warnings, entry_uncertain: false };
      return { install_commands, entry_point_command: '.', warnings, entry_uncertain: true };
    }
    case 'rust': {
      install_commands.push('cargo build --release');
      return {
        install_commands,
        entry_point_command: './target/release/app',
        warnings: [...warnings, 'RUST_BINARY_NAME_HEURISTIC'],
        entry_uncertain: true,
      };
    }
    case 'java': {
      if (input.manifests.javaBuild === 'maven')
        install_commands.push('mvn package -DskipTests');
      else if (hasRootFile('gradlew'))
        install_commands.push('./gradlew build');
      else {
        warnings.push('JAVA_INSTALL_WRAPPER_UNAVAILABLE');
      }
      return {
        install_commands,
        entry_point_command: './target/classes/Main',
        warnings: [...warnings, 'JAVA_MAIN_HEURISTIC'],
        entry_uncertain: true,
      };
    }
    case 'ruby': {
      install_commands.push('bundle install');
      let entry_point_command = 'ruby ./main.rb';
      if (hasFileRel('config.ru')) {
        entry_point_command = 'ruby ./config.ru';
        warnings.push('RUBY_RACK_REQUIRES_ACK');
      } else if (hasFileRel('app.rb')) entry_point_command = 'ruby ./app.rb';
      return { install_commands, entry_point_command, warnings, entry_uncertain: false };
    }
    case 'php': {
      const inst = [...tree.keys()].some(
        (k) => path.basename(k) === 'composer.lock' && tree.get(k)?.type === 'file',
      )
        ? 'composer install'
        : 'composer install --no-dev';
      install_commands.push(inst);
      const entry_point_command = hasFileRel('public/index.php')
        ? 'php ./public/index.php'
        : 'php ./index.php';
      return { install_commands, entry_point_command, warnings, entry_uncertain: false };
    }
    default:
      warnings.push('RUNTIME_NOT_SUPPORTED_IN_GENERATOR');
      return { install_commands: [], entry_point_command: '', warnings, entry_uncertain: true };
  }
}

module.exports = {
  ALLOWED_COMMAND_PATTERNS,
  SAFE_SCRIPT_FILE,
  ENTRY_BLOCKED,
  validateAllowlistCommand,
  validateInstallCommandList,
  sanitizeEntryCommand,
  inferNodeEntryFromPackageJson,
  generateCommandsForRuntime,
};
