'use strict';

/**
 * dasDocker ephemeral storage controller (Phase 2 / Deliverable 2.3)
 *
 * WHY tmpfs (Rule 1 — ZTA, T-S04-001 persistence class):
 * - RAM-backed: workloads never dirty rotating rust for sandbox scratch unless the kernel swaps (disable
 *   swap for sandbox workers in ops runbooks); ciphertext never lands in a Docker named volume ledger.
 * - Lifetime-bound: tmpfs namespaces are torn down with the container mount ns — no separate "delete volume"
 *   step that might be deferred, mis-labelled, or forensically copied.
 * - No host path exposure: contrasts with bind mounts where a misplaced path leaks host filesystem-write
 *   (explicitly forbidden). Named volumes still allocate backing store under /var/lib/docker and can linger
 *   until pruned — failing the "provably gone" bar without extra machinery.
 *
 * Agent 08 MUST NOT add writable bind mounts for session paths; orchestrator merges these tmpfs specs only.
 */

const { spawnSync } = require('child_process');

const DEFAULT_WORKSPACE_MB = 512;
const DEFAULT_TMP_MB = 64;
const DEFAULT_UID = 1000;
const DEFAULT_GID = 1000;

/** @typedef {{ workspaceSizeMb?: number, tmpSizeMb?: number, uid?: number, gid?: number, namePrefix?: string }} StorageOptions */

/**
 * @param {string} sessionId
 * @returns {string}
 */
function sanitizeSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(sessionId)) {
    throw new Error('storage-controller: invalid sessionId (use alnum/._- , max 128 chars)');
  }
  return sessionId;
}

/**
 * provisionStorage — build Docker tmpfs fragments for a sandbox session.
 * @param {string} sessionId
 * @param {StorageOptions} [options]
 * @returns {{
 *   containerName: string,
 *   labels: Record<string, string>,
 *   hostConfigTmpfs: Record<string, string>,
 *   dockerCliArgs: string[],
 * }}
 */
function provisionStorage(sessionId, options = {}) {
  const sid = sanitizeSessionId(sessionId);
  const prefix = options.namePrefix || 'dasdocker-sess';
  const containerName = `${prefix}-${sid}`;
  const workspaceMb = options.workspaceSizeMb ?? DEFAULT_WORKSPACE_MB;
  const tmpMb = options.tmpSizeMb ?? DEFAULT_TMP_MB;
  const uid = options.uid ?? DEFAULT_UID;
  const gid = options.gid ?? DEFAULT_GID;

  const workspaceOpts = `rw,size=${workspaceMb}m,noexec,nosuid,nodev,uid=${uid},gid=${gid}`;
  const tmpOpts = `rw,size=${tmpMb}m,noexec,nosuid,nodev`;

  const hostConfigTmpfs = {
    '/workspace': workspaceOpts,
    '/tmp': tmpOpts,
  };

  const labels = {
    'dasdocker.session_id': sid,
    'dasdocker.storage': 'tmpfs-only',
  };

  const dockerCliArgs = [
    '--name',
    containerName,
    '--label',
    `dasdocker.session_id=${sid}`,
    '--label',
    'dasdocker.storage=tmpfs-only',
    '--tmpfs',
    `/workspace:${workspaceOpts}`,
    '--tmpfs',
    `/tmp:${tmpOpts}`,
  ];

  return {
    containerName,
    labels,
    hostConfigTmpfs,
    dockerCliArgs,
  };
}

/**
 * @param {{ sessionId: string, message: string, level?: 'info'|'warn'|'error' }} entry
 * @param {(line: string) => void} [sink]
 */
function emitAudit(entry, sink) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    component: 'storage-controller',
    sessionId: entry.sessionId,
    level: entry.level || 'info',
    message: entry.message,
  });
  if (typeof sink === 'function') {
    sink(line);
    return;
  }
  // Default sink: stdout (JSONL) — orchestrator should wire to structured audit pipeline (T-S02-003).
  process.stdout.write(`${line}\n`);
}

/**
 * verifyStorageDestroyed — post-`docker rm` checks: no container, no stray named volume, audit log line.
 * @param {string} sessionId
 * @param {{ auditSink?: (s: string) => void }} [ctx]
 * @returns {{ ok: boolean, detail: string }}
 */
function verifyStorageDestroyed(sessionId, ctx = {}) {
  const sid = sanitizeSessionId(sessionId);
  const namePrefix = ctx.namePrefix || 'dasdocker-sess';
  const containerName = `${namePrefix}-${sid}`;

  const inspect = spawnSync('docker', ['inspect', containerName], { encoding: 'utf8' });
  if (inspect.status === 0) {
    return { ok: false, detail: 'container still present after teardown' };
  }

  const vols = spawnSync('docker', ['volume', 'ls', '-q', '--filter', `label=dasdocker.session_id=${sid}`], {
    encoding: 'utf8',
  });
  const volLines = (vols.stdout || '').trim().split('\n').filter(Boolean);
  if (volLines.length > 0) {
    return { ok: false, detail: `unexpected volumes: ${volLines.join(',')}` };
  }

  emitAudit(
    {
      sessionId: sid,
      message: 'storage teardown verified: container absent, no session-labelled docker volume',
    },
    ctx.auditSink,
  );

  return { ok: true, detail: 'teardown verified' };
}

/**
 * getStorageMetrics — best-effort tmpfs utilisation via `df` inside the running container.
 * @param {string} containerId
 * @returns {{ workspace?: { size1K: number, used1K: number, avail1K: number }, tmp?: { size1K: number, used1K: number, avail1K: number }, raw?: string }}
 */
function getStorageMetrics(containerId) {
  if (typeof containerId !== 'string' || !containerId.trim()) {
    throw new Error('storage-controller: containerId required');
  }
  const id = containerId.trim();
  const df = spawnSync(
    'docker',
    ['exec', id, 'sh', '-c', 'df -Pk /workspace /tmp 2>/dev/null || df -k /workspace /tmp'],
    { encoding: 'utf8' },
  );
  if (df.status !== 0) {
    return { raw: df.stderr || df.stdout || 'df failed' };
  }
  const lines = (df.stdout || '').trim().split('\n');
  const out = { raw: df.stdout };
  for (const line of lines.slice(1)) {
    const p = line.trim().split(/\s+/);
    if (p.length < 6) continue;
    const mount = p[5];
    const block = { size1K: Number(p[1]), used1K: Number(p[2]), avail1K: Number(p[3]) };
    if (mount === '/workspace') out.workspace = block;
    if (mount === '/tmp') out.tmp = block;
  }
  return out;
}

module.exports = {
  provisionStorage,
  verifyStorageDestroyed,
  getStorageMetrics,
  emitAudit,
  DEFAULT_WORKSPACE_MB,
  DEFAULT_TMP_MB,
};
