'use strict';

/**
 * Maintains source-ip -> session mapping from orchestrator lifecycle events.
 */
class SessionRegistry {
  constructor() {
    /** @type {Map<string,{session_id:string,container_id:string,source_ip:string}>} */
    this.byIp = new Map();
  }

  /**
   * @param {{session_id:string,container_id:string,source_ip:string}} row
   */
  upsert(row) {
    if (!row || !row.source_ip || !row.session_id) return;
    this.byIp.set(row.source_ip, {
      session_id: row.session_id,
      container_id: row.container_id || '',
      source_ip: row.source_ip,
    });
  }

  /**
   * @param {string} sourceIp
   */
  lookupSession(sourceIp) {
    const hit = this.byIp.get(sourceIp);
    return hit ? hit.session_id : null;
  }

  /**
   * @param {string} sessionId
   */
  removeBySession(sessionId) {
    for (const [ip, row] of this.byIp.entries()) {
      if (row.session_id === sessionId) this.byIp.delete(ip);
    }
  }
}

module.exports = { SessionRegistry };
