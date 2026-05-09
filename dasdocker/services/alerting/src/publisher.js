'use strict';

/**
 * Minimal publisher contract: event bus hub receives per-session events only.
 * @param {{ publish: (sessionId: string, evt: Record<string, unknown>) => number }} hub
 * @param {Record<string, unknown>} alertEvent
 */
function publishAlertEvent(hub, alertEvent) {
  const sid = String(alertEvent.session_id || '');
  if (!sid) return 0;
  return hub.publish(sid, alertEvent);
}

module.exports = { publishAlertEvent };
