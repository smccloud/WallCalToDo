import {
  getAccessToken,
  graphFetch,
  isAuthorized,
  listCalendars,
  CALENDAR_SCOPES,
} from '../auth/microsoftAuth.js';
import { listAccounts } from '../auth/googleAuth.js';
import { readJson, writeJson } from '../store/fileStore.js';

const EVENTS_CACHE_FILE = 'msCalendarEventsCache.json';
const SYNC_FILE = 'msCalendarSync.json';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
// Same window calendarService.js uses for Google, deliberately: the display
// only ever shows the current month, and both providers' events end up in
// one list, so they should cover the same stretch of dates.
const FULL_SYNC_WINDOW_DAYS = 90;
const FULL_SYNC_LOOKBACK_DAYS = 35;

// `|| {}` rather than relying on readJson's fallback, which only covers a
// missing or unparseable file -- one that parses to `null` (a torn write on
// an SD card, same hazard todoService.js guards against per-entry) would
// otherwise make Object.entries below throw on every poll and every read.
const loadEvents = () => readJson(EVENTS_CACHE_FILE, {}) || {};
const saveEvents = (cache) => writeJson(EVENTS_CACHE_FILE, cache);
const loadSync = () => readJson(SYNC_FILE, {}) || {};
const saveSync = (sync) => writeJson(SYNC_FILE, sync);

// Graph's event ids are opaque base64 blobs that share no namespace with
// Google's, but both end up in one flat array on the display keyed by id
// (see CalendarView.jsx/DayAgenda.jsx), so prefix them to keep a collision
// from making React reuse the wrong node. Same value used as the cache key
// so a cancellation deletes the entry it created.
//
// iCalUId is the fallback because a delta round can hand back an expanded
// occurrence of a recurring series with no `id` at all, only its iCalUId.
// Keying on id alone collapsed every such event onto one `ms:undefined`
// entry, so all but the last silently overwrote each other.
const ID_PREFIX = 'ms:';
const eventKey = (event) => `${ID_PREFIX}${event.id || event.iCalUId}`;

// Every event id in the wall display's flat list, from either provider, needs
// to be unique on its own. This one is derived from the calendar rather than
// the event, since that's what the legend groups by.
const calendarKey = (calendarId) => `${ID_PREFIX}calendar::${calendarId}`;

// Ask for every response in UTC so timed events come back as a plain UTC
// wall clock (see toIsoInstant) instead of a Windows time-zone name this
// process would have to resolve itself. Must be sent on *every* request in a
// delta round, not just the first -- the returned deltaLink carries the
// query parameters but not the headers.
const PREFER_HEADERS = { Prefer: 'outlook.timezone="UTC"' };

// Stand-in for an event with no subject. Shared by the normalizer and the
// read-time filter below, so the two can't drift apart and quietly stop
// matching. calendarService.js has its own copy of the same idea, which is
// deliberate -- the two providers are kept independent throughout, down to
// mirroring isAcceptedByUser -- and both have to drop these or the merged
// list would show untitled Google events while hiding untitled Microsoft
// ones, for no reason a user could see.
const UNTITLED = '(No title)';

// calendarView/delta answers with a restricted default property set, and a
// delta round that omits a field the code below reads is indistinguishable
// from one where the event genuinely doesn't have it. That bit us twice:
// responseStatus missing made every declined/tentative invite look accepted
// (see isAcceptedByUser), and organizer missing would leave no way to tell an
// invite from someone else's calendar apart from the user's own. Ask for what
// we depend on by name rather than hoping for it.
//
// id and iCalUId are both requested because neither is reliable alone across
// delta rounds -- see eventKey().
const DELTA_SELECT = [
  'id',
  'iCalUId',
  'subject',
  'start',
  'end',
  'isAllDay',
  'location',
  'organizer',
  'responseStatus',
  'isCancelled',
  'isDraft',
  'type',
].join(',');

// Graph's dateTime is a naive wall-clock string with 7 fractional digits and
// no offset. With the UTC preference above, that wall clock *is* UTC, so
// mark it as such -- otherwise new Date() downstream would reinterpret the
// same digits as the browser's own local time, shifting every timed event by
// whatever the local UTC offset happens to be. Mirrors toIsoDue() in
// todoService.js, which has to make the same assumption about dueDateTime.
function toIsoInstant(dateTime) {
  if (!dateTime) return null;
  return `${dateTime.replace(/\.\d+$/, '')}Z`;
}

