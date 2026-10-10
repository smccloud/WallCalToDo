import fs from 'fs';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { config } from '../config.js';
import { dataFilePath, readJson, writeJson } from '../store/fileStore.js';
import { getCredentials } from '../services/credentialsService.js';

const CACHE_FILE = dataFilePath('msalCache.json');
const LISTS_FILE = 'msLists.json';
const CALENDARS_FILE = 'msCalendars.json';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
// offline_access is required explicitly (MSAL does not add it implicitly)
// to get back a refresh token we can use for silent renewal.
//
// Kept split per-resource rather than as one flat list because they're
// requested separately per call (see getAccessToken): a token minted before
// Calendars.Read existed only covers Tasks.Read, and asking MSAL for the
// union on a to-do call would fail that renewal for everyone who connected
// before calendars existed. Requesting only what the caller needs keeps
// To Do polling working on an older token, with the calendar side the only
// thing that reports the missing scope (and asks to be reconnected).
const TODO_SCOPES = ['Tasks.Read', 'offline_access'];
const CALENDAR_SCOPES = ['Calendars.Read', 'offline_access'];
const SCOPES = [...TODO_SCOPES, ...CALENDAR_SCOPES];
const CALENDAR_SCOPE = 'Calendars.Read';

// AAD's answer to "this token was never consented to that scope". MSAL
// surfaces the redemption failure rather than the raw HTTP body, so match on
// either its own error code or the description it carries through.
function isMissingConsentError(err) {
  const text = `${err?.errorCode || ''} ${err?.error || ''} ${err?.errorMessage || ''} ${err?.message || ''}`;
  return /invalid_grant|AADSTS65001|consent required/i.test(text);
}

// Whether the connected account's token actually carries Calendars.Read.
// Read from MSAL's own view of the granted scopes rather than inferred from
// a failed request, so the companion app can show the "reconnect to grant
// calendar access" prompt on load instead of after a failed poll.
// Whether calendar-scoped API access actually works, determined by asking for
// a calendar-scoped token rather than by reading the cache and inferring.
//
// Inference was tried twice and was wrong both times, in ways that kept
// reporting "missing" for accounts that had genuinely consented. MSAL's
// `account.target` is rewritten to the scopes of the most recent
// acquireTokenSilent call, and this app requests Tasks.Read alone on every
// to-do poll, so a consented account looks un-consented within a minute. The
// ID token's `scp` claim is more stable, but is only present for tokens that
// carry one and says nothing about whether a *silent* redemption of the scope
// will now be allowed — which is the thing that actually matters, and the
// thing that changes when an admin grants consent tenant-wide.
//
// A silent token request is the only thing here that can't be wrong: it is
// the same call the calendar poll goes on to make, so the answer is the poll's
// answer. It's silent and cheap — MSAL serves it from the refresh token with
// no browser interaction — and it self-heals the moment a reconnect happens or
// admin consent is granted, with nothing to invalidate by hand.
//
// Returns 'granted', 'missing' (connected, but the scope needs consent the
// account never gave), or 'not_connected'.
export async function getCalendarAccess() {
  if (!isConfigured()) return 'not_connected';
  const accounts = await getClient().getTokenCache().getAllAccounts();
  if (!accounts.length) return 'not_connected';
  try {
    await getAccessToken(CALENDAR_SCOPES);
    return 'granted';
  } catch (err) {
    if (isMissingConsentError(err)) return 'missing';
    // Anything else (network blip, Entra outage) is not evidence about
    // consent, so report what we know rather than accusing the account.
    throw err;
  }
}

// Set when a calendar-scoped token request comes back needing consent the
// account never gave, cleared as soon as one succeeds (including right after
// a reconnect). Read by the accounts route so the companion app can explain
// itself rather than showing an empty calendar list with no reason.
let calendarScopeMissing = false;

export function isCalendarScopeMissing() {
  return calendarScopeMissing;
}

