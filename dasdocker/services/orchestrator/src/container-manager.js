'use strict';

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const { provisionStorage, verifyStorageDestroyed, appendDestroyAuditLog } = require('./storage-controller');
const { dockerResourceCliArgs } = require('./resource-enforcer');
const { ENTRY_BLOCKED } = require('./runtime-detection/command-generator');

/**
 * Baseline hardening (Agent 02 / 03 / 09) — applied as a single argv prefix for `docker create`.
 * WHY no per-session overrides: ZTA lease — widening seccomp/network/tmpfs requires Squad A ADR (Rule 1).
 */
const DEFAULT_SECCOMP = '/etc/dasdocker/security/seccomp-dasdocker.json';
const DEFAULT_NETWORK = 'dasdocker-isolated';

/** Image map is static (operator-owned registry pins) — never derived from user repo content. */
const RUNTIME_IMAGE = {
  nodejs: 'node:20-alpine',
  python: 'python:3.12-alpine',
  go: 'golang:1.22-alpine',
  rust: 'rust:1.76-alpine',
  java: 'eclipse-temurin:17-jdk-alpine',
  ruby: 'ruby:3.3-alpine',
  php: 'php:8.3-cli-alpine',
  unknown: 'alpine:3.19',
  dotnet: 'mcr.microsoft.com/dotnet/sdk:8.0-alpine',
};

/** @typedef {{ type: string, session_id: string, from: string, to: string, timestamp: string, reason?: string }} StateChangeEvt */

class SessionEventBus extends EventEmitter {
  /** @param {StateChangeEvt} payload */
  emitStateChange(payload) {
    this.emit('state_change', payload);
    this.emit(`session:${payload.session_id}`, payload);
  }
}

/**
 * Structural guard on entry — mirrors detection-time policy (duplicate cheap safety).
 *
 * @param {string} entryCmd
 */
function assertSafeEntry(entryCmd) {
  if (typeof entryCmd !== 'string' || !entryCmd.trim()) throw new Error('ENTRY_EMPTY');
  if (ENTRY_BLOCKED.test(entryCmd)) throw new Error('ENTRY_STRUCTURAL_REJECT');
}

/** @typedef {Record<string, unknown> & {
 *   session_id: string,
 *   runtime: string,
 *   install_commands: string[],
 *   entry_point_command: string
 * }} RuntimeSpec */

/**
 * WHITELIST schema snapshot for docker-bound RuntimeSpec payloads (nothing user-freeform enters Docker CLI).
 *
 * @param {unknown} spec
 * @returns {{ ok: true, spec: RuntimeSpec } | { ok: false, reason: string }}
 */
function validateRuntimeSpecSchema(spec) {
  if (!spec || typeof spec !== 'object') return { ok: false, reason: 'RUNTIME_SPEC_INVALID' };
  const s = /** @type {Record<string, unknown>} */ (spec);
  if (typeof s.session_id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(s.session_id)) {
    return { ok: false, reason: 'SESSION_ID_INVALID' };
  }
  const allowedRt = new Set(['nodejs', 'python', 'go', 'rust', 'java', 'ruby', 'php', 'dotnet', 'unknown']);
  if (typeof s.runtime !== 'string' || !allowedRt.has(s.runtime)) return { ok: false, reason: 'RUNTIME_ENUM_INVALID' };
  if (!Array.isArray(s.install_commands) || !s.install_commands.every((c) => typeof c === 'string')) {
    return { ok: false, reason: 'INSTALL_COMMANDS_INVALID' };
  }
  if (typeof s.entry_point_command !== 'string') return { ok: false, reason: 'ENTRY_INVALID' };
  return { ok: true, spec: /** @type {RuntimeSpec} */ (spec) };
}

function baselineSecurityCliArgs() {
  if (process.env.DASDOCKER_INTEGRATION_SKIP_BASELINE === '1') {
    return ['--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL'];
  }
  const seccomp = process.env.DASDOCKER_SECCOMP_PATH || DEFAULT_SECCOMP;
  return [
    '--security-opt',
    `seccomp=${seccomp}`,
    '--security-opt',
    'apparmor=dasdocker-container',
    '--security-opt',
    'no-new-privileges:true',
    '--cap-drop',
    'ALL',
  ];
}

/**
 * @param {string[]} argv
 */
