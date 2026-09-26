import { getCalendarAccessToken, graphFetch, isAuthorized, listCalendars } from '../auth/microsoftAuth.js';
import { readJson, writeJson } from '../store/fileStore.js';

const EVENTS_CACHE_FILE = 'msEventsCache.json';
const SYNC_FILE = 'msCalendarSync.json';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
// Same window as calendarService.js's Google side -- kept identical so a
// Microsoft and a Google calendar shown side by side cover the same span
// of time rather than one quietly extending further than the other.
const FULL_SYNC_WINDOW_DAYS = 90;
const FULL_SYNC_LOOKBACK_DAYS = 35;

const loadEvents = () => readJson(EVENTS_CACHE_FILE, {});
const saveEvents = (cache) => writeJson(EVENTS_CACHE_FILE, cache);
const loadSync = () => readJson(SYNC_FILE, {});
const saveSync = (sync) => writeJson(SYNC_FILE, sync);

// Graph's start.dateTime/end.dateTime are naive "wall clock" strings with
// no offset -- only meaningful together with their sibling timeZone
// field. Same exact situation todoService.js already ran into for
// dueDateTime and fixed the same way: this app never sends a
// Prefer: outlook.timezone header on its Graph requests, so Graph's
// documented default applies -- UTC. Appending "Z" makes that explicit,
// so downstream Date parsing treats it as the correct instant instead of
// reinterpreting the same digits as local time.
function toIsoDateTime(field) {
  if (!field?.dateTime) return null;
  if (field.timeZone === 'UTC') return `${field.dateTime}Z`;
  // Unexpected: Graph returned something other than UTC despite no
  // preference header. Pass it through as-is rather than guess wrong,
  // same fallback todoService.js takes.
  return field.dateTime;
}

// By default Outlook drops a declined meeting from calendarView entirely
// server-side, so this is defense-in-depth rather than load-bearing the
// way the equivalent check is for Google (which does return declined
// events and relies on the client to filter them) -- it only matters if
// the account has "show declined events" turned on, or for an invite
// that's still sitting unanswered.
function isAcceptedByUser(event) {
  if (event.isOrganizer) return true;
  const response = event.responseStatus?.response;
  return response === 'accepted' || response === 'organizer' || response === 'none';
}

function upsertEvent(entries, event, context) {
  if (event['@removed'] || !isAcceptedByUser(event)) delete entries[event.id];
  else entries[event.id] = normalizeEvent(event, context);
}

// Microsoft doesn't publish an official hex mapping for its calendar-color
// enum the way it does the `hexColor` field itself -- these are a
// best-effort approximation of Outlook's own palette, used only as a
// fallback for a calendar that's never had an explicit color set (where
// Graph's `hexColor` comes back empty, most commonly calendars left on
// "auto"). Worth a visual sanity check against Outlook's actual swatches
// if exact color matching matters.
const FALLBACK_COLOR_BY_ENUM = {
  lightBlue: '#0078D4',
  lightGreen: '#498205',
  lightOrange: '#CA5010',
  lightGray: '#69797E',
  lightYellow: '#FFB900',
  lightTeal: '#00B7C3',
  lightPink: '#E3008C',
  lightBrown: '#8E562E',
  lightRed: '#D13438',
  maxColor: '#69797E',
};

// Prefers Graph's own hexColor (authoritative when the user's actually
// set one) over the enum-based approximation, and returns null rather
// than a guess for "auto"/unrecognized values -- DayAgenda.jsx already
// falls back to var(--color-accent) when `color` is null, which is a
// more honest result than a made-up color for a calendar nobody colored.
function resolveColor(hexColor, colorEnum) {
  if (hexColor) return hexColor.startsWith('#') ? hexColor : `#${hexColor}`;
  return FALLBACK_COLOR_BY_ENUM[colorEnum] || null;
}

function normalizeEvent(event, context) {
  return {
    id: event.id,
    title: event.subject || '(No title)',
    start: toIsoDateTime(event.start),
    end: toIsoDateTime(event.end),
    allDay: Boolean(event.isAllDay),
    location: event.location?.displayName || null,
    calendarLabel: context.calendarLabel,
    // Microsoft has no per-event color override the way Google's colorId
    // does (Outlook's closest equivalent, categories, is a different
    // mechanism entirely and not mapped here) -- so unlike Google's
    // normalizeEvent, `color` and `calendarColor` are always the same
    // value for a Microsoft event. Both are still set, not just one,
    // because DayAgenda.jsx reads `color` for the pill itself while the
    // Legend reads `calendarColor` for the calendar's identity swatch --
    // omitting either would silently break just that one consumer.
    calendarColor: context.color,
    calendarOrder: context.calendarOrder,
    color: context.color,
  };
}

// Full listing via the same delta endpoint, seeded from
// FULL_SYNC_LOOKBACK_DAYS in the past out to FULL_SYNC_WINDOW_DAYS ahead.
// The final page's deltaLink becomes our handle for cheap incremental
// polls, same shape as calendarService.js's Google side and
// todoService.js's own delta handling for tasks.
async function fullSync(accessToken, calendarId, entries, context) {
  const startDateTime = new Date(Date.now() - FULL_SYNC_LOOKBACK_DAYS * 86400000).toISOString();
  const endDateTime = new Date(Date.now() + FULL_SYNC_WINDOW_DAYS * 86400000).toISOString();
  let url = `${GRAPH_BASE}/me/calendars/${calendarId}/calendarView/delta?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}`;
  let deltaLink;
  const seenIds = new Set();

  do {
    const data = await graphFetch(url, accessToken);
    for (const event of data.value || []) {
      seenIds.add(event.id);
      upsertEvent(entries, event, context);
    }
    url = data['@odata.nextLink'];
    deltaLink = data['@odata.deltaLink'] || deltaLink;
  } while (url);

  // Same reasoning as calendarService.js's fullSync: a first-time listing
  // like this one doesn't carry removal markers for things deleted before
  // this sync ever started, so anything already cached inside this window
  // that didn't come back here needs pruning explicitly.
  const minTime = new Date(startDateTime).getTime();
  const maxTime = new Date(endDateTime).getTime();
  for (const [id, cached] of Object.entries(entries)) {
    const startTime = new Date(cached.start).getTime();
    if (startTime >= minTime && startTime <= maxTime && !seenIds.has(id)) delete entries[id];
  }

  return deltaLink;
}

