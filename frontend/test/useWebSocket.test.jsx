import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebSocket } from '../src/hooks/useWebSocket.js';
import { applyBuild } from '../src/utils/buildReload.js';

// Mocked because the real thing reloads the page, which jsdom cannot do and
// no test here should want. What it does with an id is buildReload's own
// test suite's business; this file only checks the message reaches it.
vi.mock('../src/utils/buildReload.js', () => ({ applyBuild: vi.fn() }));

// A stand-in for the browser's WebSocket that records what the hook asked
// for and lets each test drive the socket's events by hand.
class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.useFakeTimers();
  vi.mocked(applyBuild).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const last = () => FakeWebSocket.instances.at(-1);

describe('useWebSocket', () => {
  it('opens one socket at /ws on the current host, starting disconnected', () => {
    const { result } = renderHook(() => useWebSocket());

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(result.current.connected).toBe(false);
    expect(result.current.calendar).toEqual([]);
    expect(result.current.calendarGrid).toEqual([]);
    expect(result.current.todo).toEqual([]);
    expect(result.current.settings).toBeNull();
    expect(result.current.weather).toBeNull();

    const [url] = FakeWebSocket.instances[0].url.split(':');
    expect(['ws', 'wss']).toContain(url);
    expect(FakeWebSocket.instances[0].url.endsWith('/ws')).toBe(true);
  });

  it('reports connected once the socket opens, and not after it closes', () => {
    const { result } = renderHook(() => useWebSocket());
    const socket = last();

    act(() => socket.onopen());
    expect(result.current.connected).toBe(true);

    act(() => socket.onclose());
    expect(result.current.connected).toBe(false);
  });

  it('routes each message type into its own slice of state', () => {
    const { result } = renderHook(() => useWebSocket());
    const socket = last();

    act(() => {
      socket.onmessage({ data: JSON.stringify({ type: 'calendar', data: [{ id: 'e1' }], grid: [{ id: 'e1' }] }) });
      socket.onmessage({ data: JSON.stringify({ type: 'todo', data: [{ id: 't1' }] }) });
      socket.onmessage({ data: JSON.stringify({ type: 'settings', data: { theme: 'light' } }) });
      socket.onmessage({ data: JSON.stringify({ type: 'weather', data: { tempC: 21 } }) });
    });

    expect(result.current.calendar).toEqual([{ id: 'e1' }]);
    expect(result.current.calendarGrid).toEqual([{ id: 'e1' }]);
    expect(result.current.todo).toEqual([{ id: 't1' }]);
    expect(result.current.settings).toEqual({ theme: 'light' });
    expect(result.current.weather).toEqual({ tempC: 21 });
  });

  it('falls back to the full list for a server that predates the grid split', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      last().onmessage({ data: JSON.stringify({ type: 'calendar', data: [{ id: 'e1' }, { id: 'e2' }] }) });
    });

    expect(result.current.calendar).toHaveLength(2);
    expect(result.current.calendarGrid).toEqual(result.current.calendar);
  });

  it('hands a build message to the reload logic', () => {
    // The decision of whether to actually reload is buildReload's, and is
    // tested there -- including the guard against reloading in a loop. This
    // is the wiring: the message has to reach it at all, or the wall sits on
    // old code forever with nobody able to reach it and press F5.
    renderHook(() => useWebSocket());

    act(() => {
      last().onmessage({ data: JSON.stringify({ type: 'build', data: { id: 'new-build' } }) });
    });

    expect(applyBuild).toHaveBeenCalledWith('new-build');
  });

  it('does not hand anything else to the reload logic', () => {
    renderHook(() => useWebSocket());

    act(() => {
      last().onmessage({ data: JSON.stringify({ type: 'settings', data: { theme: 'light' } }) });
      last().onmessage({ data: JSON.stringify({ type: 'weather', data: { tempC: 21 } }) });
    });

    expect(applyBuild).not.toHaveBeenCalled();
  });

  it('reconnects two seconds after the connection drops', () => {
    renderHook(() => useWebSocket());
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => last().onclose());
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => vi.advanceTimersByTime(2000));
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('closes the socket on unmount and does not reconnect afterwards', () => {
    const { unmount } = renderHook(() => useWebSocket());
    const socket = last();

    unmount();
    expect(socket.closed).toBe(true);

    act(() => vi.advanceTimersByTime(10_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
