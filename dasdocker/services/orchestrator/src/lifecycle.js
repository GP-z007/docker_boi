'use strict';

const {
  provisionContainer,
  installDependenciesSequential,
  markRunningWithEntryPolling,
  destroyContainer,
  dockerRunArgv,
} = require('./container-manager');
const { setSessionTtl, ensureKeyspaceExpiryNotifications, subscribeSessionTtlExpired } = require('./self-destruct');
const { resolveIngestPaths } = require('./ingestion/ingestion-service');
const { detectRuntimeSpec } = require('./runtime-detection/detector');

/** @type Map<string,{containerName:string,containerId:string}> */
const sessionRegistry = new Map();

function getSessionHandle(sessionId) {
  return sessionRegistry.get(sessionId);
}

function registerSessionHandle(sessionId, handle) {
  sessionRegistry.set(sessionId, handle);
}

function unregisterSessionHandle(sessionId) {
  sessionRegistry.delete(sessionId);
}

/**
 * WHY centralised destroyer: TTL + watchdog converge here so `dasdocker-sess-{id}` is always reachable without user input.
 */
async function destroySessionContainer(sessionId, reason, opts = {}) {
  const h = getSessionHandle(sessionId);
  const name = h?.containerName || `dasdocker-sess-${sessionId}`;
  try {
    await destroyContainer({ sessionId, containerName: name }, reason, opts);
  } finally {
    unregisterSessionHandle(sessionId);
    /* Best-effort: ensure label-stamped name removed even if registry missed */
    await dockerRunArgv(['rm', '-f', name]);
  }
}

async function provisionFromDetectedTree(cfg) {
  const paths = resolveIngestPaths(cfg.workspaceRoot, cfg.sessionId);
  const det = detectRuntimeSpec({ sessionId: cfg.sessionId, sourceRoot: paths.sourceTreePath });
  if (!det.ok || !det.spec) {
    await cfg.transition(cfg.sessionId, 'FAILED', {
      failure_reason: det.failure_reason || 'RUNTIME_UNDETECTABLE',
    });
    throw Object.assign(new Error(det.failure_reason || 'RUNTIME_UNDETECTABLE'), { detail: det });
  }

  /** @type {import('./container-manager').ProvisionCtx} */
  const pctx = {
    sessionId: cfg.sessionId,
    runtimeSpec: det.spec,
    sourceHostPath: paths.sourceTreePath,
    transition: cfg.transition,
    stateBus: cfg.stateBus,
    logSink: cfg.logSink,
    unregister: () => unregisterSessionHandle(cfg.sessionId),
  };

  /** @type {null | Awaited<ReturnType<typeof provisionContainer>>} */
  let prov = null;

  try {
    prov = await provisionContainer(pctx);
    registerSessionHandle(cfg.sessionId, {
      containerName: prov.containerName,
      containerId: prov.containerId,
    });

    if (cfg.redis && cfg.ttlSeconds) {
      await ensureKeyspaceExpiryNotifications(cfg.redis);
      await setSessionTtl(cfg.redis, cfg.sessionId, cfg.ttlSeconds);
    }

    const didInstall = await installDependenciesSequential(prov, pctx);
    await markRunningWithEntryPolling(prov, pctx, didInstall);
  } catch (e) {
    if (prov?.containerName) await dockerRunArgv(['rm', '-f', prov.containerName]);
    unregisterSessionHandle(cfg.sessionId);
    throw e;
  }
}

function attachTtlExpirationHandler(redis, hooks) {
  return subscribeSessionTtlExpired(redis, async (sessionId, cause) => {
    await hooks.destroy(sessionId, cause || 'ttl-expired');
  });
}

module.exports = {
  sessionRegistry,
  getSessionHandle,
  registerSessionHandle,
  unregisterSessionHandle,
  destroySessionContainer,
  provisionFromDetectedTree,
  attachTtlExpirationHandler,
  setSessionTtl,
  subscribeSessionTtlExpired,
  ensureKeyspaceExpiryNotifications,
};
