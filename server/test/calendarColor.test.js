import { beforeEach, describe, expect, it } from 'vitest';
import { writeJson } from '../src/store/fileStore.js';
import { setCalendarColor as setGoogleColor, listAccounts } from '../src/auth/googleAuth.js';
import {
  setCalendarColor as setMsColor,
  listCalendars,
} from '../src/auth/microsoftAuth.js';

// The color a user picks in the companion app is stored separately from the
// color the provider reports, so a later calendar-list refresh doesn't throw
// it away. These tests cover the storage layer directly; the routes and the
// cached-event repaint are covered elsewhere.

const GOOGLE_ACCOUNTS = 'googleAccounts.json';
const MS_CALENDARS = 'msCalendars.json';

beforeEach(() => {
  writeJson(GOOGLE_ACCOUNTS, {
    acct: {
      id: 'acct',
      email: 'a@example.com',
      credentialSetId: 'default',
      tokens: {},
      calendars: [
        { id: 'cal', summary: 'Work', backgroundColor: '#111111', accessLevel: 'owner', enabled: true },
      ],
    },
  });
  writeJson(MS_CALENDARS, [
    { id: 'mcal', name: 'Work', color: 'lightblue', hexColor: null, enabled: true },
  ]);
});

describe('Google calendar color', () => {
  it('stores an override alongside, not over, the color Google reported', () => {
    expect(setGoogleColor('acct', 'cal', '#00ff00')).toBe('#00ff00');

    const [cal] = listAccounts()[0].calendars;
    expect(cal.customColor).toBe('#00ff00');
    expect(cal.backgroundColor).toBe('#111111');
    expect(cal.color).toBe('#00ff00');
  });

  it('clears the override, falling back to Google’s color', () => {
    setGoogleColor('acct', 'cal', '#00ff00');
    expect(setGoogleColor('acct', 'cal', '')).toBe('#111111');

    const [cal] = listAccounts()[0].calendars;
    expect(cal.customColor).toBeUndefined();
    expect(cal.color).toBe('#111111');
  });

  it('rejects an unknown account or calendar', () => {
    expect(() => setGoogleColor('nope', 'cal', '#00ff00')).toThrow(/unknown google account/i);
    expect(() => setGoogleColor('acct', 'nope', '#00ff00')).toThrow(/unknown calendar/i);
  });
});

describe('Microsoft calendar color', () => {
  it('overrides the color derived from the Graph theme', () => {
    // lightblue is #0078d4 in the palette.
    expect(listCalendars()[0].displayColor).toBe('#0078d4');
    expect(setMsColor('mcal', '#00ff00')).toBe('#00ff00');

    const [cal] = listCalendars();
    expect(cal.customColor).toBe('#00ff00');
    expect(cal.displayColor).toBe('#00ff00');
  });

  it('clears the override, falling back to the derived color', () => {
    setMsColor('mcal', '#00ff00');
    expect(setMsColor('mcal', '')).toBe('#0078d4');

    const [cal] = listCalendars();
    expect(cal.customColor).toBeUndefined();
    expect(cal.displayColor).toBe('#0078d4');
  });

  it('rejects an unknown calendar', () => {
    expect(() => setMsColor('nope', '#00ff00')).toThrow(/unknown microsoft calendar/i);
  });
});
