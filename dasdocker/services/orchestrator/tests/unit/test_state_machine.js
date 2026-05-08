'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const Redis = require('ioredis');

const sm = require('../../src/state-machine');

const SAMPLE_ID = '123e4567-e89b-12d3-a456-426614174000';

test('InvalidTransitionError prevents illegal hop', async (t) => {
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });
  redis.on('error', () => {});
  try {
    await redis.connect();
  } catch (_) {
    redis.disconnect();
    t.skip(`Redis unavailable (${process.env.REDIS_URL || 'redis://127.0.0.1:6379'})`);
    return;
  }

  /** @rule Least-privilege TTL keys — teardown after test */
  t.after(async () => {
    try {
      await redis.del(`${sm.PREFIX}${SAMPLE_ID}:state`, `${sm.PREFIX}${SAMPLE_ID}:meta`, `${sm.PREFIX}ttl:${SAMPLE_ID}`);
      await redis.quit();
    } catch (_) {}
  });

  /** Reset counter drift from prior runs — justified for isolated test artifact */
  await redis.del(sm.ACTIVE_COUNTER);

  const okSlot = await sm.acquireSessionSlot(redis, 50);
  assert.equal(okSlot, true);

  await sm.bootstrapQueuedSession(redis, {
    sessionId: SAMPLE_ID,
    meta: {
      ttl_seconds: 600,
      source_url: 'https://github.com/acme/repo',
      source_type: 'github',
    },
    ttlSeconds: 600,
  });

  await assert.rejects(
    async () => sm.transition(redis, SAMPLE_ID, 'RUNNING'),
    sm.InvalidTransitionError,
  );

  await sm.transition(redis, SAMPLE_ID, 'DESTROYING');
  await sm.transition(redis, SAMPLE_ID, 'DESTROYED');

  /** Slot acquired at enqueue + released at DESTROYED terminal state */
  assert.equal(Number(await redis.get(sm.ACTIVE_COUNTER)), 0);
});
