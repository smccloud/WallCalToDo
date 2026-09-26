import { pollCalendar as pollGoogleCalendar, resetSyncTokens as resetGoogleCalendarSyncTokens } from './calendarService.js';
import {
  pollCalendar as pollMicrosoftCalendar,
  resetSyncTokens as resetMicrosoftCalendarSyncTokens,
} from './microsoftCalendarService.js';
import { getMergedEvents } from './calendarAggregator.js';
import { pollTodo, clearCompletedTasks as clearCompletedMicrosoftTasks } from './todoService.js';
import { pollTasks as pollGoogleTasks, clearCompletedTasks as clearCompletedGoogleTasks } from './googleTasksService.js';
import { getMergedTasks } from './todoAggregator.js';
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

async function runPoll() {
  const now = new Date();
  const today = now.toDateString();
  if (lastFullResyncDay !== today) {
    // Both calendar providers pin their sync window to whenever the last
    // full sync ran (see each service's own resetSyncTokens comment for
    // why), so both need resetting on the same daily cadence, not just
    // Google's.
    resetGoogleCalendarSyncTokens();
    resetMicrosoftCalendarSyncTokens();
    lastFullResyncDay = today;
  }

  // Once a week, as soon as the day rolls over to Monday -- getDay() === 1
  // -- rather than on a rolling "7 days since last cleanup" timer, so it
  // always lands on the same day regardless of when the server last
  // restarted. Only ever removes completed tasks from each provider's
  // local cache (see clearCompletedTasks in each service), never the real
  // task in Microsoft To Do or Google Tasks.
  if (lastCompletedCleanupDay !== today && now.getDay() === 1) {
    // Wrapped like the calendar/todo polls below -- runPoll() is called
    // fire-and-forget from startPolling() with no caller to catch a
    // rejection, so an uncaught error here used to crash the whole
    // process (and since lastCompletedCleanupDay never got set, every
    // restart hit the same failure again -- a permanent crash loop until
    // whatever caused it was fixed by hand).
    try {
      clearCompletedMicrosoftTasks();
      clearCompletedGoogleTasks();
      broadcast({ type: 'todo', data: getMergedTasks() });
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

  // Same "poll both unconditionally, merge, broadcast once if either
  // changed" shape as the to-do polling below -- see todoAggregator.js /
  // calendarAggregator.js for why the merge can't just be "whichever
  // provider's own result changed".
  let calendarChanged = false;

  try {
    const { changed } = await pollGoogleCalendar();
    calendarChanged = calendarChanged || changed;
  } catch (err) {
    console.error('[poller] Google Calendar poll failed:', err.message);
  }

  try {
    const { changed } = await pollMicrosoftCalendar();
    calendarChanged = calendarChanged || changed;
  } catch (err) {
    console.error('[poller] Microsoft Calendar poll failed:', err.message);
  }

  if (calendarChanged) broadcast({ type: 'calendar', data: getMergedEvents() });

  let todoChanged = false;

  try {
    const { changed } = await pollTodo();
    todoChanged = todoChanged || changed;
  } catch (err) {
    console.error('[poller] Microsoft To Do poll failed:', err.message);
  }

  try {
    const { changed } = await pollGoogleTasks();
    todoChanged = todoChanged || changed;
  } catch (err) {
    console.error('[poller] Google Tasks poll failed:', err.message);
  }

  if (todoChanged) broadcast({ type: 'todo', data: getMergedTasks() });

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
