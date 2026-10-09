import { describe, expect, it } from 'vitest';
import { getSettings, updateSettings } from '../src/services/settingsService.js';
import { getSunTimes } from '../src/services/sunService.js';

const NORTHAMERICA = { lat: 40.71, lon: -74.0 };

describe('settingsService', () => {
  it('returns defaults for a fresh install', () => {
    const settings = getSettings();
    expect(settings.theme).toBe('dark');
    expect(settings.location).toBeNull();
    expect(settings.privacyMode).toBe(false);
    expect(settings.tempUnit).toBe('F');
    expect(settings.windUnit).toBe('mph');
    expect(settings.precipUnit).toBe('inch');
    expect(settings.timeFormat).toBe('12');
    expect(settings.clockShowSeconds).toBe(true);
    expect(settings.advancedEnabled).toBe(false);
    expect(settings.weatherIntervalMinutes).toBe(0);
    expect(settings.weatherDurationSeconds).toBe(60);
    expect(settings.sunriseOffset).toEqual({ minutes: 0, direction: 'before' });
    expect(settings.sunsetOffset).toEqual({ minutes: 0, direction: 'before' });
  });

  it('keeps sun times null while no location is saved', () => {
    const settings = getSettings();
    expect(settings.sunrise).toBeNull();
    expect(settings.sunset).toBeNull();
    expect(settings.sunriseTomorrow).toBeNull();
    expect(settings.sunsetTomorrow).toBeNull();
  });

  it('persists an update across calls', () => {
    updateSettings({ theme: 'light', tempUnit: 'C', timeFormat: '24' });
    const settings = getSettings();
    expect(settings.theme).toBe('light');
    expect(settings.tempUnit).toBe('C');
    expect(settings.timeFormat).toBe('24');
  });

  it('merges partial updates without overwriting the rest', () => {
    updateSettings({ theme: 'dark', privacyMode: true });
    const settings = getSettings();
    expect(settings.privacyMode).toBe(true);
    expect(settings.theme).toBe('dark');
  });

  it('sets a boolean flag on directly', () => {
    updateSettings({ advancedEnabled: true });
    expect(getSettings().advancedEnabled).toBe(true);
  });

  it('computes today and tomorrow sun times once a location is saved', () => {
    updateSettings({ location: NORTHAMERICA });
    const settings = getSettings();
    expect(settings.sunrise).toBeInstanceOf(Date);
    expect(settings.sunset).toBeInstanceOf(Date);
    expect(settings.sunriseTomorrow).toBeInstanceOf(Date);
    expect(settings.sunsetTomorrow).toBeInstanceOf(Date);
  });

  it('ignores saved offsets while advancedEnabled is off', () => {
    updateSettings({ location: NORTHAMERICA, advancedEnabled: false, sunriseOffset: { minutes: 120, direction: 'before' } });
    const now = new Date();
    const raw = getSunTimes(NORTHAMERICA.lat, NORTHAMERICA.lon, now);
    const settings = getSettings();
    expect(Math.abs(settings.sunrise.getTime() - raw.sunrise.getTime())).toBeLessThan(60 * 1000);
  });

  it('applies a before-offset to sunrise when advancedEnabled', () => {
    updateSettings({ location: NORTHAMERICA, advancedEnabled: true, sunriseOffset: { minutes: 30, direction: 'before' } });
    const raw = getSunTimes(NORTHAMERICA.lat, NORTHAMERICA.lon, new Date());
    const settings = getSettings();
    const expectedEarlier = settings.sunrise.getTime() + 30 * 60 * 1000;
    expect(Math.abs(expectedEarlier - raw.sunrise.getTime())).toBeLessThan(60 * 1000);
  });

  it('applies an after-offset to sunset when advancedEnabled', () => {
    updateSettings({ location: NORTHAMERICA, advancedEnabled: true, sunsetOffset: { minutes: 45, direction: 'after' } });
    const raw = getSunTimes(NORTHAMERICA.lat, NORTHAMERICA.lon, new Date());
    const settings = getSettings();
    const expectedLater = settings.sunset.getTime() - 45 * 60 * 1000;
    expect(Math.abs(expectedLater - raw.sunset.getTime())).toBeLessThan(60 * 1000);
  });

  it('does not apply offsets to tomorrow times', () => {
    updateSettings({ location: NORTHAMERICA, advancedEnabled: true, sunriseOffset: { minutes: 120, direction: 'before' } });
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const rawTomorrow = getSunTimes(NORTHAMERICA.lat, NORTHAMERICA.lon, tomorrow);
    const settings = getSettings();
    expect(Math.abs(settings.sunriseTomorrow.getTime() - rawTomorrow.sunrise.getTime())).toBeLessThan(60 * 1000);
  });

  it('lets a saved location be cleared back to null', () => {
    updateSettings({ location: NORTHAMERICA });
    expect(getSettings().sunrise).toBeInstanceOf(Date);
    updateSettings({ location: null });
    expect(getSettings().sunrise).toBeNull();
  });
});