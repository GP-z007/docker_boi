'use strict';

const Redis = require('ioredis');

/**
 * Layer-1 self-destruct: Redis key expiry + keyspace notifications (Rule 1 — authoritative server-side timer).
 * WHY `session:ttl:{id}`: deterministic namespace for `__keyevent@*__:expired` subscription (no Lua clock skew in client).
 */

/**
 * @param {Redis} redis primary connection (must support `config SET` in dev; may fail on managed Redis).
 */
async function ensureKeyspaceExpiryNotifications(redis) {
  try {
    await redis.config('SET', 'notify-keyspace-events', 'Ex');
  } catch {
    /* Managed clusters often block CONFIG — Layer-2 watchdog must compensate (technical constraint D). */
  }
}

/**
 * @param {Redis} redis
 * @param {(sessionId: string, cause: string) => void | Promise<void>} onExpire
 * @returns {Redis} subscriber connection — keep alive for process lifetime; `.quit()` on shutdown.
 */
function subscribeSessionTtlExpired(redis, onExpire) {
  const sub = redis.duplicate();
  sub.psubscribe('__keyevent@*__:expired', () => {});
  sub.on('pmessage', (_pattern, _channel, key) => {
    if (typeof key === 'string' && key.startsWith('session:ttl:')) {
      const sessionId = key.slice('session:ttl:'.length);
      void Promise.resolve(onExpire(sessionId, 'ttl-expired')).catch(() => {});
    }
  });
  return sub;
}

/**
 * Bind TTL to orchestrator session id.
 *
 * @param {Redis} redis
 * @param {string} sessionId
 * @param {number} ttlSeconds
 */
async function setSessionTtl(redis, sessionId, ttlSeconds) {
  const ex = Math.max(1, Math.floor(Number(ttlSeconds) || 0));
  await redis.set(`session:ttl:${sessionId}`, sessionId, 'EX', ex);
}

module.exports = {
  ensureKeyspaceExpiryNotifications,
  subscribeSessionTtlExpired,
  setSessionTtl,
};
