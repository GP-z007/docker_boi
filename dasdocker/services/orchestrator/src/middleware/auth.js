'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/** @typedef {{ scopes: Set<string>, claims: jwt.JwtPayload, rawClaims: jwt.JwtPayload }} AuthContext */

/** [Rule 1] RS256 only — forbid HS256, none, asymmetric confusion (T-S12-002). */

/**
 * @param {jwt.JwtPayload} payload
 */
function parseScopes(payload) {
  /** @see docs/architecture/orchestrator-api-contract.md — space-delimited string */
  const sc = payload.scope;
  let list = [];
  if (typeof sc === 'string') list = sc.split(/\s+/).filter(Boolean);
  else if (Array.isArray(sc)) list = /** @type {string[]} */ (sc);
  return new Set(list);
}

/**
 * @param {jwt.JwtHeader} hdr
 */
function rejectWeakAlgorithm(hdr) {
  if (!hdr || typeof hdr.alg !== 'string') {
    throw jwt.JsonWebTokenError('missing alg');
  }
  const a = hdr.alg.toUpperCase();
  /** [Rule 1] Symmetric JWT is disallowed — prevents shared-secret downgrade */
  if (a === 'NONE' || a.startsWith('HS')) {
    throw jwt.JsonWebTokenError('disallowed algorithm');
  }
}

/**
 * Manual header inspection before verify — reinforces RS256 rejection (red-team parity).
 *
 * @param {string} tokenRaw
 */
function verifyAlgorithmHeaderStub(tokenRaw) {
  /** @note jsonwebtoken 9 rejects `none`; we still classify intent for auditing */
  try {
    const [h] = tokenRaw.split('.');
    const json = Buffer.from(h, 'base64url').toString('utf8');
    /** @type {jwt.JwtHeader} */
    const hdr = JSON.parse(json);
    rejectWeakAlgorithm(hdr);
  } catch (e) {
    if (e instanceof jwt.JsonWebTokenError) throw e;
    /** malformed token flows to jwt.verify anyway */
  }
}

/**
 * @param {string} pem
 */
function verifyBearer(pem, tokenRaw) {
  verifyAlgorithmHeaderStub(tokenRaw);
  /** [Rule 1] Algorithms locked — prevents alg confusion */
  const claims = jwt.verify(tokenRaw, pem, {
    algorithms: ['RS256'],
    ignoreNotBefore: false,
    maxAge: undefined,
    clockTolerance: 2,
  });
  /** @note jsonwebtoken does not populate header in decode result here */
  return /** @type {jwt.JwtPayload} */ (claims);
}

/**
 * @returns {Promise<jwt.JwtPayload>}
 */
async function authenticateAuthorizationHeader(pem, authHeaderValue) {
  if (!authHeaderValue || typeof authHeaderValue !== 'string' || !authHeaderValue.startsWith('Bearer ')) {
    throw new jwt.JsonWebTokenError('missing bearer');
  }
  const tok = authHeaderValue.slice('Bearer '.length).trim();
  return verifyBearer(pem, tok);
}

/**
 * Builds Fastify attachable auth verifier.
 *
 * @param {{
 *   publicKeyPath: () => Buffer,
 *   logRejection?: (evt: Record<string, unknown>) => void,
 *   redisGetter?: () => Promise<unknown>,
 * }} opts
 */
function createAuthVerifier(opts) {
  const logRejection = opts.logRejection || (() => {});

  return {
    authenticate(headers) {
      const pem = opts.publicKeyPath();
      /** @note Authorization header casing normalized by browsers; keep explicit */
      return authenticateAuthorizationHeader(pem, headers.authorization || headers.Authorization);
    },

    /**
     * @param {jwt.JwtPayload} claims
     * @param {string} requiredScopes
     * @param {{
     *   sessionPathId?: string,
     *   watchdogOnlyRoute?: boolean,
     * }=} routeCtx
     * When `watchdogOnlyRoute` is true, only `system:watchdog` scope is accepted (no `sess` binding).
     */
    assertScopesAndSession(claims, requiredScopes, routeCtx = {}) {
      const scopes = parseScopes(claims);
      /** [Rule 1] Host watchdog token is minted from Vault — shortest practical TTL (ops runbook) */
      if (routeCtx.watchdogOnlyRoute) {
        if (!scopes.has('system:watchdog')) {
          throw Object.assign(new jwt.JsonWebTokenError('missing watchdog scope'), {
            code: 'INSUFFICIENT_SCOPE',
          });
        }
        return scopes;
      }

      // e.g. requiredScopes = "session:read"
      for (const s of requiredScopes.split(/\s+/).filter(Boolean)) {
        if (!scopes.has(s)) {
          /** [Rule 1] Least privilege — insufficient scope denied */
          throw Object.assign(new jwt.JsonWebTokenError('missing scope'), {
            code: 'INSUFFICIENT_SCOPE',
          });
        }
      }

      if (routeCtx.sessionPathId) {
        /** [Rule 1] Session binding prevents cross-tenant telemetry/lateral read (T-S12-003) */
        const want = routeCtx.sessionPathId;
        if (claims.sess !== want && !scopes.has('system:watchdog')) {
          throw new jwt.JsonWebTokenError('session binding mismatch');
        }
      }

      /** [Rule 1] Destroyed session tokens must fail read paths (replay / stale JWT) — checked by route using Redis */
      return scopes;
    },
  };
}

/**
 * @param {Record<string, unknown>} jwtSignOverrides — jsonwebtoken sign options (`expiresIn`, `issuer`), not claims
 */
function signTestJwt(privateKeyPem, payload, jwtSignOverrides = {}) {
  /** @note keep claim `jti` out of JWT sign() options bundle */
  const jti =
    typeof payload.jti === 'string' ? payload.jti : crypto.randomUUID();
  /** @type {jwt.JwtPayload} */
  const body = /** @type {jwt.JwtPayload} */ ({
    ...payload,
    jti,
  });
  const signOpts = {
    algorithm: 'RS256',
    expiresIn: '15m',
    ...(jwtSignOverrides && typeof jwtSignOverrides === 'object' ? jwtSignOverrides : {}),
  };
  return jwt.sign(body, privateKeyPem, signOpts);
}

module.exports = {
  authenticateAuthorizationHeader,
  verifyBearer,
  parseScopes,
  createAuthVerifier,
  signTestJwt,
  rejectWeakAlgorithm,
};
