import { readJson, writeJson } from '../store/fileStore.js';
import { getMoonPhase } from './moonService.js';

const WEATHER_FILE = 'weather.json';

// Open-Meteo: free, no API key/signup, and it aggregates national weather
// services' own models (NOAA/NWS, DWD, Météo-France, ECMWF, ...) rather than
// running its own — accuracy in line with a paid provider, same "no key,
// generous free tier" shape as the geocoder already used for location
// search. Its separate Air Quality API (same provider, same terms) is what
// makes the "smoke from wildfires" case possible below without a second
// vendor.
const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';

// EPA's US AQI breakpoint for "Unhealthy" (151-200) and worse — wildfire
// smoke routinely pushes AQI into this range and beyond, which is the
// "something is actually wrong with the air" threshold the mask emoji
// below is meant to flag, as opposed to the more common, healthier day to
// day range.
const UNHEALTHY_AQI = 151;

// Open-Meteo's WMO weather codes (https://open-meteo.com/en/docs) collapsed
// down to one emoji per condition family. Day/night is decided by the
// frontend (against the same sunrise/sunset already computed for Automatic
// theme, not Open-Meteo's own is_day) so this only ever needs the daytime
// reading — the moon phase below is what stands in for it at night.
function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if (code === 1) return '🌤️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if ([51, 53, 55, 56, 57].includes(code)) return '🌦️';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '🌡️';
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
  return res.json();
}

// Epoch seconds -> an ISO instant. The forecast is requested as unixtime
// (below) precisely so this is the only conversion needed: a date-time string
// with no offset, which is what Open-Meteo returns by default, would be
// re-read as *local* time by the frontend and quietly shifted by the wall's
// UTC offset. As an instant it formats in whatever timezone the display is
// actually in, the same as every other time the display shows.
const isoInstant = (epochSeconds) => new Date(epochSeconds * 1000).toISOString();

// How much hourly data to fetch, and how much of it the display shows. The
// fetch is deliberately deeper than the display's window: the cache is only
// refreshed every WEATHER_POLL_INTERVAL_MS, so a display asking for exactly
// its own 24 hours would start showing a short tail whenever the cache was
// more than an hour old. Fetching a spare day costs about 2KB and means the
// view is never short of hours, however stale the reading underneath it is.
const HOURLY_FETCH_HOURS = 48;
const DAILY_FETCH_DAYS = 10;

function loadWeather() {
  return readJson(WEATHER_FILE, null);
}

function saveWeather(weather) {
  writeJson(WEATHER_FILE, weather);
}

// Last successfully fetched reading, regardless of how stale — the display
// shows this rather than nothing while a fetch is failing (Wi-Fi hiccup,
// Open-Meteo hiccup), same "keep showing the last good state" approach as
// the calendar/todo caches.
export function getCachedWeather() {
  return loadWeather();
}

