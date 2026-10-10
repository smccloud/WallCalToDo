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
  // Whether to show the Microsoft calendar section — off hides Office365
  // accounts and their calendars from the display. true shows them if
  // connected (the default for existing installs).
  microsoftEnabled: true,
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
  weatherEnabled: false,
  // How often the display hands the whole screen over to the weather view
  // (see frontend/src/components/WeatherView.jsx), and for how long it keeps
  // it. weatherEnabled is the only thing that decides whether the view appears
  // at all; these two say how often and how long *once it's on*, which is why
  // 0 minutes no longer means "never" to anybody (the companion app's "Off"
  // option is the switch now) but stays accepted here so an API client that
  // still sends it isn't broken.
  //
  // 15 rather than 0 is the first interval the companion app offers, so that
  // turning the view on can't leave it enabled with nothing to repeat on.
  weatherIntervalMinutes: 15,
  weatherDurationSeconds: 60,
  // How many hours of hourly forecast the weather view draws across the top
  // of the wall, 1-24. Its own setting rather than a consequence of the
  // interval/duration above because it answers a different question: those
  // two are about *when* the view appears and for how long, this is about
  // what it says while it's up. 24 is what the view has always shown, and
  // 24 is also the most the cache can be trusted to supply -- the server
  // fetches 48 hours so the window is never short even when the reading
  // underneath it is up to an hour old (see HOURLY_FETCH_HOURS in
  // weatherService.js).
  weatherHourlyHours: 24,
  // How many days of daily forecast the weather view draws underneath the
  // hours, 5-10. Same reasoning as the hourly count above: the daily strip is
  // the other half of the view, and someone who plans a week out doesn't
  // want five columns of it. 10 is what the view has always shown, and 10 is
  // every day the server fetches (see DAILY_FETCH_DAYS in weatherService.js).
  weatherDailyDays: 10,
};

function loadSettings() {
  const saved = readJson(SETTINGS_FILE, {});
  const settings = { ...DEFAULT_SETTINGS, ...saved };

  // An install saved before the weather view had its own on/off switch has no
  // weatherEnabled key at all, and back then "off" was expressed as an
  // interval of 0. Derive the switch from that rather than taking the
  // default: the alternative silently switches the weather view off for
  // anyone who had turned it on, which is the kind of thing that gets
  // reported as "the update broke my wall".
  //
  // Read from `saved`, not from the merged settings, for two reasons. The
  // merge has already filled the gap with the default we're trying not to
  // apply; and the *default* interval is a real positive number now, so
  // reading the merged one would derive "on" for a fresh install that has
  // never asked for a weather view in its life.
  if (!('weatherEnabled' in saved)) {
    settings.weatherEnabled = Number(saved.weatherIntervalMinutes) > 0;
  }

  return settings;
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
