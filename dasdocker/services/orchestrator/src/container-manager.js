'use strict';

/**
 * Container lifecycle — baseline profile (Agents 02/03/09). [Rule 1] Docker socket never inside sandboxes (T-S06-001).
 */

const { spawnSync } = require('child_process');
const path = require('path');

const sm = require('./state-machine');
const { provisionStorage, verifyStorageDestroyed, emitAudit } = require('./storage-controller');

const DEFAULT_NETWORK = process.env.DASDOCKER_NETWORK || 'dasdocker-isolated';
const DEFAULT_IMAGE = process.env.SANDBOX_IMAGE || 'alpine:3.19';
const SECCOMP_FALLBACK = path.resolve(__dirname, '../../../config/security/seccomp-dasdocker.json');
const SECCOMP_JSON = process.env.DASDOCKER_SECCOMP_JSON || SECCOMP_FALLBACK;
const APPARMOR_PROFILE = process.env.DASDOCKER_APPARMOR_PROFILE || 'dasdocker-container';
const DOCKER = process.env.DOCKER_BIN || 'docker';

function buildLifecycleHooks({ redis, logger }) {
  const log = logger || console;
  return {
    enqueueProvision: (sid) => runProvisionPipeline(redis, log, sid),
    runSessionTeardown: (sid, reason) => runSessionTeardown(redis, log, sid, reason),
  };
}

async function runProvisionPipeline(redis, log, sessionId) {
  try {
    await provisionContainer(redis, sessionId);
    await startContainer(redis, sessionId);
    await markRunning(redis, sessionId);
    log.info?.({ sessionId }, 'provision pipeline reached RUNNING');
  } catch (e) {
    log.error?.({ sessionId, err: /** @type {Error} */ (e).message }, 'provision pipeline abort');
    await runSessionTeardown(redis, log, sessionId, 'provision-error').catch(() => {});
    throw /** @type {Error} */ (e);
  }
}

async function runSessionTeardown(redis, log, sessionId, reason) {
  const prev = await sm.getState(redis, sessionId);
  if (!prev || prev === 'DESTROYED') return;

  if (prev !== 'DESTROYING') {
    await sm.transition(redis, sessionId, 'DESTROYING');
  }

  await destroyContainer(redis, sessionId, reason, log).catch((err) =>
    log.error?.({ sessionId, err: /** @type {Error} */ (err).message }, 'destroyContainer'),
  );

  await sm.deleteExpireSignalKey(redis, sessionId).catch(() => {});

  if ((await sm.getState(redis, sessionId)) !== 'DESTROYED') {
    try {
      await sm.transition(redis, sessionId, 'DESTROYED');
    } catch (e2) {
      log.error?.({ sessionId, err: /** @type {Error} */ (e2).message }, 'transition DESTROYED failed');
    }
  }
}

async function provisionContainer(redis, sessionId) {
  await sm.transition(redis, sessionId, 'PROVISIONING');

  const args = dockerCreateArgv(sessionId);
  const r = spawnSync(DOCKER, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`docker create failed: ${r.stderr?.trim?.() || String(r.signal)}`);
  }

  const cid = (r.stdout || '').trim();
  const storName = provisionStorage(sessionId).containerName;
  await sm.mergeMeta(redis, sessionId, {
    container_id: cid,
    container_name: storName,
  });
}

async function startContainer(redis, sessionId) {
  const meta = await sm.getMeta(redis, sessionId);
  const cid = meta?.container_id;
  if (!cid || typeof cid !== 'string') {
    throw new Error('missing container_id after provision');
  }

  dockerChecked(['start', cid]);
  await sm.transition(redis, sessionId, 'INSTALLING_DEPS');

  dockerChecked([
    'exec',
    cid,
    'sh',
    '-lc',
    'echo deps-no-op >/workspace/.deps-stamp 2>/dev/null || true',
  ]);
}

async function markRunning(redis, sessionId) {
  const meta = await sm.getMeta(redis, sessionId);
  const cid = meta?.container_id;
  if (!cid || typeof cid !== 'string') {
    throw new Error('container id missing');
  }

  const r = spawnSync(DOCKER, ['inspect', '--format={{.State.Running}}', cid], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`docker inspect failed: ${r.stderr}`);
  }
  if (!(r.stdout || '').trim().startsWith('true')) {
    throw new Error('container not running');
  }
  await sm.transition(redis, sessionId, 'RUNNING');
}

async function destroyContainer(redis, sessionId, reason, log) {
  emitAudit({ sessionId, message: `destroy reason=${reason}`, level: 'warn' });
  log.warn?.({ sessionId, reason }, 'SIGKILL teardown');

  const meta = await sm.getMeta(redis, sessionId);
  const cid = meta?.container_id;
  const name = provisionStorage(sessionId).containerName;

  if (typeof cid === 'string' && cid) {
    dockerChecked(['kill', '-s', 'SIGKILL', cid], { softFail: true });
    dockerChecked(['rm', '-f', cid], { softFail: true });
  }
  dockerChecked(['rm', '-f', name], { softFail: true });

  const v = verifyStorageDestroyed(sessionId);
  if (!v.ok) {
    log.error?.({ sessionId, detail: v.detail }, 'storage verification');
  }
}

function dockerCreateArgv(sessionId) {
  const stor = provisionStorage(sessionId);
  const ws = `rw,size=512m,noexec,nosuid,nodev,uid=1000,gid=1000`;
  const tm = `rw,size=64m,noexec,nosuid,nodev`;

  return [
    'create',
    '--network',
    DEFAULT_NETWORK,
    '--memory',
    '512m',
    '--memory-swap',
    '512m',
    '--cpus',
    '1.0',
    '--pids-limit',
    '100',
    '--read-only',
    '--tmpfs',
    `/workspace:${ws}`,
    '--tmpfs',
    `/tmp:${tm}`,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--security-opt',
    `seccomp=${SECCOMP_JSON}`,
    '--security-opt',
    `apparmor=${APPARMOR_PROFILE}`,
    '--ulimit',
    'nofile=1024:1024',
    '--ulimit',
    'nproc=100:100',
    '--restart',
    'no',
    '--user',
    '1000:1000',
    '--name',
    stor.containerName,
    '--label',
    `dasdocker.session_id=${sessionId}`,
    '--label',
    'dasdocker.storage=tmpfs-only',
    DEFAULT_IMAGE,
    'sleep',
    '86400',
  ];
}

function dockerChecked(args, opts = {}) {
  const r = spawnSync(DOCKER, args, { encoding: 'utf8' });
  const errText = `${r.stderr || ''}`;
  if (r.status === 0) return r.stdout;
  if (opts.softFail && /No such container/i.test(errText)) return r.stdout;
  throw new Error(`docker ${args.join(' ')} failed: ${errText || r.signal}`);
}

module.exports = {
  buildLifecycleHooks,
  provisionContainer,
  startContainer,
  markRunning,
  runSessionTeardown,
  destroyContainer,
};
