'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const sm = require('../state-machine');
const { checkPostSessionsPerMinute, deriveClientIp } = require('../middleware/rate-limiter');

/** [Rule 1] GitHub HTTPS URL only — blocks scheme downgrade & non-GitHub hosts (T-S08-001 class). */
const SOURCE_URL_RE =
  /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\.git)?$/;

const MAX_CONCURRENT_SESSIONS = 50;
const MAX_POST_PER_MINUTE = 5;

/**
 * Schema validation for POST /sessions (unit-tested surface).
 * @param {unknown} body
 * @returns {{ source_url: string, ttl_seconds: number, source_type: 'github'|'zip' }}
 */
function validateCreatePayload(body) {
  if (!body || typeof body !== 'object') {
    throw Object.assign(new Error('INVALID_BODY'), { code: 'INVALID_BODY' });
  }
  /** @type {Record<string, unknown>} */
  const b = /** @type {Record<string, unknown>} */ (body);
  const source_url = b.source_url;
  const ttl_seconds = b.ttl_seconds;
  const source_type = b.source_type;

  if (typeof source_url !== 'string' || !SOURCE_URL_RE.test(source_url)) {
    throw Object.assign(new Error('INVALID_SOURCE_URL'), { code: 'INVALID_SOURCE_URL' });
  }
  if (
    typeof ttl_seconds !== 'number' ||
    !Number.isInteger(ttl_seconds) ||
    ttl_seconds < 60 ||
    ttl_seconds > 3600
  ) {
    throw Object.assign(new Error('INVALID_TTL'), { code: 'INVALID_TTL' });
  }
  if (source_type !== 'github' && source_type !== 'zip') {
    throw Object.assign(new Error('INVALID_SOURCE_TYPE'), { code: 'INVALID_SOURCE_TYPE' });
  }
  return {
    source_url,
    ttl_seconds,
    /** @type {'github'|'zip'} */
    source_type,
  };
}

/**
 * Scan Redis for `{ id, state, meta }` summaries (watchdog reconciliation).
 *
 * @param {import('ioredis').Redis} redis
 */
async function listManagedSessions(redis) {
  const pattern = `${sm.PREFIX}*:state`;
  const out = /** @type {Array<{ id: string, state: string, meta: Record<string, unknown>|null }>} */ ([]);
  let cursor = '0';
  do {
    /** @type {[string, string[]]} */
    const tuple = /** @type {any} */ (await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 64));
    cursor = tuple[0];
    for (const rk of tuple[1]) {
      /** @expect dasdocker:sess:{uuid}:state */
      const m = rk.match(/^dasdocker:sess:([0-9a-f-]+):state$/i);
      if (!m || !sm.UUID_RE.test(m[1])) continue;
      const id = m[1];
      const state = await redis.get(rk);
      const meta = await sm.getMeta(redis, id);
      out.push({ id, state: state || 'UNKNOWN', meta });
    }
  } while (cursor !== '0');
  return out;
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{
 *   redis: import('ioredis').Redis,
 *   authVerifier: ReturnType<import('../middleware/auth').createAuthVerifier>,
 *   trustProxy: boolean,
 *   lifecycleHooks?: {
 *     enqueueProvision?: (id: string) => Promise<void>,
 *     runSessionTeardown?: (id: string, reason: string) => Promise<void>, // Docker + Redis terminal (Agent 08)
 *   } | null | undefined,
 * }} opts
 */
