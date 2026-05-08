'use strict';

const { spawnSync } = require('child_process');

const sm = require('./state-machine');

const DOCKER = process.env.DOCKER_BIN || 'docker';
const PID_LIMIT_ALERT = Number(process.env.DASDOCKER_EXPECTED_PID_LIMIT ?? 100);
const POLL_MS = 30_000;
const MEM_WARN_THRESHOLD = 90;
const MEM_WARN_DURATION_MS = 60_000;

/**
 * Periodic cgroup/docker stats sentinel (T-S04-004). [Rule 1] Observations are host-side — never polled from workloads.
 */

/**
 * @param {import('ioredis').Redis} redis
 * @param {{ runSessionTeardown?: (id: string, reason: string) => Promise<void> }} lifecycleHooks
 * @param {import('pino').Logger} log
 */
async function startResourceEnforcer(redis, lifecycleHooks, log) {
  if (!lifecycleHooks?.runSessionTeardown) {
    return async () => {};
  }

  const memElevatedSince = /** @type {Map<string, number>} */ (new Map());

  const tick = async () => {
    const pattern = `${sm.PREFIX}*:state`;
    let cursor = '0';
    do {
      const tuple = /** @type {[string, string[]]} */ (/** @type {unknown} */ (await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 128)));
      cursor = tuple[0];
      for (const rk of tuple[1]) {
        const m = rk.match(/^dasdocker:sess:([0-9a-f-]+):state$/i);
        if (!m || !sm.UUID_RE.test(m[1])) continue;
        const sessionId = m[1];
        const st = await redis.get(rk);
        if (st !== 'RUNNING') {
          memElevatedSince.delete(sessionId);
          continue;
        }

        const meta = await sm.getMeta(redis, sessionId);
        const cid = meta?.container_id;
        if (!cid || typeof cid !== 'string') continue;

        const statsRaw = spawnSync(DOCKER, ['stats', '--no-stream', '--format', '{{.MemPerc}}\t{{.PIDs}}', cid], {
          encoding: 'utf8',
        });
        if (statsRaw.status !== 0) continue;
        const [memPart, pidPart = '0'] = (statsRaw.stdout || '').trim().split(/\s+/);

        /** @rule Parse `83.72%` */
        const memPerc = Number.parseFloat(memPart.replace('%', ''));
        if (!Number.isNaN(memPerc) && memPerc >= MEM_WARN_THRESHOLD) {
          const first = memElevatedSince.get(sessionId) ?? Date.now();
          memElevatedSince.set(sessionId, first);
          if (Date.now() - first > MEM_WARN_DURATION_MS) {
            log.warn({ sessionId, memPerc }, 'resource:warning');
          }
        } else {
          memElevatedSince.delete(sessionId);
        }

        const pidsUsed = Number.parseInt(pidPart, 10);
        if (
          PID_LIMIT_ALERT > 0 &&
          !Number.isNaN(pidsUsed) &&
          pidsUsed >= PID_LIMIT_ALERT
        ) {
          log.error({ sessionId, pidsUsed }, 'pids-at-limit → teardown');
          await lifecycleHooks.runSessionTeardown(sessionId, 'pids-limit-exceeded');
        }
      }
    } while (cursor !== '0');
  };

  const handle = setInterval(() => {
    tick().catch((e) => log.error({ err: /** @type {Error} */ (e) }, 'resource-enforcer tick'));
  }, POLL_MS);

  return async () => {
    clearInterval(handle);
  };
}

module.exports = { startResourceEnforcer };
