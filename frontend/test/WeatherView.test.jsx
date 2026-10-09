import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WeatherView from '../src/components/WeatherView.jsx';

// The wall's full-screen forecast. Only the strip sizing is under test here —
// the unit formatting has its own suite (test/units.test.js) and the rest of
// the cells are covered by rendering what's here.
//
// Fixtures are generated rather than hand-written so the tests can ask for 48
// hours when they need to and still be exact about what they expect back.

const HOURS_AVAILABLE = 48;
const DAYS_AVAILABLE = 12;

// Fixed clock, so "the next 24 hours" means something specific.
const NOW = new Date(2026, 5, 21, 15, 30);

function hourly(count = HOURS_AVAILABLE) {
  const start = new Date(NOW);
  start.setMinutes(0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(start.getTime() + i * 3_600_000);
    return {
      time: at.toISOString(),
      emoji: '⛅',
      tempC: 20 + (i % 5),
      tempF: 68 + (i % 5),
      precipChance: 0,
    };
  });
}

function daily(count = DAYS_AVAILABLE) {
  const start = new Date(NOW);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(start.getTime() + i * 86_400_000);
    return {
      date: at.toISOString(),
      emoji: '☀️',
      highC: 25,
      highF: 77,
      lowC: 12,
      lowF: 54,
      precipChance: 10,
      precipMm: 0,
      windKmh: 10,
      windDir: 'N',
    };
  });
}

function renderAt(settings = {}) {
  return render(<WeatherView weather={{ hourly: hourly(), daily: daily() }} settings={settings} />);
}

const hours = () => [...document.querySelectorAll('.weather-view__hour')];
const days = () => [...document.querySelectorAll('.weather-view__day')];
const stripLabel = (kind) =>
  document.querySelector(`.weather-view__half--${kind} .weather-view__label`).textContent;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WeatherView strips', () => {
  it('shows the full 24 hours and 10 days when nothing is configured', () => {
    renderAt({});

    expect(hours()).toHaveLength(24);
    expect(days()).toHaveLength(10);
    expect(stripLabel('hourly')).toBe('Next 24 hours');
    expect(stripLabel('daily')).toBe('Next 10 days');
  });

  it('takes the hour count from the companion app setting', () => {
    renderAt({ weatherHourlyHours: 6 });

    expect(hours()).toHaveLength(6);
    // The label counts what was asked for, and has to: a strip reading
    // "Next 24 hours" over six columns is a wall lying about itself.
    expect(stripLabel('hourly')).toBe('Next 6 hours');
  });

  it('takes the day count from the companion app setting', () => {
    renderAt({ weatherDailyDays: 5 });

    expect(days()).toHaveLength(5);
    expect(stripLabel('daily')).toBe('Next 5 days');
  });

  it('sizes each grid to the columns it actually rendered', () => {
    renderAt({ weatherHourlyHours: 6, weatherDailyDays: 7 });

    // A grid left at its old fixed 24/10 tracks would stretch six cells across
    // the full width of a portrait panel, with the strip reading as mostly
    // empty space rather than as six hours of forecast.
    expect(document.querySelector('.weather-view__hours').style.getPropertyValue('--hourly-count')).toBe('6');
    expect(document.querySelector('.weather-view__days').style.getPropertyValue('--daily-count')).toBe('7');
  });

  // The count is a cap, not a promise: the server's cache can be up to an
  // hour old, so near the end of a long window there may be fewer hours left
  // than were asked for. The grid has to follow what rendered, or the strip
  // ends up padded out with empty tracks.
  it('sizes the grid to what is left when the cache runs short', () => {
    render(<WeatherView weather={{ hourly: hourly(3), daily: daily(12) }} settings={{ weatherHourlyHours: 24 }} />);

    expect(hours()).toHaveLength(3);
    expect(document.querySelector('.weather-view__hours').style.getPropertyValue('--hourly-count')).toBe('3');
    // Still asks for the 24 it was given in the label — the setting is what
    // the viewer chose, and a stale cache is not the viewer getting a
    // different answer.
    expect(stripLabel('hourly')).toBe('Next 24 hours');
  });

  it('never shows more than the cache holds, however large the setting', () => {
    // 30 hours asked for against 30 cached: the setting is the cap, and a
    // cache bigger than the cap still gets trimmed to it.
    render(<WeatherView weather={{ hourly: hourly(30), daily: daily(12) }} settings={{ weatherHourlyHours: 24 }} />);

    expect(hours()).toHaveLength(24);
  });

  // The API rejects anything outside the range, but a settings file edited by
  // hand years from now still shouldn't be able to produce a row of zero
  // columns or a hundred of them. Anything that isn't a whole number falls
  // back to the full 24 rather than being rounded to something nobody chose.
  it.each([
    ['a count of zero', 0, 1],
    ['a negative count', -5, 1],
    ['a count above the maximum', 99, 24],
    ['a fractional count', 6.5, 24],
    ['a count that is not a number', 'lots', 24],
  ])('clamps %s rather than rendering it', (_label, weatherHourlyHours, expected) => {
    renderAt({ weatherHourlyHours });

    expect(hours()).toHaveLength(expected);
  });

  it('drops hours that have already gone by', () => {
    // Only just more hours than the view wants, so running the clock forward
    // leaves it genuinely short: with the server's usual 48-hour cache there
    // would still be plenty left and nothing would visibly change.
    const cached = hourly(25);
    vi.setSystemTime(new Date(NOW.getTime() + 2 * 3_600_000));

    render(<WeatherView weather={{ hourly: cached, daily: daily() }} settings={{ weatherHourlyHours: 24 }} />);

    expect(hours()).toHaveLength(23);
    // The first column is the hour in progress, labelled rather than timed.
    expect(hours()[0].querySelector('.weather-view__hour-label').textContent).toBe('Now');
  });
});