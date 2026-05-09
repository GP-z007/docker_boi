'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const { SessionHub } = require('./session-hub');
const { validateJwtForSession } = require('./jwt-auth');

function tokenFromReq(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  return null;
}

/**
 * @param {{
 *  server?: import('http').Server,
 *  publicKeyPem: string,
 *  expectedAudience?: string
 * }} cfg
 */
function createEventBusServer(cfg) {
  const server = cfg.server || http.createServer();
  const hub = new SessionHub();
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const m = /^\/events\/([A-Za-z0-9._-]{1,128})$/.exec(url.pathname);
    if (!m) {
      socket.destroy();
      return;
    }
    const sessionId = m[1];
    const token = tokenFromReq(req);
    if (!token) {
      socket.destroy();
      return;
    }
    const v = validateJwtForSession({
      token,
      sessionIdFromPath: sessionId,
      publicKeyPem: cfg.publicKeyPem,
      expectedAudience: cfg.expectedAudience || 'obs:subscribe',
    });

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!v.ok) {
        ws.close(v.code, v.reason);
        return;
      }
      hub.addConnection(sessionId, ws);
      ws.on('close', () => hub.removeConnection(sessionId, ws));
    });
  });

  return { server, wss, hub };
}

module.exports = { createEventBusServer };
