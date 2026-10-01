import { pollCalendar, resetSyncTokens as resetCalendarSyncTokens, getCachedEvents } from './calendarService.js';
import { pollMsCalendar } from './msCalendarService.js';
import { pollTodo, clearCompletedTasks } from './todoService.js';
import { getSettings } from './settingsService.js';
import { pollWeather } from './weatherService.js';
import { broadcast } from '../ws/hub.js';
import { config } from '../config.js';

// Weather doesn't need calendar/todo's minute-by-minute freshness, so it's
// gated to its own much longer interval inside the same poll loop instead
// of a separate timer.
const WEATHER_POLL_INTERVAL_MS = 15 * 60 * 1000;

let timer = null;
let lastFullResyncDay = null;
let lastSettingsDay = null;
let lastCompletedCleanupDay = null;
let lastWeatherPollAt = 0;
let lastCalendarSignature = null;

// Pushes the display's calendar feed if it isn't already what every connected
// display last received.
//
// Keyed on the contents rather than on either provider's "did anything change"
// flag, because the feed is no longer a pure function of what the providers
// hold: the Microsoft per-day cap is relative to the current time (see
// limitToPerDay in msCalendarService.js), so on a quiet day the list a
// display should be showing changes as the morning's meetings pass and the
// polls themselves report no change at all. Diffing the actual list is what
// catches that, and it makes the providers' own `changed` flags unnecessary
// here — they only ever claim something moved, which is the same question.
//
// The Microsoft overflow count is part of the signature for the same reason:
// it rides on the kept events rather than standing in for them, so a day that
// gains a meeting the per-day cap then drops leaves every id and start time in
// this list exactly as they were. Without it, "+2" would stay on the wall
// until some unrelated event moved.
function pushCalendar(events) {
  const signature = events
    .map((event) => `${event.id}@${event.start}${event.msOverflowCount ? `+${event.msOverflowCount}` : ''}`)
    .join(',');
  if (signature === lastCalendarSignature) return;
  lastCalendarSignature = signature;
  broadcast({ type: 'calendar', data: events });
}

async function runPoll() {
  const now = new Date();
  const today = now.toDateString();
  if (lastFullResyncDay !== today) {
    // Google only: its sync token is pinned to the window of the request that
    // started the round, so it has to be dropped daily for that window to roll
    // forward. Microsoft no longer has a token to drop -- it re-reads its whole
    // window on its own interval inside pollMsCalendar -- so there is nothing
    // to reset here for it.
    resetCalendarSyncTokens();
    lastFullResyncDay = today;
  }

  // Once a week, as soon as the day rolls over to Monday -- getDay() === 1
  // -- rather than on a rolling "7 days since last cleanup" timer, so it
  // always lands on the same day regardless of when the server last
  // restarted. Only ever removes completed tasks from the local cache
  // (see clearCompletedTasks), never the real task in Microsoft To Do.
  if (lastCompletedCleanupDay !== today && now.getDay() === 1) {
    // Wrapped like the calendar/todo polls below -- runPoll() is called
    // fire-and-forget from startPolling() with no caller to catch a
    // rejection, so an uncaught error here used to crash the whole
    // process (and since lastCompletedCleanupDay never got set, every
    // restart hit the same failure again -- a permanent crash loop until
    // whatever caused it was fixed by hand).
    try {
      const tasks = clearCompletedTasks();
      broadcast({ type: 'todo', data: tasks });
    } catch (err) {
      console.error('[poller] Weekly to-do cleanup failed:', err.message);
    }
    lastCompletedCleanupDay = today;
  }

  const settings = getSettings();

  // getSettings() computes sunrise/sunset for "today" at call time, but a
  // connected display only gets a `settings` message when it (re)connects
  // (see ws/hub.js) — this kiosk can stay connected for days, so without
  // this it keeps yesterday's sunrise/sunset forever. Those are absolute
  // timestamps for a specific calendar day, so once "now" rolls past
  // midnight it's already past that stale sunset too, which permanently
  // fails the auto-theme's `now < sunset` check and locks it on dark —
  // sunset-triggered dark still worked because that comparison only needs
  // to hold true once, on the same day the values were fetched. Rebroadcast
  // once a day so every connected display picks up the new day's times.
  if (lastSettingsDay !== today) {
    broadcast({ type: 'settings', data: settings });
    lastSettingsDay = today;
  }

  try {
    const { events } = await pollCalendar();
    pushCalendar(events);
  } catch (err) {
    console.error('[poller] Calendar poll failed:', err.message);
  }

  // Second calendar provider, same display feed. Polled after Google's so the
  // push below lands last when both moved in the same cycle -- it re-reads
  // getCachedEvents() rather than using pollMsCalendar()'s own result, since
  // the display needs all calendars from both providers in one message and the
  // first push above would have carried a Microsoft side that was still a poll
  // behind. pushCalendar's own diffing makes that second call a no-op when
  // nothing actually moved, so this costs a cache read, not a second push.
  try {
    await pollMsCalendar();
    pushCalendar(getCachedEvents());
  } catch (err) {
    console.error('[poller] Microsoft calendar poll failed:', err.message);
  }

  try {
    const { changed, tasks } = await pollTodo();
    if (changed) broadcast({ type: 'todo', data: tasks });
  } catch (err) {
    console.error('[poller] Todo poll failed:', err.message);
  }

  // Nowhere to fetch weather *for* without a saved location -- skipped
  // entirely rather than erroring every cycle until one's set.
  if (settings.location && Date.now() - lastWeatherPollAt >= WEATHER_POLL_INTERVAL_MS) {
    await pollWeatherNow(settings.location.lat, settings.location.lon);
  }
}

// Fetches, caches, and broadcasts a fresh weather reading right now,
// bypassing WEATHER_POLL_INTERVAL_MS -- exported so the settings route can
// call this the moment a location is saved, rather than making someone who
// just set one up wait up to 15 minutes for the first reading to appear.
export async function pollWeatherNow(lat, lon) {
  try {
    const weather = await pollWeather(lat, lon);
    broadcast({ type: 'weather', data: weather });
    lastWeatherPollAt = Date.now();
  } catch (err) {
    console.error('[poller] Weather poll failed:', err.message);
  }
}

export function startPolling() {
  runPoll(); // populate immediately on boot instead of waiting a full interval
  timer = setInterval(runPoll, config.pollIntervalMs);
}

export function stopPolling() {
  if (timer) clearInterval(timer);
}
