'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { validateJwtForSession } = require('../../services/event-bus/src/jwt-auth');

function signJwt(claims, privatePem) {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${head}.${body}`);
  signer.end();
  const sig = signer.sign(privatePem).toString('base64url');
  return `${head}.${body}.${sig}`;
}

test('Valid JWT -> accepted for matching session', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const token = signJwt({ session_id: 'sess-a', aud: 'obs:subscribe' }, privateKey.export({ type: 'pkcs1', format: 'pem' }));
  const res = validateJwtForSession({
    token,
    sessionIdFromPath: 'sess-a',
    publicKeyPem: publicKey.export({ type: 'pkcs1', format: 'pem' }),
    expectedAudience: 'obs:subscribe',
  });
  assert.equal(res.ok, true);
});

test('Invalid JWT -> rejected with 4001', () => {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const res = validateJwtForSession({
    token: 'bad.token.value',
    sessionIdFromPath: 'sess-a',
    publicKeyPem: publicKey.export({ type: 'pkcs1', format: 'pem' }),
    expectedAudience: 'obs:subscribe',
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, 4001);
});
