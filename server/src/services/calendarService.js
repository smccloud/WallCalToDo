import { google } from 'googleapis';
import { getAuthorizedClient, listAccounts } from '../auth/googleAuth.js';
import { getCachedMsEvents, getCachedMsGridEvents } from './msCalendarService.js';
import { getSettings } from './settingsService.js';
import { readJson, writeJson } from '../store/fileStore.js';

const EVENTS_CACHE_FILE = 'googleEventsCache.json';
const SYNC_FILE = 'googleSync.json';
const FULL_SYNC_WINDOW_DAYS = 90;
// How far back a full sync looks, so it also re-verifies (and can prune)
// events on days the month grid still displays as part of the current
// month — up to a full month back comfortably covers that regardless of
// where in the month "today" currently falls.
const FULL_SYNC_LOOKBACK_DAYS = 35;

const loadEvents = () => readJson(EVENTS_CACHE_FILE, {});
const saveEvents = (cache) => writeJson(EVENTS_CACHE_FILE, cache);
const loadSync = () => readJson(SYNC_FILE, {});
const saveSync = (sync) => writeJson(SYNC_FILE, sync);

const cacheKey = (accountId, calendarId) => `${accountId}::${calendarId}`;

// Stand-in for an event with no summary. Shared by the normalizer and the
// read-time filter in collectGoogleEvents() so the two can't drift apart. See
// the matching constant in msCalendarService.js for why each provider keeps
// its own copy rather than sharing one.
const UNTITLED = '(No title)';

// Google Calendar's palette (colorId -> hex) is a small, effectively static
// set shared across a whole account, not per-calendar — cheap to fetch once
// per account per poll cycle and cache in memory rather than persisting it.
const eventColorCache = new Map(); // accountId -> { [colorId]: { background } }

async function getEventColors(calendarApi, accountId) {
  if (eventColorCache.has(accountId)) return eventColorCache.get(accountId);
  const { data } = await calendarApi.colors.get();
  const colors = data.event || {};
  eventColorCache.set(accountId, colors);
  return colors;
}

// True for events that should actually show up: ones the user created, or
// invites they've accepted or not yet answered. Declining an invite you didn't
// organize (Google Calendar's "remove from this calendar" on someone
// else's event) doesn't delete the event - it just flips your own RSVP to
// "declined", so the event keeps coming back from events.list() looking
// unchanged unless this is checked. Only that explicit "declined" drops it:
// "tentative" and "needsAction" are an unanswered RSVP, not a refusal, and
// hiding them made the wall disagree with both Google Calendar and Outlook,
// which both list such invites dimmed rather than omitting them.
function isAcceptedByUser(event) {
  if (event.organizer?.self) return true;
  if (!event.attendees || event.attendees.length === 0) return true; // no invitees at all - a personal event
  const self = event.attendees.find((attendee) => attendee.self);
  return self ? self.responseStatus !== 'declined' : true;
}

// Shared by fullSync/incrementalSync: cancelled and non-accepted events are
// both treated as "shouldn't be cached", everything else gets normalized in.
function upsertEvent(entries, event, context) {
  if (event.status === 'cancelled' || !isAcceptedByUser(event)) delete entries[event.id];
  else entries[event.id] = normalizeEvent(event, context);
}

function normalizeEvent(event, context) {
  // An event can override its calendar's color (Google Calendar's "change
  // color of this event" option) via colorId — respect that when set,
  // otherwise fall back to the calendar's own color. calendarColor is
  // always the calendar's own, never-overridden color, kept alongside
  // `color` so a consumer (the wall display's calendar-color legend) can
  // tell "this calendar's own color" apart from "an event recolored
  // within it" even when the two differ.
  const overrideColor = event.colorId && context.eventColors?.[event.colorId]?.background;
  return {
    id: event.id,
    title: event.summary || UNTITLED,
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    allDay: Boolean(event.start?.date && !event.start?.dateTime),
    location: event.location || null,
    // A contacts-derived birthday — the display marks these with a cake.
    // Google's own `eventType` rather than anything in the title, which is
    // the only reliable tell: an event someone called "Birthday party" is a
    // party, the same contact's own birthday says whatever the calendar's
    // language says ("Geburtstag", "Anniversaire"), and the two are
    // otherwise indistinguishable. Set only when true, not as `false` --
    // that's nearly every event, and the cache holds a copy of each.
    ...(event.eventType === 'birthday' ? { isBirthday: true } : {}),
    calendarKey: context.calendarKey,
    calendarLabel: context.calendarLabel,
    calendarColor: context.color,
    calendarOrder: context.calendarOrder,
    color: overrideColor || context.color,
  };
}

