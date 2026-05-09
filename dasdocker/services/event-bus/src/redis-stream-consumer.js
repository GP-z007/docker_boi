'use strict';

const Redis = require('ioredis');

class RedisSessionStreamConsumer {
  /**
   * @param {{ redisUrl?: string, hub: import('./session-hub').SessionHub }} args
   */
  constructor(args) {
    this.redis = new Redis(args.redisUrl || process.env.REDIS_URL || 'redis://127.0.0.1:6379');
    this.hub = args.hub;
    this.running = false;
  }

  async start(sessionId) {
    const streamKey = `dasdocker:events:${sessionId}`;
    let lastId = '$';
    this.running = true;
    while (this.running) {
      const rows = await this.redis.xread('BLOCK', 2000, 'STREAMS', streamKey, lastId).catch(() => null);
      if (!rows || rows.length === 0) continue;
      for (const stream of rows) {
        const entries = stream[1] || [];
        for (const item of entries) {
          lastId = item[0];
          const kv = item[1] || [];
          const map = {};
          for (let i = 0; i < kv.length; i += 2) map[kv[i]] = kv[i + 1];
          const payload = map.payload ? JSON.parse(map.payload) : map;
          this.hub.publish(sessionId, payload);
          if (payload.type === 'state_change' && payload.to === 'DESTROYED') {
            this.hub.closeSession(sessionId, 'session_destroyed');
          }
        }
      }
    }
  }

  async stop() {
    this.running = false;
    await this.redis.quit().catch(() => {});
  }
}

module.exports = { RedisSessionStreamConsumer };
