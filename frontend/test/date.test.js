import { describe, expect, it } from 'vitest';
import {
  WEEKDAYS,
  addDays,
  buildMonthGrid,
  clockParts,
  dateKey,
  formatClock,
  formatClockSeconds,
  formatShortDate,
  ordinalSuffix,
  parseLocalDate,
  sortDayEvents,
} from '../src/utils/date.js';

// Formatting is spelled out by hand rather than delegated to toLocaleString,
// so these are exact-string assertions -- that determinism is the point of
// the functions being hand-written at all.

describe('parseLocalDate', () => {
  it('reads an all-day "YYYY-MM-DD" as a local calendar date', () => {
    // The whole reason this exists: new Date('2026-08-21') is UTC midnight,
    // which prints as the 20th anywhere west of UTC.
    const date = parseLocalDate('2026-08-21');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7);
    expect(date.getDate()).toBe(21);
    expect(date.getHours()).toBe(0);
  });

  it('passes a full timestamp through to the Date parser', () => {
    const date = parseLocalDate('2026-08-21T14:30:00Z');
    expect(date.toISOString()).toBe('2026-08-21T14:30:00.000Z');
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(dateKey(addDays(new Date(2026, 6, 31), 1))).toBe('2026-08-01');
    expect(dateKey(addDays(new Date(2026, 7, 1), -1))).toBe('2026-07-31');
  });

  it('does not mutate the date it was given', () => {
    const original = new Date(2026, 0, 15);
    addDays(original, 5);
    expect(dateKey(original)).toBe('2026-01-15');
  });
});

describe('dateKey', () => {
  it('zero-pads the month and day', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dateKey(new Date(2026, 11, 24))).toBe('2026-12-24');
  });
});

describe('WEEKDAYS', () => {
  it('starts on Sunday, three letters each', () => {
    expect(WEEKDAYS).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });
});