const cachePlugin = {
  beforeCacheAccess: async (cacheContext) => {
    if (fs.existsSync(CACHE_FILE)) {
      cacheContext.tokenCache.deserialize(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  },
  afterCacheAccess: async (cacheContext) => {
    if (cacheContext.cacheHasChanged) {
      fs.writeFileSync(CACHE_FILE, cacheContext.tokenCache.serialize());
    }
  },
};

// Built lazily rather than at import time: MSAL's constructor throws
// immediately if the client secret is empty, which would otherwise crash
// the whole server on startup before Microsoft credentials are configured
// (e.g. while still setting up Google, or before either is set up).
let msalClient = null;

function getClient() {
  const { clientId, clientSecret, tenantId } = getCredentials('ms');
  if (!clientId || !clientSecret) {
    throw new Error('Microsoft OAuth is not configured — enter a Client ID/Secret in the companion app’s Microsoft section.');
  }
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId,
        // getCredentials always resolves this, so there's no need to
        // re-default here — the tenant is optional at the config/UI layer
        // and arrives already set to 'common' when unspecified.
        authority: `https://login.microsoftonline.com/${tenantId}`,
        clientSecret,
      },
      cache: { cachePlugin },
    });
  }
  return msalClient;
}

// The MSAL client above is built once and cached (its constructor needs a
// real clientId/clientSecret up front) -- call this after saving new
// credentials through the companion app so the next request rebuilds it
// with them, instead of keeping whatever it was (or wasn't) built with at
// server startup.
export function resetClient() {
  msalClient = null;
}

export function isConfigured() {
  const { clientId, clientSecret } = getCredentials('ms');
  return Boolean(clientId && clientSecret);
}

export function getAuthUrl() {
  return getClient().getAuthCodeUrl({ scopes: SCOPES, redirectUri: config.ms.redirectUri });
}

export async function exchangeCode(code) {
  const result = await getClient().acquireTokenByCode({ code, scopes: SCOPES, redirectUri: config.ms.redirectUri });
  // Populate the list of To Do lists immediately so the companion app has
  // something to show right after connecting, without a separate step.
  await refreshTodoLists();
  // Same for calendars, but deliberately not fatal: the sign-in above only
  // succeeds if the app registration has Calendars.Read in it, and if it
  // doesn't, a failure here would throw away an otherwise perfectly good
  // To Do connection. refreshCalendars() records the reason on its own (see
  // calendarScopeMissing) for the companion app to show.
  try {
    await refreshCalendars();
  } catch (err) {
    if (!isMissingConsentError(err)) {
      console.error('[microsoft] calendar refresh after connect failed:', err.message);
    }
  }
  return result;
}

export async function isAuthorized() {
  if (!isConfigured()) return false;
  const accounts = await getClient().getTokenCache().getAllAccounts();
  return accounts.length > 0;
}

// { email } for the companion app to display, or null if nothing's
// connected yet — mirrors how each Google account shows its email.
export async function getConnectedAccount() {
  if (!isConfigured()) return null;
  const accounts = await getClient().getTokenCache().getAllAccounts();
  return accounts[0] ? { email: accounts[0].username } : null;
}

// Removes the account from MSAL's persisted token cache and clears the
// list of To Do lists and calendars — the actual cached tasks/events/sync
// state is cleared separately by todoService.dropAllListsCache() and
// msCalendarService.dropAllCalendarsCache(), same split as Google's
// removeAccount()/dropAccountCache() pair.
export async function disconnectAccount() {
  if (!isConfigured()) return;
  const client = getClient();
  const accounts = await client.getTokenCache().getAllAccounts();
  for (const account of accounts) {
    await client.getTokenCache().removeAccount(account);
  }
  writeJson(LISTS_FILE, []);
  writeJson(CALENDARS_FILE, []);
  calendarScopeMissing = false;
}

// MSAL persists the refresh token in its cache (via cachePlugin above) and
// silently uses it to mint a new access token here whenever the old one
// has expired — no manual refresh-token bookkeeping needed.
//
// `scopes` defaults to the full set, but callers should pass just what they
// need (TODO_SCOPES / CALENDAR_SCOPES) — see the note on those constants.
// A calendar-scoped request against a token minted before Calendars.Read
// existed fails its refresh-token redemption with a "consent required"
// error; that's recorded on the module rather than thrown as-is so the
// to-do side of the app keeps working while the companion app explains
// why the calendar list is empty.
export async function getAccessToken(scopes = SCOPES) {
  const client = getClient();
  const accounts = await client.getTokenCache().getAllAccounts();
  if (!accounts.length) {
    throw new Error('Microsoft account not connected. Visit /auth/microsoft to connect.');
  }
  try {
    const result = await client.acquireTokenSilent({ account: accounts[0], scopes });
    // Only a *calendar*-scoped success clears the flag — a to-do call
    // renewing fine says nothing about whether Calendars.Read was granted.
    if (scopes.includes(CALENDAR_SCOPE)) calendarScopeMissing = false;
    return result.accessToken;
  } catch (err) {
    if (scopes.includes(CALENDAR_SCOPE) && isMissingConsentError(err)) {
      calendarScopeMissing = true;
      // Tagged so callers can tell "the account never consented to this" from
      // an unrelated failure without matching on the message text. The status
      // is the same one a real Graph 403 would carry, so the calendar poll's
      // existing "this is a permissions problem, skip quietly" handling
      // treats both the same way.
      const error = new Error(
        `The connected Microsoft account has not granted ${CALENDAR_SCOPE}. Reconnect it to grant calendar access.`
      );
      error.status = 403;
      error.scopeMissing = true;
      throw error;
    }
    throw err;
  }
}

