import { Router } from 'express';
import { getSettings, updateSettings } from '../services/settingsService.js';
import { searchPlaces, reverseGeocode } from '../services/geocodeService.js';
import { pollWeatherNow } from '../services/poller.js';
import { broadcast } from '../ws/hub.js';

export const settingsRouter = Router();

const OFFSET_MINUTES = [0, 15, 30, 45, 60, 120, 180];

// How often the full-screen weather view takes over the display, and how long
// it holds it. 0 minutes means it never appears. These lists are the
// authority on what's accepted; the companion app's segmented controls offer
// the same values with friendlier labels ("Off", "Every hour"), which is why
// this validates against numbers rather than the labels.
const WEATHER_INTERVAL_MINUTES = [0, 15, 30, 60, 120, 180, 360];
const WEATHER_DURATION_SECONDS = [30, 60, 120, 300];

// Wind and precipitation units. The reading is cached in km/h and mm and
// converted by the display (frontend/src/utils/units.js), so this only picks
// what the wall prints. 'mph'/'inch' are the defaults for the same reason
// temperature defaults to Fahrenheit.
const WIND_UNITS = ['mph', 'kmh', 'ms', 'kn'];
const PRECIP_UNITS = ['inch', 'mm'];

function isValidOffset(offset) {
  return (
    offset &&
    OFFSET_MINUTES.includes(offset.minutes) &&
    ['before', 'after'].includes(offset.direction)
  );
}

settingsRouter.get('/settings', (req, res) => {
  res.json(getSettings());
});

// City-name search for the companion app's location picker — works from
// any device on the LAN (unlike browser geolocation, which needs a secure
// context), which is what makes it the primary way to set a location.
settingsRouter.get('/geocode', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  try {
    res.json({ results: await searchPlaces(q) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Friendly label for a lat/lon, used after "Use my location" so it shows
// something nicer than raw coordinates too.
settingsRouter.get('/geocode/reverse', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return res.status(400).json({ error: 'Invalid lat/lon' });
  try {
    res.json({ label: await reverseGeocode(lat, lon) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

settingsRouter.patch('/settings', (req, res) => {
  const {
    theme,
    location,
    privacyMode,
    tempUnit,
    advancedEnabled,
    sunriseOffset,
    sunsetOffset,
    weatherIntervalMinutes,
    weatherDurationSeconds,
    windUnit,
    precipUnit,
    timeFormat,
  } = req.body || {};
  const patch = {};

  if (theme !== undefined) {
    if (!['light', 'dark', 'auto'].includes(theme)) return res.status(400).json({ error: 'Invalid theme' });
    patch.theme = theme;
  }
  if (location !== undefined) {
    if (location !== null && (typeof location.lat !== 'number' || typeof location.lon !== 'number')) {
      return res.status(400).json({ error: 'Invalid location' });
    }
    patch.location = location;
  }
  if (privacyMode !== undefined) {
    if (typeof privacyMode !== 'boolean') return res.status(400).json({ error: 'Invalid privacyMode' });
    patch.privacyMode = privacyMode;
  }
  if (tempUnit !== undefined) {
    if (!['F', 'C'].includes(tempUnit)) return res.status(400).json({ error: 'Invalid tempUnit' });
    patch.tempUnit = tempUnit;
  }
  if (advancedEnabled !== undefined) {
    if (typeof advancedEnabled !== 'boolean') return res.status(400).json({ error: 'Invalid advancedEnabled' });
    patch.advancedEnabled = advancedEnabled;
  }
  if (sunriseOffset !== undefined) {
    if (!isValidOffset(sunriseOffset)) return res.status(400).json({ error: 'Invalid sunriseOffset' });
    patch.sunriseOffset = sunriseOffset;
  }
  if (sunsetOffset !== undefined) {
    if (!isValidOffset(sunsetOffset)) return res.status(400).json({ error: 'Invalid sunsetOffset' });
    patch.sunsetOffset = sunsetOffset;
  }
  if (weatherIntervalMinutes !== undefined) {
    if (!WEATHER_INTERVAL_MINUTES.includes(weatherIntervalMinutes)) {
      return res.status(400).json({ error: 'Invalid weatherIntervalMinutes' });
    }
    patch.weatherIntervalMinutes = weatherIntervalMinutes;
  }
  if (weatherDurationSeconds !== undefined) {
    if (!WEATHER_DURATION_SECONDS.includes(weatherDurationSeconds)) {
      return res.status(400).json({ error: 'Invalid weatherDurationSeconds' });
    }
    patch.weatherDurationSeconds = weatherDurationSeconds;
  }
  if (windUnit !== undefined) {
    if (!WIND_UNITS.includes(windUnit)) return res.status(400).json({ error: 'Invalid windUnit' });
    patch.windUnit = windUnit;
  }
  if (precipUnit !== undefined) {
    if (!PRECIP_UNITS.includes(precipUnit)) return res.status(400).json({ error: 'Invalid precipUnit' });
    patch.precipUnit = precipUnit;
  }
  if (timeFormat !== undefined) {
    if (!['12', '24'].includes(timeFormat)) return res.status(400).json({ error: 'Invalid timeFormat' });
    patch.timeFormat = timeFormat;
  }

  const settings = updateSettings(patch);
  broadcast({ type: 'settings', data: settings });
  // Fire-and-forget: don't make the companion app wait on a weather fetch
  // just to save a location, and don't make someone who just set one up
  // wait up to 15 minutes for the poll loop to get around to it either.
  if (patch.location) pollWeatherNow(patch.location.lat, patch.location.lon);
  res.json(settings);
});
