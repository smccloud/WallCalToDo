import {
  getAccessToken,
  graphFetch,
  isAuthorized,
  listCalendars,
  CALENDAR_SCOPES,
} from '../auth/microsoftAuth.js';
import { listAccounts } from '../auth/googleAuth.js';
import { readJson, writeJson } from '../store/fileStore.js';
import { config } from '../config.js';

const EVENTS_CACHE_FILE = 'msCalendarEventsCache.json';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
// Same window calendarService.js uses for Google, deliberately: the display
// only ever shows the current month, and both providers' events end up in
// one list, so they should cover the same stretch of dates.
const FULL_SYNC_WINDOW_DAYS = 90;
const FULL_SYNC_LOOKBACK_DAYS = 35;

// Graph pages at 100 by default, which turns a ~150-event calendar into two
// round trips for no reason. 1000 is the documented maximum for calendarView.
const GRAPH_PAGE_SIZE = 1000;

// How often a Microsoft calendar is actually re-read. Every round now pulls
// the whole window (see fetchWindow for why delta had to go), so this cannot
// ride the poller's 60s tick -- that would be ~1500 events re-read ten times
// a minute across every calendar. Ten minutes is still far more responsive
// than a wall display needs, and it is what the old once-a-day forced resync
// was effectively covering for anyway.
const MS_SYNC_INTERVAL_MS = 10 * 60 * 1000;
let lastSyncAt = 0;

// `|| {}` rather than relying on readJson's fallback, which only covers a
// missing or unparseable file -- one that parses to `null` (a torn write on
// an SD card, same hazard todoService.js guards against per-entry) would
// otherwise make Object.entries below throw on every poll and every read.
const loadEvents = () => readJson(EVENTS_CACHE_FILE, {}) || {};
const saveEvents = (cache) => writeJson(EVENTS_CACHE_FILE, cache);

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
// process would have to resolve itself. Must be sent on *every* page of a
// round, not just the first: @odata.nextLink carries the query parameters but
// not the headers.
const PREFER_HEADERS = { Prefer: 'outlook.timezone="UTC"' };

// Stand-in for an event with no subject. Shared by the normalizer and the
// read-time filter below, so the two can't drift apart and quietly stop
// matching. calendarService.js has its own copy of the same idea, which is
// deliberate -- the two providers are kept independent throughout, down to
// mirroring isAcceptedByUser -- and both have to drop these or the merged
// list would show untitled Google events while hiding untitled Microsoft
// ones, for no reason a user could see.
//
// This is a silent drop, and that is the hazard: an event only lands here if
// Graph omitted `subject`, which is also what a field-loss bug looks like. A
// $select on calendarView/delta did exactly that, and this filter turned 21
// missing events in a single week into "untitled junk" that looked deliberate.
// Anything that mangles a subject upstream will hide behind this, so treat a
// surprising count of untitled events as a sync bug until proven otherwise.
const UNTITLED = '(No title)';

// Why events went missing, tallied per round and logged once at the end.
//
// upsertEvent() *deletes* anything it won't keep, so the cache is
// write-on-accept and a rejected event leaves no trace: "the API shows fewer
// events than Outlook" is undiagnosable from the outside, because a stripped
// property set, a declined invite, a cancellation and a draft all look the
// same from the API. keptUntitled is the one that matters most -- it means we
// cached the event but lost its subject, which is a bug rather than a policy.
const dropTally = { kept: 0, keptUntitled: 0, noKey: 0, cancelled: 0, draft: 0, notAccepted: 0, pruned: 0 };

function resetDropTally() {
  for (const key of Object.keys(dropTally)) dropTally[key] = 0;
}