// Incremental listing using the stored deltaLink -- only events that
// changed since the last poll come back. Mirrors todoService.js's own
// delta-following loop.
async function incrementalSync(accessToken, entries, context, deltaLink) {
  let url = deltaLink;
  let nextDeltaLink;
  let changed = false;

  do {
    const data = await graphFetch(url, accessToken);
    for (const event of data.value || []) {
      changed = true;
      upsertEvent(entries, event, context);
    }
    url = data['@odata.nextLink'];
    nextDeltaLink = data['@odata.deltaLink'] || nextDeltaLink;
  } while (url);

  return { changed, deltaLink: nextDeltaLink };
}

async function pollOneCalendar(accessToken, calendarId, context, cache, sync) {
  const entries = cache[calendarId] || {};
  cache[calendarId] = entries;
  let changed = false;

  try {
    if (!sync[calendarId]?.deltaLink) {
      sync[calendarId] = { deltaLink: await fullSync(accessToken, calendarId, entries, context) };
      changed = true;
    } else {
      const result = await incrementalSync(accessToken, entries, context, sync[calendarId].deltaLink);
      changed = result.changed;
      sync[calendarId] = { deltaLink: result.deltaLink || sync[calendarId].deltaLink };
    }
  } catch (err) {
    if (err.status === 410) {
      // Delta link expired or invalid -- drop it and fall back to a full
      // resync, same handling as todoService.js's own delta polling.
      Object.keys(entries).forEach((id) => delete entries[id]);
      sync[calendarId] = { deltaLink: await fullSync(accessToken, calendarId, entries, context) };
      changed = true;
    } else {
      throw err;
    }
  }

  return changed;
}

export async function pollCalendar() {
  if (!(await isAuthorized())) return { changed: false, events: [] };

  const enabledCalendars = listCalendars().filter((cal) => cal.enabled);
  if (enabledCalendars.length === 0) return { changed: false, events: [] };

  let accessToken;
  try {
    accessToken = await getCalendarAccessToken();
  } catch (err) {
    // Most likely an account connected before Calendar support existed
    // (see microsoftAuth.js's calendarScopeGranted) -- surfaced the same
    // way a failed connection is already surfaced elsewhere, rather than
    // throwing and taking down the rest of runPoll()'s poll cycle.
    console.error('[msCalendar] failed to get an access token — needs reconnect for Calendar access:', err.message);
    return { changed: false, events: [] };
  }

  const cache = loadEvents();
  const sync = loadSync();
  let changed = false;
  // Same reasoning as calendarService.js's calendarOrder -- lets a
  // consumer (the wall display's calendar-color legend) sort Microsoft
  // calendars in the same order the companion app's own list shows them.
  let calendarOrder = 0;

  for (const cal of enabledCalendars) {
    const context = {
      calendarLabel: cal.displayName,
      color: resolveColor(cal.hexColor, cal.color),
      calendarOrder: calendarOrder++,
    };
    try {
      const calChanged = await pollOneCalendar(accessToken, cal.id, context, cache, sync);
      changed = changed || calChanged;
    } catch (err) {
      console.error(`[msCalendar] poll failed for ${cal.displayName}:`, err.message);
    }
  }

  saveEvents(cache);
  saveSync(sync);
  return { changed, events: getCachedEvents() };
}

// Forces the next pollCalendar() call to do a full resync of every
// calendar. Needed for the same reason as calendarService.js's
// resetSyncTokens(): each sync window is pinned to the original full-sync
// request's startDateTime/endDateTime, so without a periodic reset it
// never rolls forward and stale past events never get pruned. Called
// alongside the Google side from poller.js's existing daily check.
export function resetSyncTokens() {
  saveSync({});
}

// Purges cached events/sync state for one calendar -- used when a
// calendar is removed/disabled and its history shouldn't linger.
export function dropCalendarCache(calendarId) {
  const cache = loadEvents();
  const sync = loadSync();
  delete cache[calendarId];
  delete sync[calendarId];
  saveEvents(cache);
  saveSync(sync);
}

// Wipes every calendar's cached events/sync state -- used when
// disconnecting the Microsoft account entirely, mirroring
// todoService.js's dropAllListsCache().
export function dropAllCalendarsCache() {
  saveEvents({});
  saveSync({});
}

// Only events from currently-enabled calendars are returned -- toggling a
// calendar off in the companion app takes effect immediately, without
// waiting for or triggering a new poll. Mirrors todoService.js's
// getCachedTasks() exactly, including the defensive null-skip.
export function getCachedEvents() {
  const cache = loadEvents();
  const enabledIds = new Set(listCalendars().filter((cal) => cal.enabled).map((cal) => cal.id));
  const events = [];
  for (const [calendarId, entries] of Object.entries(cache)) {
    if (!enabledIds.has(calendarId)) continue;
    events.push(...Object.values(entries).filter(Boolean));
  }
  return events.sort((a, b) => new Date(a.start) - new Date(b.start));
}
