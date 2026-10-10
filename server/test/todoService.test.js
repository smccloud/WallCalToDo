import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataPath } from './setup.js';
import { readJson, writeJson } from '../src/store/fileStore.js';

// microsoftAuth (MSAL + Graph) and googleTodoService (googleapis) are both
// mocked out: this suite is about the local cache -- what's kept on disk,
// which lists reach the display, and how a delta poll is normalised -- not
// about either provider's client library.

const m = vi.hoisted(() => ({
  listTodoLists: vi.fn(),
  isAuthorized: vi.fn(),
  getAccessToken: vi.fn(),
  graphFetch: vi.fn(),
  getCachedGoogleTasks: vi.fn(() => []),
}));

vi.mock('../src/auth/microsoftAuth.js', () => ({
  listTodoLists: m.listTodoLists,
  isAuthorized: m.isAuthorized,
  getAccessToken: m.getAccessToken,
  graphFetch: m.graphFetch,
  TODO_SCOPES: ['Tasks.Read', 'offline_access'],
}));

vi.mock('../src/services/googleTodoService.js', () => ({
  getCachedGoogleTasks: m.getCachedGoogleTasks,
}));

const { clearCompletedTasks, dropAllListsCache, dropListCache, getCachedTasks, pollTodo } =
  await import('../src/services/todoService.js');

const TASKS_FILE = 'msTasksCache.json';
const SYNC_FILE = 'msSync.json';

const lists = (entries) => m.listTodoLists.mockReturnValue(entries);
const noLists = () => lists([]);

beforeEach(() => {
  vi.clearAllMocks();
  m.getCachedGoogleTasks.mockReturnValue([]);
  m.isAuthorized.mockResolvedValue(false);
  noLists();
  m.graphFetch.mockResolvedValue({ value: [] });
  fs.rmSync(dataPath(TASKS_FILE), { force: true });
  fs.rmSync(dataPath(SYNC_FILE), { force: true });
});

describe('getCachedTasks', () => {
  it('is empty before anything has been polled', () => {
    expect(getCachedTasks()).toEqual([]);
  });

  it('returns only tasks from lists that are currently enabled', () => {
    writeJson(TASKS_FILE, {
      'list-work': {
        w1: { id: 'w1', title: 'Standup', completed: false, listLabel: 'Work' },
      },
      'list-home': {
        h1: { id: 'h1', title: 'Bins', completed: false, listLabel: 'Home' },
      },
    });
    lists([
      { id: 'list-work', displayName: 'Work', enabled: true },
      { id: 'list-home', displayName: 'Home', enabled: false },
    ]);

    expect(getCachedTasks().map((task) => task.id)).toEqual(['w1']);
  });

  it('sorts incomplete tasks first, then by title ignoring case', () => {
    writeJson(TASKS_FILE, {
      'list-1': {
        b: { id: 'b', title: 'apples', completed: true, listLabel: 'L' },
        c: { id: 'c', title: 'Zebra', completed: false, listLabel: 'L' },
        a: { id: 'a', title: 'Banana', completed: false, listLabel: 'L' },
      },
    });
    lists([{ id: 'list-1', displayName: 'L', enabled: true }]);

    expect(getCachedTasks().map((task) => task.id)).toEqual(['a', 'c', 'b']);
  });

  it('skips a hole in the cache file instead of crashing the read', () => {
    writeJson(TASKS_FILE, { 'list-1': { good: { id: 'good', title: 'ok', completed: false }, bad: null } });
    lists([{ id: 'list-1', displayName: 'L', enabled: true }]);

    expect(getCachedTasks().map((task) => task.id)).toEqual(['good']);
  });

  it('appends Google tasks from the mocked provider', () => {
    m.getCachedGoogleTasks.mockReturnValue([{ id: 'g1', title: 'From Google', completed: false }]);
    expect(getCachedTasks().map((task) => task.id)).toEqual(['g1']);
  });

  it('drops Microsoft tasks while the Microsoft section is switched off', () => {
    writeJson(TASKS_FILE, {
      'list-work': {
        w1: { id: 'w1', title: 'Standup', completed: false, listLabel: 'Work' },
      },
    });
    lists([{ id: 'list-work', displayName: 'Work', enabled: true }]);
    m.getCachedGoogleTasks.mockReturnValue([{ id: 'g1', title: 'From Google', completed: false }]);

    // The display-wide on/off — off, so Microsoft's half of the to-do feed
    // disappears but Google tasks are not Microsoft's and so stay.
    writeJson('settings.json', { microsoftEnabled: false });
    expect(getCachedTasks().map((task) => task.id)).toEqual(['g1']);
    // Restore the default so the rest of this file's tests still see MS tasks.
    fs.rmSync(dataPath('settings.json'), { force: true });
    expect(getCachedTasks().map((task) => task.id)).toEqual(['g1', 'w1']);
  });
});

describe('clearCompletedTasks', () => {
  it('drops completed tasks and unreadable entries, keeping the rest', () => {
    writeJson(TASKS_FILE, {
      'list-1': {
        open: { id: 'open', title: 'Still to do', completed: false, listLabel: 'L' },
        done: { id: 'done', title: 'Finished', completed: true, listLabel: 'L' },
        poison: null,
      },
    });
    lists([{ id: 'list-1', displayName: 'L', enabled: true }]);

    const remaining = clearCompletedTasks();
    expect(remaining.map((task) => task.id)).toEqual(['open']);
    expect(Object.keys(readJson(TASKS_FILE, {})['list-1'])).toEqual(['open']);
  });
});