// One line per round, and only when something was actually dropped or came
// back without a subject. Opt-in via LOG_MS_CALENDAR_ROUNDS=1 in
// server/.env rather than on by default: the tally exists to answer "why is
// the wall missing events", and when that isn't the question a week of
// declined invites shouldn't write a line to the journal every minute. Read
// from config, which is built once at startup, so it needs a restart to take
// effect.
function logDropTally() {
  if (!config.logMsCalendarRounds) return;
  const dropped = dropTally.cancelled + dropTally.draft + dropTally.notAccepted
    + dropTally.pruned + dropTally.noKey;
  if (dropped === 0 && dropTally.keptUntitled === 0) return;
  const parts = Object.entries(dropTally)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason}=${count}`)
    .join(' ');
  console.log(`[ms-calendar] round: ${parts}`);
}

// Deliberately no $select on the calendarView request either.
//
// $select was tried here and removed, then the restricted property set came
// back anyway with $select absent -- so the stripping belongs to the endpoint,
// not to the query. Asking for a named property set is not a workaround for
// it, and the full default property set is only a few KB per event. The real
// fix was leaving calendarView/delta altogether; see fetchWindow.

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

// Same idea as calendarService.js's isAcceptedByUser: show events the user
// agreed to, plus ones they haven't answered yet. Graph's equivalent is
// responseStatus, which has more than just the four values one might expect
// from Outlook's own UI -- 'none' means the event has no attendees (a
// personal entry) and 'organizer' means this copy is the one belonging to
// whoever created it, neither of which is an unanswered invitation. Both are
// the user's own events and belong on the display, so both have to be let
// through or every meeting the user scheduled with attendees would silently
// vanish.
//
// 'tentative' and 'needsAction' both count as shown. Treating a tentative RSVP
// as a no was defensible on paper -- a wall is a commitment reminder, not an
// inbox -- but it quietly diverged from Outlook, which lists tentative invites
// greyed out rather than hiding them, so the wall looked like it had lost a
// week of meetings that were plainly on the calendar. Only an explicit
// 'declined' is a decision to not attend, and that still drops the event.
function isAcceptedByUser(event) {
  const response = event.responseStatus?.response;
  if (!response || response === 'none' || response === 'organizer') return true;
  return response === 'accepted' || response === 'tentative' || response === 'needsAction';
}

// Cancelled events, drafts, and events the user declined are all "shouldn't
// be on the display" -- same three-way split calendarService.js has between
// Google's status/organizer checks, expressed in Graph's vocabulary.
function upsertEvent(entries, event, context) {
  if (event.isCancelled) { dropTally.cancelled += 1; delete entries[eventKey(event)]; return; }
  if (event.isDraft) { dropTally.draft += 1; delete entries[eventKey(event)]; return; }
  if (!isAcceptedByUser(event)) { dropTally.notAccepted += 1; delete entries[eventKey(event)]; return; }
  const normalized = normalizeEvent(event, context);
  if (normalized.title === UNTITLED) dropTally.keptUntitled += 1;
  else dropTally.kept += 1;
  entries[eventKey(event)] = normalized;
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

// Reads a calendar's whole window in one pass, following @odata.nextLink
// until Graph runs out of pages. `seen` collects every id that came back so
// the caller can prune what has since been deleted upstream.
//
// This is calendarView, deliberately NOT calendarView/delta, and the swap was
// not cosmetic. The delta variant answers with a restricted property set: in
// one measured round 1146 of 1488 events came back with no `subject` at all,
// and the read-time untitled filter then deleted every one of them, leaving
// the wall nearly empty. It also does not reliably expand recurring series
// into instances, so entire weeks of recurring meetings were simply absent
// from the cache. The plain endpoint returns complete event objects and
// expands recurrences, which is the same thing Google's singleEvents:true
// gives us on the other side. It also has no token to expire, so the 410/400
// recovery and the daily forced resync disappear along with it.
//
// The cost is that each round re-reads the entire window rather than just
// what changed, which is why pollMsCalendar throttles itself to one round per
// MS_SYNC_INTERVAL_MS instead of running on the poller's 60s tick.
async function fetchWindow(url, accessToken, entries, context, seen) {
  let changed = false;
  let next = url;

  while (next) {
    const data = await graphFetch(next, accessToken, PREFER_HEADERS);
    for (const event of data.value || []) {
      // Neither identifier present means there's nothing stable to key this
      // on, and caching it under a shared placeholder would let one event
      // overwrite another. Skip it rather than guess.
      if (!event.id && !event.iCalUId) { dropTally.noKey += 1; continue; }
      changed = true;
      if (seen) seen.add(eventKey(event));
      upsertEvent(entries, event, context);
    }
    next = data['@odata.nextLink'] || null;
  }

  return changed;
}

// One full pass over a single calendar's window. Anything already cached
// inside the window that this round did not mention has been deleted upstream,
// so it gets pruned explicitly -- the same reasoning calendarService.js's
// fullSync uses for Google.
async function syncCalendar(accessToken, calendarId, entries, context) {
  const timeMin = new Date(Date.now() - FULL_SYNC_LOOKBACK_DAYS * 86400000).toISOString();
  const timeMax = new Date(Date.now() + FULL_SYNC_WINDOW_DAYS * 86400000).toISOString();
  const url =
    `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/calendarView` +
    `?startDateTime=${encodeURIComponent(timeMin)}&endDateTime=${encodeURIComponent(timeMax)}` +
    `&$top=${GRAPH_PAGE_SIZE}`;

  const seen = new Set();
  const changed = await fetchWindow(url, accessToken, entries, context, seen);

  const minTime = new Date(timeMin).getTime();
  const maxTime = new Date(timeMax).getTime();
  for (const [id, cached] of Object.entries(entries)) {
    const startTime = new Date(cached.start).getTime();
    if (startTime >= minTime && startTime <= maxTime && !seen.has(id)) {
      dropTally.pruned += 1;
      delete entries[id];
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
  // Throttle before spending a token or a request: a round now re-reads every
  // calendar's whole window rather than following a delta handle, and the
  // poller calls in every 60s. lastSyncAt is stamped up front so a round that
  // throws still counts, rather than retrying against Graph on every tick.
  const now = Date.now();
  if (lastSyncAt && now - lastSyncAt < MS_SYNC_INTERVAL_MS) return { changed: false };
  lastSyncAt = now;

  let accessToken;
  try {
    accessToken = await getAccessToken(CALENDAR_SCOPES);
  } catch (err) {
    if (err.status === 400 || err.status === 401 || err.status === 403) return { changed: false };
    throw err;
  }

  const cache = loadEvents();
  resetDropTally();
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
      const calendarChanged = await syncCalendar(accessToken, calendar.id, entries, context);
      changed = changed || calendarChanged;
    } catch (err) {
      console.error(`[ms-calendar] poll failed for ${calendar.name}:`, err.message);
    }
  }

  saveEvents(cache);
  logDropTally();
  return { changed };
}

// Purges one calendar's cached events, for a calendar Graph no longer returns.
export function dropCalendarCache(calendarId) {
  const cache = loadEvents();
  delete cache[calendarId];
  saveEvents(cache);
}

// Wipes every calendar's cached events -- used when the Microsoft account is
// disconnected entirely, since there's only ever the one account.
export function dropAllCalendarsCache() {
  saveEvents({});
}

// How many events from Microsoft calendars a single day is allowed to
// contribute to the display, kept in the same order the display itself sorts
// a day's events (see sortDayEvents in the frontend's utils/date.js).
//
// A work calendar carries a lot more per day than a wall has room for, and
// the overflow is invisible: DayCell measures the cell and trims to "+N
// more", so a heavy day silently becomes a month of "+N more" badges that say
// nothing about what's actually on. Capping at the wall's own capacity means
// the days that still fit say the same thing they always did, and the ones
// that don't stop pretending to.
//
// Deliberately not counted against Google's events: the two providers are
// kept independent throughout (see isAcceptedByUser), and a busy Google
// calendar is the user's own doing in a way a shared work calendar isn't.
// Google is left exactly as it was.
const MS_EVENTS_PER_DAY = 2;

// The `msOverflowCount` field: how many events the cap dropped for the day
// this event was the last one kept on. Stamped onto the kept event itself
// rather than sent alongside the list, so the display has nothing to join up
// and no way to attribute the number to the wrong day -- it reads it off the
// pill the hidden events would have come after, which is the only place the
// count means anything.
//
// Deliberately not part of the normalized shape above (see normalizeEvent):
// it isn't data about the event, it's an artifact of this read's cap, and it
// has to be recomputed on every read. Absent on every Google event, and on
// every Microsoft event whose day didn't overflow -- so the display can key
// straight off it without a provider check.
const OVERFLOW_FIELD = 'msOverflowCount';

// The display's own per-day ordering, mirrored so "the first two" means the
// first two the day cell would have rendered. All-day first, then timed by
// start time, with all-day ones by title -- same as sortDayEvents, and for
// the same reason: capping in an order the display doesn't use would drop the
// event it was going to show and keep one it was going to trim.
function compareLikeDisplay(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.allDay) return a.title.localeCompare(b.title);
  return new Date(a.start) - new Date(b.start);
}

// A local YYYY-MM-DD, for a timed event. Deliberately not toDateOnly() or the
// UTC-parsing the frontend's parseLocalDate exists to avoid: an ISO instant is
// in UTC, and reading its date straight off the string would put an evening
// event on the wrong day for anyone west of UTC. Read through local getters,
// which is also the timezone the day cell buckets it in.
function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Every local day an event covers, in order. A multi-day event counts against
// each of its days, not just the one it starts on, because a bar does occupy
// a lane in every cell it crosses -- capping by start date alone would let a
// week-long trip through alongside a full day of meetings on its last day.
//
// Walks the day keys as plain date arithmetic (addDays above), never as Date
// objects, so crossing a DST boundary -- 23-hour and 25-hour days -- can't
// skip or repeat a day the way stepping real timestamps through local
// midnights would.
function* eachEventDay(event) {
  if (event.allDay) {
    // Already YYYY-MM-DD, so no timezone handling is needed or wanted here --
    // see toDateOnly(). The end is exclusive (exclusiveAllDayEnd above), so
    // the last covered day is the one before it.
    const start = event.start;
    if (!start) return;
    const last = event.end && event.end > start ? addDays(event.end, -1) : start;
    for (let day = start; day <= last; day = addDays(day, 1)) yield day;
    return;
  }

  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return;
  const end = new Date(event.end || event.start);
  // A zero-width or backwards range (a bad end upstream) covers just its own
  // start day rather than looping forever below.
  const last = Number.isNaN(end.getTime()) || end <= start ? start : end;
  const lastKey = localDayKey(last);
  for (let day = localDayKey(start); ; day = addDays(day, 1)) {
    yield day;
    if (day >= lastKey) break;
  }
}

// Keeps at most MS_EVENTS_PER_DAY per day, in the display's own order. A Set
// rather than a flat "first N wins" pass so an event covering several days is
// kept whole wherever it survives -- trimming it to one day would split a
// trip in half, which is worse on the wall than the cap was meant to prevent.
//
// Today picks the next two still to happen rather than the day's first two.
// On a wall nobody is standing in front of, "what's next" is the only part of
// a day that carries any information -- at 3pm the 9am meeting happened
// hours ago, and spending both slots on the morning means the wall says
// nothing at all about the rest of the day. Past days and future days keep the
// first two, which is all there is to say about them.
//
// Whatever the cap drops is counted onto the last event that day kept, so the
// wall can say so rather than quietly showing a trimmed day that looks
// complete -- see OVERFLOW_FIELD above.
function limitToPerDay(events, now) {
  const byDay = new Map();
  for (const event of events) {
    for (const day of eachEventDay(event)) {
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(event);
    }
  }

  const kept = new Set();
  const overflowByEvent = new Map();
  for (const bucket of byDay.values()) {
    bucket.sort(compareLikeDisplay);
    // A day with one event left still shows that one rather than padding the
    // slot back up with something that already happened.
    const upcoming = bucket.filter((event) => isUpcoming(event, now));
    const shown = (upcoming.length ? upcoming : bucket).slice(0, MS_EVENTS_PER_DAY);
    for (const event of shown) kept.add(event);

    // On the last one shown, so "+n" reads as continuing past the item the
    // eye is already looking at rather than sitting somewhere arbitrary in
    // the day's list. A bucket is never empty, so `shown` is never empty
    // either, so there is always somewhere to put the number.
    const hidden = bucket.length - shown.length;
    if (hidden > 0) {
      const last = shown[shown.length - 1];
      // A multi-day event can be the last kept item on several of the days it
      // crosses -- whichever day has nothing sorting after it -- and each of
      // those days drops a different number. Only one of them can be the one
      // that travels, so it's the largest rather than whichever bucket
      // happened to be walked last.
      overflowByEvent.set(last, Math.max(overflowByEvent.get(last) || 0, hidden));
    }
  }

  const limited = events.filter((event) => kept.has(event));
  // Written onto the events rather than onto copies: these come from a fresh
  // JSON.parse on every read (loadEvents), and nothing on the read path ever
  // writes the cache back, so the stamps can't outlive this call.
  for (const event of limited) {
    const overflow = overflowByEvent.get(event);
    if (overflow) event[OVERFLOW_FIELD] = overflow;
  }
  return limited;
}

// Whether an event is still to come, as of `now`. Ends rather than starts, so
// a meeting in progress still counts — it's the one you might be walking to.
function isUpcoming(event, now) {
  if (event.allDay) {
    // Both sides are plain YYYY-MM-DD (exclusive end -- see
    // exclusiveAllDayEnd), so this is a string comparison against today's own
    // local key with no timezone in the way at all.
    return event.end ? localDayKey(now) < event.end : true;
  }
  const end = new Date(event.end || event.start);
  return Number.isNaN(end.getTime()) || end > now;
}

// Only events from currently-enabled calendars, and no null entries: like
// todoService's, this is a plain JSON file on an SD card with no atomic
// write guarantee, and a bad entry would otherwise reach the sort in
// getCachedEvents() (new Date(undefined) is Invalid Date, which doesn't
// throw, but the display's own date math downstream would).
//
// Untitled events are NOT dropped here, which reverses an earlier decision.
// The reasoning then was that a wall display isn't the place for a list of
// empty entries. It turned out to be the wrong call for a reason nobody could
// see from the outside: an event only lacks a subject here if Graph failed to
// send one, so the filter silently deleted every event whose fields had been
// stripped. With calendarView/delta that was 1146 of 1488 -- the wall looked
// almost empty and the cause was invisible, because a filter that drops
// untitled events makes stripped events look like deliberate tidying. A
// genuinely untitled entry now shows as "(No title)" and stays countable; the
// [ms-calendar] round: log line is what tells you if that number is climbing.
//
// Note what this does *not* do: hide a shared contact's invites. An invite
// creates a separate copy in the user's own calendar, so it survives that
// contact's calendar being switched off and stays visible. That is
// intentional -- those are meetings the user is meant to attend, and the
// calendar toggle means "hide this calendar", not "silence this person".
// Matching on the organizer instead was tried and reverted: it made no
// measurable difference, because the meetings worth hiding live in the user's
// own calendar rather than the shared one. If per-contact hiding is ever
// wanted it needs to be an explicit opt-in, not a side effect of the toggle.
//
// Reading a file with a fresh listCalendars() each time is deliberate: the
// point of the exercise is that toggling a calendar takes effect immediately,
// without waiting for or triggering a new poll.
//
// The per-day cap (MS_EVENTS_PER_DAY above) is applied here, at read time,
// for the same reason: the cache on disk stays complete, so the limit is a
// display decision rather than data loss, and changing it takes effect on the
// next poll with no resync of anything. What it drops is not dropped
// silently -- the count rides along on the last event each day kept (see
// OVERFLOW_FIELD), so the display can mark it "+n" on that pill.
//
// `now` is the server's own clock rather than something passed in, and is read
// at call time because the cap is relative to it: every read re-decides what
// "the next two" means. That also means this list can differ from the one a
// display was last sent without any provider having changed anything, which is
// why the poller re-broadcasts on a changed list rather than only on a changed
// poll (see runPoll in poller.js).
export function getCachedMsEvents() {
  const cache = loadEvents();
  const enabled = new Set(listCalendars().filter((calendar) => calendar.enabled).map((calendar) => calendar.id));
  const events = [];
  for (const [id, entries] of Object.entries(cache)) {
    if (!enabled.has(id)) continue;
    for (const event of Object.values(entries)) {
      if (event) events.push(event);
    }
  }
  return limitToPerDay(events, new Date());
}