// Thin wrapper shared with todoService.js and msCalendarService.js so all
// three hit the Graph API the same way instead of each keeping their own
// copy. `headers` is for the per-request extras Graph needs on some calls
// (msCalendarService.js's `Prefer: outlook.timezone`), which have to be sent
// on every request in a delta round -- the returned deltaLink encodes the
// query parameters but not the headers.
export async function graphFetch(url, accessToken, headers = {}) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, ...headers } });
  if (!res.ok) {
    const error = new Error(`Graph API error ${res.status}: ${await res.text()}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// [{ id, displayName, enabled }] — what the companion app reads and what
// todoService.js polls. Mirrors googleAuth's listAccounts()/calendars
// shape: multiple lists can be enabled at once (e.g. your personal list
// plus one shared with your wife), not just a single hardcoded default.
export function listTodoLists() {
  return readJson(LISTS_FILE, []);
}

// Re-fetches the account's To Do lists from Graph and merges them with
// whatever enabled/disabled state the companion app already set — newly
// discovered lists default to enabled, removed ones are dropped.
export async function refreshTodoLists() {
  const accessToken = await getAccessToken(TODO_SCOPES);
  const data = await graphFetch(`${GRAPH_BASE}/me/todo/lists`, accessToken);

  const existing = new Map(listTodoLists().map((list) => [list.id, list]));
  const lists = (data.value || []).map((item) => ({
    id: item.id,
    displayName: item.displayName || item.id,
    enabled: existing.get(item.id)?.enabled ?? true,
  }));
  writeJson(LISTS_FILE, lists);
  return lists;
}

export function setTodoListEnabled(listId, enabled) {
  const lists = listTodoLists();
  const list = lists.find((l) => l.id === listId);
  if (!list) throw new Error(`Unknown To Do list: ${listId}`);
  list.enabled = enabled;
  writeJson(LISTS_FILE, lists);
}

// Exported so the two services can ask for exactly the scopes they need
// rather than the union, which would fail renewal on a token minted before
// Calendars.Read was requested. See the note on TODO_SCOPES above.
export { TODO_SCOPES, CALENDAR_SCOPES };

// Microsoft's own eleven calendar color themes, as hex.
//
// Graph's calendar resource has no Google-style free-form backgroundColor:
// `color` is one of these fixed names, and the read-only `hexColor` is only
// populated once someone has explicitly picks a color in Outlook, which
// almost nobody does. Mapped to Outlook's own palette so a calendar looks
// the same here as it does there. 'auto' is Outlook's "let Outlook decide",
// which it renders as its default blue — given a distinct purple instead so
// it doesn't land on the same color as maxColor/lightBlue in the common
// one-default-calendar case.
const GRAPH_CALENDAR_COLORS = {
  auto: '#5c2d91',
  lightblue: '#0078d4',
  lightgreen: '#107c10',
  lightorange: '#d83b01',
  lightgray: '#7a7a7a',
  lightyellow: '#c19c00',
  lightteal: '#038387',
  lightpink: '#e3008c',
  lightbrown: '#8e562e',
  lightred: '#e81123',
  maxcolor: '#0f6cbd',
};

function calendarDisplayColor(calendar) {
  if (calendar.customColor) return calendar.customColor;
  if (calendar.hexColor) return calendar.hexColor;
  return GRAPH_CALENDAR_COLORS[String(calendar.color).toLowerCase()] || GRAPH_CALENDAR_COLORS.auto;
}

// [{ id, name, color, hexColor, isDefaultCalendar, ownerEmail, enabled,
// customColor, displayColor }] — the same shape googleAuth keeps per calendar
// (an id, a display name, a color, and the companion app's enabled flag),
// with Graph's field names kept as they arrive rather than renamed to
// Google's.
//
// `customColor` is the user's own choice from the companion app, if any;
// `displayColor` is the color resolved to the hex the display will actually
// use, which prefers `customColor` and otherwise derives from Graph. The
// stored record keeps Graph's own `color`/`hexColor` as they arrived, so the
// derived color is computed here on read rather than baked in at fetch time —
// changing the palette re-colors every already-connected calendar on the
// next poll, with nobody having to re-add them in the companion app. One
// place decides what a Microsoft calendar's color is, so the event pills,
// the kiosk's legend, and the companion app's swatch can't drift apart.
// The records exactly as stored, without displayColor folded in. Everything
// that *reads* calendars goes through listCalendars() above; anything that
// *writes* them uses this, so the derived color stays derived and never
// accumulates into the stored records.
function storedCalendars() {
  // readJson only falls back when the file is missing or unparseable, not
  // when it parses to something other than a list -- so a half-written file
  // from a torn SD-card write reads back as `null` and would otherwise crash
  // every caller, including the display's own calendar feed. Treated as "no
  // calendars discovered yet" instead, which the next refreshCalendars()
  // repairs from Graph.
  const stored = readJson(CALENDARS_FILE, []);
  return Array.isArray(stored) ? stored : [];
}

export function listCalendars() {
  return storedCalendars().map((calendar) => ({ ...calendar, displayColor: calendarDisplayColor(calendar) }));
}

// Re-fetches the account's calendars from Graph and merges them with
// whatever enabled/disabled state the companion app already set — newly
// discovered calendars default to enabled, removed ones are dropped.
export async function refreshCalendars() {
  const accessToken = await getAccessToken(CALENDAR_SCOPES);
  const data = await graphFetch(`${GRAPH_BASE}/me/calendars`, accessToken);

  const existing = new Map(storedCalendars().map((cal) => [cal.id, cal]));
  const calendars = (data.value || []).map((item) => {
    const previous = existing.get(item.id);
    return {
      id: item.id,
      name: item.name || item.id,
      color: item.color || 'auto',
      hexColor: item.hexColor || null,
      isDefaultCalendar: Boolean(item.isDefaultCalendar),
      // Whose calendar this is, lowercased so it can be compared without
      // worrying about address casing. Nothing reads it right now: it was
      // added for organizer-based hiding, which was reverted because it hid
      // too much (see getCachedMsEvents). Kept because it's the one field that
      // distinguishes a calendar the user owns from one shared with them, so
      // anything wanting that distinction later has it available rather than
      // needing another calendar-list round trip.
      ownerEmail: item.owner?.emailAddress?.address?.toLowerCase() || null,
      enabled: previous?.enabled ?? true,
      // The user's own color, if they've chosen one, carried across the
      // refresh Graph just triggered so it isn't lost the way a field derived
      // only from Graph's response would be.
      ...(previous?.customColor ? { customColor: previous.customColor } : {}),
    };
  });
  writeJson(CALENDARS_FILE, calendars);
  return listCalendars();
}

export function setCalendarEnabled(calendarId, enabled) {
  const calendars = storedCalendars();
  const calendar = calendars.find((cal) => cal.id === calendarId);
  if (!calendar) throw new Error(`Unknown Microsoft calendar: ${calendarId}`);
  calendar.enabled = enabled;
  writeJson(CALENDARS_FILE, calendars);
}

// Stores (or clears) the user's own color for a calendar, overriding the one
// derived from Graph's theme name. Passing an empty value drops the override,
// falling back to the derived color. Returns the color the calendar should
// now display, so the caller can repaint cached events without re-reading.
export function setCalendarColor(calendarId, color) {
  const calendars = storedCalendars();
  const calendar = calendars.find((cal) => cal.id === calendarId);
  if (!calendar) throw new Error(`Unknown Microsoft calendar: ${calendarId}`);
  if (color) calendar.customColor = color;
  else delete calendar.customColor;
  writeJson(CALENDARS_FILE, calendars);
  return calendarDisplayColor(calendar);
}
