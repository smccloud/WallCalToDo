import fs from 'fs';
import { ConfidentialClientApplication, InteractionRequiredAuthError } from '@azure/msal-node';
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
// Kept as two separate scope sets, not one merged array, because
// getAccessToken() below is what todoService.js already depends on for
// every existing connected account -- those accounts only ever consented
// to TASK_SCOPES. If TASK_SCOPES grew a Calendars.Read entry, MSAL's
// silent token acquisition would start failing for the *combined* set the
// moment this ships (acquireTokenSilent can't silently obtain consent for
// a scope that wasn't already granted), breaking To Do polling for every
// already-connected account until they happened to reconnect -- not just
// leaving Calendar unavailable, which is the failure mode we actually
// want. CONNECT_SCOPES is the only place the two are requested together,
// so a fresh connect or a deliberate reconnect grants both at once.
const TASK_SCOPES = ['Tasks.Read', 'offline_access'];
const CALENDAR_SCOPES = ['Calendars.Read', 'offline_access'];
const CONNECT_SCOPES = ['Tasks.Read', 'Calendars.Read', 'offline_access'];

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
    throw new Error('Microsoft OAuth is not configured — enter a Client ID/Secret in the companion app’s Microsoft To Do section.');
  }
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId,
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

// Always requests every scope this app knows about, not just whatever the
// person happens to have used before -- so a fresh connect and a
// reconnect-to-grant-calendar-access both go through this same URL rather
// than needing a second "connect flow" just for Calendar.
export function getAuthUrl() {
  return getClient().getAuthCodeUrl({ scopes: CONNECT_SCOPES, redirectUri: config.ms.redirectUri });
}

export async function exchangeCode(code) {
  const result = await getClient().acquireTokenByCode({ code, scopes: CONNECT_SCOPES, redirectUri: config.ms.redirectUri });
  // Populate the list of To Do lists and calendars immediately so the
  // companion app has something to show right after connecting, without a
  // separate step. Calendar access is non-fatal to the connect flow the
  // same way Google's refreshTaskList() is in googleAuth.js -- a hiccup
  // fetching calendars shouldn't block the (already-working) To Do side.
  await refreshTodoLists();
  try {
    await refreshCalendars();
  } catch (err) {
    console.error('[microsoftAuth] failed to fetch calendars after connect:', err.message);
  }
  return result;
}

export async function isAuthorized() {
  if (!isConfigured()) return false;
  const accounts = await getClient().getTokenCache().getAllAccounts();
  return accounts.length > 0;
}

function isReauthRequired(err) {
  return (
    err instanceof InteractionRequiredAuthError ||
    err?.name === 'InteractionRequiredAuthError' ||
    err?.errorCode === 'interaction_required'
  );
}

// { email, calendarScopeGranted } for the companion app to display, or
// null if nothing's connected yet — mirrors how each Google account shows
// its email and tasksScopeGranted. Unlike Google (where the granted scope
// list is just read straight off the stored token), MSAL doesn't expose
// "which scopes did this account actually consent to" as a plain field --
// the only reliable way to know is to attempt a silent acquisition for
// CALENDAR_SCOPES and see whether it succeeds. That's a real (if
// cache-cheap) check, not a free property read, but it's the accurate
// answer rather than an inferred one.
export async function getConnectedAccount() {
  if (!isConfigured()) return null;
  const client = getClient();
  const accounts = await client.getTokenCache().getAllAccounts();
  if (!accounts[0]) return null;

  let calendarScopeGranted = true;
  try {
    await client.acquireTokenSilent({ account: accounts[0], scopes: CALENDAR_SCOPES });
  } catch (err) {
    if (isReauthRequired(err)) calendarScopeGranted = false;
    else throw err;
  }

  return { email: accounts[0].username, calendarScopeGranted };
}

