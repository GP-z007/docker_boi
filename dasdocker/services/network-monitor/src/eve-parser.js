'use strict';

/**
 * Parse Suricata eve.json row and produce stream events.
 *
 * @param {Record<string, any>} row
 * @param {string|null} sessionId
 * @returns {null | Record<string, any>}
 */
function toDasdockerEvent(row, sessionId) {
  if (!sessionId) return null;
  const ts = row.timestamp || new Date().toISOString();
  if (row.event_type === 'alert' && row.alert) {
    return {
      type: 'alert_event',
      session_id: sessionId,
      timestamp: ts,
      severity: String(row.alert.severity || 'warn').toLowerCase(),
      rule_id: row.alert.signature_id ? `SURICATA-${row.alert.signature_id}` : 'SURICATA-UNKNOWN',
      description: row.alert.signature || 'Suricata IDS alert',
      evidence: {
        src_ip: row.src_ip || '',
        dest_ip: row.dest_ip || '',
        dest_port: row.dest_port || null,
      },
    };
  }
  if (row.event_type === 'dns' && row.dns) {
    return {
      type: 'network_event',
      session_id: sessionId,
      timestamp: ts,
      event_type: 'dns_query',
      pid: 0,
      comm: 'network-monitor',
      dst_ip: row.dest_ip || '',
      dst_port: row.dest_port || 53,
      proto: row.proto || 'udp',
      query: row.dns.rrname || '',
    };
  }
  if (row.event_type === 'http' && row.http) {
    return {
      type: 'network_event',
      session_id: sessionId,
      timestamp: ts,
      event_type: 'http_request',
      pid: 0,
      comm: 'network-monitor',
      dst_ip: row.dest_ip || '',
      dst_port: row.dest_port || 80,
      proto: row.proto || 'tcp',
      http_host: row.http.hostname || '',
      http_url: row.http.url || '',
      http_method: row.http.http_method || '',
    };
  }
  return null;
}

module.exports = { toDasdockerEvent };
