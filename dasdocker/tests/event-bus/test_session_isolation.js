'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { validateJwtForSession } = require('../../services/event-bus/src/jwt-auth');
const { SessionHub } = require('../../services/event-bus/src/session-hub');

function signJwt(claims, privatePem) {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${head}.${body}`);
  signer.end();
  const sig = signer.sign(privatePem).toString('base64url');
  return `${head}.${body}.${sig}`;
}

test('Valid JWT for session A cannot subscribe to session B (4003)', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const token = signJwt({ session_id: 'session-a', aud: 'obs:subscribe' }, privateKey.export({ type: 'pkcs1', format: 'pem' }));
  const res = validateJwtForSession({
    token,
    sessionIdFromPath: 'session-b',
    publicKeyPem: publicKey.export({ type: 'pkcs1', format: 'pem' }),
    expectedAudience: 'obs:subscribe',
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, 4003);
});

test('Cross-session message isolation in hub', () => {
  const hub = new SessionHub();
  const seenA = [];
  const seenB = [];
  hub.addConnection('session-a', { send: (x) => seenA.push(JSON.parse(x)) });
  hub.addConnection('session-b', { send: (x) => seenB.push(JSON.parse(x)) });
  hub.publish('session-a', { type: 'alert_event', session_id: 'session-a', severity: 'warn' });
  assert.equal(seenA.length, 1);
  assert.equal(seenB.length, 0);
});
