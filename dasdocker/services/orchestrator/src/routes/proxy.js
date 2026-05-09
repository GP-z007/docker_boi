'use strict';

const http = require('http');
const https = require('https');

function decodeJwtNoVerify(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload;
  } catch {
    return null;
  }
}

function extractBearer(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length);
}

/**
 * @param {Record<string, string | string[] | undefined>} upstream
 */
function sanitizeProxyHeaders(upstream) {
  const out = {};
  for (const [k, v] of Object.entries(upstream || {})) {
    const lower = String(k).toLowerCase();
    if (lower === 'set-cookie') continue;
    if (lower === 'x-frame-options') continue;
    if (lower === 'content-security-policy') continue;
    out[k] = v;
  }
  out['Content-Security-Policy'] = "sandbox allow-scripts allow-forms allow-same-origin; default-src 'self'";
  out['X-Content-Type-Options'] = 'nosniff';
  return out;
}

/**
 * @param {string} targetUrl
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
function streamProxy(targetUrl, req, res) {
  const u = new URL(targetUrl);
  const transport = u.protocol === 'https:' ? https : http;
  const pReq = transport.request(
    {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: req.method,
      headers: {
        ...req.headers,
        host: u.host,
        authorization: undefined,
        cookie: undefined,
      },
    },
    (pRes) => {
      res.writeHead(pRes.statusCode || 502, sanitizeProxyHeaders(pRes.headers));
      pRes.pipe(res);
    },
  );
  pReq.on('error', () => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'proxy_upstream_error' }));
  });
  req.pipe(pReq);
}

/**
 * Lightweight route handler for:
 * GET /api/v1/sessions/:id/proxy/*
 *
 * deps:
 * - getSession(id) -> { id, state, app_port, container_ip }
 * - hasScope(claims, scope) -> boolean
 */
function createProxyHandler(deps) {
  return function proxyHandler(req, res) {
    const m = /^\/api\/v1\/sessions\/([^/]+)\/proxy\/?(.*)$/.exec(req.url || '');
    if (!m) {
      res.writeHead(404).end();
      return;
    }
    const sessionId = decodeURIComponent(m[1]);
    const subPath = m[2] || '';

    const token = extractBearer(req);
    const claims = decodeJwtNoVerify(token);
    if (!claims || !deps.hasScope(claims, 'session:read')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (claims.session_id && claims.session_id !== sessionId) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'session_scope_mismatch' }));
      return;
    }

    const session = deps.getSession(sessionId);
    if (!session || session.state !== 'RUNNING') {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'session_not_running' }));
      return;
    }
    if (!session.app_port || !session.container_ip) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'web_view_not_available' }));
      return;
    }

    const suffix = subPath ? `/${subPath}` : '/';
    const upstream = `http://${session.container_ip}:${session.app_port}${suffix}`;
    streamProxy(upstream, req, res);
  };
}

module.exports = {
  createProxyHandler,
  sanitizeProxyHeaders,
};