describe('cache eviction', () => {
  it('dropListCache removes only that list, sync state included', () => {
    writeJson(TASKS_FILE, { one: { a: { id: 'a' } }, two: { b: { id: 'b' } } });
    writeJson(SYNC_FILE, { one: { deltaLink: 'x' }, two: { deltaLink: 'y' } });

    dropListCache('one');

    expect(readJson(TASKS_FILE, {})).toEqual({ two: { b: { id: 'b' } } });
    expect(readJson(SYNC_FILE, {})).toEqual({ two: { deltaLink: 'y' } });
  });

  it('dropAllListsCache empties both files', () => {
    writeJson(TASKS_FILE, { one: { a: { id: 'a' } } });
    writeJson(SYNC_FILE, { one: { deltaLink: 'x' } });

    dropAllListsCache();

    expect(readJson(TASKS_FILE, null)).toEqual({});
    expect(readJson(SYNC_FILE, null)).toEqual({});
  });
});

describe('pollTodo', () => {
  it('does nothing while Microsoft is unconfigured', async () => {
    m.isAuthorized.mockResolvedValue(false);
    expect(await pollTodo()).toEqual({ changed: false, tasks: [] });
    expect(m.graphFetch).not.toHaveBeenCalled();
  });

  it('does nothing while no lists are known', async () => {
    m.isAuthorized.mockResolvedValue(true);
    noLists();
    expect(await pollTodo()).toEqual({ changed: false, tasks: [] });
  });

  const task = {
    id: 't1',
    title: 'Buy milk',
    status: 'active',
    importance: 'high',
    dueDateTime: { dateTime: '2026-03-20T15:00:00.0000000', timeZone: 'UTC' },
  };

  it('normalises a full delta poll and stores the delta link', async () => {
    m.isAuthorized.mockResolvedValue(true);
    lists([{ id: 'list-1', displayName: 'Work', enabled: true }]);
    m.getAccessToken.mockResolvedValue('token');
    m.graphFetch.mockResolvedValue({
      value: [task],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/todo/lists/list-1/tasks/delta?deltatoken=abc',
    });

    const { changed, tasks } = await pollTodo();

    expect(changed).toBe(true);
    expect(tasks).toEqual([
      {
        id: 't1',
        title: 'Buy milk',
        completed: false,
        // UTC-labeled Graph times are stamped with an explicit Z so the
        // display reads them as the instant they are.
        due: '2026-03-20T15:00:00.0000000Z',
        importance: 'high',
        listLabel: 'Work',
      },
    ]);
    expect(m.graphFetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/todo/lists/list-1/tasks/delta',
      'token'
    );
    expect(readJson(SYNC_FILE, {})['list-1'].deltaLink).toContain('deltatoken=abc');
  });

  it('follows @odata.nextLink through every page before finishing', async () => {
    m.isAuthorized.mockResolvedValue(true);
    lists([{ id: 'list-1', displayName: 'Work', enabled: true }]);
    m.getAccessToken.mockResolvedValue('token');
    m.graphFetch
      .mockResolvedValueOnce({ value: [task], '@odata.nextLink': 'https://graph/page2' })
      .mockResolvedValueOnce({
        value: [{ ...task, id: 't2', title: 'Second page' }],
        '@odata.deltaLink': 'https://graph/delta',
      });

    const { changed, tasks } = await pollTodo();

    expect(changed).toBe(true);
    expect(tasks.map((entry) => entry.id)).toEqual(['t1', 't2']);
    expect(m.graphFetch).toHaveBeenNthCalledWith(2, 'https://graph/page2', 'token');
  });

  it('applies a removal from the delta feed', async () => {
    writeJson(TASKS_FILE, { 'list-1': { t1: { id: 't1', title: 'Buy milk', completed: false } } });
    m.isAuthorized.mockResolvedValue(true);
    lists([{ id: 'list-1', displayName: 'Work', enabled: true }]);
    m.getAccessToken.mockResolvedValue('token');
    m.graphFetch.mockResolvedValue({ value: [{ id: 't1', '@removed': true }] });

    const { changed, tasks } = await pollTodo();

    expect(changed).toBe(true);
    expect(tasks).toEqual([]);
  });

  it('clears the list and forces a resync when the delta link expires (410)', async () => {
    writeJson(TASKS_FILE, { 'list-1': { t1: { id: 't1', title: 'Buy milk', completed: false } } });
    writeJson(SYNC_FILE, { 'list-1': { deltaLink: 'https://graph/expired' } });
    m.isAuthorized.mockResolvedValue(true);
    lists([{ id: 'list-1', displayName: 'Work', enabled: true }]);
    m.getAccessToken.mockResolvedValue('token');
    m.graphFetch.mockRejectedValue(Object.assign(new Error('Gone'), { status: 410 }));

    const { changed, tasks } = await pollTodo();

    expect(changed).toBe(true);
    expect(tasks).toEqual([]);
    expect(readJson(SYNC_FILE, {})['list-1']).toEqual({});
  });

  it('reports no change and keeps the cache when a poll fails for any other reason', async () => {
    writeJson(TASKS_FILE, { 'list-1': { t1: { id: 't1', title: 'Buy milk', completed: false } } });
    m.isAuthorized.mockResolvedValue(true);
    lists([{ id: 'list-1', displayName: 'Work', enabled: true }]);
    m.getAccessToken.mockResolvedValue('token');
    m.graphFetch.mockRejectedValue(new Error('ECONNRESET'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { changed, tasks } = await pollTodo();

    expect(changed).toBe(false);
    expect(tasks.map((task) => task.id)).toEqual(['t1']);
    expect(console.error).toHaveBeenCalled();
  });
});
