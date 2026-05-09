'use strict';

const Redis = require('ioredis');

class StreamPublisher {
  constructor(redisUrl = process.env.DASDOCKER_REDIS_URL || 'redis://127.0.0.1:6379') {
    this.redis = new Redis(redisUrl);
  }

  /**
   * @param {string} sessionId
   * @param {Record<string, any>} event
   */
  async publish(sessionId, event) {
    const stream = `dasdocker:events:${sessionId}`;
    await this.redis.xadd(stream, '*', 'payload', JSON.stringify(event));
  }

  async close() {
    await this.redis.quit().catch(() => {});
  }
}

module.exports = { StreamPublisher };