// Full listing, seeded from FULL_SYNC_LOOKBACK_DAYS in the past out to
// FULL_SYNC_WINDOW_DAYS ahead. The final page's nextSyncToken becomes our
// handle for cheap incremental polls.
async function fullSync(calendarApi, calendarId, entries, context) {
  const timeMin = new Date(Date.now() - FULL_SYNC_LOOKBACK_DAYS * 86400000).toISOString();
  const timeMax = new Date(Date.now() + FULL_SYNC_WINDOW_DAYS * 86400000).toISOString();
  let pageToken;
  let nextSyncToken = null;
  const seenIds = new Set();

  do {
    const { data } = await calendarApi.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken,
    });
    for (const event of data.items || []) {
      seenIds.add(event.id);
      upsertEvent(entries, event, context);
    }
    pageToken = data.nextPageToken;
    nextSyncToken = data.nextSyncToken || nextSyncToken;
  } while (pageToken);

  // Unlike an incremental sync, a plain listing like this one doesn't ask
  // for (or return) cancelled events — it just silently omits them instead
  // of flagging them, so a genuine deletion can't be detected the same
  // way. Anything already cached inside this window that didn't come back
  // in this fresh listing is gone (deleted, or no longer accessible) and
  // needs pruning explicitly.
  const minTime = new Date(timeMin).getTime();
  const maxTime = new Date(timeMax).getTime();
  for (const [id, cached] of Object.entries(entries)) {
    const startTime = new Date(cached.start).getTime();
    if (startTime >= minTime && startTime <= maxTime && !seenIds.has(id)) delete entries[id];
  }

  return nextSyncToken;
}

// Incremental listing using the stored sync token — only events that
// changed since the last poll come back, which is what makes frequent
// polling cheap.
async function incrementalSync(calendarApi, calendarId, entries, context, syncToken) {
  let pageToken;
  let nextSyncToken = null;
  let changed = false;

  do {
    const { data } = await calendarApi.events.list({
      calendarId,
      syncToken,
      showDeleted: true,
      pageToken,
    });
    for (const event of data.items || []) {
      changed = true;
      upsertEvent(entries, event, context);
    }
    pageToken = data.nextPageToken;
    nextSyncToken = data.nextSyncToken || nextSyncToken;
  } while (pageToken);

  return { changed, nextSyncToken };
}

async function pollOneCalendar(calendarApi, key, calendarId, context, cache, sync) {
  const entries = cache[key] || {};
  cache[key] = entries;
  let changed = false;

  try {
    if (!sync[key]?.syncToken) {
      sync[key] = { syncToken: await fullSync(calendarApi, calendarId, entries, context) };
      changed = true;
    } else {
      const result = await incrementalSync(calendarApi, calendarId, entries, context, sync[key].syncToken);
      changed = result.changed;
      sync[key] = { syncToken: result.nextSyncToken || sync[key].syncToken };
    }
  } catch (err) {
    if (err.code === 410) {
      // Sync token expired or invalid — drop it and fall back to a full resync.
      Object.keys(entries).forEach((id) => delete entries[id]);
      sync[key] = { syncToken: await fullSync(calendarApi, calendarId, entries, context) };
      changed = true;
    } else {
      throw err;
    }
  }

  return changed;
}

