import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataPath } from './setup.js';
import { writeJson } from '../src/store/fileStore.js';

// googleAuth (googleapis, token storage) is mocked so the read path can be
// driven straight from seeded cache files: what's under test is which cached
// tasks reach the display, not the sync itself.

const m = vi.hoisted(() => ({
  listAccounts: vi.fn(() => []),
  getAuthorizedClient: vi.fn(() => ({})),
}));

vi.mock('../src/auth/googleAuth.js', () => ({
  listAccounts: m.listAccounts,
  getAuthorizedClient: m.getAuthorizedClient,
}));

const { getCachedGoogleTasks } = await import('../src/services/googleTodoService.js');

const CACHE_FILE = 'googleTasksCache.json';
const LISTS_FILE = 'googleTaskLists.json';

beforeEach(() => {
  m.listAccounts.mockReturnValue([{ id: 'acct-1' }]);
  fs.rmSync(dataPath(CACHE_FILE), { force: true });
  fs.rmSync(dataPath(LISTS_FILE), { force: true });
  fs.rmSync(dataPath('settings.json'), { force: true });
});

describe('getCachedGoogleTasks', () => {
  it('returns tasks from enabled lists only', () => {
    writeJson(CACHE_FILE, {
      'acct-1': [
        { id: 't1', listId: 'l1', title: 'On', completed: false },
        { id: 't2', listId: 'l2', title: 'Off', completed: false },
      ],
    });
    writeJson(LISTS_FILE, {
      'acct-1': [
        { id: 'l1', title: 'One', enabled: true },
        { id: 'l2', title: 'Two', enabled: false },
      ],
    });

    expect(getCachedGoogleTasks().map((task) => task.id)).toEqual(['t1']);
  });

  it('drops the whole Google half while the Google section is switched off', () => {
    writeJson(CACHE_FILE, { 'acct-1': [{ id: 't1', listId: 'l1', title: 'On', completed: false }] });
    writeJson(LISTS_FILE, { 'acct-1': [{ id: 'l1', title: 'One', enabled: true }] });
    // The display-wide Google on/off (see googleEnabled in settingsService.js).
    writeJson('settings.json', { googleEnabled: false });

    expect(getCachedGoogleTasks()).toEqual([]);
  });
});