// Removes the account from MSAL's persisted token cache and clears the
// list of To Do lists and calendars — the actual cached tasks/events/sync
// state is cleared separately by todoService.dropAllListsCache() and
// microsoftCalendarService.dropAllCalendarsCache(), same split as
// Google's removeAccount()/dropAccountCache() pair.
export async function disconnectAccount() {
  if (!isConfigured()) return;
  const client = getClient();
  const accounts = await client.getTokenCache().getAllAccounts();
  for (const account of accounts) {
    await client.getTokenCache().removeAccount(account);
  }
  writeJson(LISTS_FILE, []);
  writeJson(CALENDARS_FILE, []);
}

// MSAL persists the refresh token in its cache (via cachePlugin above) and
// silently uses it to mint a new access token here whenever the old one
// has expired — no manual refresh-token bookkeeping needed. Scoped to
// TASK_SCOPES specifically (see the comment on TASK_SCOPES above) so this
// keeps working for every already-connected account regardless of
// whether they've granted Calendar access yet.
export async function getAccessToken() {
  const client = getClient();
  const accounts = await client.getTokenCache().getAllAccounts();
  if (!accounts.length) {
    throw new Error('Microsoft account not connected. Visit /auth/microsoft to connect.');
  }
  const result = await client.acquireTokenSilent({ account: accounts[0], scopes: TASK_SCOPES });
  return result.accessToken;
}

// Mirrors getAccessToken() exactly, scoped to CALENDAR_SCOPES instead.
// Throws the underlying MSAL error (including InteractionRequiredAuthError
// when the account hasn't granted Calendar access yet) rather than
// swallowing it -- callers that want a clean "needs reconnect" signal
// instead of a thrown error should check getConnectedAccount().
// calendarScopeGranted first.
export async function getCalendarAccessToken() {
  const client = getClient();
  const accounts = await client.getTokenCache().getAllAccounts();
  if (!accounts.length) {
    throw new Error('Microsoft account not connected. Visit /auth/microsoft to connect.');
  }
  const result = await client.acquireTokenSilent({ account: accounts[0], scopes: CALENDAR_SCOPES });
  return result.accessToken;
}

// Thin wrapper shared with todoService.js and microsoftCalendarService.js
// so all three hit the Graph API the same way instead of each keeping
// their own copy.
export async function graphFetch(url, accessToken) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
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
  const accessToken = await getAccessToken();
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

// [{ id, displayName, color, hexColor, enabled }] — mirrors listTodoLists()
// exactly, one level over for calendars. `color` is Graph's enum value
// (e.g. "lightBlue", "auto"); `hexColor` is the calendar's actual hex
// color when the user has explicitly set one -- Graph leaves it an empty
// string otherwise (most notably for "auto" calendars, which is the
// common default), so a consumer needs a fallback for the enum-only case.
// See microsoftCalendarService.js's color resolution for that fallback.
export function listCalendars() {
  return readJson(CALENDARS_FILE, []);
}

// Re-fetches the account's calendars from Graph and merges them with
// whatever enabled/disabled state the companion app already set — newly
// discovered calendars default to enabled, removed ones are dropped.
// Mirrors refreshTodoLists() exactly.
export async function refreshCalendars() {
  const accessToken = await getCalendarAccessToken();
  const data = await graphFetch(`${GRAPH_BASE}/me/calendars`, accessToken);

  const existing = new Map(listCalendars().map((cal) => [cal.id, cal]));
  const calendars = (data.value || []).map((item) => ({
    id: item.id,
    displayName: item.name || item.id,
    color: item.color || 'auto',
    hexColor: item.hexColor || null,
    enabled: existing.get(item.id)?.enabled ?? true,
  }));
  writeJson(CALENDARS_FILE, calendars);
  return calendars;
}

export function setCalendarEnabled(calendarId, enabled) {
  const calendars = listCalendars();
  const calendar = calendars.find((c) => c.id === calendarId);
  if (!calendar) throw new Error(`Unknown calendar: ${calendarId}`);
  calendar.enabled = enabled;
  writeJson(CALENDARS_FILE, calendars);
}
