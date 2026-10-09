import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

// Exercises the real hub against a real HTTP server on an ephemeral port:
// the hydration burst a display gets on connect, and that broadcasts reach
// it. hub.js keeps one module-level WebSocketServer, so the "not started
// yet" case has to run before the describe below initialises it.

describe('before initWebSocket', () => {
  it('broadcasts are no-ops rather than crashes', async () => {
    const hub = await import('../src/ws/hub.js');
    expect(() => hub.broadcast({ type: 'probe' })).not.toThrow();
    expect(() => hub.broadcastCalendar()).not.toThrow();
  });
});

describe('with a live hub', () => {
  let hub;
  let server;
  let url;
  const openClients = [];

  beforeAll(async () => {
    hub = await import('../src/ws/hub.js');
    server = createServer();
    hub.initWebSocket(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `ws://127.0.0.1:${server.address().port}/ws`;
  });

  afterAll(async () => {
    for (const client of openClients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
  });

  // A connected display's message log. Resolves once the socket is open;
  // callers then wait for the messages they expect with vi.waitFor.
  function connect() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const messages = [];
      socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
      socket.on('open', () => {
        openClients.push(socket);
        resolve({ socket, messages });
      });
      socket.on('error', reject);
    });
  }

  it('hydrates a new connection with every feed in one go', async () => {
    const { messages } = await connect();
    await vi.waitFor(() => expect(messages).toHaveLength(5));

    // 'build' is last and is what tells a display that sat out a deploy to go
    // and reload -- see services/buildStamp.js.
    expect(messages.map((message) => message.type)).toEqual([
      'calendar',
      'todo',
      'settings',
      'weather',
      'build',
    ]);

    const [calendar, todo, settings] = messages;
    expect(calendar.data).toEqual([]);
    expect(calendar.grid).toEqual([]);
    expect(todo.data).toEqual([]);
    expect(settings.data).toMatchObject({ theme: expect.any(String), location: null });
  });

  it('delivers a broadcast to connected displays', async () => {
    const { messages } = await connect();
    await vi.waitFor(() => expect(messages).toHaveLength(5));

    hub.broadcast({ type: 'probe', data: 42 });
    await vi.waitFor(() =>
      expect(messages.some((message) => message.type === 'probe' && message.data === 42)).toBe(true)
    );
  });

  it('broadcastCalendar sends the calendar message shape', async () => {
    const { messages } = await connect();
    await vi.waitFor(() => expect(messages).toHaveLength(5));

    hub.broadcastCalendar();
    await vi.waitFor(() => {
      const calendar = messages.filter((message) => message.type === 'calendar').at(-1);
      expect(calendar).toMatchObject({ data: [], grid: [] });
    });
  });

  it('calendarMessage carries both the agenda feed and the grid feed', () => {
    expect(hub.calendarMessage()).toEqual({ type: 'calendar', data: [], grid: [] });
  });
});
