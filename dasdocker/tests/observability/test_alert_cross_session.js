'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionHub } = require('../../services/event-bus/src/session-hub');
const { publishAlertEvent } = require('../../services/alerting/src/publisher');

test('Alert for session A never appears on session B stream', () => {
  const hub = new SessionHub();
  const streamA = [];
  const streamB = [];
  hub.addConnection('session-a', { send: (x) => streamA.push(JSON.parse(x)) });
  hub.addConnection('session-b', { send: (x) => streamB.push(JSON.parse(x)) });

  publishAlertEvent(hub, {
    type: 'alert_event',
    session_id: 'session-a',
    severity: 'critical',
    rule_id: 'ALERT-002',
    description: 'Potential reverse shell',
  });

  assert.equal(streamA.length, 1);
  assert.equal(streamB.length, 0);
});