// Fetches current temperature/condition, an hourly and a daily forecast, and
// air quality for the given location, computes the day's moon phase, and
// caches the combined reading. Throws on failure (caller decides what
// "failed" means for the poll loop) rather than swallowing it here, so the
// last good cache is left untouched instead of being overwritten with a
// null/partial one.
export async function pollWeather(lat, lon) {
  const [forecast, airQuality] = await Promise.all([
    // One request for all three: Open-Meteo returns current conditions,
    // hourly series and daily aggregates from a single call, and splitting
    // them would mean three round trips for data that is fetched together
    // anyway on the same cadence.
    //
    // timezone=auto buckets the series in the *location's* timezone (so the
    // daily entries land on local midnight, which is what makes a day label
    // read correctly on the wall) while timeformat=unixtime keeps them as
    // absolute instants rather than offset-less local strings.
    //
    // The unit parameters are pinned rather than left to Open-Meteo's
    // defaults: which unit a bare wind_speed_10m arrives in is otherwise
    // decided by the far end, and the whole point of caching one canonical
    // unit is that the display does the converting against the unit the
    // companion app was told to use. km/h and mm are the conversion bases
    // for the same reason temperature is cached in both C and F -- they're
    // the units everything else converts through.
    fetchJson(
      `${FORECAST_BASE}?latitude=${lat}&longitude=${lon}` +
        '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation' +
        '&hourly=temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,' +
        'precipitation_sum,precipitation_probability_max,wind_speed_10m_max' +
        `&forecast_hours=${HOURLY_FETCH_HOURS}&forecast_days=${DAILY_FETCH_DAYS}` +
        '&timezone=auto&timeformat=unixtime&wind_speed_unit=kmh&precipitation_unit=mm'
    ),
    // Non-fatal on its own: a smoke alert is a nice-to-have, not worth
    // losing the whole temperature reading over if just this call fails.
    fetchJson(`${AIR_QUALITY_BASE}?latitude=${lat}&longitude=${lon}&current=us_aqi`).catch(() => null),
  ]);

  const tempC = forecast.current.temperature_2m;
  const weatherCode = forecast.current.weather_code;
  const aqi = airQuality?.current?.us_aqi ?? null;

  const toF = (celsius) => Math.round((celsius * 9) / 5 + 32);

  // Zipped from the parallel arrays Open-Meteo returns rather than read
  // index-by-index across them, so a short (or absent) series can't throw
  // and quietly take the temperature reading down with it: the shortest
  // series wins, and the display renders whatever it got.
  const hourlyTimes = forecast.hourly?.time || [];
  const hourlyTemps = forecast.hourly?.temperature_2m || [];
  const hourlyCodes = forecast.hourly?.weather_code || [];
  // A missing series (an older cache, a field Open-Meteo stops returning)
  // reads as null per entry rather than making the whole reading throw --
  // these are conveniences on top of the temperature, and a wall that loses
  // its wind reading for an hour is better than one that goes blank.
  const hourlyPrecipChance = forecast.hourly?.precipitation_probability || [];
  const hourlyPrecip = forecast.hourly?.precipitation || [];
  const hourlyWind = forecast.hourly?.wind_speed_10m || [];
  const hourlyLength = Math.min(hourlyTimes.length, hourlyTemps.length, hourlyCodes.length);

  const dailyTimes = forecast.daily?.time || [];
  const dailyCodes = forecast.daily?.weather_code || [];
  const dailyMax = forecast.daily?.temperature_2m_max || [];
  const dailyMin = forecast.daily?.temperature_2m_min || [];
  const dailyPrecip = forecast.daily?.precipitation_sum || [];
  const dailyPrecipChance = forecast.daily?.precipitation_probability_max || [];
  const dailyWind = forecast.daily?.wind_speed_10m_max || [];
  const dailyLength = Math.min(dailyTimes.length, dailyCodes.length, dailyMax.length, dailyMin.length);

  // Degrees -> one of eight compass points. Kept here rather than in the
  // display so the cached reading is the same regardless of how many
  // languages or locales it might be rendered in; "88" means nothing to
  // anyone staring at a wall, "E" means east.
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const compass = (degrees) =>
    Number.isFinite(degrees) ? COMPASS[Math.round(degrees / 45) % 8] : null;

  const weather = {
    tempC,
    tempF: toF(tempC),
    weatherEmoji: weatherEmoji(weatherCode),
    isUnhealthyAir: aqi != null && aqi >= UNHEALTHY_AQI,
    aqi,
    moonPhase: getMoonPhase(),
    // Current wind and precipitation, in the same "canonical unit, display
    // converts" shape as the temperatures above.
    windKmh: forecast.current.wind_speed_10m ?? null,
    windDir: compass(forecast.current.wind_direction_10m),
    precipMm: forecast.current.precipitation ?? null,
    // The full-screen weather view's two halves. Both in Celsius *and*
    // Fahrenheit, like tempC/tempF above, so the display converts against
    // the companion app's unit setting instead of the server deciding it.
    hourly: Array.from({ length: hourlyLength }, (_, i) => ({
      time: isoInstant(hourlyTimes[i]),
      tempC: hourlyTemps[i],
      tempF: toF(hourlyTemps[i]),
      emoji: weatherEmoji(hourlyCodes[i]),
      precipChance: hourlyPrecipChance[i] ?? null,
      precipMm: hourlyPrecip[i] ?? null,
      windKmh: hourlyWind[i] ?? null,
    })),
    daily: Array.from({ length: dailyLength }, (_, i) => ({
      date: isoInstant(dailyTimes[i]),
      highC: dailyMax[i],
      lowC: dailyMin[i],
      highF: toF(dailyMax[i]),
      lowF: toF(dailyMin[i]),
      emoji: weatherEmoji(dailyCodes[i]),
      precipMm: dailyPrecip[i] ?? null,
      precipChance: dailyPrecipChance[i] ?? null,
      windKmh: dailyWind[i] ?? null,
    })),
    fetchedAt: new Date().toISOString(),
  };

  saveWeather(weather);
  return weather;
}
