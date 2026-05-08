'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const Redis = require('ioredis');

const { verifyBearer, createAuthVerifier } = require('../../src/middleware/auth');
const sm = require('../../src/state-machine');

function tempPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString('utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dasdocker-redteam-'));
  const pubPath = path.join(dir, 'pub.pem');
  fs.writeFileSync(pubPath, pem);
  return { pem, pubPath, privateKey };
}

test('alg=HS256 with symmetric secret cannot satisfy RS256 verification', async () => {
  const { pem } = tempPair();
  const bogus = jwt.sign({ scope: 'session:create', sess: 'id' }, 'shared-secret!', {
    algorithm: 'HS256',
    expiresIn: '600s',
  });
  await assert.rejects(async () => verifyBearer(pem, bogus));
});

test('handcrafted NONE algorithm bearer fails RS256 verifier', async () => {
  const { pem } = tempPair();
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ scope: 'session:create', exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  const handcrafted = `${header}.${payload}.`;
  await assert.rejects(async () => verifyBearer(pem, handcrafted));
});

test('expired token rejected', async () => {
  const { pem, privateKey } = tempPair();
  const stale = jwt.sign({ scope: 'session:read', sess: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '-30s',
  });
  await assert.rejects(async () => verifyBearer(pem, stale));
});

test('wrong scope denied', async () => {
  const { pubPath, privateKey } = tempPair();
  const verifier = createAuthVerifier({ publicKeyPath: () => fs.readFileSync(pubPath) });
  const token = jwt.sign(
    /** @type {jwt.JwtPayload} */
    ({
      sess: '123e4567-e89b-12d3-a456-426614174000',
      scope: 'session:create',
    }),
    privateKey,
    { algorithm: 'RS256', expiresIn: '120s' },
  );
  const claims = await verifier.authenticate({ authorization: `Bearer ${token}` });
  await assert.rejects(async () => verifier.assertScopesAndSession(claims, 'session:destroy', {}), jwt.JsonWebTokenError);
});

test('replay: destroyed session retains terminal Redis state regardless of hypothetical JWT freshness', async (t) => {
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
    t.skip('Redis down');
    return;
  }

  const id = crypto.randomUUID();

  t.after(async () => {
    try {
      await redis.del(`${sm.PREFIX}${id}:state`, `${sm.PREFIX}${id}:meta`, `${sm.PREFIX}ttl:${id}`);
      await redis.quit();
    } catch (_) {}
  });

  await sm.acquireSessionSlot(redis, 50);
  await sm.bootstrapQueuedSession(redis, {
    sessionId: id,
    meta: { ttl_seconds: 600, source_url: 'https://github.com/acme/repo', source_type: 'github' },
    ttlSeconds: 600,
  });

  await sm.transition(redis, id, 'DESTROYING');
  await sm.transition(redis, id, 'DESTROYED');

  assert.equal(await sm.getState(redis, id), 'DESTROYED');
});
