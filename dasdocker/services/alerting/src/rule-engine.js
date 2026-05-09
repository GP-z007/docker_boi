'use strict';

const fs = require('fs');

function loadRulesFromYamlJson(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed.rules || [];
}

function isRuleMatch(rule, event) {
  const p = String(rule.pattern || '');
  if (p.startsWith('metric:proc_spawn_rate_gt:')) {
    const n = Number(p.split(':').pop());
    return Number(event.proc_spawn_rate || 0) > n;
  }
  if (p.startsWith('network:port:')) {
    const rx = new RegExp(`^${p.slice('network:port:'.length)}$`);
    return rx.test(String(event.dst_port || ''));
  }
  if (p.startsWith('network:dns:')) {
    const rx = new RegExp(p.slice('network:dns:'.length), 'i');
    return rx.test(String(event.dns_query || ''));
  }
  if (p.startsWith('network:dst_ip:')) {
    const rx = new RegExp(`^${p.slice('network:dst_ip:'.length)}$`);
    return rx.test(String(event.dst_ip || ''));
  }
  if (p.startsWith('process:')) {
    const rx = new RegExp(p.slice('process:'.length), 'i');
    return rx.test(String(event.command || event.comm || ''));
  }
  if (p.startsWith('file:')) {
    const rx = new RegExp(p.slice('file:'.length), 'i');
    return rx.test(String(event.path || ''));
  }
  return false;
}

/**
 * @param {{ session_id: string, timestamp?: string, [k:string]: any }} event
 * @param {Array<{rule_id: string, severity: string, description: string, pattern: string, action: string}>} rules
 */
function evaluateAlerts(event, rules) {
  const out = [];
  for (const rule of rules) {
    if (!isRuleMatch(rule, event)) continue;
    out.push({
      type: 'alert_event',
      session_id: event.session_id,
      timestamp: event.timestamp || new Date().toISOString(),
      severity: String(rule.severity || '').toLowerCase(),
      rule_id: rule.rule_id,
      description: rule.description,
      evidence: {
        matched_pattern: rule.pattern,
        event_meta: {
          event_type: event.type || event.event_type || 'unknown',
          comm: event.comm || '',
          dst_port: event.dst_port || null,
          dst_ip: event.dst_ip || null,
        },
      },
    });
  }
  return out;
}

module.exports = { loadRulesFromYamlJson, evaluateAlerts };
