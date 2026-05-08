'use strict';

const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const { createAuthVerifier, verifyBearer } = require('../../src/middleware/auth');

function tempPems() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dasdocker-jwt-'));
  const pubPath = path.join(dir, 'pub.pem');
  const privPath = path.join(dir, 'priv.pem');
  fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return { pubPath, privPath, privateKey };
}

test('RS256 verifier accepts bearer with correct scopes', async () => {
  const { pubPath, privateKey } = tempPems();
  const verifier = createAuthVerifier({ publicKeyPath: () => fs.readFileSync(pubPath) });

  const token = jwt.sign(
    /** @type {jwt.JwtPayload} */ ({
      sess: '550e8400-e29b-41d4-a716-446655440000',
      scope: 'session:read session:destroy',
    }),
    privateKey,
    { algorithm: 'RS256', expiresIn: '120s' },
  );

  const claims = await verifier.authenticate({ authorization: `Bearer ${token}` });
  verifier.assertScopesAndSession(claims, 'session:read', {
    sessionPathId: '550e8400-e29b-41d4-a716-446655440000',
  });
});

test('session binding rejects cross-tenant path', async () => {
  const { pubPath, privateKey } = tempPems();
  const verifier = createAuthVerifier({ publicKeyPath: () => fs.readFileSync(pubPath) });

  const token = jwt.sign(
    {
      sess: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      scope: 'session:read',
    },
    privateKey,
    { algorithm: 'RS256', expiresIn: '120s' },
  );

  const claims = await verifier.authenticate({ authorization: `Bearer ${token}` });
  await assert.rejects(async () =>
    verifier.assertScopesAndSession(claims, 'session:read', {
      sessionPathId: '550e8400-e29b-41d4-a716-446655440000',
    }),
  );
});

test('verifyBearer rejects HS256 asymmetric confusion', async () => {
  const { pubPath, privateKey } = tempPems();
  const pub = fs.readFileSync(pubPath).toString('utf8');

  const sym = jwt.sign({ scope: 'session:read', sess: 'x' }, 'supersecretbad', {
    algorithm: 'HS256',
    expiresIn: '120s',
  });

  await assert.rejects(async () => verifyBearer(pub, sym));
});
