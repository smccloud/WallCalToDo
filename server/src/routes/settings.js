import { Router } from 'express';
import { getSettings, updateSettings } from '../services/settingsService.js';
import { searchPlaces, reverseGeocode } from '../services/geocodeService.js';
import { pollWeatherNow } from '../services/poller.js';
import { getCachedTasks } from '../services/todoService.js';
import { broadcast, broadcastCalendar } from '../ws/hub.js';

export const settingsRouter = Router();

const OFFSET_MINUTES = [0, 15, 30, 45, 60, 120, 180];

// How often the full-screen weather view takes over the display, and how long
// it holds it. 0 minutes means it never appears. These lists are the
// authority on what's accepted; the companion app's segmented controls offer
// the same values with friendlier labels ("Off", "Every hour"), which is why
// this validates against numbers rather than the labels.
const WEATHER_INTERVAL_MINUTES = [0, 15, 30, 60, 120, 180, 360];
const WEATHER_DURATION_SECONDS = [30, 60, 120, 300];

// How many hours of hourly forecast, and how many days of daily forecast, the
// display will draw. Unlike the two lists above these are continuous ranges
// rather than fixed sets, so the bounds are validated rather than
// membership-checked -- and the companion app's dropdowns offer every value
// in between, one hour/day at a time. Both ceilings are what the server's
// fetch can be trusted to supply (see weatherHourlyHours/weatherDailyDays in
// settingsService.js).
const WEATHER_HOURLY_HOURS_MIN = 1;
const WEATHER_HOURLY_HOURS_MAX = 24;
const WEATHER_DAILY_DAYS_MIN = 5;
const WEATHER_DAILY_DAYS_MAX = 10;

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

// A whole number within an inclusive range. Strictly typed rather than
// coerced: "12" and 12 are the same count to a person filling in a dropdown,
// but only one of them is what the API should be handing around, and
// accepting both would leave every consumer having to guess. The integer
// check is not redundant either -- the display slices an array by these, so
// 6.5 would silently show something nobody asked for.
function isValidCount(value, min, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
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
    microsoftEnabled,
    googleEnabled,
    mergeSimilarEvents,
    tempUnit,
    advancedEnabled,
    weatherEnabled,
    sunriseOffset,
    sunsetOffset,
    weatherIntervalMinutes,
    weatherDurationSeconds,
    weatherHourlyHours,
    weatherDailyDays,
    windUnit,
    precipUnit,
    timeFormat,
    clockShowSeconds,
    clockFlashDivider,
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
  // A real on/off for whether the Microsoft half of the display shows at all
  // -- turning it off drops Office365 calendars and to-do lists from both the
  // calendar and to-do feeds until it's turned back on (see getCachedMsEvents
  // and getCachedTasks). Turning it on does not require a connected account:
  // with none, it simply changes nothing.
  if (microsoftEnabled !== undefined) {
    if (typeof microsoftEnabled !== 'boolean') return res.status(400).json({ error: 'Invalid microsoftEnabled' });
    patch.microsoftEnabled = microsoftEnabled;
  }
  // Same idea for the Google half of the display (see getCachedEvents and
  // getCachedGoogleTasks): off drops Google calendars and tasks from both
  // feeds until it's turned back on.
  if (googleEnabled !== undefined) {
    if (typeof googleEnabled !== 'boolean') return res.status(400).json({ error: 'Invalid googleEnabled' });
    patch.googleEnabled = googleEnabled;
  }
  // Whether events two calendars both list for the same slot are combined
  // into one entry on the display (see mergeSimilarEvents in calendarService.js).
  if (mergeSimilarEvents !== undefined) {
    if (typeof mergeSimilarEvents !== 'boolean') return res.status(400).json({ error: 'Invalid mergeSimilarEvents' });
    patch.mergeSimilarEvents = mergeSimilarEvents;
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
  // The weather view's own on/off, separate from its interval: a view that
  // can't appear at all shouldn't force you to read an interval that does
  // nothing.
  if (weatherEnabled !== undefined) {
    if (typeof weatherEnabled !== 'boolean') return res.status(400).json({ error: 'Invalid weatherEnabled' });
    patch.weatherEnabled = weatherEnabled;
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
  // 1-24 inclusive, and an integer: the display slices a forecast array by
  // this, so a fractional or out-of-range value would either silently show
  // something nobody asked for or leave the row wider than the screen.
  if (weatherHourlyHours !== undefined) {
    if (!isValidCount(weatherHourlyHours, WEATHER_HOURLY_HOURS_MIN, WEATHER_HOURLY_HOURS_MAX)) {
      return res.status(400).json({ error: 'Invalid weatherHourlyHours' });
    }
    patch.weatherHourlyHours = weatherHourlyHours;
  }
  if (weatherDailyDays !== undefined) {
    if (!isValidCount(weatherDailyDays, WEATHER_DAILY_DAYS_MIN, WEATHER_DAILY_DAYS_MAX)) {
      return res.status(400).json({ error: 'Invalid weatherDailyDays' });
    }
    patch.weatherDailyDays = weatherDailyDays;
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
  if (clockShowSeconds !== undefined) {
    if (typeof clockShowSeconds !== 'boolean') {
      return res.status(400).json({ error: 'Invalid clockShowSeconds' });
    }
    patch.clockShowSeconds = clockShowSeconds;
  }
  if (clockFlashDivider !== undefined) {
    if (typeof clockFlashDivider !== 'boolean') {
      return res.status(400).json({ error: 'Invalid clockFlashDivider' });
    }
    patch.clockFlashDivider = clockFlashDivider;
  }

  const settings = updateSettings(patch);
  broadcast({ type: 'settings', data: settings });
  // Turning the Microsoft or Google section off/on — or toggling the similar-
  // event merge — changes what the calendar feed contains, but it isn't
  // re-read just because a setting changed: a display would otherwise keep
  // showing the old items until the next poll. Push both feeds now so the
  // toggle takes effect on the wall the moment it's flipped.
  if (
    patch.microsoftEnabled !== undefined ||
    patch.googleEnabled !== undefined ||
    patch.mergeSimilarEvents !== undefined
  ) {
    broadcastCalendar();
    broadcast({ type: 'todo', data: getCachedTasks() });
  }
  // Fire-and-forget: don't make the companion app wait on a weather fetch
  // just to save a location, and don't make someone who just set one up
  // wait up to 15 minutes for the poll loop to get around to it either.
  if (patch.location) pollWeatherNow(patch.location.lat, patch.location.lon);
  res.json(settings);
});
