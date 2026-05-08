'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const RUNNER = path.join(__dirname, '../../services/orchestrator/scripts/watchdog-runner.cjs');

function runRunnerAsync(payload, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [RUNNER], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.on('error', reject);
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.stdin.end(payload, 'utf8');
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

test('VT-RED-S14: watchdog-runner issues DELETE for overdue sessions', async () => {
  let deleted = 0;
  const srv = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/v1/sessions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          sessions: [
            {
              session_id: 'late-1',
              state: 'RUNNING',
              expires_at: new Date(Date.now() - 60_000).toISOString(),
            },
          ],
        }),
      );
      return;
    }
    if (req.method === 'DELETE' && req.url === '/api/v1/sessions/late-1') {
      deleted += 1;
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = /** @type {import('net').AddressInfo} */ (srv.address());

  const payload = JSON.stringify({
    sessions: [
      {
        session_id: 'late-1',
        state: 'RUNNING',
        expires_at: new Date(Date.now() - 120_000).toISOString(),
      },
    ],
  });

  const env = {
    ...process.env,
    DASDOCKER_ORCHESTRATOR_URL: `http://127.0.0.1:${port}`,
    DASDOCKER_WATCHDOG_JWT: 'test-watchdog',
  };

  try {
    /* Async spawn: spawnSync in the listen stack deadlocks the event loop while the child HTTP-deletes this server. */
    const r = await runRunnerAsync(payload, env);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(deleted, 1);
  } finally {
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
    await new Promise((resolve, reject) => srv.close((e) => (e ? reject(e) : resolve())));
  }
});
