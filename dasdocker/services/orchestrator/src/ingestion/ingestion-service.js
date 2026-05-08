'use strict';

const path = require('path');
const fsp = require('fs').promises;

const githubResolver = require('./github-resolver');
const zipResolver = require('./zip-resolver');
const preScanner = require('./pre-scanner');

/**
 * Ingest untrusted GitHub HTTPS URL or ZIP bytes into `{workspaceRoot}/{sessionId}/source`.
 * WHY dedicated orchestration module: isolates hostile-input handling behind one audited state machine boundary.
 */

/**
 * @typedef {'github'|'zip'} IngestKind
 */

/**
 * @typedef {{
 *   sessionId: string,
 *   kind: IngestKind,
 *   githubUrl?: string,
 *   zipBuffer?: Buffer,
 *   workspaceRoot: string,
 *   logger?: Console,
 *   transition: (sid: string, state: string, meta?: Record<string, unknown>) => Promise<void>|void,
 *   emit?: (evt: string, payload: Record<string, unknown>) => Promise<void>|void,
 *   github?: { spawnImpl?: import('child_process').SpawnFunction },
 *   preScan?: { spawnImpl?: import('child_process').SpawnFunction, skip?: boolean, env?: NodeJS.ProcessEnv },
 * }} IngestArgs
 */

/**
 * @param {string} sid
 */
function assertSessionId(sid) {
  if (typeof sid !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(sid)) {
    throw new Error('ingestion-service: invalid sessionId');
  }
}

/**
 * @param {IngestArgs} args
 */
async function runIngestion(args) {
  const {
    sessionId,
    kind,
    githubUrl,
    zipBuffer,
    workspaceRoot,
    logger = console,
    transition,
    emit = async () => {},
  } = args;

  assertSessionId(sessionId);
  /* WHY same directory layout every time — Agent 07 detection engine reads ONE stable subtree path. */
  const sessionRoot = path.join(workspaceRoot, sessionId);
  const sourceDir = path.join(sessionRoot, 'source');

  const fail = async (reason, extra = {}) => {
    logger.error?.({ msg: 'ingestion:failed', sessionId, reason, ...extra });
    try {
      await fsp.rm(sessionRoot, { recursive: true, force: true });
    } catch (e) {
      logger.warn?.({ msg: 'ingestion:cleanup_partial', sessionId, err: String(e) });
    }
    await transition(sessionId, 'FAILED', { failure_reason: reason, ...extra });
  };

  const succeed = async () => {
    await transition(sessionId, 'PROVISIONING', { source_root: sourceDir });
    await emit('ingestion:complete', { sessionId, sourceTreePath: sourceDir, kind });
  };

  await fsp.rm(sessionRoot, { recursive: true, force: true });
  await fsp.mkdir(sessionRoot, { recursive: true });
  /* WHY omit mkdir(sourceDir) for git: git clone writes the directory; ZIP path creates it inside extractZipBuffer */

  try {
    if (kind === 'github') {
      const r = await githubResolver.cloneGithubRepository({
        url: githubUrl,
        destDir: sourceDir,
        logger,
        spawnImpl: args.github?.spawnImpl,
      });
      if (!r.ok) {
        await fail(r.reason, { detail: r.detail });
        return { ok: false, reason: r.reason, detail: r.detail };
      }
    } else if (kind === 'zip') {
      const r = await zipResolver.extractZipBuffer(zipBuffer, sourceDir);
      if (!r.ok) {
        await fail(r.reason, { detail: r.detail });
        return { ok: false, reason: r.reason, detail: r.detail };
      }
    } else {
      await fail('INGEST_UNKNOWN_KIND', { kind });
      return { ok: false, reason: 'INGEST_UNKNOWN_KIND' };
    }

    if (!args.preScan?.skip) {
      const clam = await preScanner.scanTreeWithClamAV(sourceDir, {
        spawnImpl: args.preScan?.spawnImpl,
        logger,
      });
      if (!clam.ok) {
        if (clam.reason === 'MALWARE_DETECTED') {
          logger.error?.({
            msg: 'ingestion:malware',
            sessionId,
            detections: clam.detections,
          });
        }
        await fail(clam.reason === 'MALWARE_DETECTED' ? 'MALWARE_DETECTED' : clam.reason, {
          detail: clam.reason === 'MALWARE_DETECTED' ? clam.detections?.join('; ') : clam.detail,
        });
        return { ok: false, reason: clam.reason === 'MALWARE_DETECTED' ? 'MALWARE_DETECTED' : clam.reason };
      }

      const vt = await preScanner.optionalVirusTotalScan(sourceDir, {
        env: args.preScan?.env,
        fetchImpl: global.fetch,
      });
      if (!vt.ok) {
        await fail(vt.reason, { detail: vt.detail });
        return { ok: false, reason: vt.reason, detail: vt.detail };
      }
    }

    await succeed();
    return { ok: true, sourceTreePath: sourceDir };
  } catch (e) {
    await fail('INGEST_INTERNAL_ERROR', { detail: String(e) });
    return { ok: false, reason: 'INGEST_INTERNAL_ERROR', detail: String(e) };
  }
}

/**
 * Exported for tests — deterministic source path contract for Agent 07.
 */
function resolveIngestPaths(workspaceRoot, sessionId) {
  assertSessionId(sessionId);
  const sessionRoot = path.join(workspaceRoot, sessionId);
  return {
    sessionRoot,
    sourceTreePath: path.join(sessionRoot, 'source'),
  };
}

module.exports = {
  runIngestion,
  resolveIngestPaths,
};
