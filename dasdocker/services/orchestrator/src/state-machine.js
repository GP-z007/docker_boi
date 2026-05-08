'use strict';

/**
 * Redis-backed session state machine (Deliverable 2.6).
 * [Rule 1] Only orchestrator must mutate these keys; transitions are centralized to deny tampering.
 */

const PREFIX = 'dasdocker:sess:';

/** @typedef {'QUEUED'|'PROVISIONING'|'INSTALLING_DEPS'|'RUNNING'|'DESTROYING'|'DESTROYED'} SessionState */

const ALLOWED = {
  QUEUED: ['PROVISIONING', 'DESTROYING'],
  PROVISIONING: ['INSTALLING_DEPS', 'DESTROYING'],
  INSTALLING_DEPS: ['RUNNING', 'DESTROYING'],
  RUNNING: ['DESTROYING'],
  DESTROYING: ['DESTROYED'],
};

class InvalidTransitionError extends Error {
  /** @param {string} msg */
  constructor(msg) {
    super(msg);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * UUID v4 matcher for session identifiers (RFC 9562-ish).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Justified strict ID shape: rejects path traversal tokens and oversized IDs (T-S02-004).
 */
function assertValidSessionId(id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new Error('INVALID_SESSION_ID');
  }
}

/**
 * @param {import('ioredis').Redis} redis
 */
function keys(sessionId) {
  assertValidSessionId(sessionId);
  return {
    state: `${PREFIX}${sessionId}:state`,
    meta: `${PREFIX}${sessionId}:meta`,
    ttlSignal: `${PREFIX}ttl:${sessionId}`,
  };
}

const ACTIVE_COUNTER = 'dasdocker:sessions:active';

/**
 * Atomically bumps active session counter if below maxConcurrent.
 * [Rule 1] Capacity enforced server-side — client cannot override.
 *
 * @param {import('ioredis').Redis} redis
 * @param {number} maxConcurrent
 */
async function acquireSessionSlot(redis, maxConcurrent) {
  const res = await redis.eval(
    `
    local cur = tonumber(redis.call('GET', KEYS[1])) or 0
    local cap = tonumber(ARGV[1])
    if cur >= cap then return 0 end
    redis.call('INCR', KEYS[1])
    return 1
    `,
    1,
    ACTIVE_COUNTER,
    String(maxConcurrent),
  );
  return res === 1;
}

/** Decrement capacity counter when QUEUED bootstrap fails after acquisition (T-S11-002 race safety). */
async function rollbackSessionSlot(redis) {
  await redis.decr(ACTIVE_COUNTER);
}

/**
 * Transition session FSM — throws InvalidTransitionError on illegal hops.
 *
 * @param {import('ioredis').Redis} redis
 * @param {string} sessionId
 * @param {SessionState} targetState
 */
async function transition(redis, sessionId, targetState) {
  const k = keys(sessionId);
  const pipeline = redis.multi();
  pipeline.get(k.state);
  const exec = await pipeline.exec();
  const prev = exec?.[0]?.[1];

  /** @type {SessionState|string|undefined} */
  const prevState = typeof prev === 'string' ? prev : undefined;

  if (!prevState) {
    throw new InvalidTransitionError(`no session "${sessionId}"`);
  }

  /** @type {SessionState} */
  // @ts-expect-error narrow
  const from = prevState;
  /** @type {SessionState[]} */
  // @ts-expect-error narrow
  const permitted = ALLOWED[from] || [];
  if (!permitted.includes(targetState)) {
    throw new InvalidTransitionError(`cannot move ${from} → ${targetState}`);
  }

  const multi = redis.multi();
  multi.set(k.state, targetState);
  if (targetState === 'DESTROYED' && from !== 'DESTROYED') {
    /** [Rule 1] Release capacity slot exactly once — tied to authoritative FSM terminal state */
    multi.decr(ACTIVE_COUNTER);
  }
  await multi.exec();
  return targetState;
}

/** @returns {Promise<SessionState|string|null>} */
async function getState(redis, sessionId) {
  assertValidSessionId(sessionId);
  const k = keys(sessionId);
  return redis.get(k.state);
}

/**
 * Persist session TTL signal key — MUST mirror ttl_seconds from meta for keyspace teardown.
 *
 * @param {import('ioredis').Redis} redis
 * @param {string} sessionId
 * @param {number} ttlSeconds
 */
async function setExpireSignalKey(redis, sessionId, ttlSeconds) {
  const kt = keys(sessionId).ttlSignal;
  await redis.set(kt, '1', 'EX', ttlSeconds);
}

/**
 * Create QUEUED session row + TTL dead-man signal (atomic enough for MVP — single MULTI).
 * [Rule 1] Caller must hold an acquired capacity slot BEFORE calling.
 *
 * @param {import('ioredis').Redis} redis
 * @param {{ sessionId: string, meta: Record<string, unknown>, ttlSeconds: number }} args
 */
async function bootstrapQueuedSession(redis, { sessionId, meta, ttlSeconds }) {
  const k = keys(sessionId);
  const multi = redis.multi();
  multi.set(k.state, 'QUEUED');
  multi.set(k.meta, JSON.stringify(meta));
  multi.set(k.ttlSignal, '1', 'EX', ttlSeconds);
  await multi.exec();
  return sessionId;
}

/**
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function getMeta(redis, sessionId) {
  assertValidSessionId(sessionId);
  const raw = await redis.get(keys(sessionId).meta);
  return raw ? JSON.parse(raw) : null;
}

/**
 * Save metadata JSON blob (trusted fields only — already validated upstream).
 *
 * @param {import('ioredis').Redis} redis
 * @param {string} sessionId
 * @param {Record<string, unknown>} patch
 */
async function mergeMeta(redis, sessionId, patch) {
  assertValidSessionId(sessionId);
  const prev = await getMeta(redis, sessionId);
  const next = { ...(prev || {}), ...patch };
  await redis.set(keys(sessionId).meta, JSON.stringify(next));
  return next;
}

async function deleteExpireSignalKey(redis, sessionId) {
  await redis.del(keys(sessionId).ttlSignal);
}

module.exports = {
  InvalidTransitionError,
  PREFIX,
  UUID_RE,
  assertValidSessionId,
  ALLOWED_STATES_SET: ALLOWED,
  ACTIVE_COUNTER,
  keys,
  transition,
  getState,
  getMeta,
  mergeMeta,
  setExpireSignalKey,
  deleteExpireSignalKey,
  bootstrapQueuedSession,
  acquireSessionSlot,
  rollbackSessionSlot,
};
