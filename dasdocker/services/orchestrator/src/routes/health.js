'use strict';

const path = require('path');
const sm = require('../state-machine');

/**
 * Liveness — unauthenticated by contract; **must not** echo secrets (T-S02-004).
 */
module.exports = async function healthRoutes(fastify, opts) {
  const redis = opts.redis;
  const version = require(path.join(__dirname, '../../package.json')).version;
  const started = Date.now();

  fastify.get('/health', async (_request, reply) => {
    /** [Rule 1] Active count is capacity truth from Redis — not client-reported */
    const raw = await redis.get(sm.ACTIVE_COUNTER);
    const activeSessions = Math.max(0, Number(raw || 0));
    return reply.send({
      version,
      uptime_seconds: Math.floor((Date.now() - started) / 1000),
      active_sessions: activeSessions,
    });
  });
};
