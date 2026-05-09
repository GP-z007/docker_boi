'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeProxyHeaders, createProxyHandler } = require('../../services/orchestrator/src/routes/proxy');

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function token(claims) {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.sig`;
}

test('sanitizeProxyHeaders strips Set-Cookie, XFO, upstream CSP', () => {
  const out = sanitizeProxyHeaders({
    'set-cookie': 'a=b',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src *",
    'content-type': 'text/html',
  });
  assert.equal('set-cookie' in out, false);
  assert.equal('x-frame-options' in out, false);
  assert.equal('content-security-policy' in out, false);
  assert.equal(out['Content-Security-Policy'].includes('sandbox allow-scripts allow-forms allow-same-origin'), true);
  assert.equal(out['X-Content-Type-Options'], 'nosniff');
});

test('proxy handler rejects non-RUNNING and missing scope', () => {
  const handler = createProxyHandler({
    hasScope: (claims, s) => Array.isArray(claims.scopes) && claims.scopes.includes(s),
    getSession: () => ({ state: 'PROVISIONING' }),
  });
  const req = {
    url: '/api/v1/sessions/s1/proxy/',
    headers: { authorization: `Bearer ${token({ session_id: 's1', scopes: [] })}` },
    method: 'GET',
    pipe: () => {},
  };
  const res = {
    statusCode: 0,
    _body: '',
    writeHead(c) {
      this.statusCode = c;
      return this;
    },
    end(body) {
      this._body = body || '';
    },
  };
  handler(req, res);
  assert.equal(res.statusCode, 401);
});