export async function pollCalendar() {
  const accounts = listAccounts();
  if (accounts.length === 0) return { changed: false, events: [] };

  const cache = loadEvents();
  const sync = loadSync();
  let changed = false;
  // Position within the same account-then-calendar order listAccounts()
  // already returns (itself just however Google's calendarList.list()
  // returned them, preserved verbatim — see googleAuth.js) — carried
  // through to each event as calendarOrder so a consumer (the wall
  // display's calendar-color legend) can sort calendars the same way
  // the companion app's own calendar list already reads, instead of
  // guessing at an order (e.g. alphabetically) that doesn't match it.
  let calendarOrder = 0;

  for (const account of accounts) {
    let calendarApi;
    try {
      calendarApi = google.calendar({ version: 'v3', auth: getAuthorizedClient(account.id) });
    } catch (err) {
      console.error(`[calendar] skipping account ${account.email}:`, err.message);
      continue;
    }

    // Non-fatal: per-event color overrides are a nice-to-have, not worth
    // skipping this account's whole poll over if the palette fetch fails.
    const eventColors = await getEventColors(calendarApi, account.id).catch((err) => {
      console.error(`[calendar] failed to fetch event color palette for ${account.email}:`, err.message);
      return {};
    });

    for (const cal of account.calendars) {
      const key = cacheKey(account.id, cal.id);
      const context = {
        calendarKey: `google:calendar::${key}`,
        calendarLabel: cal.summary,
        color: cal.customColor || cal.backgroundColor,
        eventColors,
        calendarOrder: calendarOrder++,
      };
      try {
        const calChanged = await pollOneCalendar(calendarApi, key, cal.id, context, cache, sync);
        changed = changed || calChanged;
      } catch (err) {
        console.error(`[calendar] poll failed for ${account.email} / ${cal.summary}:`, err.message);
      }
    }
  }

  saveEvents(cache);
  saveSync(sync);
  return { changed, events: getCachedEvents() };
}

// Forces the next pollCalendar() call to do a full resync of every
// account/calendar. The poller uses this once a day so each sync window
// (which Google pins to the original full-sync request's time range)
// rolls forward and stale past events get pruned.
export function resetSyncTokens() {
  saveSync({});
}

// Purges cached events/sync state for calendars that no longer exist for
// an account — called when an account is disconnected.
export function dropAccountCache(accountId) {
  const prefix = `${accountId}::`;
  const cache = loadEvents();
  const sync = loadSync();
  for (const key of Object.keys(cache)) {
    if (key.startsWith(prefix)) delete cache[key];
  }
  for (const key of Object.keys(sync)) {
    if (key.startsWith(prefix)) delete sync[key];
  }
  saveEvents(cache);
  saveSync(sync);
}

// Repaints one calendar's already-cached events after its color is changed,
// so the wall updates immediately. An incremental sync only re-normalizes
// events that actually changed upstream, so without this a new color would
// sit in the account record while every cached pill kept the old one until
// that calendar happened to see an event move. Events carrying a per-event
// color override keep it; only the calendar's own color — and the fallback
// `color` where it wasn't overridden — moves. Returns whether anything was
// cached to repaint.
export function recolorCalendar(accountId, calendarId, color) {
  const key = cacheKey(accountId, calendarId);
  const cache = loadEvents();
  const entries = cache[key];
  if (!entries) return false;
  for (const event of Object.values(entries)) {
    if (!event) continue;
    const overridden = Boolean(event.color) && event.color !== event.calendarColor;
    event.calendarColor = color;
    if (!overridden) event.color = color;
  }
  saveEvents(cache);
  return true;
}

// Every event on this account's enabled Google calendars, straight out of
// the cache — the Google half of either feed below. Both feeds build their
// own copy by calling this again rather than sharing one array: the grid's
// half gets Microsoft's per-day overflow count stamped onto its events (see
// getCachedMsGridEvents), and stamping objects the agenda is about to be
// handed would put that artefact where it means nothing. The display-wide
// Google on/off (see googleEnabled in settingsService.js) skips this half
// entirely while it's off.
function collectGoogleEvents() {
  if (!getSettings().googleEnabled) return [];
  const cache = loadEvents();
  const enabledKeys = new Set();
  for (const account of listAccounts()) {
    for (const cal of account.calendars) {
      if (cal.enabled) enabledKeys.add(cacheKey(account.id, cal.id));
    }
  }

  const events = [];
  for (const key of Object.keys(cache)) {
    if (!enabledKeys.has(key)) continue;
    // The null guard isn't new here, but msCalendarService.js explains why
    // these files can end up with holes in them.
    for (const event of Object.values(cache[key])) {
      if (event) events.push(event);
    }
  }
  return events;
}

const byStart = (a, b) => new Date(a.start) - new Date(b.start);

// --- Similar-event merge ---
//
// The display-wide "combine look-alike events" on/off (see mergeSimilarEvents
// in settingsService.js). When two calendars both list the same real thing —
// the school district's "NO SCHOOL" all-day event on its calendar, the same
// day on the family Google calendar as "K-12 No School" — the wall shows a
// second, near-identical row. The merge combines those into one entry so a
// busy day stops repeating itself.

