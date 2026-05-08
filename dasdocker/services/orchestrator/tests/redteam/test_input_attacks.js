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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dasdocker-red-input-'));
  const pubPath = path.join(dir, 'pub.pem');
  fs.writeFileSync(pubPath, pub);
  return { pubPath, priv };
}

async function boot() {
  const { pubPath, priv } = pem();
  return {
    priv,
    app: await buildApp({
      jwtPublicKeyPath: pubPath,
      redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
      lifecycleHooks: null,
    }),
    pubPath,
  };
}

function mint(priv, scopes) {
  return jwt.sign(
    /** @type {jwt.JwtPayload} */
    ({ scope: scopes }),
    priv,
    { algorithm: 'RS256', expiresIn: '120s', jti: String(Math.random()) },
  );
}

test('red-team: rejects path traversal style session identifiers', async (t) => {
  if (!(await redisReachable())) {
    t.skip('Redis unavailable');
    return;
  }

  const { app, priv } = await boot();
  t.after(async () => app.close().catch(() => {}));

  const tok = mint(priv, 'session:read');
  const rsp = await app.inject({
    method: 'GET',
    url: '/api/v1/sessions/../../../etc/passwd',
    headers: { authorization: `Bearer ${tok}` },
  });

  assert.equal(rsp.statusCode, 400);
});

test('red-team: TTL overflow must not bypass integer guard', async (t) => {
  if (!(await redisReachable())) {
    t.skip('Redis unavailable');
    return;
  }

  const { app, priv } = await boot();
  t.after(async () => app.close().catch(() => {}));

  const tok = mint(priv, 'session:create');
  const rsp = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    payload: {
      source_url: 'https://github.com/acme/repo',
      ttl_seconds: Number.MAX_SAFE_INTEGER,
      source_type: 'github',
    },
  });

  assert.equal(rsp.statusCode, 400);
});

test('red-team: SQLi-flavoured source_url payloads fail validation', async (t) => {
  if (!(await redisReachable())) {
    t.skip('Redis unavailable');
    return;
  }

  const { app, priv } = await boot();
  t.after(async () => app.close().catch(() => {}));

  const tok = mint(priv, 'session:create');
  const rsp = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    payload: {
      source_url: "https://github.com/org/repo' OR 1=1 --",
      ttl_seconds: 300,
      source_type: 'github',
    },
  });

  assert.equal(rsp.statusCode, 400);
});
