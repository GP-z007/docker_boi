'use strict';

const sm = require('./state-machine');

/**
 * Redis keyspace expiry hook — complements API TTL bookkeeping (Deliverable 2.6).
 * OPS: redis.conf `notify-keyspace-events Ex` (or `CONFIG SET` at boot). [Rule 1] Subscriber uses read-only duplication client.
 */

const TTL_PREFIX = `${sm.PREFIX}ttl:`;

/**
 * @param {import('ioredis').Redis} subscriber Duplicate connection (must not share pub/sub with commander).
 * @param {import('ioredis').Redis} commander Primary Redis connection (unused here – hooks carry redis via lifecycle).
 * @param {{ runSessionTeardown?: (id: string, reason: string) => Promise<void> }} lifecycleHooks
 * @param {import('pino').Logger} logger
 */
async function startRedisKeyspaceExpiryWatcher(subscriber, commander, lifecycleHooks, logger) {
  if (!lifecycleHooks?.runSessionTeardown) {
    subscriber.disconnect();
    return async () => {};
  }

  try {
    await commander.config('SET', 'notify-keyspace-events', 'Ex');
  } catch (e) {
    logger.warn(
      { err: /** @type {Error} */ (e).message },
      'unable to SET notify-keyspace-events — TTL listener may stay blind until ops configures Redis',
    );
  }

  const onMessage = async (_pattern, _channel, expiredKey) => {
    if (typeof expiredKey !== 'string' || !expiredKey.startsWith(TTL_PREFIX)) return;

    const sessionId = expiredKey.slice(TTL_PREFIX.length);
    if (!sm.UUID_RE.test(sessionId)) return;

    try {
      await lifecycleHooks.runSessionTeardown(sessionId, 'redis-ttl-expired');
      logger.warn({ sessionId }, 'self-destruct: redis TTL key expired → teardown');
    } catch (err) {
      logger.error({ sessionId, err }, 'self-destruct: teardown after expiry failed');
    }
  };

  subscriber.on('pmessage', (_pat, chan, msg) => {
    void onMessage(_pat, chan, msg);
  });

  await subscriber.psubscribe('__keyevent@*__:expired');

  return async () => {
    try {
      await subscriber.punsubscribe();
      subscriber.disconnect();
    } catch (_) {}
  };
}

module.exports = { startRedisKeyspaceExpiryWatcher, TTL_PREFIX };
