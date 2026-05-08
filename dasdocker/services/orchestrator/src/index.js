'use strict';

const fs = require('fs');
const Fastify = require('fastify');
const Redis = require('ioredis');

const { createAuthVerifier } = require('./middleware/auth');
const healthRoutes = require('./routes/health');
const sessionRoutes = require('./routes/sessions');

/**
 * @param {{
 *   jwtPublicKeyPath?: string,
 *   redisUrl?: string,
 *   lifecycleHooks?: Record<string, unknown> | null,
 * }} [config]
 */
async function buildApp(config = {}) {
  const jwtPath = config.jwtPublicKeyPath || process.env.JWT_PUBLIC_KEY_PATH;
  if (!jwtPath || !fs.existsSync(jwtPath)) {
    throw new Error('JWT_PUBLIC_KEY_PATH missing or unreadable');
  }

  const pem = fs.readFileSync(jwtPath);
  const redisUrl = config.redisUrl || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const trustProxy = process.env.TRUST_PROXY === '1';

  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL || 'info' },
    trustProxy,
  });

  const authVerifier = createAuthVerifier({
    publicKeyPath: () => pem,
    logRejection: (evt) => fastify.log.warn(evt),
  });

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });

  /** Explicit `lifecycleHooks:null` disables Docker provisioning (unit/integration harness safety). */
  let lifecycleHooks;
  if (Object.prototype.hasOwnProperty.call(config, 'lifecycleHooks')) {
    lifecycleHooks = config.lifecycleHooks;
  } else {
    lifecycleHooks = tryLoadDockerLifecycle(redis, fastify);
  }

  /** Runtime sidecars (Agent 08) — shut down BEFORE Redis quit */
  /** @type {Array<() => Promise<void>>} */
  const shutdownFns = [];

  if (lifecycleHooks?.runSessionTeardown && process.env.DASDOCKER_KEYSPACE_EXPIRY === '1') {
    const sub = redis.duplicate();
    sub.on('error', () => {});
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { startRedisKeyspaceExpiryWatcher } = require('./self-destruct');
    shutdownFns.push(await startRedisKeyspaceExpiryWatcher(sub, redis, lifecycleHooks, fastify.log));
  }

  if (lifecycleHooks?.runSessionTeardown && process.env.DASDOCKER_RESOURCE_ENFORCER !== '0') {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { startResourceEnforcer } = require('./resource-enforcer');
    shutdownFns.push(await startResourceEnforcer(redis, lifecycleHooks, fastify.log));
  }

  await fastify.register(healthRoutes, { prefix: '/api/v1', redis });
  await fastify.register(sessionRoutes, {
    prefix: '/api/v1/sessions',
    redis,
    authVerifier,
    trustProxy,
    lifecycleHooks,
  });

  fastify.addHook('onClose', async (_inst, done) => {
    for (const fn of shutdownFns.reverse()) {
      try {
        await fn();
      } catch (_) {}
    }
    redis.quit().then(() => done(), done);
  });

  return fastify;
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
function tryLoadDockerLifecycle(redis, fastify) {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { buildLifecycleHooks } = require('./container-manager');
    return buildLifecycleHooks({ redis, logger: fastify.log });
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    if (err && err.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

async function main() {
  const app = await buildApp();
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '0.0.0.0';
  await app.listen({ port, host });
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.stack || err}\n`);
    process.exit(1);
  });
}

module.exports = { buildApp, main };
