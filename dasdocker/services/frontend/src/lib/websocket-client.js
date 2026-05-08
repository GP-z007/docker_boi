/**
 * Session-scoped WebSocket helper for Agents 15–17.
 *
 * - Auth: JWT via `?session_token=` on the URL (`authMode: 'url'`) **or** first JSON message
 *   `{ type: 'auth', token, session_id }` (`authMode: 'first_message'`).
 * - ZTA: inbound payloads with a mismatched `session_id` are dropped (no cross-session fan-out).
 * - Reconnect: exponential backoff with jitter between `minDelayMs` and `maxDelayMs`.
 *
 * @typedef {{ type?: string, event?: string, session_id?: string }} WsJsonPayload
 */

function sleepSchedule(attempt, minDelayMs, maxDelayMs) {
  const exp = Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
  const jitter = Math.random() * 0.25 * exp;
  return Math.floor(exp + jitter);
}

export class SessionWebSocketClient {
  /**
   * @param {object} opts
   * @param {string} opts.wsUrl WebSocket URL without auth query
   * @param {string} opts.sessionId UUID for the active workspace
   * @param {string} opts.authToken Session-scoped JWT
   * @param {'url'|'first_message'} [opts.authMode]
   * @param {number} [opts.minDelayMs]
   * @param {number} [opts.maxDelayMs]
   */
  constructor({ wsUrl, sessionId, authToken, authMode = 'url', minDelayMs = 500, maxDelayMs = 30_000 }) {
    this.wsUrl = wsUrl;
    this.sessionId = sessionId;
    this.authToken = authToken;
    this.authMode = authMode;
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;

    /** @type {WebSocket|null} */
    this.ws = null;
    /** @type {Map<string, Set<Function>>} */
    this.handlers = new Map();
    this.closedByUser = false;
    this.reconnectAttempt = 0;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this.backoffTimer = null;
    /** bound for tests/backoff assertions */
    this._lastScheduledDelayMs = null;
  }

  _urlWithToken() {
    const url = new URL(this.wsUrl);
    url.searchParams.set('session_token', this.authToken);
    return url.toString();
  }

  _clearBackoff() {
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
  }

  _scheduleReconnect() {
    this._clearBackoff();
    const delay = sleepSchedule(this.reconnectAttempt, this.minDelayMs, this.maxDelayMs);
    this._lastScheduledDelayMs = delay;
    this.reconnectAttempt += 1;
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      this.connect();
    }, delay);
  }

  /** @param {string} raw */
  _handleMessage(raw) {
    /** @type {WsJsonPayload} */
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (data.session_id && data.session_id !== this.sessionId) {
      return;
    }
    const eventType = data.event ?? data.type;
    if (!eventType || eventType === 'auth') {
      return;
    }
    const scoped = /** @type {WsJsonPayload} */ ({
      ...data,
      session_id: this.sessionId,
      __namespaced_event: `${this.sessionId}:${eventType}`,
    });
    const listeners = this.handlers.get(eventType);
    if (!listeners) {
      return;
    }
    listeners.forEach((fn) => {
      fn(scoped);
    });
  }

  connect() {
    this.closedByUser = false;
    this._clearBackoff();
    const targetUrl = this.authMode === 'url' ? this._urlWithToken() : this.wsUrl;
    const socket = new WebSocket(targetUrl);
    this.ws = socket;

    socket.onopen = () => {
      if (this.authMode === 'first_message') {
        socket.send(
          JSON.stringify({
            type: 'auth',
            token: this.authToken,
            session_id: this.sessionId,
          }),
        );
      }
    };

    socket.onmessage = (event) => {
      this._handleMessage(event.data);
    };

    socket.onclose = () => {
      this.ws = null;
      if (!this.closedByUser) {
        this._scheduleReconnect();
      }
    };

    socket.onerror = () => {
      /* close event drives reconnect */
    };
  }

  disconnect() {
    this.closedByUser = true;
    this.reconnectAttempt = 0;
    this._clearBackoff();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Subscribe to orchestrator stream events (`event`/`type` field after JSON parse).
   * @param {string} eventType
   * @param {(payload: WsJsonPayload) => void} handler
   */
  subscribe(eventType, handler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    const bucket = this.handlers.get(eventType);
    bucket.add(handler);
    return () => {
      bucket.delete(handler);
      if (bucket.size === 0) {
        this.handlers.delete(eventType);
      }
    };
  }

  unsubscribe() {
    this.handlers.clear();
  }
}
