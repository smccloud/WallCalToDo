import { describe, expect, it } from 'vitest';
import {
  formatPrecipChance,
  formatPrecipitation,
  formatWind,
  precipitation,
  precipitationUnitLabel,
  windSpeed,
  windUnitLabel,
} from '../src/utils/units.js';

// One canonical unit comes off the server (km/h, mm, and both Celsius and
// Fahrenheit); these are the display-side conversions the companion app's
// unit settings select between.

describe('windSpeed', () => {
  it('converts km/h into each supported unit', () => {
    expect(windSpeed(1609.344, 'mph')).toBeCloseTo(1000, 6); // a mile is 1.609344 km
    expect(windSpeed(36, 'ms')).toBeCloseTo(10, 9); // 1000 m per km, 3600 s per hour
    expect(windSpeed(18.52, 'kn')).toBeCloseTo(10, 9); // a knot is one nautical mile/hour
    expect(windSpeed(47, 'kmh')).toBe(47);
  });

  it('falls back to mph for an unknown unit', () => {
    expect(windSpeed(1609.344, 'furlongs')).toBeCloseTo(1000, 6);
    expect(windSpeed(1609.344, undefined)).toBeCloseTo(1000, 6);
  });

  it('returns null for a missing reading rather than 0', () => {
    expect(windSpeed(null, 'mph')).toBeNull();
    expect(windSpeed(undefined, 'kmh')).toBeNull();
    expect(windSpeed(NaN, 'kmh')).toBeNull();
    expect(windSpeed(Infinity, 'kmh')).toBeNull();
  });
});

describe('windUnitLabel', () => {
  it.each([
    ['mph', 'mph'],
    ['kmh', 'km/h'],
    ['ms', 'm/s'],
    ['kn', 'kn'],
    ['anything-else', 'mph'],
  ])('%s -> %s', (unit, label) => {
    expect(windUnitLabel(unit)).toBe(label);
  });
});

describe('formatWind', () => {
  it('rounds to a whole number except in m/s', () => {
    expect(formatWind(10, 'mph')).toBe('6 mph');
    expect(formatWind(47, 'kmh')).toBe('47 km/h');
    expect(formatWind(36.2, 'ms')).toBe('10.1 m/s');
    expect(formatWind(18.52, 'kn')).toBe('10 kn');
  });

  it('is null when there is nothing to show', () => {
    expect(formatWind(null, 'mph')).toBeNull();
    expect(formatWind(NaN, 'kmh')).toBeNull();
  });
});

describe('precipitation', () => {
  it('passes millimetres through and converts inches', () => {
    expect(precipitation(25.4, 'mm')).toBe(25.4);
    expect(precipitation(25.4, 'inch')).toBe(1);
    expect(precipitation(12.7, 'inch')).toBeCloseTo(0.5, 9);
  });

  it('returns null for a missing reading rather than 0', () => {
    expect(precipitation(null, 'mm')).toBeNull();
    expect(precipitation(undefined, 'inch')).toBeNull();
    expect(precipitation(NaN, 'mm')).toBeNull();
  });

  it('labels itself per unit', () => {
    expect(precipitationUnitLabel('mm')).toBe('mm');
    expect(precipitationUnitLabel('inch')).toBe('in');
  });
});

describe('formatPrecipitation', () => {
  it('keeps two decimals for a trace of rain in inches', () => {
    expect(formatPrecipitation(1.27, 'inch')).toBe('0.05 in'); // 0.05 in
    expect(formatPrecipitation(2.54, 'inch')).toBe('0.1 in');
  });

  it('keeps one decimal for larger amounts', () => {
    expect(formatPrecipitation(5.08, 'inch')).toBe('0.2 in');
    expect(formatPrecipitation(1.24, 'mm')).toBe('1.2 mm');
    expect(formatPrecipitation(7, 'mm')).toBe('7 mm');
  });

  it('is null when there is nothing to show', () => {
    expect(formatPrecipitation(null, 'mm')).toBeNull();
  });
});

describe('formatPrecipChance', () => {
  it('renders a rounded percentage', () => {
    expect(formatPrecipChance(40)).toBe('40%');
    expect(formatPrecipChance(40.4)).toBe('40%');
    expect(formatPrecipChance(99.6)).toBe('100%');
  });

  it('treats 0% as "no chance data" rather than claiming a dry sky', () => {
    expect(formatPrecipChance(0)).toBeNull();
    expect(formatPrecipChance(null)).toBeNull();
    expect(formatPrecipChance(NaN)).toBeNull();
  });
});