describe('sortDayEvents', () => {
  it('puts all-day events first, then timed events by start time', () => {
    const events = [
      { id: 'lunch', title: 'Lunch', allDay: false, start: '2026-06-21T12:30:00' },
      { id: 'standup', title: 'Standup', allDay: false, start: '2026-06-21T09:00:00' },
      { id: 'vacation', title: 'Vacation', allDay: true, start: '2026-06-21' },
    ];
    expect(sortDayEvents(events).map((event) => event.id)).toEqual([
      'vacation',
      'standup',
      'lunch',
    ]);
  });

  it('orders all-day events alphabetically', () => {
    const events = [
      { id: 'b', title: 'Zebra parade', allDay: true },
      { id: 'a', title: 'Aardvark day', allDay: true },
    ];
    expect(sortDayEvents(events).map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('leaves the input array alone', () => {
    const events = [
      { id: 'late', title: 'Late', allDay: false, start: '2026-06-21T18:00:00' },
      { id: 'early', title: 'Early', allDay: false, start: '2026-06-21T08:00:00' },
    ];
    sortDayEvents(events);
    expect(events.map((event) => event.id)).toEqual(['late', 'early']);
  });
});

describe('buildMonthGrid', () => {
  it('pads to whole weeks with the neighbouring months', () => {
    const grid = buildMonthGrid(2026, 5); // June 2026
    expect(grid.length % 7).toBe(0);
    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(30);
    // Rows start on Sunday, so the padding before the 1st is the tail of May.
    expect(grid[0].date.getDay()).toBe(0);
    expect(grid[0].inMonth).toBe(false);
    expect(grid[0].date.getMonth()).toBe(4);
    expect(grid.find((cell) => cell.inMonth).date.getDate()).toBe(1);
    expect(grid.at(-1).inMonth).toBe(false);
    expect(grid.at(-1).date.getMonth()).toBe(6);
  });

  it('handles a month that starts on Sunday (no leading pad)', () => {
    const grid = buildMonthGrid(2026, 1); // February 2026 starts on a Sunday
    expect(grid[0].inMonth).toBe(true);
    expect(grid[0].date.getDate()).toBe(1);
    expect(grid.length).toBe(28); // 28 days, already whole weeks
  });

  it('walks consecutive calendar days across the whole grid', () => {
    const grid = buildMonthGrid(2026, 5);
    for (let i = 1; i < grid.length; i++) {
      const previous = new Date(grid[i - 1].date);
      previous.setDate(previous.getDate() + 1);
      expect(grid[i].date.getTime()).toBe(previous.getTime());
    }
  });
});

describe('ordinalSuffix', () => {
  it.each([
    [1, 'st'],
    [2, 'nd'],
    [3, 'rd'],
    [4, 'th'],
    [11, 'th'],
    [12, 'th'],
    [13, 'th'],
    [21, 'st'],
    [22, 'nd'],
    [23, 'rd'],
    [31, 'st'],
    [111, 'th'],
    [103, 'rd'],
    [113, 'th'], // the 11-13 exception wins over the trailing 3
  ])('%i -> %s', (day, suffix) => {
    expect(ordinalSuffix(day)).toBe(suffix);
  });
});

describe('formatClock', () => {
  const at = (hours, minutes) => new Date(2026, 5, 21, hours, minutes);

  it('renders 12-hour time with a lowercase am/pm, no seconds', () => {
    expect(formatClock(at(17, 21))).toBe('5:21 pm');
    expect(formatClock(at(5, 21))).toBe('5:21 am');
    expect(formatClock(at(0, 5))).toBe('12:05 am');
    expect(formatClock(at(12, 0))).toBe('12:00 pm');
    expect(formatClock(at(9, 7), '12')).toBe('9:07 am');
  });

  it('renders 24-hour time zero-padded', () => {
    expect(formatClock(at(17, 21), '24')).toBe('17:21');
    expect(formatClock(at(0, 5), '24')).toBe('00:05');
    expect(formatClock(at(9, 7), '24')).toBe('09:07');
  });
});

describe('formatClockSeconds', () => {
  it('adds the seconds the wall clock needs', () => {
    const time = new Date(2026, 5, 21, 17, 21, 7);
    expect(formatClockSeconds(time, '24')).toBe('17:21:07');
    expect(formatClockSeconds(time)).toBe('5:21:07 pm');
    expect(formatClockSeconds(new Date(2026, 5, 21, 9, 5, 3), '12')).toBe('9:05:03 am');
  });
});

describe('clockParts', () => {
  const time = new Date(2026, 5, 21, 17, 21, 7);

  it('splits out the fields and the divider-friendly pieces', () => {
    // The wall clock renders from this directly so its colons can be their
    // own elements — the string formatters are built back on top of it.
    expect(clockParts(time, '24')).toEqual({ hours: '17', minutes: '21', seconds: '07', period: null });
    expect(clockParts(time, '12')).toEqual({ hours: '5', minutes: '21', seconds: '07', period: 'pm' });
  });

  it('has no period in 24-hour, so there is no dangling space to trim', () => {
    expect(clockParts(time, '24').period).toBeNull();
  });

  it('always carries the seconds, even when the caller only wants minutes', () => {
    // The choice of whether to *show* them belongs to the caller; splitting
    // them out here keeps clockParts a description of the date rather than a
    // second settings-aware formatter.
    expect(clockParts(time, '24').seconds).toBe('07');
  });

  it('round-trips into exactly the strings the formatters produce', () => {
    for (const format of ['12', '24']) {
      const parts = clockParts(time, format);
      expect(`${parts.hours}:${parts.minutes}${parts.period ? ` ${parts.period}` : ''}`).toBe(
        formatClock(time, format)
      );
      expect(`${parts.hours}:${parts.minutes}:${parts.seconds}${parts.period ? ` ${parts.period}` : ''}`).toBe(
        formatClockSeconds(time, format)
      );
    }
  });
});

describe('formatShortDate', () => {
  it('renders numeric month/day and a two-digit year', () => {
    expect(formatShortDate(new Date(2026, 8, 15))).toBe('9/15/26');
    expect(formatShortDate(new Date(2026, 0, 5))).toBe('1/5/26');
  });
});