async function sessionRoutes(fastify, opts) {
  const { redis } = opts;
  const verifier = opts.authVerifier;
  const trustProxy = Boolean(opts.trustProxy);
  const lifecycleHooks = opts.lifecycleHooks || null;

  function logAuthFailure(reason, request, extra = {}) {
    /** [Rule 1] Structured rejection — NEVER log Bearer token payloads */
    request.log.warn(
      Object.assign({ reason, ts: new Date().toISOString(), ip: deriveClientIp(request, trustProxy) }, extra),
    );
  }

  async function authorize(request, requiredScopes, routeCtx = {}) {
    try {
      const claims = await verifier.authenticate(request.headers);
      verifier.assertScopesAndSession(claims, requiredScopes, routeCtx);
      /** [Rule 1] attach sanitized auth — never forward raw JWT downstream */
      const { parseScopes } = require('../middleware/auth');
      request.auth = { scopes: parseScopes(claims), claims };
      return claims;
    } catch (e) {
      logAuthFailure(e instanceof Error ? e.message : String(e), request);
      throw e;
    }
  }

  /**
   * [Rule 1] Destroyed-terminal sessions deny read amplification (replay-class).
   *
   * @returns {Promise<'ok'>}
   */
  async function assertReadableSession(sessionId) {
    const st = await sm.getState(redis, sessionId);
    if (st === null) {
      /** @example unknown id */
      const err = new Error('NOT_FOUND');
      // @ts-ignore
      err.statusCode = 404;
      throw err;
    }
    if (st === 'DESTROYED') {
      const err = new Error('SESSION_TERMINATED');
      // @ts-ignore
      err.statusCode = 403;
      throw err;
    }
    return 'ok';
  }

  fastify.get('/', async (request, reply) => {
    await authorize(request, '', {
      /** [Rule 1] Bearer must carry `system:watchdog` minted from Vault — no `sess` binding */
      watchdogOnlyRoute: true,
    });
    /** @todo Route through service mesh auth + mTLS in prod (Deliverable roadmap) */
    const rows = await listManagedSessions(redis);
    return reply.send({
      sessions: rows,
      fetched_at: new Date().toISOString(),
    });
  });

  fastify.post('/', async (request, reply) => {
    await authorize(request, 'session:create');
    /** [Rule 1] Rate-limit identity from socket unless ops enables TRUST_PROXY=1 — documented in middleware */
    const ipKey = deriveClientIp(request, trustProxy);
    const okRl = await checkPostSessionsPerMinute(redis, ipKey, 60_000, MAX_POST_PER_MINUTE);
    if (!okRl) {
      logAuthFailure('rate_limit_post_sessions', request, { metric: MAX_POST_PER_MINUTE });
      return reply.code(429).send({
        code: 'RATE_LIMIT_POST_SESSION',
        error: 'Too Many Requests',
      });
    }

    let payload;
    try {
      payload = validateCreatePayload(request.body);
    } catch (e) {
      // @ts-expect-error narrow
      return reply.code(400).send({ error: /** @type {Error} */ (e).message, code: e.code || 'BAD_REQUEST' });
    }

    /** [Rule 1] Capacity enforced before state write — aligns with LUA gate in redis */
    const slotOk = await sm.acquireSessionSlot(redis, MAX_CONCURRENT_SESSIONS);
    if (!slotOk) {
      return reply.code(503).send({
        code: 'SESSION_CAPACITY_EXHAUSTED',
        error: 'Service Unavailable — maximum concurrent sandbox sessions reached',
      });
    }

    const sessionId = crypto.randomUUID();
    const meta = {
      created_at: new Date().toISOString(),
      source_url: payload.source_url,
      ttl_seconds: payload.ttl_seconds,
      source_type: payload.source_type,
    };

    try {
      await sm.bootstrapQueuedSession(redis, {
        sessionId,
        meta,
        ttlSeconds: payload.ttl_seconds,
      });
    } catch (e) {
      await sm.rollbackSessionSlot(redis).catch(() => {});
      throw e;
    }

    /** Agent 08: async provision pipeline hooks into Docker */
    if (lifecycleHooks && typeof lifecycleHooks.enqueueProvision === 'function') {
      setImmediate(() => {
        lifecycleHooks.enqueueProvision(sessionId).catch((err) => fastify.log.error({ err }, 'lifecycle provision'));
      });
    }

    return reply.code(201).send({
      id: sessionId,
      state: 'QUEUED',
      ttl_seconds: payload.ttl_seconds,
      source_url: payload.source_url,
      source_type: payload.source_type,
    });
  });

  fastify.get('/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;
    if (!sm.UUID_RE.test(sessionId)) {
      return reply.code(400).send({ error: 'INVALID_SESSION_ID' });
    }
    await authorize(request, 'session:read', {
      /** [Rule 1] User JWT must bind to path param — rejects cross-session reads */
      sessionPathId: sessionId,
    });

    /** [Rule 1] Replay JWT after destroy ⇒ 403, not stale 200 metadata */
    try {
      await assertReadableSession(sessionId);
    } catch (e) {
      const code = /** @type {Error&{statusCode?:number}} */ (e).statusCode || 500;
      if (code === 404) return reply.code(404).send({ error: 'NOT_FOUND', code });
      return reply.code(403).send({ error: /** @type {Error} */ (e).message, code: 'SESSION_READ_DENIED' });
    }

    const state = await sm.getState(redis, sessionId);
    const meta = await sm.getMeta(redis, sessionId);
    return reply.send({
      id: sessionId,
      state,
      meta,
    });
  });

  fastify.delete('/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;
    if (!sm.UUID_RE.test(sessionId)) {
      return reply.code(400).send({ error: 'INVALID_SESSION_ID' });
    }

    /** @note claims optional until authorize — parse twice for watchdog shortcut */
    const claims = await verifier.authenticate(request.headers);
    const { parseScopes } = require('../middleware/auth');
    const scopes = parseScopes(claims);

    /** [Rule 1] Operators bind `sess`; watchdog uses only `system:watchdog` (no cross-user destroy) */
    const isWatchdog = scopes.has('system:watchdog');
    const isOperatorDestroy = scopes.has('session:destroy') && claims.sess === sessionId;

    if (!isWatchdog && !isOperatorDestroy) {
      verifier.assertScopesAndSession(claims, 'session:destroy', { sessionPathId: sessionId });
    }

    /** @todo Multi-replica quorum lock before SIGKILL — see Agent 08 handoff */
    const prev = await sm.getState(redis, sessionId);
    if (prev === null) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }
    if (prev === 'DESTROYED') {
      return reply.code(204).send();
    }

    /** Agent 08 wired path — single orchestrated destructor (SIGKILL semantics inside docker layer) */
    if (lifecycleHooks && typeof lifecycleHooks.runSessionTeardown === 'function') {
      try {
        await lifecycleHooks.runSessionTeardown(sessionId, isWatchdog ? 'watchdog' : 'api-delete');
      } catch (e) {
        request.log.error({ err: /** @type {Error} */ (e), sessionId }, 'runSessionTeardown');
        /** [Rule 1] Teardown must converge to terminal state even if Docker API flakes */
        await sm.deleteExpireSignalKey(redis, sessionId).catch(() => {});
        if ((await sm.getState(redis, sessionId)) !== 'DESTROYED') {
          await sm.transition(redis, sessionId, 'DESTROYED').catch(() => {});
        }
      }
      return reply.code(202).send({
        id: sessionId,
        state: (await sm.getState(redis, sessionId)) || 'DESTROYED',
      });
    }

    /** Agent 05 scaffolding — Redis terminal path without daemon coupling */
    if (prev !== 'DESTROYING') {
      await sm.transition(redis, sessionId, 'DESTROYING');
    }

    await sm.deleteExpireSignalKey(redis, sessionId).catch(() => {});

    let final = await sm.getState(redis, sessionId);
    if (final !== 'DESTROYED') {
      await sm.transition(redis, sessionId, 'DESTROYED');
      final = 'DESTROYED';
    }

    return reply.code(202).send({ id: sessionId, state: final });
  });

  fastify.get('/:sessionId/logs', async (request, reply) => {
    const { sessionId } = request.params;
    if (!sm.UUID_RE.test(sessionId)) {
      return reply.code(400).send({ error: 'INVALID_SESSION_ID' });
    }
    await authorize(request, 'session:read', { sessionPathId: sessionId });
    try {
      await assertReadableSession(sessionId);
    } catch (e) {
      const code = /** @type {Error&{statusCode?:number}} */ (e).statusCode || 500;
      if (code === 404) return reply.code(404).send({ error: 'NOT_FOUND' });
      return reply.code(403).send({ error: 'SESSION_READ_DENIED' });
    }

    /** SSE — no buffering at reverse proxy when possible (T-S12-002) */
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (obj) => {
      reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    send({ type: 'session-log-open', sessionId, ts: new Date().toISOString() });
    /** [Rule 1] Heartbeats keep LB idle timers honest without shipping workload output */
    const hb = setInterval(() => send({ type: 'heartbeat', ts: new Date().toISOString() }), 15_000);
    reply.raw.flushHeaders?.();

    request.raw.on('close', () => clearInterval(hb));

    /** @note Agent 08 may pipe `docker logs` here — scaffold only */
    return new Promise(() => {});
  });

  /** Map auth + validation faults to stable HTTP statuses */
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof jwt.JsonWebTokenError) {
      return reply.code(401).send({
        code: 'UNAUTHORIZED',
        error: 'Invalid or malformed token',
      });
    }
    if (error instanceof sm.InvalidTransitionError) {
      return reply.code(409).send({ code: 'INVALID_TRANSITION', error: error.message });
    }
    request.log.error({ err: error }, 'sessions route fault');
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });
};


sessionRoutes.validateCreatePayload = validateCreatePayload;
module.exports = sessionRoutes;
