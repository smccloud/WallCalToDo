import { readJson, writeJson } from '../store/fileStore.js';
import { getSunTimes } from './sunService.js';

const SETTINGS_FILE = 'settings.json';
// 'dark' matches the only look this project has ever shipped with, so a
// fresh install (or one from before this setting existed) doesn't change
// anything until someone actually opens the toggle. advancedEnabled is a
// real on/off for the offsets, not just a UI show/hide -- off means they
// don't apply at all (switch exactly at the real sunrise/sunset),
// regardless of whatever sunriseOffset/sunsetOffset are saved as. Turning
// it back on reapplies those saved values without needing to re-enter them.
const DEFAULT_SETTINGS = {
  theme: 'dark',
  location: null,
  privacyMode: false,
  // 'F' is the first option in the companion app's Units segmented control,
  // matching the usual "first option starts selected" convention. Temperature
  // was its own Temperature section until wind speed and precipitation
  // joined it (see windUnit/precipUnit below).
  tempUnit: 'F',
  // Wind and precipitation units for the same reason, and with the same US
  // bias as tempUnit above -- the reading is cached in one canonical unit
  // (km/h, mm) and converted by the display, so these only decide what the
  // wall prints. mph and inches because everything else here defaults to the
  // same side of the Atlantic.
  windUnit: 'mph',
  precipUnit: 'inch',
  // How every clock time on the wall is printed: '12' as "5:21 pm", '24' as
  // "17:21" (see frontend/src/utils/date.js). '12' is the format the display
  // has always used, so upgrading doesn't change what anything reads as
  // until someone actually picks the other one.
  timeFormat: '12',
  // Whether the wall's own clock ticks seconds — "5:21:07 pm" rather than
  // "5:21 pm". Scoped to the clock and nothing else, deliberately: the
  // seconds are there to prove the display is alive when you watch it (see
  // formatClockSeconds in frontend/src/utils/date.js), which is an argument
  // that only applies to a clock you're watching, not to a meeting's start
  // time. true because that is what the clock has always shown, so
  // upgrading doesn't change what anything reads as until someone actually
  // turns it off.
  clockShowSeconds: true,
  // Whether the clock's colons blink between the fields — the one part of
  // the wall that moves without being redrawn, and a matter of taste
  // (some people read a blinking colon as a fault indicator, some as what
  // a clock is supposed to do). false because the colons have always been
  // solid, so this stays an opt-in rather than something an upgrade does
  // to somebody's wall unasked.
  clockFlashDivider: false,
  advancedEnabled: false,
  // 'before' is the first option in the companion app's segmented control
  // for both, so it's the default direction -- standard segmented-control
  // behavior is the first item starts selected.
  sunriseOffset: { minutes: 0, direction: 'before' },
  sunsetOffset: { minutes: 0, direction: 'before' },
  // How often the display hands the whole screen over to the weather view
  // (see frontend/src/components/WeatherView.jsx), and for how long it keeps
  // it. 0 is "never", and is the default on purpose: this changes what the
  // wall shows between the calendar and something else, which is a thing to
  // opt into rather than have happen to someone who upgrades. The duration
  // exists because an interval alone doesn't define a rotation — without it
  // the view would either flash past unreadably or never give the calendar
  // back — and 60s is long enough to read 24 hours of forecast from across a
  // room and short enough not to feel like the wall has changed its mind.
  weatherIntervalMinutes: 0,
  weatherDurationSeconds: 60,
};

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
}

// Shifts a sun-event time by the configured offset -- 'before' subtracts,
// 'after' adds. This is what actually ties the companion app's Sunrise/
// Sunset offset controls into the theme switch: getSettings() below returns
// this adjusted time as `sunrise`/`sunset`, and that's the only thing
// App.jsx's auto-theme check ever looks at, so it never needs to know
// offsets exist at all.
function applyOffset(date, offset) {
  if (!date) return date;
  const ms = offset.minutes * 60 * 1000;
  return new Date(date.getTime() + (offset.direction === 'before' ? -ms : ms));
}

// Settings plus today's and tomorrow's sunrise/sunset for the saved location —
// what every consumer (the settings API, the WebSocket push) actually wants.
// Computed fresh on every call rather than cached: it's cheap pure math, and
// this way it's never stale even if the server's been running since yesterday.
//
// Today's pair carries the companion app's offsets, since those decide when
// the display actually switches; tomorrow's pair does not, because nothing
// today is deciding anything about tomorrow. Tomorrow's exists at all so the
// display can show the *next* sun event rather than today's, which is the one
// left once both of today's are behind us (see frontend/src/components/
// SunTimes.jsx) — after sunset, "sunrise" is not something that already
// happened an hour ago, it's tomorrow morning.
export function getSettings() {
  const settings = loadSettings();
  if (!settings.location) {
    return { ...settings, sunrise: null, sunset: null, sunriseTomorrow: null, sunsetTomorrow: null };
  }
  const { lat, lon } = settings.location;
  const now = new Date();
  const { sunrise, sunset } = getSunTimes(lat, lon, now);

  // Calendar arithmetic on a local Date rather than adding 24 hours, so a DST
  // change overnight can't land tomorrow's times on the wrong date.
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const { sunrise: sunriseTomorrow, sunset: sunsetTomorrow } = getSunTimes(lat, lon, tomorrow);

  const today = settings.advancedEnabled
    ? {
        sunrise: applyOffset(sunrise, settings.sunriseOffset),
        sunset: applyOffset(sunset, settings.sunsetOffset),
      }
    : { sunrise, sunset };

  return { ...settings, ...today, sunriseTomorrow, sunsetTomorrow };
}

export function updateSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  writeJson(SETTINGS_FILE, next);
  return getSettings();
}
