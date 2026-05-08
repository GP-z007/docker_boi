'use strict';

const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const Redis = require('ioredis');
const crypto = require('node:crypto');

const { buildApp } = require('../../src/index.js');

async function redisOptional() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    enableReadyCheck: false,
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

function keyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString('utf8');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dasdocker-orchestrator-integration-'));
  const pubPath = path.join(dir, 'pub.pem');
  fs.writeFileSync(pubPath, pub);
  return { pubPath, priv };
}

test('integration: POST+GET sessions with RS256 bearer', async (t) => {
  if (!(await redisOptional())) {
    t.skip('Redis down');
    return;
  }

  const { pubPath, priv } = keyMaterial();
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  const app = await buildApp({
    jwtPublicKeyPath: pubPath,
    redisUrl,
    lifecycleHooks: null,
  });

  t.after(async () => {
    await app.close().catch(() => {});
  });

  const token = jwt.sign(
    /** @type {jwt.JwtPayload} */ ({
      scope: 'session:create',
      jti: crypto.randomUUID(),
    }),
    priv,
    { algorithm: 'RS256', expiresIn: '180s', subject: 'test-operator' },
  );

  /** @todo Wire real operator identity bindings when IdP federation lands */
  const post = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: {
      source_url: 'https://github.com/org/repo.git',
      ttl_seconds: 120,
      source_type: 'github',
    },
  });
  assert.equal(post.statusCode, 201);

  const body = post.json();

  /** Re-sign JWT bound to created session for read */
  const readTok = jwt.sign(
    {
      sess: body.id,
      scope: 'session:read',
    },
    priv,
    { algorithm: 'RS256', expiresIn: '180s' },
  );

  const get = await app.inject({
    method: 'GET',
    url: `/api/v1/sessions/${body.id}`,
    headers: { authorization: `Bearer ${readTok}` },
  });
  assert.equal(get.statusCode, 200);
});
