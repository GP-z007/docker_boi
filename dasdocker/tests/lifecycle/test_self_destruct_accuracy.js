'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Redis = require(path.join(__dirname, '../../services/orchestrator/node_modules/ioredis'));
const {
  setSessionTtl,
  ensureKeyspaceExpiryNotifications,
  subscribeSessionTtlExpired,
} = require('../../services/orchestrator/src/self-destruct');
const SKIP_BASE =
  process.env.DASDOCKER_LIFECYCLE_INTEGRATION !== '1' ||
  process.env.DASDOCKER_REDIS_TESTS !== '1';
const REDIS_URL = process.env.DASDOCKER_TEST_REDIS_URL || 'redis://127.0.0.1:6379';
/** Default 8s for dev speed; set `DASDOCKER_TTL_TEST_SECONDS=60` for production ±5s acceptance. */
const TTL_SEC = Number(process.env.DASDOCKER_TTL_TEST_SECONDS || 8);

test(
  `VT-INT-S14: Redis TTL expiry (~${TTL_SEC}s, ±5s tolerance)`,
  { skip: SKIP_BASE },
  async () => {
    const redis = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
    });
    await redis.connect().catch((e) => {
      redis.disconnect();
      throw new Error(`Redis unavailable (${REDIS_URL}): ${e}`);
    });

    await ensureKeyspaceExpiryNotifications(redis);

    const fired = [];
    const t0 = Date.now();
    const sub = subscribeSessionTtlExpired(redis, (sid) => {
      fired.push({ sid, dt: Date.now() - t0 });
    });

    const sid = `ttlc-${Date.now()}`;
    await setSessionTtl(redis, sid, TTL_SEC);

    await new Promise((r) => setTimeout(r, (TTL_SEC + 3) * 1000));

    assert.ok(fired.length >= 1, `expected expiry callback, saw ${JSON.stringify(fired)}`);
    const deltaMs = fired[0].dt;
    const lo = TTL_SEC * 1000 - 5000;
    const hi = TTL_SEC * 1000 + 5000;
    assert.ok(deltaMs >= lo && deltaMs <= hi, `expiry at ${deltaMs}ms vs target ${TTL_SEC}s (allowed ${lo}–${hi}ms)`);

    await sub.quit().catch(() => {});
    await redis.quit().catch(() => {});
  },
);