// A slot is what an event *is* regardless of which calendar carries it: for a
// timed event the exact start/end instants, for an all-day event its day(s),
// since "same day" is all the "start and end times" an all-day event has.
// Timed and all-day events can't share a slot, so a midnight-timed event and
// an all-day one never merge.
function slotKey(event) {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end || event.start);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (event.allDay) {
    const day = (ms) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };
    return `all-day:${day(start)}:${day(end)}`;
  }
  return `timed:${start}:${end}`;
}

// Titles, stripped to their words: lowercase, punctuation collapsed to a
// space. "NO SCHOOL" and "K-12 No School" both become comparable this way.
const normalizeTitle = (title) => (title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// "Similar" enough to treat as the same event: identical after stripping;
// one name is a whole span of the other ("NO SCHOOL" inside
// "K-12 No School"); or they share most of their words either way ("School
// Board Meeting" / "School Board Mtg" style drift). The word-overlap branch
// is deliberately below the containment one — containment is a much stronger
// signal and covers the common "one calendar is more specific" case outright.
function titlesSimilar(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aa = na.split(' ');
  const bb = nb.split(' ');
  const common = aa.filter((word) => bb.includes(word)).length;
  return common / new Set([...aa, ...bb]).size >= 0.6;
}

// Two events are one display entry iff they come from different calendars,
// occupy the same slot, and read the same way. Same-calendar pairs are never
// merged — a single calendar listing the same event twice is a real separate
// entry, not a duplicate of itself.
function areMergeable(a, b) {
  if (a.calendarKey && b.calendarKey && a.calendarKey === b.calendarKey) return false;
  if (!titlesSimilar(a.title, b.title)) return false;
  const sa = slotKey(a);
  return sa !== null && sa === slotKey(b);
}

// The merge itself, gated by the setting. Keeps the first event of each
// merged group (the feed is already start-sorted, so that's the one that
// would have appeared first anyway) and drops the rest. Events whose slot
// can't be parsed, or that match nothing, pass through unchanged.
export function mergeSimilarEvents(events) {
  if (!getSettings().mergeSimilarEvents) return events;
  const kept = [];
  for (const event of events) {
    if (!kept.some((other) => areMergeable(event, other))) kept.push(event);
  }
  return kept;
}

// The complete feed: both providers merged, nothing trimmed, and only
// events from currently-enabled calendars.
//
// Untitled events are NOT dropped here, which reverses an earlier decision
// that both providers used to share. The idea was that a wall shouldn't list
// empty entries, but it turned out to hide real breakage: on the Microsoft
// side a stripped property set left 1146 of 1488 events without a subject, so
// this filter deleted them and the wall looked almost empty for reasons
// nothing could see. msCalendarService.js carries the full story and the
// diagnostic that replaced it; the two sides stay in step because the display
// shows one merged list and treating the providers differently would be
// inexplicable to anyone reading the result.
//
// This is what the day agenda, the to-do panel and the legend read, so it
// deliberately carries no per-day cap — see getCachedGridEvents() for the
// month grid's trimmed view of the same cache.
//
// The display gets one flat list of events regardless of where they came
  // from, so Microsoft's are appended to Google's here rather than the two
  // being kept apart all the way to the frontends. Each side already applies
  // its own enabled-calendar filter and numbers its calendars so the two
  // can't collide (see msCalendarService.js's calendarOrderOffset), and each
  // event carries a provider-unique id and calendarKey. The similar-event
  // merge (see mergeSimilarEvents above) then collapses look-alikes across
  // calendars into one entry when its toggle is on.
export function getCachedEvents() {
  return mergeSimilarEvents([...collectGoogleEvents(), ...getCachedMsEvents()].sort(byStart));
}

// The month grid's view of the same cache: identical, except Microsoft's
// per-day cap is applied to its half (see limitToPerDay in
// msCalendarService.js). Keeping this a second feed rather than capping the
// one above is what lets the grid stay a month of readable day cells while
// the agenda lists a whole day — both were being handed the capped list
// before, so the agenda showed "the next two" meetings and nothing else.
export function getCachedGridEvents() {
  return mergeSimilarEvents([...collectGoogleEvents(), ...getCachedMsGridEvents()].sort(byStart));
}
