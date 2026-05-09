'use strict';

const crypto = require('crypto');

function b64urlDecode(segment) {
  const norm = String(segment || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(String(segment || '').length / 4) * 4, '=');
  return Buffer.from(norm, 'base64').toString('utf8');
}

/**
 * @param {string} token
 * @param {string} publicKeyPem
 */
function decodeAndVerifyRs256(token, publicKeyPem) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, code: 4001, reason: 'jwt_malformed' };

  let header;
  let payload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]));
    payload = JSON.parse(b64urlDecode(parts[1]));
  } catch {
    return { ok: false, code: 4001, reason: 'jwt_decode_failed' };
  }

  if (header.alg !== 'RS256') return { ok: false, code: 4001, reason: 'jwt_alg_mismatch' };
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  const sig = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const valid = verifier.verify(publicKeyPem, sig);
  if (!valid) return { ok: false, code: 4001, reason: 'jwt_signature_invalid' };
  return { ok: true, payload };
}

/**
 * @param {{
 *  token: string,
 *  sessionIdFromPath: string,
 *  publicKeyPem: string,
 *  expectedAudience?: string
 * }} args
 */
function validateJwtForSession(args) {
  const v = decodeAndVerifyRs256(args.token, args.publicKeyPem);
  if (!v.ok) return v;
  const p = v.payload || {};
  const claimSid = p.session_id || p.sid;
  if (!claimSid || claimSid !== args.sessionIdFromPath) {
    return { ok: false, code: 4003, reason: 'session_claim_mismatch' };
  }
  if (args.expectedAudience && p.aud !== args.expectedAudience) {
    return { ok: false, code: 4001, reason: 'aud_mismatch' };
  }
  return { ok: true, payload: p };
}

module.exports = { validateJwtForSession };
