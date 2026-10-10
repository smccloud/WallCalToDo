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
  mergeSimilarEvents,
  pollCalendar,
  recolorCalendar,
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

  it('drops the whole Google half while the Google section is switched off', () => {
    seedCache();
    // The display-wide Google on/off (see googleEnabled in settingsService.js).
    writeJson('settings.json', { googleEnabled: false });
    expect(getCachedEvents()).toEqual([]);
    expect(getCachedGridEvents()).toEqual([]);
    // Restore the default so the rest of this file's tests still see events.
    fs.rmSync(dataPath('settings.json'), { force: true });
  });
});

describe('recolorCalendar', () => {
  const COLORED = (id, calendarColor, color) => ({
    ...EVENT(id, '2026-06-01T10:00:00'),
    calendarColor,
    color,
  });

  it('repaints a calendar’s cached events, leaving per-event overrides alone', () => {
    writeJson(EVENTS_FILE, {
      'acct-1::cal-a': {
        plain: COLORED('plain', '#111111', '#111111'),
        overridden: COLORED('overridden', '#111111', '#ff0000'),
      },
    });

    expect(recolorCalendar('acct-1', 'cal-a', '#00ff00')).toBe(true);

    const events = getCachedEvents();
    const plain = events.find((event) => event.id === 'plain');
    const overridden = events.find((event) => event.id === 'overridden');
    expect(plain).toMatchObject({ calendarColor: '#00ff00', color: '#00ff00' });
    expect(overridden).toMatchObject({ calendarColor: '#00ff00', color: '#ff0000' });
  });

  it('reports nothing to repaint for a calendar with no cache', () => {
    expect(recolorCalendar('acct-1', 'missing', '#00ff00')).toBe(false);
  });
});

const SLOT_EVENT = (id, title, calendarKey, overrides = {}) => ({
  id,
  title,
  calendarKey,
  calendarLabel: calendarKey,
  start: '2026-06-01T09:00:00',
  end: '2026-06-01T09:30:00',
  allDay: false,
  color: '#111111',
  ...overrides,
});

describe('mergeSimilarEvents', () => {
  beforeEach(() => fs.rmSync(dataPath('settings.json'), { force: true }));

  it('leaves events alone while the toggle is off', () => {
    const events = [
      SLOT_EVENT('a', 'NO SCHOOL', 'k1', { allDay: true, start: '2026-06-01', end: '2026-06-01' }),
      SLOT_EVENT('b', 'K-12 No School', 'k2', { allDay: true, start: '2026-06-01', end: '2026-06-01' }),
    ];
    expect(mergeSimilarEvents(events).map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('combines two calendars’ same-slot look-alikes into the first one', () => {
    writeJson('settings.json', { mergeSimilarEvents: true });
    const events = [
      SLOT_EVENT('a', 'NO SCHOOL', 'k1', { allDay: true, start: '2026-06-01', end: '2026-06-01' }),
      SLOT_EVENT('b', 'K-12 No School', 'k2', { allDay: true, start: '2026-06-01', end: '2026-06-01' }),
    ];
    expect(mergeSimilarEvents(events).map((event) => event.id)).toEqual(['a']);
  });

  it('keeps same-slot events whose titles are genuinely different', () => {
    writeJson('settings.json', { mergeSimilarEvents: true });
    const events = [
      SLOT_EVENT('a', 'NO SCHOOL', 'k1', { allDay: true, start: '2026-06-01', end: '2026-06-01' }),
      SLOT_EVENT('b', 'Staff Meeting', 'k2', { allDay: true, start: '2026-06-01', end: '2026-06-01' }),
    ];
    expect(mergeSimilarEvents(events).map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('keeps similar titles that fall on different slots', () => {
    writeJson('settings.json', { mergeSimilarEvents: true });
    const events = [
      SLOT_EVENT('a', 'NO SCHOOL', 'k1', { allDay: true, start: '2026-06-01', end: '2026-06-01' }),
      SLOT_EVENT('b', 'K-12 No School', 'k2', { allDay: true, start: '2026-06-02', end: '2026-06-02' }),
    ];
    expect(mergeSimilarEvents(events).map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('merges timed events on the same day and times', () => {
    writeJson('settings.json', { mergeSimilarEvents: true });
    const events = [
      SLOT_EVENT('a', 'Math final', 'k1'),
      SLOT_EVENT('b', 'MATH FINAL', 'k2'),
    ];
    expect(mergeSimilarEvents(events).map((event) => event.id)).toEqual(['a']);
  });

  it('does not merge a timed event with an all-day one at the same instant', () => {
    writeJson('settings.json', { mergeSimilarEvents: true });
    const events = [
      SLOT_EVENT('a', 'No School', 'k1', { allDay: true, start: '2026-06-01', end: '2026-06-01' }),
      SLOT_EVENT('b', 'K-12 No School', 'k2', { start: '2026-06-01T00:00:00', end: '2026-06-01T00:00:00' }),
    ];
    expect(mergeSimilarEvents(events).map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('never merges two entries from the same calendar', () => {
    writeJson('settings.json', { mergeSimilarEvents: true });
    const events = [
      SLOT_EVENT('a', 'NO SCHOOL', 'k1', { allDay: true, start: '2026-06-01', end: '2026-06-01' }),
      SLOT_EVENT('b', 'K-12 No School', 'k1', { allDay: true, start: '2026-06-01', end: '2026-06-01' }),
    ];
    expect(mergeSimilarEvents(events).map((event) => event.id)).toEqual(['a', 'b']);
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
