#!/usr/bin/env node
'use strict';

/** stdin = JSON payload from curl (sessions list mirror of GET response) */

const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const base = process.env.DASDOCKER_ORCHESTRATOR_URL || 'http://127.0.0.1:8080';
const token = process.env.DASDOCKER_WATCHDOG_JWT;
if (!token) process.exit(2);

/**
 * DELETE without curl: avoids TZ/sandbox quirks and stdin inheritance issues when spawned from scripts.
 *
 * @param {string} sessionId
 */
function deleteSession(sessionId) {
  const rel = `/api/v1/sessions/${encodeURIComponent(sessionId)}`;
  let u;
  try {
    u = new URL(rel, base);
  } catch {
    return Promise.resolve(0);
  }
  const mod = u.protocol === 'https:' ? https : http;

  const opts = {
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: `${u.pathname}${u.search}`,
    method: 'DELETE',
    agent: false,
    headers: {
      Authorization: `Bearer ${token}`,
      Connection: 'close',
    },
  };

  return new Promise((resolve) => {
    const req = mod.request(opts, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', () => resolve(0));
    req.end();
  });
}

async function main() {
  const stdin = fs.readFileSync(0, 'utf8').trim();
  let rows;
  try {
    const j = JSON.parse(stdin);
    rows = Array.isArray(j) ? j : j.sessions || j.data || [];
  } catch {
    process.exit(1);
  }
  const now = Date.now();
  for (const s of rows) {
    const id = s.session_id || s.id;
    const state = s.state;
    if (!id || !state || state === 'DESTROYED' || state === 'FAILED') continue;
    const ex = s.expires_at ? Date.parse(s.expires_at) : 0;
    if (ex && ex < now) await deleteSession(String(id));
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(2));
