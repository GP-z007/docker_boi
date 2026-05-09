import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const SESSIONS_API = `${BASE_URL}/api/v1/sessions`;
const GITHUB_URL = __ENV.LOADTEST_GITHUB_URL || 'https://github.com/octocat/Hello-World';
const TTL_SECONDS = Number(__ENV.LOADTEST_TTL_SECONDS || 60);
const WS_OBSERVE_SECONDS = Number(__ENV.LOADTEST_WS_OBSERVE_SECONDS || 60);
const RUNNING_TIMEOUT_SECONDS = Number(__ENV.LOADTEST_RUNNING_TIMEOUT_SECONDS || 120);
const DESTROYED_TIMEOUT_SECONDS = Number(__ENV.LOADTEST_DESTROYED_TIMEOUT_SECONDS || 180);
const POLL_INTERVAL_SECONDS = Number(__ENV.LOADTEST_POLL_INTERVAL_SECONDS || 2);
const AUTH_BEARER = __ENV.LOADTEST_AUTH_BEARER || '';
const EVENTS_URL = (__ENV.EVENTS_BASE_URL || BASE_URL).replace(/^http/, 'ws');

const timeToRunning = new Trend('custom_time_to_running', true);
const selfDestructAccuracy = new Trend('self_destruct_accuracy', true);
const lifecycleFailures = new Rate('custom_lifecycle_failed');

export const options = {
  scenarios: {
    full_lifecycle_50_vus: {
      executor: 'per-vu-iterations',
      vus: 50,
      iterations: 1,
      maxDuration: '20m',
    },
  },
  thresholds: {
    'http_req_duration{name:create_session}': ['p(95)<2000'],
    'custom_time_to_running': ['p(95)<60000'],
    // Absolute TTL drift in ms; 10000 => ±10s.
    'self_destruct_accuracy': ['p(95)<10000'],
    'http_req_failed': ['rate<0.01'],
    'custom_lifecycle_failed': ['rate<0.01'],
  },
};

function authHeaders(extra = {}) {
  const headers = {
    'content-type': 'application/json',
    ...extra,
  };
  if (AUTH_BEARER) headers.Authorization = `Bearer ${AUTH_BEARER}`;
  return headers;
}

function parseJson(resp, fallback = {}) {
  try {
    return resp.json();
  } catch {
    return fallback;
  }
}

function waitForState(sessionId, wantedState, timeoutSeconds) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < timeoutSeconds) {
    const r = http.get(`${SESSIONS_API}/${encodeURIComponent(sessionId)}`, {
      headers: authHeaders(),
      tags: { name: 'get_session' },
      timeout: '30s',
    });
    const body = parseJson(r);
    if (r.status === 200 && body?.state === wantedState) {
      return { ok: true, state: body.state, body, ts: Date.now() };
    }
    if (r.status >= 400 && r.status < 500 && r.status !== 409) {
      return { ok: false, reason: `unexpected_http_${r.status}`, body };
    }
    sleep(POLL_INTERVAL_SECONDS);
  }
  return { ok: false, reason: `timeout_waiting_${wantedState}` };
}

export default function () {
  const startMs = Date.now();
  const payload = JSON.stringify({
    source_type: 'github',
    github_url: GITHUB_URL,
    running_ttl_seconds: TTL_SECONDS,
    install_commands: [],
    entrypoint: 'echo started && sleep 5',
  });

  const create = http.post(SESSIONS_API, payload, {
    headers: authHeaders(),
    tags: { name: 'create_session' },
    timeout: '30s',
  });

  const createBody = parseJson(create);
  const sessionId = createBody?.session_id || createBody?.id;

  const createOk = check(create, {
    'create status 201': (r) => r.status === 201,
    'session id returned': () => typeof sessionId === 'string' && sessionId.length > 0,
  });
  if (!createOk) {
    lifecycleFailures.add(1);
    return;
  }

  const toRunning = waitForState(sessionId, 'RUNNING', RUNNING_TIMEOUT_SECONDS);
  if (!toRunning.ok) {
    lifecycleFailures.add(1);
    return;
  }
  timeToRunning.add(toRunning.ts - startMs);

  const token = createBody?.token || AUTH_BEARER;
  const wsHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const wsUrl = `${EVENTS_URL}/events/${encodeURIComponent(sessionId)}`;
  const wsRes = ws.connect(wsUrl, { headers: wsHeaders }, function (socket) {
    socket.on('open', () => {
      // If backend expects first-message auth mode, sending auth is harmless for header mode.
      if (token) socket.send(JSON.stringify({ type: 'auth', token, session_id: sessionId }));
    });
    socket.on('error', () => {
      lifecycleFailures.add(1);
    });
    sleep(WS_OBSERVE_SECONDS);
    socket.close();
  });
  check(wsRes, { 'websocket connect status 101': (r) => r && r.status === 101 });

  const toDestroyed = waitForState(sessionId, 'DESTROYED', DESTROYED_TIMEOUT_SECONDS);
  if (!toDestroyed.ok) {
    lifecycleFailures.add(1);
    return;
  }

  const elapsedSeconds = (toDestroyed.ts - toRunning.ts) / 1000;
  const driftMs = Math.abs(elapsedSeconds - TTL_SECONDS) * 1000;
  selfDestructAccuracy.add(driftMs);
  lifecycleFailures.add(0);
}
