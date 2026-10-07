import { describe, expect, it } from 'vitest';
import { getSunTimes } from '../src/services/sunService.js';

// The sunrise equation is an approximation (accurate to a minute or two,
// per the module comment), so every time assertion below carries a window
// rather than an exact minute. Values are checked against well-known
// astronomy: equinox/equator, solstice day-length swings, symmetry of the
// pair around solar noon, and polar day/night producing no times at all.

function utcHours(date) {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

describe('getSunTimes', () => {
  it('returns Date objects on the requested calendar day', () => {
    const { sunrise, sunset } = getSunTimes(40.71, -74.0, new Date(2026, 5, 21));
    expect(sunrise).toBeInstanceOf(Date);
    expect(sunset).toBeInstanceOf(Date);
    for (const time of [sunrise, sunset]) {
      expect(time.getUTCFullYear()).toBe(2026);
      expect(time.getUTCMonth()).toBe(5);
      expect(time.getUTCDate()).toBe(21);
    }
  });

  it('gives a ~12h day at the equator on the equinox', () => {
    const date = new Date(2026, 2, 20); // March equinox
    const { sunrise, sunset } = getSunTimes(0, 0, date);
    // Greenwich: sunrise lands near 06:00, sunset near 18:00.
    expect(utcHours(sunrise)).toBeGreaterThan(4);
    expect(utcHours(sunrise)).toBeLessThan(8);
    expect(utcHours(sunset)).toBeGreaterThan(16);
    expect(utcHours(sunset)).toBeLessThan(20);
  });

  it('swaps day length between solstices in the northern hemisphere', () => {
    const lat = 40.71;
    const lon = -74.0;
    const summer = getSunTimes(lat, lon, new Date(2026, 5, 21));
    const winter = getSunTimes(lat, lon, new Date(2026, 11, 21));
    const dayLength = ({ sunrise, sunset }) => utcHours(sunset) - utcHours(sunrise);
    expect(dayLength(summer)).toBeGreaterThan(14);
    expect(dayLength(winter)).toBeLessThan(10);
  });

  it('has sunrise and sunset roughly symmetric around solar noon', () => {
    // At lon 0 the UT hours of the pair straddle 12: sunrise+sunset ~= 24h.
    const { sunrise, sunset } = getSunTimes(45, 0, new Date(2026, 5, 21));
    const sum = utcHours(sunrise) + utcHours(sunset);
    expect(Math.abs(sum - 24)).toBeLessThan(1);
  });

  it('returns null for both when the sun never sets (polar day)', () => {
    const { sunrise, sunset } = getSunTimes(78, 15, new Date(2026, 5, 21));
    expect(sunrise).toBeNull();
    expect(sunset).toBeNull();
  });

  it('returns null for both when the sun never rises (polar night)', () => {
    const { sunrise, sunset } = getSunTimes(78, 15, new Date(2026, 11, 21));
    expect(sunrise).toBeNull();
    expect(sunset).toBeNull();
  });

  it('defaults to a date argument of now', () => {
    const { sunrise } = getSunTimes(40.71, -74.0);
    expect(sunrise).toBeInstanceOf(Date);
  });
});