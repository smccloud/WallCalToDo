import { describe, expect, it } from 'vitest';
import { holidayFor } from '../src/utils/holidays.js';

// Holidays arrive as ordinary all-day events from a holiday calendar, so a
// match needs both halves: the event has to come from one and its title has
// to name one of the decorated fifteen.

const GOOGLE_HOLIDAY_CAL = 'en.usa#holiday@group.v.calendar.google.com';

const event = (overrides) => ({
  allDay: true,
  calendarKey: GOOGLE_HOLIDAY_CAL,
  calendarLabel: 'Holidays in United States',
  title: 'Independence Day',
  color: '#be1931',
  ...overrides,
});

describe('holidayFor', () => {
  it('matches a holiday from a Google holiday calendar, keeping the event color', () => {
    expect(holidayFor(event({ title: 'Christmas Day', color: '#0b8043' }))).toEqual({
      name: 'Christmas Day',
      icon: '🎄',
      color: '#0b8043',
    });
  });

  it('falls back to the calendar label when the id is not Google’s shape', () => {
    // Microsoft's built-in holidays calendar, and any Google one renamed by
    // hand, are recognized by their "Holidays..." label instead.
    expect(
      holidayFor(event({ title: 'Christmas Day', calendarKey: undefined, calendarLabel: 'Holidays in United States' }))
    ).toMatchObject({ name: 'Christmas Day', icon: '🎄' });
    expect(
      holidayFor(
        event({ title: 'Christmas Day', calendarKey: undefined, calendarLabel: 'Holidays (United Kingdom)' })
      )
    ).toMatchObject({ name: 'Christmas Day' });
  });

  it('ignores a personal event that merely names a holiday', () => {
    expect(
      holidayFor(event({ calendarKey: 'user@example.com', calendarLabel: 'Personal' }))
    ).toBeNull();
    expect(
      holidayFor(
        event({ calendarKey: 'user@example.com', calendarLabel: 'Personal', title: 'Halloween party' })
      )
    ).toBeNull();
  });

  it('ignores a timed event even on a holiday calendar', () => {
    expect(holidayFor(event({ allDay: false, start: '2026-10-31T18:00:00' }))).toBeNull();
  });

  it('ignores a holiday-calendar event that names none of the holidays', () => {
    expect(holidayFor(event({ title: 'Company offsite' }))).toBeNull();
    expect(holidayFor(event({ title: '' }))).toBeNull();
  });

  it('matches on the canonical name regardless of how the calendar titled it', () => {
    // Google's titles vary year to year; normalization is what bridges them.
    expect(holidayFor(event({ title: "New Year's Day (observed)" }))).toMatchObject({
      name: "New Year's Day",
    });
    expect(holidayFor(event({ title: 'President’s Day' }))).toMatchObject({
      name: "Presidents' Day",
    });
    expect(holidayFor(event({ title: 'Birthday of Martin Luther King, Jr.' }))).toMatchObject({
      name: 'Martin Luther King Jr. Day',
    });
    expect(holidayFor(event({ title: "Washington's Birthday" }))).toMatchObject({
      name: "Presidents' Day",
    });
    expect(holidayFor(event({ title: 'Juneteenth National Independence Day' }))).toMatchObject({
      name: 'Juneteenth',
    });
  });

  it('is case- and punctuation-insensitive', () => {
    expect(holidayFor(event({ title: 'THANKSGIVING!!' }))).toMatchObject({ name: 'Thanksgiving' });
    expect(holidayFor(event({ title: "St Patrick's Day" }))).toMatchObject({
      name: "St. Patrick's Day",
    });
  });

  it('returns every icon the day markers draw', () => {
    expect(holidayFor(event({ title: "Valentine's Day" })).icon).toBe('❤️');
    expect(holidayFor(event({ title: 'Easter Sunday' })).icon).toBe('🐣');
    expect(holidayFor(event({ title: 'Veterans Day' })).icon).toBe('🎖️');
    expect(holidayFor(event({ title: 'Memorial Day' })).icon).toBe('🪻');
  });
});
