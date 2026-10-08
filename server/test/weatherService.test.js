import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataPath } from './setup.js';
import { getCachedWeather, pollWeather } from '../src/services/weatherService.js';

// Open-Meteo (forecast + air quality) is stubbed at the fetch level: what
// this suite cares about is how one reading is built from the two responses
// -- conversions, the emoji/compass collapsing, the zipped series -- not the
// provider. Each test starts from an empty cache file (setup.js gives the
// whole run one scratch dir, see fileStore.test.js).

const FORECAST_URL = 'api.open-meteo.com/v1/forecast';
const AIR_URL = 'air-quality-api.open-meteo.com';

const HOURS = [1774000000, 1774003600, 1774007200]; // three hourly slots as unixtime
const DAYS = [1773974400, 1774060800];

function forecast(overrides = {}) {
  return {
    current: {
      temperature_2m: 21.4,
      weather_code: 61,
      wind_speed_10m: 12.5,
      wind_direction_10m: 170,
      precipitation: 0.4,
      ...overrides.current,
    },
    hourly: {
      time: HOURS,
      temperature_2m: [20, 21, 22],
      weather_code: [0, 61, 3],
      precipitation_probability: [10, 40],
      precipitation: [0, 0.5, 0],
      wind_speed_10m: [5, 6, 7],
      ...overrides.hourly,
    },
    daily: {
      time: DAYS,
      weather_code: [0, 61],
      temperature_2m_max: [25, 26],
      temperature_2m_min: [15, 16],
      precipitation_sum: [0, 3],
      precipitation_probability_max: [10, 80],
      wind_speed_10m_max: [20, 25],
      ...overrides.daily,
    },
  };
}

const fetchMock = vi.fn();

function respond({ forecastBody = forecast(), airBody = { current: { us_aqi: 42 } } } = {}) {
  fetchMock.mockImplementation(async (url) => {
    if (url.includes(AIR_URL)) return { ok: true, json: async () => airBody };
    if (url.includes(FORECAST_URL)) return { ok: true, json: async () => forecastBody };
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fs.rmSync(dataPath('weather.json'), { force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getCachedWeather', () => {
  it('is null before anything has been fetched', () => {
    expect(getCachedWeather()).toBeNull();
  });

  it('returns the last reading after a successful poll', async () => {
    respond();
    await pollWeather(40.71, -74.0);
    expect(getCachedWeather().tempC).toBe(21.4);
  });
});

describe('pollWeather', () => {
  it('builds the cached reading with both temperature scales and the wind/precip fields', async () => {
    respond();
    const reading = await pollWeather(40.71, -74.0);

    expect(reading.tempC).toBe(21.4);
    expect(reading.tempF).toBe(71); // 21.4C -> 70.52F, rounded
    expect(reading.weatherEmoji).toBe('🌧️'); // WMO code 61 = light rain
    expect(reading.windKmh).toBe(12.5);
    expect(reading.windDir).toBe('S'); // 170 degrees
    expect(reading.precipMm).toBe(0.4);
    expect(reading.moonPhase).toMatchObject({ name: expect.any(String), emoji: expect.any(String) });
    expect(Number.isNaN(Date.parse(reading.fetchedAt))).toBe(false);
  });

  it('pins the units and unix time it asks Open-Meteo for', async () => {
    respond();
    await pollWeather(40.71, -74.0);
    const [url] = fetchMock.mock.calls.find(([u]) => u.includes(FORECAST_URL));
    expect(url).toContain('latitude=40.71');
    expect(url).toContain('longitude=-74');
    expect(url).toContain('timezone=auto');
    expect(url).toContain('timeformat=unixtime');
    expect(url).toContain('wind_speed_unit=kmh');
    expect(url).toContain('precipitation_unit=mm');
    expect(url).toContain('forecast_hours=48');
    expect(url).toContain('forecast_days=10');
  });

  it('zips the hourly series, leaving gaps as null rather than throwing', async () => {
    respond();
    const { hourly } = await pollWeather(40.71, -74.0);

    expect(hourly).toHaveLength(3);
    expect(hourly[0]).toEqual({
      time: expect.any(String),
      tempC: 20,
      tempF: 68,
      emoji: '☀️',
      precipChance: 10,
      precipMm: 0,
      windKmh: 5,
    });
    // Only two precip-chance values came back; the missing third reads null.
    expect(hourly[2].precipChance).toBeNull();
    expect(Number.isNaN(Date.parse(hourly[1].time))).toBe(false);
  });

  it('zips the daily series with highs/lows in both scales', async () => {
    respond();
    const { daily } = await pollWeather(40.71, -74.0);

    expect(daily).toHaveLength(2);
    expect(daily[0]).toMatchObject({
      highC: 25,
      lowC: 15,
      highF: 77,
      lowF: 59,
      emoji: '☀️',
      precipMm: 0,
      precipChance: 10,
      windKmh: 20,
    });
    expect(daily[1].emoji).toBe('🌧️');
    expect(daily[1].precipChance).toBe(80);
  });

  it.each([
    [0, '☀️'],
    [1, '🌤️'],
    [2, '⛅'],
    [3, '☁️'],
    [45, '🌫️'],
    [53, '🌦️'],
    [65, '🌧️'],
    [75, '🌨️'],
    [95, '⛈️'],
    [123, '🌡️'], // anything unrecognised falls back to the thermometer
  ])('maps weather code %i to %s', async (code, emoji) => {
    respond({ forecastBody: forecast({ current: { weather_code: code } }) });
    const reading = await pollWeather(0, 0);
    expect(reading.weatherEmoji).toBe(emoji);
  });

  it('flags unhealthy air only from the EPA "Unhealthy" breakpoint up', async () => {
    respond({ airBody: { current: { us_aqi: 150 } } });
    expect((await pollWeather(0, 0)).isUnhealthyAir).toBe(false);

    respond({ airBody: { current: { us_aqi: 151 } } });
    expect((await pollWeather(0, 0)).isUnhealthyAir).toBe(true);

    respond({ airBody: { current: { us_aqi: 210 } } });
    expect((await pollWeather(0, 0)).isUnhealthyAir).toBe(true);
  });

  it('keeps the temperature reading when only the air-quality call fails', async () => {
    respond();
    fetchMock.mockImplementation(async (url) => {
      if (url.includes(AIR_URL)) throw new Error('air quality down');
      return { ok: true, json: async () => forecast() };
    });

    const reading = await pollWeather(40.71, -74.0);
    expect(reading.tempC).toBe(21.4);
    expect(reading.isUnhealthyAir).toBe(false);
  });

  it('throws on a failed forecast and leaves the last good reading untouched', async () => {
    respond();
    await pollWeather(40.71, -74.0);

    fetchMock.mockImplementation(async (url) => {
      if (url.includes(AIR_URL)) return { ok: true, json: async () => ({ current: { us_aqi: 10 } }) };
      return { ok: false, status: 503 };
    });

    await expect(pollWeather(40.71, -74.0)).rejects.toThrow('Weather request failed (503)');
    expect(getCachedWeather().tempC).toBe(21.4);
  });
});
