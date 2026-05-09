'use strict';

class SessionHub {
  constructor() {
    /** @type {Map<string, Set<{ send: Function, close?: Function, readyState?: number }>>} */
    this.rooms = new Map();
  }

  addConnection(sessionId, ws) {
    if (!this.rooms.has(sessionId)) this.rooms.set(sessionId, new Set());
    this.rooms.get(sessionId).add(ws);
  }

  removeConnection(sessionId, ws) {
    const set = this.rooms.get(sessionId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.rooms.delete(sessionId);
  }

  /**
   * @param {string} sessionId
   * @param {Record<string, unknown>} event
   */
  publish(sessionId, event) {
    const set = this.rooms.get(sessionId);
    if (!set) return 0;
    const wire = JSON.stringify(event);
    let sent = 0;
    for (const ws of set) {
      if (typeof ws.send !== 'function') continue;
      ws.send(wire);
      sent += 1;
    }
    return sent;
  }

  closeSession(sessionId, reason = 'session_destroyed') {
    const set = this.rooms.get(sessionId);
    if (!set) return 0;
    const msg = JSON.stringify({
      type: 'session_closed',
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      reason,
    });
    for (const ws of set) {
      ws.send?.(msg);
      ws.close?.(1000, 'session_closed');
    }
    this.rooms.delete(sessionId);
    return 1;
  }
}

module.exports = { SessionHub };