function dockerRunArgv(argv) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('docker', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function inspectContainerRunning(dockerName) {
  const r = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', dockerName], { encoding: 'utf8' });
  return r.status === 0 && String(r.stdout || '').trim() === 'true';
}

function entryActiveFilePresent(containerName) {
  const r = spawnSync(
    'docker',
    ['exec', '-u', '1000:1000', containerName, 'sh', '-c', 'test -f /tmp/dasdocker-entry-active'],
    { encoding: 'utf8' },
  );
  return r.status === 0;
}

/**
 * @param {string} containerName
 * @param {(s: string) => void} [streamLogs]
 */
function dockerExecStreaming(containerName, shellLine, streamLogs) {
  return new Promise((resolve) => {
    const args = ['exec', '-u', '1000:1000', '-w', '/workspace/source', containerName, 'sh', '-c', shellLine];
    let stdout = '';
    let stderr = '';
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (c) => {
      const t = c.toString();
      stdout += t;
      streamLogs?.(t);
    });
    child.stderr.on('data', (c) => {
      const t = c.toString();
      stderr += t;
      streamLogs?.(t);
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * WHY trap + marker file: satisfies “poll every 5s” — `active` exists while child runs, removed on exit for any reason.
 *
 * @param {string} containerName
 * @param {string} entryCmd
 */
async function launchEntryDetached(containerName, entryCmd) {
  assertSafeEntry(entryCmd);
  const script = [
    "trap 'rm -f /tmp/dasdocker-entry-active' EXIT INT HUP TERM",
    'touch /tmp/dasdocker-entry-active',
    'cd /workspace/source || exit 3',
    `${entryCmd} >> /tmp/dasdocker-entry.log 2>&1`,
  ].join('; ');
  return dockerRunArgv([
    'exec',
    '-d',
    '-u',
    '1000:1000',
    '-w',
    '/workspace/source',
    containerName,
    'sh',
    '-c',
    script,
  ]);
}

/**
 * @typedef {{
 *   sessionId: string,
 *   runtimeSpec: RuntimeSpec,
 *   sourceHostPath: string,
 *   transition: (sid: string, to: string, meta?: Record<string, unknown>) => Promise<void>|void,
 *   stateBus?: SessionEventBus,
 *   logSink?: (line: string) => void,
 *   unregister?: () => void,
 * }} ProvisionCtx
 */

/**
 * @param {ProvisionCtx} ctx
 * @returns {Promise<{ containerId: string, containerName: string, image: string }>}
 */
async function provisionContainer(ctx) {
  const v = validateRuntimeSpecSchema(ctx.runtimeSpec);
  if (!v.ok) throw Object.assign(new Error(v.reason), { code: v.reason });

  const { containerName, dockerCliArgs: storageCli } = provisionStorage(ctx.sessionId);
  const emit = (from, to, reason) =>
    ctx.stateBus?.emitStateChange({
      type: 'state_change',
      session_id: ctx.sessionId,
      from,
      to,
      timestamp: new Date().toISOString(),
      reason: reason || '',
    });

  emit('QUEUED', 'PROVISIONING', 'docker_provision');
  await ctx.transition(ctx.sessionId, 'PROVISIONING', { phase: 'docker_create' });

  const img = RUNTIME_IMAGE[/** @type {keyof typeof RUNTIME_IMAGE} */ (ctx.runtimeSpec.runtime)] || RUNTIME_IMAGE.unknown;
  const net =
    process.env.DASDOCKER_INTEGRATION_SKIP_NETWORK === '1' ? ['--network', 'bridge'] : ['--network', DEFAULT_NETWORK];

  const dockerCreateArgs = [
    'create',
    '--init',
    '--read-only',
    '--user',
    '1000:1000',
    '-w',
    '/workspace/source',
    ...baselineSecurityCliArgs(),
    ...net,
    ...dockerResourceCliArgs(),
    ...storageCli,
    img,
    'sleep',
    'infinity',
  ];

  ctx.logSink?.(`[docker] create ${containerName}\n`);
  let r = await dockerRunArgv(dockerCreateArgs);
  if (r.code !== 0) {
    emit('PROVISIONING', 'FAILED', r.stderr.slice(0, 400));
    await ctx.transition(ctx.sessionId, 'FAILED', { failure_reason: 'DOCKER_CREATE_FAILED', detail: r.stderr });
    throw new Error(`DOCKER_CREATE_FAILED: ${r.stderr}`);
  }

  const cid = String(r.stdout || '').trim();
  const st = await dockerRunArgv(['start', cid]);
  if (st.code !== 0) {
    emit('PROVISIONING', 'FAILED', st.stderr.slice(0, 400));
    await ctx.transition(ctx.sessionId, 'FAILED', { failure_reason: 'DOCKER_START_FAILED', detail: st.stderr });
    throw new Error(`DOCKER_START_FAILED: ${st.stderr}`);
  }

  const cp = await dockerRunArgv(['cp', path.join(ctx.sourceHostPath, '.'), `${cid}:/workspace/source/`]);
  if (cp.code !== 0) {
    emit('PROVISIONING', 'FAILED', 'docker_cp_failed');
    await dockerRunArgv(['rm', '-f', cid]);
    await ctx.transition(ctx.sessionId, 'FAILED', { failure_reason: 'SOURCE_SEED_FAILED', detail: cp.stderr });
    throw new Error(`DOCKER_CP_FAILED: ${cp.stderr}`);
  }

  return { containerId: cid, containerName, image: img };
}

/**
 * @returns {Promise<boolean>} `true` if INSTALLING_DEPS ran
 * @param {{ containerName: string }} provisioned
 * @param {ProvisionCtx} ctx
 */
async function installDependenciesSequential(provisioned, ctx) {
  const cmds = ctx.runtimeSpec.install_commands || [];
  if (cmds.length === 0) {
    ctx.stateBus?.emitStateChange({
      type: 'state_change',
      session_id: ctx.sessionId,
      from: 'PROVISIONING',
      to: 'RUNNING',
      timestamp: new Date().toISOString(),
      reason: 'skip_install_empty',
    });
    await ctx.transition(ctx.sessionId, 'RUNNING', { phase: 'no_install_commands' });
    return false;
  }

  ctx.stateBus?.emitStateChange({
    type: 'state_change',
    session_id: ctx.sessionId,
    from: 'PROVISIONING',
    to: 'INSTALLING_DEPS',
    timestamp: new Date().toISOString(),
    reason: 'exec_install_chain',
  });
  await ctx.transition(ctx.sessionId, 'INSTALLING_DEPS');

  const nameRef = provisioned.containerName;
  let idx = 0;
  for (const cmd of cmds) {
    idx += 1;
    if (/[;&|$\`<>]/.test(cmd)) {
      ctx.stateBus?.emitStateChange({
        type: 'state_change',
        session_id: ctx.sessionId,
        from: 'INSTALLING_DEPS',
        to: 'FAILED',
        timestamp: new Date().toISOString(),
        reason: 'install_command_rejected',
      });
      await ctx.transition(ctx.sessionId, 'FAILED', { failure_reason: 'INSTALL_COMMAND_REJECTED', detail: cmd });
      await dockerRunArgv(['rm', '-f', nameRef]);
      throw new Error('INSTALL_COMMAND_REJECTED');
    }
    ctx.logSink?.(`[install ${idx}/${cmds.length}] ${cmd}\n`);
    const ex = await dockerExecStreaming(nameRef, cmd, ctx.logSink);
    if (ex.code !== 0) {
      ctx.stateBus?.emitStateChange({
        type: 'state_change',
        session_id: ctx.sessionId,
        from: 'INSTALLING_DEPS',
        to: 'FAILED',
        timestamp: new Date().toISOString(),
        reason: `install_exit_${ex.code}`,
      });
      await ctx.transition(ctx.sessionId, 'FAILED', {
        failure_reason: 'INSTALL_COMMAND_FAILED',
        detail: `${cmd}:${ex.stderr.slice(0, 800)}`,
      });
      await dockerRunArgv(['rm', '-f', nameRef]);
      throw Object.assign(new Error('INSTALL_COMMAND_FAILED'), { cmd, stderr: ex.stderr });
    }
  }
  return true;
}

/**
 * @param {{ containerName: string }} provisioned
 * @param {ProvisionCtx} ctx
 * @param {boolean} didInstallDeps
 * @param {number} [pollMs]
 */
async function markRunningWithEntryPolling(provisioned, ctx, didInstallDeps, pollMs = 5000) {
  const nameRef = provisioned.containerName;

  if (didInstallDeps) {
    ctx.stateBus?.emitStateChange({
      type: 'state_change',
      session_id: ctx.sessionId,
      from: 'INSTALLING_DEPS',
      to: 'RUNNING',
      timestamp: new Date().toISOString(),
      reason: 'deps_ok',
    });
    await ctx.transition(ctx.sessionId, 'RUNNING');
  }

  await launchEntryDetached(nameRef, ctx.runtimeSpec.entry_point_command);
  await new Promise((r) => setTimeout(r, 400));

  const deadline = Date.now() + Number(process.env.DASDOCKER_ENTRY_POLL_DEADLINE_MS || 86400000);
  let seenActive = false;
  while (Date.now() < deadline) {
    if (!inspectContainerRunning(nameRef)) {
      await finalizeDestroyAfterEntry(ctx, nameRef, 'container_stopped');
      return;
    }
    const active = entryActiveFilePresent(nameRef);
    if (active) seenActive = true;
    if (seenActive && !active) {
      await finalizeDestroyAfterEntry(ctx, nameRef, 'entry_exited');
      return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function finalizeDestroyAfterEntry(ctx, nameRef, reason) {
  await destroyContainer({ sessionId: ctx.sessionId, containerName: nameRef }, reason, ctx);
  ctx.unregister?.();
}

/**
 * Hard destroy (TTL / watchdog) — idempotent `docker rm`.
 *
 * @param {{ sessionId: string, containerName: string }} target
 * @param {string} reason
 * @param {{ transition?: Function, stateBus?: SessionEventBus, logSink?: (line: string) => void, auditLogPath?: string, manualReviewTrigger?: Function }} ctx
 */
async function destroyContainer(target, reason, ctx = {}) {
  ctx.stateBus?.emitStateChange({
    type: 'state_change',
    session_id: target.sessionId,
    from: 'RUNNING',
    to: 'DESTROYING',
    timestamp: new Date().toISOString(),
    reason,
  });
  if (typeof ctx.transition === 'function') await ctx.transition(target.sessionId, 'DESTROYING', { reason });
  const rm = await dockerRunArgv(['rm', '-f', target.containerName]);
  const storageCheck = verifyStorageDestroyed(target.sessionId);
  if (!storageCheck.ok) {
    const critical = `[CRITICAL] storage residue detected for session=${target.sessionId}: ${storageCheck.detail}\n`;
    if (typeof ctx.logSink === 'function') ctx.logSink(critical);
    else process.stderr.write(critical);
    if (typeof ctx.manualReviewTrigger === 'function') {
      await Promise.resolve(ctx.manualReviewTrigger({ sessionId: target.sessionId, reason, detail: storageCheck.detail }));
    }
  }
  const audit = appendDestroyAuditLog(
    {
      timestamp: new Date().toISOString(),
      event: 'container_destroyed',
      session_id: target.sessionId,
      reason,
      storage_verified_clean: storageCheck.ok,
      container_id: target.containerName,
    },
    ctx.auditLogPath,
  );
  if (!audit.ok) {
    const warn = `[warn] failed to write audit log for session=${target.sessionId}: ${audit.detail}\n`;
    if (typeof ctx.logSink === 'function') ctx.logSink(warn);
    else process.stderr.write(warn);
  }
  if (rm.code !== 0) {
    const err = `DOCKER_RM_FAILED: ${rm.stderr || rm.stdout}`;
    if (typeof ctx.transition === 'function') await ctx.transition(target.sessionId, 'FAILED', { reason: err });
    throw new Error(err);
  }
  ctx.stateBus?.emitStateChange({
    type: 'state_change',
    session_id: target.sessionId,
    from: 'DESTROYING',
    to: 'DESTROYED',
    timestamp: new Date().toISOString(),
    reason,
  });
  if (typeof ctx.transition === 'function') await ctx.transition(target.sessionId, 'DESTROYED', { reason });
}

module.exports = {
  SessionEventBus,
  RUNTIME_IMAGE,
  DEFAULT_SECCOMP,
  DEFAULT_NETWORK,
  validateRuntimeSpecSchema,
  provisionContainer,
  installDependenciesSequential,
  markRunningWithEntryPolling,
  destroyContainer,
  dockerRunArgv,
  inspectContainerRunning,
  baselineSecurityCliArgs,
  assertSafeEntry,
};
