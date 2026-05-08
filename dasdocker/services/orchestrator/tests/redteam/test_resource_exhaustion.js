'use strict';

const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const Redis = require('ioredis');

const { buildApp } = require('../../src/index.js');

async function redisReachable() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    maxRetriesPerRequest: null,
  });
  redis.on('error', () => {});
  try {
    await redis.connect();
    redis.disconnect();
    return true;
  } catch (_) {
    redis.disconnect();
    return false;
  }
}

function pem() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString('utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dasdocker-red-res-'));
  const pubPath = path.join(dir, 'pub.pem');
  fs.writeFileSync(pubPath, pub);
  return { pubPath, priv };
}

test('red-team: 6 POST /sessions/minute from same synthetic IP ⇒ 429', async (t) => {
  if (!(await redisReachable())) {
    t.skip('Redis unavailable');
    return;
  }

  const { pubPath, priv } = pem();

  /** @todo Fastify exposes `inject` pseudo-socket IPs — document proxy behaviour for RL keys */
  const app = await buildApp({
    jwtPublicKeyPath: pubPath,
    redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    lifecycleHooks: null,
  });

  t.after(async () => app.close().catch(() => {}));

  for (let i = 0; i < 5; i += 1) {
    const tok = jwt.sign(
      /** @type {jwt.JwtPayload} */ ({ scope: 'session:create' }),
      priv,
      { algorithm: 'RS256', expiresIn: '120s', jti: `${Date.now()}${i}` },
    );
    const rsp = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      payload: {
        /** vary URL so payloads differ while staying within regex */
        source_url: `https://github.com/acme/repo-${i}`,
        ttl_seconds: 120,
        source_type: 'github',
      },
    });
    assert.equal(rsp.statusCode, 201, `iteration ${i} should succeed before RL window saturation`);
  }

  const tok6 = jwt.sign(
    /** @type {jwt.JwtPayload} */ ({ scope: 'session:create' }),
    priv,
    { algorithm: 'RS256', expiresIn: '120s', jti: `${Date.now()}final` },
  );
  const blocked = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: { authorization: `Bearer ${tok6}`, 'content-type': 'application/json' },
    payload: {
      source_url: 'https://github.com/acme/repo-z',
      ttl_seconds: 120,
      source_type: 'github',
    },
  });
  assert.equal(blocked.statusCode, 429);
});
