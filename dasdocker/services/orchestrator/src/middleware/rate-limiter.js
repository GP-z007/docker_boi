'use strict';

/**
 * Sliding-window rate limit via Redis sorted set scores = epoch ms (T-S02-004 class DoS mitigation).
 * [Rule 1] Trusted reverse-proxy mode is deliberately OFF unless TRUST_PROXY=1 env is set downstream.
 */

/** @returns {Promise<boolean>} true iff request allowed */
async function checkPostSessionsPerMinute(redis, clientKey, windowMs = 60_000, maxRequests = 5) {
  const key = `dasdocker:ratelimit:post_session:${clientKey}`;
  const now = Date.now();
  const cutoff = now - windowMs;

  /** @example member unique-ish — allows same-ms bursts without ZSET duplication collapse */
  const member = `${now}:${cryptoRandom()}`;
  await redis.zremrangebyscore(key, 0, cutoff);
  const countBefore = Number(await redis.zcard(key));
  /** Sixth POST within window when maxRequests=5 must fail */
  if (countBefore >= maxRequests) return false;

  /** ioredis: chain multi builders then exec */
  await redis
    .multi()
    .zadd(key, now, member)
    .expire(key, Math.ceil((windowMs * 3) / 1000))
    .exec();
  return true;
}

function cryptoRandom() {
  return require('crypto').randomBytes(8).toString('hex');
}

/**
 * @param {boolean} trustProxy [Rule 1] Default false — ops must explicitly enable X-Forwarded-For trust
 * (client identity for RL must never be logged alongside rejected tokens).
 */
function deriveClientIp(request, trustProxy = false) {
  if (!trustProxy) return request.socket.remoteAddress || 'unknown';

  /** [Rule 1] Justified elevated trust only when terminates TLS at LB + sanitized chain */
  const xff = request.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    /** first hop heuristic only — production should pin known LB prefix */
    return xff.split(',')[0].trim();
  }
  return request.socket.remoteAddress || 'unknown';
}

module.exports = {
  checkPostSessionsPerMinute,
  deriveClientIp,
};
