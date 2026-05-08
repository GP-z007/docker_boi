import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionWebSocketClient } from '../lib/websocket-client.js';

describe('SessionWebSocketClient', () => {
  /** @type {Array<{ url: string, instance: any }>} */
  let sockets;

  beforeEach(() => {
    sockets = [];
    vi.useFakeTimers();

    globalThis.WebSocket = class MockWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.send = vi.fn();
        sockets.push({ url, instance: this });
      }

      close() {
        if (this.readyState === 3) {
          return;
        }
        this.readyState = 3;
        const handler = this.onclose;
        if (typeof handler === 'function') {
          handler.call(this);
        }
      }
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('injects JWT on the URL when authMode is url', () => {
    const client = new SessionWebSocketClient({
      wsUrl: 'ws://localhost:8787/stream',
      sessionId: '11111111-1111-4111-8111-111111111111',
      authToken: 'jwt-sample',
      authMode: 'url',
      minDelayMs: 500,
      maxDelayMs: 8000,
    });
    client.connect();

    expect(sockets[0].url).toContain('session_token=jwt-sample');
    client.disconnect();
  });

  it('sends auth as the first message when authMode is first_message', () => {
    const client = new SessionWebSocketClient({
      wsUrl: 'ws://localhost:8787/stream',
      sessionId: '22222222-2222-4222-8222-222222222222',
      authToken: 'jwt-first',
      authMode: 'first_message',
    });
    client.connect();
    const socket = sockets[0].instance;
    socket.onopen?.();

    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'auth', token: 'jwt-first', session_id: '22222222-2222-4222-8222-222222222222' }),
    );
    client.disconnect();
  });

  it('delivers subscribe callbacks for matching session events with namespaced metadata', () => {
    const client = new SessionWebSocketClient({
      wsUrl: 'ws://localhost:9000/rt',
      sessionId: '33333333-3333-4333-8333-333333333333',
      authToken: 'jwt',
      authMode: 'url',
    });
    client.connect();

    const handler = vi.fn();
    client.subscribe('telemetry', handler);
    sockets[0].instance.onmessage?.({
      data: JSON.stringify({
        event: 'telemetry',
        payload: { cpu: 1 },
        session_id: '33333333-3333-4333-8333-333333333333',
      }),
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      payload: { cpu: 1 },
      session_id: '33333333-3333-4333-8333-333333333333',
      __namespaced_event: '33333333-3333-4333-8333-333333333333:telemetry',
    });

    client.unsubscribe();
    client.disconnect();
  });

  it('ignores telemetry for a different session_id', () => {
    const client = new SessionWebSocketClient({
      wsUrl: 'ws://localhost:9000/rt',
      sessionId: '44444444-4444-4444-8444-444444444444',
      authToken: 'jwt',
      authMode: 'url',
    });
    client.connect();
    const handler = vi.fn();
    client.subscribe('telemetry', handler);
    sockets[0].instance.onmessage?.({
      data: JSON.stringify({
        event: 'telemetry',
        session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    });
    expect(handler).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('applies exponential backoff with a ceiling between reconnect attempts', () => {
    const client = new SessionWebSocketClient({
      wsUrl: 'ws://localhost:7777/rt',
      sessionId: '55555555-5555-4555-8555-555555555555',
      authToken: 'jwt',
      authMode: 'url',
      minDelayMs: 500,
      maxDelayMs: 2000,
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    client.connect();
    sockets[0].instance.onclose?.();

    const firstDelay = client._lastScheduledDelayMs;
    expect(firstDelay).toBe(500);

    vi.advanceTimersByTime(firstDelay);
    expect(sockets).toHaveLength(2);

    sockets[1].instance.onclose?.();
    const secondDelay = client._lastScheduledDelayMs;
    expect(secondDelay).toBe(1000);

    vi.advanceTimersByTime(secondDelay);
    sockets[2].instance.onclose?.();
    const thirdDelay = client._lastScheduledDelayMs;
    expect(thirdDelay).toBe(2000); // capped at maxDelayMs

    client.disconnect();
    vi.advanceTimersByTime(5000); // flush any pending timers harmlessly after disconnect clears user-closed guard
    Math.random.mockRestore();
  });
});
