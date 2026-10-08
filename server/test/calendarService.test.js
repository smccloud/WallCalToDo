import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataPath } from './setup.js';
import { readJson, writeJson } from '../src/store/fileStore.js';

// googleAuth (googleapis, token storage) is mocked so the Google half of the
// feed can be driven straight from a seeded cache file: what's under test is
// which cached entries reach the display and when they're evicted, not the
// sync itself. The Microsoft half reads its own cache file, which stays empty
// throughout -- no MS account is configured in the scratch data dir.

const m = vi.hoisted(() => ({
  listAccounts: vi.fn(() => []),
  getAuthorizedClient: vi.fn(() => ({})),
}));

vi.mock('../src/auth/googleAuth.js', () => ({
  listAccounts: m.listAccounts,
  getAuthorizedClient: m.getAuthorizedClient,
}));

const {
  dropAccountCache,
  getCachedEvents,
  getCachedGridEvents,
  pollCalendar,
  resetSyncTokens,
} = await import('../src/services/calendarService.js');

const EVENTS_FILE = 'googleEventsCache.json';
const SYNC_FILE = 'googleSync.json';

const EVENT = (id, start) => ({ id, start, end: start, title: id });

const ACCOUNTS = [
  {
    id: 'acct-1',
    email: 'one@example.com',
    calendars: [
      { id: 'cal-a', summary: 'Work', backgroundColor: '#123456', enabled: true },
      { id: 'cal-b', summary: 'Hidden', backgroundColor: '#654321', enabled: false },
    ],
  },
  {
    id: 'acct-2',
    email: 'two@example.com',
    calendars: [{ id: 'cal-c', summary: 'Family', backgroundColor: '#abcdef', enabled: true }],
  },
];

function seedCache() {
  writeJson(EVENTS_FILE, {
    'acct-1::cal-a': {
      e2: EVENT('e2', '2026-06-02T10:00:00'),
      hole: null,
      e1: EVENT('e1', '2026-06-01T10:00:00'),
    },
    'acct-1::cal-b': { e3: EVENT('e3', '2026-06-03T10:00:00') },
    'acct-2::cal-c': { e4: EVENT('e4', '2026-06-04T10:00:00') },
  });
  writeJson(SYNC_FILE, {
    'acct-1::cal-a': { syncToken: 'token-a' },
    'acct-1::cal-b': { syncToken: 'token-b' },
    'acct-2::cal-c': { syncToken: 'token-c' },
  });
}

beforeEach(() => {
  m.listAccounts.mockReturnValue(ACCOUNTS);
  fs.rmSync(dataPath(EVENTS_FILE), { force: true });
  fs.rmSync(dataPath(SYNC_FILE), { force: true });
});

describe('getCachedEvents', () => {
  it('is empty before any cache exists', () => {
    expect(getCachedEvents()).toEqual([]);
    expect(getCachedGridEvents()).toEqual([]);
  });

  it('returns enabled calendars only, sorted by start time', () => {
    seedCache();
    expect(getCachedEvents().map((event) => event.id)).toEqual(['e1', 'e2', 'e4']);
  });

  it('skips a hole in the cache file instead of crashing the read', () => {
    seedCache();
    for (const event of getCachedEvents()) expect(event).not.toBeNull();
  });

  it('reflects a calendar being disabled immediately, without a repoll', () => {
    seedCache();
    m.listAccounts.mockReturnValue([
      {
        id: 'acct-1',
        calendars: [
          { id: 'cal-a', enabled: false },
          { id: 'cal-b', enabled: false },
        ],
      },
      { id: 'acct-2', calendars: [{ id: 'cal-c', enabled: true }] },
    ]);

    expect(getCachedEvents().map((event) => event.id)).toEqual(['e4']);
  });

  it('exposes the same Google side on the grid feed while Microsoft has nothing cached', () => {
    seedCache();
    expect(getCachedGridEvents().map((event) => event.id)).toEqual(
      getCachedEvents().map((event) => event.id)
    );
  });
});

describe('dropAccountCache', () => {
  it('purges that account’s events and sync tokens, leaving the others alone', () => {
    seedCache();

    dropAccountCache('acct-1');

    expect(readJson(EVENTS_FILE, {})).toEqual({ 'acct-2::cal-c': { e4: EVENT('e4', '2026-06-04T10:00:00') } });
    expect(Object.keys(readJson(SYNC_FILE, {}))).toEqual(['acct-2::cal-c']);
    expect(getCachedEvents().map((event) => event.id)).toEqual(['e4']);
  });

  it('is harmless for an account that has no cache', () => {
    seedCache();
    dropAccountCache('never-seen');
    expect(readJson(EVENTS_FILE, null)).toHaveProperty('acct-1::cal-a');
  });
});

describe('resetSyncTokens', () => {
  it('empties the sync file so the next poll does a full resync', () => {
    seedCache();
    resetSyncTokens();
    expect(readJson(SYNC_FILE, null)).toEqual({});
    // Events are left alone -- a token reset re-reads, it doesn't blank the
    // wall first.
    expect(getCachedEvents()).toHaveLength(3);
  });
});

describe('pollCalendar', () => {
  it('short-circuits with no Google account connected', async () => {
    m.listAccounts.mockReturnValue([]);
    expect(await pollCalendar()).toEqual({ changed: false, events: [] });
    expect(fs.existsSync(dataPath(EVENTS_FILE))).toBe(false);
  });
});
