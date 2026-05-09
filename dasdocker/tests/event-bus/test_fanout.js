'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionHub } = require('../../services/event-bus/src/session-hub');

test('Multiple clients in same session receive fan-out events', () => {
  const hub = new SessionHub();
  const one = [];
  const two = [];
  hub.addConnection('s1', { send: (x) => one.push(JSON.parse(x)) });
  hub.addConnection('s1', { send: (x) => two.push(JSON.parse(x)) });
  const sent = hub.publish('s1', { type: 'process_event', session_id: 's1', event_type: 'exec', comm: 'node' });
  assert.equal(sent, 2);
  assert.equal(one.length, 1);
  assert.equal(two.length, 1);
});

test('Session destroyed emits session_closed and closes subscribers', () => {
  const hub = new SessionHub();
  let closed = 0;
  const msgs = [];
  hub.addConnection('s1', {
    send: (x) => msgs.push(JSON.parse(x)),
    close: () => {
      closed += 1;
    },
  });
  hub.closeSession('s1', 'session_destroyed');
  assert.equal(closed, 1);
  assert.equal(msgs[0].type, 'session_closed');
});
