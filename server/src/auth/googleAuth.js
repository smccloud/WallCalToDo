import { google } from 'googleapis';
import { config } from '../config.js';
import { readJson, writeJson } from '../store/fileStore.js';
import { getCredentials } from '../services/credentialsService.js';

const ACCOUNTS_FILE = 'googleAccounts.json';
// calendar.readonly to read events, userinfo.email so we can label each
// connected account and dedupe reconnects by email instead of creating
// duplicate entries.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const loadAccounts = () => readJson(ACCOUNTS_FILE, {});
const saveAccounts = (accounts) => writeJson(ACCOUNTS_FILE, accounts);

function slugify(email) {
  return email.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function createClient() {
  const { clientId, clientSecret } = getCredentials('google');
  return new google.auth.OAuth2(clientId, clientSecret, config.google.redirectUri);
}

export function isConfigured() {
  const { clientId, clientSecret } = getCredentials('google');
  return Boolean(clientId && clientSecret);
}

export function getAuthUrl() {
  if (!isConfigured()) {
    throw new Error('Google OAuth is not configured — enter a Client ID/Secret in the companion app’s Google Calendar section.');
  }
  return createClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

// List of { id, email, calendars: [{ id, summary, backgroundColor, enabled }] }.
// Tokens are intentionally omitted — this is what the companion app reads.
export function listAccounts() {
  return Object.values(loadAccounts()).map(({ id, email, calendars }) => ({ id, email, calendars }));
}

export function isAuthorized() {
  return Object.keys(loadAccounts()).length > 0;
}

// The one calendar Google keeps out of calendarList.list(): an account's own
// Birthdays calendar, the read-only one built from its Google Contacts. It is
// plainly visible in the Google Calendar UI — ticked on, birthdays and all —
// and the API's own calendar listing never returns it, so a list built from
// that call alone can never see it, and its events are never polled. The id is
// fixed and locale-independent (unlike the holiday calendars' "en.usa#holiday@…"
// form), which is what makes asking for it by name possible at all.
//
// An array rather than a lone constant because the next calendar Google hides
// will want the same handling, and because a bare id sitting in the code with
// nothing around it reads like a typo.
const WELL_KNOWN_CALENDARS = [{ id: 'contacts#group.v.calendar.google.com', summary: 'Birthdays' }];

// One calendarList entry -> the { id, summary, backgroundColor, enabled } shape
// stored per account, carrying over whatever enabled state the companion app
// already set for it (a newly-seen calendar defaults to on).
function toStoredCalendar(item, existingById) {
  const existing = existingById.get(item.id);
  return {
    id: item.id,
    summary: item.summaryOverride || item.summary || item.id,
    // Keeps a color a previous refresh already fetched when this one has none
    // to give, which is the well-known-calendar probe path below (it has no
    // metadata to offer at all). Losing it would drop that calendar's pills
    // and legend circle back to the generic accent.
    backgroundColor: item.backgroundColor || existing?.backgroundColor || null,
    enabled: existing?.enabled ?? true,
  };
}

// Metadata for a well-known calendar, or null if this account doesn't have it
// switched on in Google Calendar.
//
// calendarList.get() is the direct route to the same entry calendarList.list()
// left out, and normally works. But "normally" is doing real work in that
// sentence: a calendar the listing doesn't return isn't guaranteed to be
// individually gettable either, and a 404 here would otherwise silently drop
// the birthdays off the wall again — which is the exact bug this exists to fix,
// and one that would look like nothing at all happening. So when get() comes
// back empty-handed, fall back to asking the only question that actually
// matters — can events be read from this id at all — with the smallest possible
// events.list call. A 200 means the calendar is real and readable even though
// its metadata was unreachable, so it's added with the name above and no color
// of its own, which the display already falls back to its accent for.
async function fetchWellKnownCalendar(calendarApi, wellKnown) {
  try {
    const { data } = await calendarApi.calendarList.get({ calendarId: wellKnown.id });
    return data;
  } catch (err) {
    if (err.code !== 404 && err.code !== 403) {
      console.error(`[google] could not fetch calendar ${wellKnown.id}:`, err.message);
    }
  }

  try {
    await calendarApi.events.list({
      calendarId: wellKnown.id,
      timeMin: new Date().toISOString(),
      maxResults: 1,
    });
    return { id: wellKnown.id, summary: wellKnown.summary, backgroundColor: null };
  } catch {
    return null; // genuinely not there for this account — not an error worth logging
  }
}

// Re-fetches this account's calendar list from Google and merges it with
// whatever enabled/disabled state the companion app already set — newly
// discovered calendars default to enabled, removed ones are dropped.
export async function refreshCalendarList(accountId) {
  const accounts = loadAccounts();
  const account = accounts[accountId];
  if (!account) throw new Error(`Unknown Google account: ${accountId}`);

  const client = createClient();
  client.setCredentials(account.tokens);
  const calendarApi = google.calendar({ version: 'v3', auth: client });
  const { data } = await calendarApi.calendarList.list();

  const existingById = new Map((account.calendars || []).map((cal) => [cal.id, cal]));
  const calendars = (data.items || []).map((item) => toStoredCalendar(item, existingById));

  for (const wellKnown of WELL_KNOWN_CALENDARS) {
    // Already in the listing after all — nothing to add, and re-adding it
    // would duplicate the entry (and the legend circle that comes with it).
    if (calendars.some((cal) => cal.id === wellKnown.id)) continue;
    const entry = await fetchWellKnownCalendar(calendarApi, wellKnown);
    if (entry) calendars.push(toStoredCalendar(entry, existingById));
  }

  account.calendars = calendars;

  saveAccounts(accounts);
  return account.calendars;
}

// Exchanges an OAuth code for tokens, identifies which Google account they
// belong to, and stores/updates that account's record. Reconnecting an
// already-known email updates its tokens in place rather than duplicating it.
export async function exchangeCode(code) {
  const client = createClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data: profile } = await oauth2.userinfo.get();
  const accountId = slugify(profile.email);

  const accounts = loadAccounts();
  accounts[accountId] = {
    id: accountId,
    email: profile.email,
    tokens,
    calendars: accounts[accountId]?.calendars || [],
  };
  saveAccounts(accounts);

  await refreshCalendarList(accountId);
  return accountId;
}

export function removeAccount(accountId) {
  const accounts = loadAccounts();
  delete accounts[accountId];
  saveAccounts(accounts);
}

export function setCalendarEnabled(accountId, calendarId, enabled) {
  const accounts = loadAccounts();
  const account = accounts[accountId];
  if (!account) throw new Error(`Unknown Google account: ${accountId}`);

  const calendar = account.calendars.find((cal) => cal.id === calendarId);
  if (!calendar) throw new Error(`Unknown calendar ${calendarId} for account ${accountId}`);

  calendar.enabled = enabled;
  saveAccounts(accounts);
}

// Returns an OAuth2 client hydrated with one account's saved tokens.
// googleapis refreshes the access token automatically using the refresh
// token when it expires; we just persist whatever it hands back so future
// requests (and restarts) keep working.
export function getAuthorizedClient(accountId) {
  const accounts = loadAccounts();
  const account = accounts[accountId];
  if (!account) throw new Error(`Unknown Google account: ${accountId}`);

  const client = createClient();
  client.setCredentials(account.tokens);
  client.on('tokens', (refreshed) => {
    const latest = loadAccounts();
    if (!latest[accountId]) return; // account was removed mid-request
    latest[accountId].tokens = { ...latest[accountId].tokens, ...refreshed };
    saveAccounts(latest);
  });
  return client;
}
