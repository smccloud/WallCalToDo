import { Router } from 'express';
import { getSettings, updateSettings } from '../services/settingsService.js';
import { requireTrusted } from '../services/trustedNetworks.js';
import { searchPlaces, reverseGeocode } from '../services/geocodeService.js';
import { pollWeatherNow, pollLunchNow } from '../services/poller.js';
import {
  fetchSchools,
  fetchLines,
  discoverDistricts,
  validateLunchSettings,
  PROVIDER_LIST,
} from '../services/lunchService.js';
import { PROVIDER_IDS, DEFAULT_PROVIDER } from '../services/lunch/index.js';
import { getCachedTasks } from '../services/todoService.js';
import { broadcast, broadcastCalendar } from '../ws/hub.js';

export const settingsRouter = Router();

// Reads (GET) stay open so the display and companion app keep working over the
// home network; only state changes are limited to the Pi's own screen and
// server/.env's TRUSTED_CIDRS. Mounted once, ahead of every route, so a route
// added later can't forget it.
settingsRouter.use(requireTrusted);

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

// School lunch's provider, ids and clock times. The ids are opaque and
// provider-specific (a Nutrislice slug, a numeric site id, a SchoolCafe GUID),
// so this route only bounds their length and type; the active provider checks
// its own shape (see validateLunchSettings in lunchService.js) once the patch is
// merged, which is also what keeps a half-typed id out of a request URL. Times
// are 'HH:MM' local wall time or null, where null on both ends of the window
// means all day (so enabling the view can't leave it with a window that never
// opens).
const LUNCH_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LUNCH_ID_MAX = 64;
const LUNCH_LINE_MAX = 120;

// How often the lunch view alternates between breakfast and lunch, in seconds.
// 0 means "off" (stay on the meal pickMeal chose). This list is the authority
// on what's accepted; the companion app's dropdown offers the same values with
// friendlier labels ("Every 30 seconds").
const LUNCH_ALTERNATE_SECONDS = [0, 15, 30, 60, 120, 300];

function isValidOffset(offset) {
  return (
    offset &&
    OFFSET_MINUTES.includes(offset.minutes) &&
    ['before', 'after'].includes(offset.direction)
  );
}