// The date portion on its own, as a plain YYYY-MM-DD.
//
// Worth its own helper because Graph treats all-day events specially: their
// dateTime is *always* midnight on the day of the event, whatever the
// Prefer header asked for, so unlike timed events it needs no timezone
// handling at all -- and reading the date straight off the string is what
// keeps an all-day event on the right day for accounts east of UTC, where
// converting its midnight to UTC would land on the previous day.
function toDateOnly(dateTime) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(dateTime || '');
  return match ? match[1] : null;
}

function addDays(dateOnly, days) {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Graph is inconsistent about which shape an all-day event's end comes back
// in: sometimes the last day's 23:59:59 (inclusive), sometimes midnight at
// the start of the day *after* (exclusive) -- both show up in Microsoft's
// own answers threads, for the same event shape.
//
// The display's contract is Google's: an all-day end is exclusive, and the
// client unconditionally backs it off by a day (see CalendarView.jsx's
// eventDateRange). Normalize both shapes into that, so a multi-day Outlook
// trip doesn't render one day short and a single-day one doesn't collapse
// to a zero-width range.
function exclusiveAllDayEnd(endDateTime, startDateOnly) {
  const endDate = toDateOnly(endDateTime);
  if (!endDate) return startDateOnly;
  // Already midnight on a later day, which *is* the exclusive end.
  if (/T00:00:00/.test(endDateTime)) return endDate;
  return addDays(endDate, 1);
}

// Same idea as calendarService.js's isAcceptedByUser: only show events the
// user actually agreed to. Graph's equivalent is responseStatus, which has
// more than just the four values one might expect from Outlook's own UI --
// 'none' means the event has no attendees (a personal entry) and
// 'organizer' means this copy is the one belonging to whoever created it,
// neither of which is an unanswered invitation. Both are the user's own
// events and belong on the display, so both have to be let through or every
// meeting the user scheduled with attendees would silently vanish.
// 'tentative' is treated as not-yet-yes, matching how Google treats a
// tentative RSVP.
function isAcceptedByUser(event) {
  const response = event.responseStatus?.response;
  if (!response || response === 'none' || response === 'organizer') return true;
  return response === 'accepted';
}

// Cancelled events, drafts, and events the user declined are all "shouldn't
// be on the display" -- same three-way split calendarService.js has between
// Google's status/organizer checks, expressed in Graph's vocabulary.
function upsertEvent(entries, event, context) {
  if (event.isCancelled || event.isDraft || !isAcceptedByUser(event)) delete entries[eventKey(event)];
  else entries[eventKey(event)] = normalizeEvent(event, context);
}

function normalizeEvent(event, context) {
  const allDay = Boolean(event.isAllDay);
  const start = allDay ? toDateOnly(event.start?.dateTime) : toIsoInstant(event.start?.dateTime);
  return {
    id: eventKey(event),
    title: event.subject || UNTITLED,
    start,
    end: allDay ? exclusiveAllDayEnd(event.end?.dateTime, start) : toIsoInstant(event.end?.dateTime),
    allDay,
    location: event.location?.displayName || null,
    // Who created the event, as a lowercased address for comparison. Not
    // display-facing -- this is the field getCachedMsEvents() filters on to
    // honour "hide everything from a person whose shared calendar is off".
    organizerEmail: event.organizer?.emailAddress?.address?.toLowerCase() || null,
    calendarKey: context.calendarKey,
    calendarLabel: context.calendarLabel,
    calendarColor: context.color,
    calendarOrder: context.calendarOrder,
    // Graph has no per-event color equivalent to Google's colorId, so the
    // calendar's own color is the only color there is. The legend reads
    // `color` as "an override within this calendar", so leaving it equal to
    // calendarColor is what keeps a Microsoft calendar from growing a
    // pointless stack of duplicate swatches.
    color: context.color,
  };
}

// One delta round, following @odata.nextLink until Graph hands back a
// @odata.deltaLink (or nothing, meaning the round produced no changes at
// all). `seen` collects every id that came back, for the full sync's pruning
// pass below; incremental rounds don't need it and skip the bookkeeping.
async function walkDelta(url, accessToken, entries, context, seen) {
  let deltaLink = null;
  let changed = false;
  let next = url;

  while (next) {
    const data = await graphFetch(next, accessToken, PREFER_HEADERS);
    for (const event of data.value || []) {
      // Neither identifier present means there's nothing stable to key this
      // on, and caching it under a shared placeholder would let one event
      // overwrite another. Skip it rather than guess.
      if (!event.id && !event.iCalUId) continue;
      changed = true;
      if (seen) seen.add(eventKey(event));
      if (event['@removed']) delete entries[eventKey(event)];
      else upsertEvent(entries, event, context);
    }
    next = data['@odata.nextLink'] || null;
    deltaLink = data['@odata.deltaLink'] || deltaLink;
  }

  return { deltaLink, changed };
}

// The initial round: every event in the window, from which the returned
// deltaLink becomes the handle for cheap incremental polls.
//
// calendarView/delta (rather than events/delta) is the only per-calendar
// delta in v1.0 -- events/delta is still beta-only -- and it has the side
// benefit of returning occurrences of recurring series already expanded,
// which is what Google's singleEvents:true does on the other side.
async function fullSync(accessToken, calendarId, entries, context) {
  const timeMin = new Date(Date.now() - FULL_SYNC_LOOKBACK_DAYS * 86400000).toISOString();
  const timeMax = new Date(Date.now() + FULL_SYNC_WINDOW_DAYS * 86400000).toISOString();
  const startUrl =
    `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta` +
    `?$select=${encodeURIComponent(DELTA_SELECT)}` +
    `&startDateTime=${encodeURIComponent(timeMin)}&endDateTime=${encodeURIComponent(timeMax)}`;

  const seen = new Set();
  const { deltaLink } = await walkDelta(startUrl, accessToken, entries, context, seen);

  // A delta round flags what it deleted, but a *first* round has nothing
  // cached to flag against, and an event deleted between two full syncs
  // simply never comes back. Anything already cached inside this window
  // that the fresh round didn't mention is gone and has to be pruned
  // explicitly -- same reasoning as calendarService.js's fullSync.
  const minTime = new Date(timeMin).getTime();
  const maxTime = new Date(timeMax).getTime();
  for (const [id, cached] of Object.entries(entries)) {
    const startTime = new Date(cached.start).getTime();
    if (startTime >= minTime && startTime <= maxTime && !seen.has(id)) delete entries[id];
  }

  return deltaLink;
}

async function pollOneCalendar(accessToken, calendarId, entries, context, sync) {
  let changed = false;

  try {
    if (!sync[calendarId]?.deltaLink) {
      sync[calendarId] = { deltaLink: await fullSync(accessToken, calendarId, entries, context) };
      changed = true;
    } else {
      const result = await walkDelta(sync[calendarId].deltaLink, accessToken, entries, context);
      changed = result.changed;
      sync[calendarId] = { deltaLink: result.deltaLink || sync[calendarId].deltaLink };
    }
  } catch (err) {
    // An invalidated or expired delta link comes back as 410 Gone, or 400
    // for the older tokens Graph still hands out -- same two statuses
    // todoService.js treats as "start over".
    if (err.status === 410 || err.status === 400) {
      Object.keys(entries).forEach((id) => delete entries[id]);
      sync[calendarId] = { deltaLink: await fullSync(accessToken, calendarId, entries, context) };
      changed = true;
    } else {
      throw err;
    }
  }

  return changed;
}

// Where Microsoft's calendars start in the display's legend ordering.
// calendarService.js numbers Google's from 0 in the order it polls them, so
// continuing from however many there are keeps the two providers from ever
// claiming the same position -- the legend sorts on this number alone, and
// Microsoft's section reads after Google's in the companion app.
function calendarOrderOffset() {
  let count = 0;
  for (const account of listAccounts()) count += (account.calendars || []).length;
  return count;
}

// Polls every discovered Microsoft calendar. Returns only whether anything
// changed, deliberately not the events themselves: the display's calendar
// feed is Google's and Microsoft's events merged into one list (see
// calendarService.getCachedEvents), so a Microsoft-only array would be the
// wrong thing to broadcast. Callers re-read the merged feed instead.
export async function pollMsCalendar() {
  // Nothing connected, or no calendars discovered yet (the list is filled in
  // by microsoftAuth.refreshCalendars() on connect / on demand).
  if (!(await isAuthorized())) return { changed: false };
  const calendars = listCalendars();
  if (calendars.length === 0) return { changed: false };

  // Ask for the token and take the answer, rather than pre-checking the cached
  // scopes and deciding in advance. An account connected before calendars
  // existed can't redeem a calendar-scoped refresh token, and that failure is
  // the real signal — getAccessToken records it for the companion app, which
  // reads the same answer to explain the empty list and offer a reconnect.
  // Pre-checking got this wrong for accounts that *had* consented, so the poll
  // no longer trusts an inference over the request it was going to make anyway.
  let accessToken;
  try {
    accessToken = await getAccessToken(CALENDAR_SCOPES);
  } catch (err) {
    if (err.status === 400 || err.status === 401 || err.status === 403) return { changed: false };
    throw err;
  }

  const cache = loadEvents();
  const sync = loadSync();
  let changed = false;
  let calendarOrder = calendarOrderOffset();

  for (const calendar of calendars) {
    const entries = cache[calendar.id] || {};
    cache[calendar.id] = entries;
    const context = {
      calendarKey: calendarKey(calendar.id),
      calendarLabel: calendar.name,
      color: calendar.displayColor,
      calendarOrder: calendarOrder++,
    };
    try {
      const calendarChanged = await pollOneCalendar(accessToken, calendar.id, entries, context, sync);
      changed = changed || calendarChanged;
    } catch (err) {
      console.error(`[ms-calendar] poll failed for ${calendar.name}:`, err.message);
    }
  }

  saveEvents(cache);
  saveSync(sync);
  return { changed };
}

// Forces the next pollMsCalendar() call to do a full resync of every
// calendar, so the sync window (which Graph pins to the original request's
// date range, inside the delta token) rolls forward. The poller calls this
// alongside calendarService's equivalent once a day.
export function resetSyncTokens() {
  saveSync({});
}

// Purges one calendar's cached events/sync state, for a calendar Graph no
// longer returns.
export function dropCalendarCache(calendarId) {
  const cache = loadEvents();
  const sync = loadSync();
  delete cache[calendarId];
  delete sync[calendarId];
  saveEvents(cache);
  saveSync(sync);
}

// Wipes every calendar's cached events/sync state — used when the Microsoft
// account is disconnected entirely, since there's only ever the one account.
export function dropAllCalendarsCache() {
  saveEvents({});
  saveSync({});
}

// Only events from currently-enabled calendars, and no null entries: like
// todoService's, this is a plain JSON file on an SD card with no atomic
// write guarantee, and a bad entry would otherwise reach the sort in
// getCachedEvents() (new Date(undefined) is Invalid Date, which doesn't
// throw, but the display's own date math downstream would).
//
// Untitled events are dropped here rather than at cache time on purpose. A
// delta round only returns what *changed*, so an event excluded while caching
// would never be offered again and could only be recovered by forcing a full
// resync -- filtering at read time keeps this reversible by deleting a
// condition, and is how the calendar toggles already work. The match is
// against the placeholder rather than a missing title, since every cached
// event already has the placeholder baked in by normalizeEvent().
//
// The cost is that a genuinely untitled event disappears from the wall too --
// focus-time blocks and some placeholder entries Outlook creates are empty by
// design, and there is no way to tell those apart from the ones the user
// doesn't want to see. That is the intended trade for a glanceable display.
//
// Note what this does *not* do: hide a shared contact's invites. An invite
// creates a separate copy in the user's own calendar, so it survives that
// contact's calendar being switched off and stays visible. That is
// intentional -- those are meetings the user is meant to attend, and the
// calendar toggle means "hide this calendar", not "silence this person".
// Matching on the organizer instead was tried and reverted: it removed ~425
// events, 323 of them dated in the future, because a shared contact's
// meetings are mostly the ones happening now, so it emptied the current week.
// If per-contact hiding is ever wanted it needs to be an explicit opt-in, not
// a side effect of the calendar toggle.
//
// Reading a file with a fresh listCalendars() each time is deliberate: the
// point of the exercise is that toggling a calendar takes effect immediately,
// without waiting for or triggering a new poll.
export function getCachedMsEvents() {
  const cache = loadEvents();
  const enabled = new Set(listCalendars().filter((calendar) => calendar.enabled).map((calendar) => calendar.id));
  const events = [];
  for (const [id, entries] of Object.entries(cache)) {
    if (!enabled.has(id)) continue;
    for (const event of Object.values(entries)) {
      if (event && event.title !== UNTITLED) events.push(event);
    }
  }
  return events;
}
