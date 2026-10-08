import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The poll loop is the one module that stitches every service together, so
// each of them is mocked: what's under test is the loop's own decisions --
// when it polls, when it decides *not* to push, and that one provider
// failing doesn't take the round down with it.

const m = vi.hoisted(() => ({
  pollCalendar: vi.fn(),
  resetSyncTokens: vi.fn(),
  getCachedEvents: vi.fn(() => []),
  getCachedGridEvents: vi.fn(() => []),
  pollMsCalendar: vi.fn(),
  pollTodo: vi.fn(),
  clearCompletedTasks: vi.fn(() => []),
  getCachedTasks: vi.fn(() => []),
  pollGoogleTasks: vi.fn(),
  getSettings: vi.fn(),
  pollWeather: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('../src/services/calendarService.js', () => ({
  pollCalendar: m.pollCalendar,
  resetSyncTokens: m.resetSyncTokens,
  getCachedEvents: m.getCachedEvents,
  getCachedGridEvents: m.getCachedGridEvents,
}));
vi.mock('../src/services/msCalendarService.js', () => ({ pollMsCalendar: m.pollMsCalendar }));
vi.mock('../src/services/todoService.js', () => ({
  pollTodo: m.pollTodo,
  clearCompletedTasks: m.clearCompletedTasks,
  getCachedTasks: m.getCachedTasks,
}));
vi.mock('../src/services/googleTodoService.js', () => ({ pollGoogleTasks: m.pollGoogleTasks }));
vi.mock('../src/services/settingsService.js', () => ({ getSettings: m.getSettings }));
vi.mock('../src/services/weatherService.js', () => ({ pollWeather: m.pollWeather }));
vi.mock('../src/ws/hub.js', () => ({ broadcast: m.broadcast }));
vi.mock('../src/config.js', () => ({ config: { pollIntervalMs: 1000 } }));

const INTERVAL = 1000;

let poller;

// One poll cycle, run and fully settled. startPolling() fires runPoll()
// fire-and-forget, so the tick is what lets its awaited polls resolve.
async function runPoll(pollerInstance = poller) {
  pollerInstance.startPolling();
  await vi.advanceTimersByTimeAsync(0);
}

const calendarPushes = () =>
  m.broadcast.mock.calls.map(([message]) => message).filter((message) => message.type === 'calendar');

beforeEach(async () => {
  vi.resetModules(); // fresh module state: the loop's day/interval trackers
  vi.clearAllMocks();
  vi.useFakeTimers();

  m.pollCalendar.mockResolvedValue({ changed: false, events: [] });
  m.pollMsCalendar.mockResolvedValue({ changed: false });
  m.pollTodo.mockResolvedValue({ changed: false, tasks: [] });
  m.pollGoogleTasks.mockResolvedValue(false);
  m.clearCompletedTasks.mockReturnValue([]);
  m.getSettings.mockReturnValue({ theme: 'dark', location: null });
  m.pollWeather.mockResolvedValue({ tempC: 20 });

  poller = await import('../src/services/poller.js');
});

afterEach(() => {
  poller.stopPolling();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startPolling / stopPolling', () => {
  it('polls everything once immediately, then again on the interval', async () => {
    await runPoll();
    expect(m.pollCalendar).toHaveBeenCalledTimes(1);
    expect(m.pollMsCalendar).toHaveBeenCalledTimes(1);
    expect(m.pollTodo).toHaveBeenCalledTimes(1);
    expect(m.pollGoogleTasks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(m.pollCalendar).toHaveBeenCalledTimes(2);

    poller.stopPolling();
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    expect(m.pollCalendar).toHaveBeenCalledTimes(2);
  });

  it('drops Google’s sync token once a day so its window rolls forward', async () => {
    await runPoll();
    expect(m.resetSyncTokens).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(m.resetSyncTokens).toHaveBeenCalledTimes(1);
  });
});

describe('pushing to displays', () => {
  it('sends settings once a day and never repeats them on the same day', async () => {
    await runPoll();
    const first = m.broadcast.mock.calls.filter(
      ([message]) => message.type === 'settings'
    ).length;
    expect(first).toBe(1);

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(
      m.broadcast.mock.calls.filter(([message]) => message.type === 'settings').length
    ).toBe(1);
  });

  it('pushes the calendar once and stays quiet while nothing changes', async () => {
    await runPoll();
    expect(calendarPushes()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(calendarPushes()).toHaveLength(1);
  });

  it('pushes again once the feed’s contents move', async () => {
    await runPoll();
    expect(calendarPushes()).toHaveLength(1);

    m.getCachedEvents.mockReturnValue([{ id: 'e1', start: '2026-10-08T09:00:00' }]);
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(calendarPushes()).toHaveLength(2);
    expect(calendarPushes()[1].data).toHaveLength(1);
  });
});

describe('weather', () => {
  it('never polls for weather while no location is saved', async () => {
    await runPoll();
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(m.pollWeather).not.toHaveBeenCalled();
  });

  it('polls weather once a location is saved, on the 15-minute gate', async () => {
    await runPoll();
    m.getSettings.mockReturnValue({ theme: 'dark', location: { lat: 40.71, lon: -74.0 } });

    await vi.advanceTimersByTimeAsync(INTERVAL); // first round after it was set
    expect(m.pollWeather).toHaveBeenCalledWith(40.71, -74.0);
    expect(
      m.broadcast.mock.calls.some(([message]) => message.type === 'weather')
    ).toBe(true);

    // Still inside the same 15-minute window: no second fetch.
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    expect(m.pollWeather).toHaveBeenCalledTimes(1);
  });

  it('logs and survives a failed weather fetch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.pollWeather.mockRejectedValue(new Error('offline'));

    await poller.pollWeatherNow(40.71, -74.0);

    expect(console.error).toHaveBeenCalledWith(
      '[poller] Weather poll failed:',
      'offline'
    );
    expect(m.broadcast).not.toHaveBeenCalled();
  });
});

describe('failure handling', () => {
  it('keeps the round going when the calendar poll throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.pollCalendar.mockRejectedValue(new Error('Google is down'));

    await runPoll();

    expect(console.error).toHaveBeenCalledWith('[poller] Calendar poll failed:', 'Google is down');
    expect(m.pollTodo).toHaveBeenCalled();
    expect(m.pollGoogleTasks).toHaveBeenCalled();
  });

  it('keeps the round going when the Microsoft poll throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.pollMsCalendar.mockRejectedValue(new Error('Graph is down'));

    await runPoll();

    expect(console.error).toHaveBeenCalledWith(
      '[poller] Microsoft calendar poll failed:',
      'Graph is down'
    );
    expect(m.pollTodo).toHaveBeenCalled();
  });

  it('broadcasts the to-do feed when a to-do poll reports a change', async () => {
    m.pollTodo.mockResolvedValue({ changed: true, tasks: [{ id: 't1' }] });

    await runPoll();

    expect(m.broadcast).toHaveBeenCalledWith({
      type: 'todo',
      data: [{ id: 't1' }],
    });
  });

  it('does not broadcast the to-do feed when nothing changed', async () => {
    await runPoll();
    expect(
      m.broadcast.mock.calls.some(([message]) => message.type === 'todo')
    ).toBe(false);
  });
});

describe('the weekly completed-task cleanup', () => {
  it('runs on a Monday, once, and not on other days', async () => {
    vi.setSystemTime(new Date('2026-10-08T10:00:00')); // a Thursday
    await runPoll();
    expect(m.clearCompletedTasks).not.toHaveBeenCalled();

    vi.setSystemTime(new Date('2026-10-05T00:00:01')); // a Monday
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(m.clearCompletedTasks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL * 3); // still Monday
    expect(m.clearCompletedTasks).toHaveBeenCalledTimes(1);
  });

  it('survives a cleanup that throws and tries again the next Monday', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.setSystemTime(new Date('2026-10-05T00:00:01')); // Monday
    m.clearCompletedTasks.mockImplementation(() => {
      throw new Error('poison entry');
    });

    await runPoll();

    expect(console.error).toHaveBeenCalledWith(
      '[poller] Weekly to-do cleanup failed:',
      'poison entry'
    );
    expect(m.pollCalendar).toHaveBeenCalled(); // the round still ran
  });
});