function isValidLunchTime(value) {
  return value === null || (typeof value === 'string' && LUNCH_TIME_RE.test(value));
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

// The provider list, for the companion app's picker, so the two never disagree
// about what's available.
settingsRouter.get('/lunch/providers', (req, res) => {
  res.json({ providers: PROVIDER_LIST });
});

// The `provider` query parameter every lunch lookup accepts, keeping the
// unknown-provider case a clean 400 while an absent one falls back to the
// default. Returns null for an unknown id.
function lunchProviderFrom(req) {
  const provider = req.query.provider;
  if (provider === undefined) return DEFAULT_PROVIDER;
  return PROVIDER_IDS.includes(provider) ? provider : null;
}

// The schools in a district, for the companion app's school picker. What a
// district id looks like is the provider's business -- a Nutrislice slug, a
// numeric site id, a SchoolCafe district id -- so this only checks it's
// non-empty; the provider's own fetch rejects a bad shape. A district that
// resolves but errors upstream is a 502, the same as a bad geocode.
settingsRouter.get('/lunch/schools', async (req, res) => {
  const provider = lunchProviderFrom(req);
  if (!provider) return res.status(400).json({ error: 'Invalid provider' });
  const district = String(req.query.district || '').trim();
  if (!district) return res.status(400).json({ error: 'Invalid district' });
  if (validateLunchSettings({ schoolLunchProvider: provider, schoolLunchDistrict: district })) {
    return res.status(400).json({ error: 'Invalid district' });
  }
  try {
    res.json({ schools: await fetchSchools(district, provider) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// SchoolCafe-only: the serving lines within a school. A serving line is what a
// SchoolCafe menu is actually fetched by, so the picker needs to offer them.
settingsRouter.get('/lunch/lines', async (req, res) => {
  const provider = lunchProviderFrom(req);
  if (!provider) return res.status(400).json({ error: 'Invalid provider' });
  const school = String(req.query.school || '').trim();
  if (!school) return res.status(400).json({ error: 'Invalid school' });
  try {
    res.json({ lines: await fetchLines(school, String(req.query.district || '').trim(), provider) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Best-effort district discovery from the wall's location, provider by provider
// (see discoverDistricts in lunchService.js). A place it can't name, or one with
// no matching district, is an empty list rather than an error -- only a
// lookup/fetch failure is a 502.
settingsRouter.get('/lunch/discover', async (req, res) => {
  const provider = lunchProviderFrom(req);
  if (!provider) return res.status(400).json({ error: 'Invalid provider' });
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (
    Number.isNaN(lat) ||
    Number.isNaN(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return res.status(400).json({ error: 'Invalid lat/lon' });
  }
  try {
    res.json(await discoverDistricts({ lat, lon }, provider));
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
    schoolLunchEnabled,
    schoolLunchProvider,
    schoolLunchDistrict,
    schoolLunchSchool,
    schoolLunchSchoolName,
    schoolLunchServingLine,
    schoolLunchStartTime,
    schoolLunchEndTime,
    schoolLunchShowTomorrow,
    schoolLunchAlternateSeconds,
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
  // The school lunch view's own on/off. Off leaves the to-do list in place;
  // its other settings are saved regardless so turning it back on restores
  // the same provider/district/school/window without re-entering them.
  if (schoolLunchEnabled !== undefined) {
    if (typeof schoolLunchEnabled !== 'boolean') {
      return res.status(400).json({ error: 'Invalid schoolLunchEnabled' });
    }
    patch.schoolLunchEnabled = schoolLunchEnabled;
  }
  // Which menu system to read. Provider-specific value shapes are checked below
  // (validateLunchSettings), after the patch is merged with what's saved.
  if (schoolLunchProvider !== undefined) {
    if (typeof schoolLunchProvider !== 'string' || !PROVIDER_IDS.includes(schoolLunchProvider)) {
      return res.status(400).json({ error: 'Invalid schoolLunchProvider' });
    }
    patch.schoolLunchProvider = schoolLunchProvider;
  }
  // The district and school ids are opaque and provider-specific, so only their
  // type and length are bounded here. A number is allowed because Health-e Pro's
  // ids are integers and the companion app may send them as such.
  for (const [key, value] of [
    ['schoolLunchDistrict', schoolLunchDistrict],
    ['schoolLunchSchool', schoolLunchSchool],
  ]) {
    if (value === undefined) continue;
    const ok =
      value === null ||
      (typeof value === 'string' && value.length <= LUNCH_ID_MAX) ||
      (typeof value === 'number' && Number.isInteger(value));
    if (!ok) return res.status(400).json({ error: `Invalid ${key}` });
    patch[key] = value;
  }
  // SchoolCafe-only: the serving line its menu is fetched by.
  if (schoolLunchServingLine !== undefined) {
    if (
      schoolLunchServingLine !== null &&
      (typeof schoolLunchServingLine !== 'string' || schoolLunchServingLine.length > LUNCH_LINE_MAX)
    ) {
      return res.status(400).json({ error: 'Invalid schoolLunchServingLine' });
    }
    patch.schoolLunchServingLine = schoolLunchServingLine;
  }
  // Purely cosmetic -- it's only ever shown back in the companion app's
  // picker -- but still length-bounded so a runaway string can't be stored.
  if (schoolLunchSchoolName !== undefined) {
    if (
      schoolLunchSchoolName !== null &&
      (typeof schoolLunchSchoolName !== 'string' || schoolLunchSchoolName.length > 120)
    ) {
      return res.status(400).json({ error: 'Invalid schoolLunchSchoolName' });
    }
    patch.schoolLunchSchoolName = schoolLunchSchoolName;
  }
  // The active provider owns the shape rules for its own ids, checked against
  // the merged settings so a change to any one identity field is judged in the
  // context of the others. Only run when an identity field actually changes --
  // the display-only knobs (on/off, window, tomorrow fallback, alternate
  // interval) must not be rejected because a school hasn't been picked yet.
  if (
    patch.schoolLunchProvider !== undefined ||
    patch.schoolLunchDistrict !== undefined ||
    patch.schoolLunchSchool !== undefined ||
    patch.schoolLunchServingLine !== undefined
  ) {
    const error = validateLunchSettings({ ...getSettings(), ...patch });
    if (error) return res.status(400).json({ error });
  }
  if (schoolLunchStartTime !== undefined) {
    if (!isValidLunchTime(schoolLunchStartTime)) {
      return res.status(400).json({ error: 'Invalid schoolLunchStartTime' });
    }
    patch.schoolLunchStartTime = schoolLunchStartTime;
  }
  if (schoolLunchEndTime !== undefined) {
    if (!isValidLunchTime(schoolLunchEndTime)) {
      return res.status(400).json({ error: 'Invalid schoolLunchEndTime' });
    }
    patch.schoolLunchEndTime = schoolLunchEndTime;
  }
  // Whether the view falls back to tomorrow's menu when today has none. Display
  // logic only, so it travels in the settings push like the window above.
  if (schoolLunchShowTomorrow !== undefined) {
    if (typeof schoolLunchShowTomorrow !== 'boolean') {
      return res.status(400).json({ error: 'Invalid schoolLunchShowTomorrow' });
    }
    patch.schoolLunchShowTomorrow = schoolLunchShowTomorrow;
  }
  if (schoolLunchAlternateSeconds !== undefined) {
    if (!LUNCH_ALTERNATE_SECONDS.includes(schoolLunchAlternateSeconds)) {
      return res.status(400).json({ error: 'Invalid schoolLunchAlternateSeconds' });
    }
    patch.schoolLunchAlternateSeconds = schoolLunchAlternateSeconds;
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
  // Changing what the lunch view fetches (its on/off, provider, district,
  // school, or serving line) means the cached menus are for the wrong school or
  // none at all, so refetch now and push the result rather than letting the
  // wall show the previous school's menu until the next poll. The window, the
  // tomorrow fallback and the alternate interval are pure display logic and
  // travel in the settings push above.
  if (
    patch.schoolLunchEnabled !== undefined ||
    patch.schoolLunchProvider !== undefined ||
    patch.schoolLunchDistrict !== undefined ||
    patch.schoolLunchSchool !== undefined ||
    patch.schoolLunchServingLine !== undefined
  ) {
    pollLunchNow();
  }
  res.json(settings);
});
