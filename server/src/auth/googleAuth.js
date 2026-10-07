import { google } from 'googleapis';
import { config } from '../config.js';
import { readJson, writeJson } from '../store/fileStore.js';
import {
  getCredentials,
  getGoogleDefaultSetId,
  getGoogleSetLabel,
} from '../services/credentialsService.js';

const ACCOUNTS_FILE = 'googleAccounts.json';
// calendar.readonly to read events, userinfo.email so we can label each
// connected account and dedupe reconnects by email instead of creating
// duplicate entries.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

// Since multiple credential sets arrived, each connected account is pinned
// to the set its tokens were minted under (see getAuthUrl's state
// round-trip). Accounts connected before that exist have no pin; fill it in
// once, on the first load after upgrade, with whichever set was in effect at
// the time, so a set being added or removed later can't silently rebind
// their tokens to a client they were never minted under. Idempotent: only
// fills the missing field, so this runs on every read but writes at most
// once per account (and only when a migration actually happened).
const loadAccounts = () => {
  const accounts = readJson(ACCOUNTS_FILE, {});
  let changed = false;
  for (const account of Object.values(accounts)) {
    if (account.credentialSetId === undefined) {
      account.credentialSetId = getGoogleDefaultSetId();
      changed = true;
    }
  }
  if (changed) saveAccounts(accounts);
  return accounts;
};
const saveAccounts = (accounts) => writeJson(ACCOUNTS_FILE, accounts);

function slugify(email) {
  return email.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function createClient(setId) {
  const { clientId, clientSecret } = getCredentials('google', setId);
  return new google.auth.OAuth2(clientId, clientSecret, config.google.redirectUri);
}

export function isConfigured(setId) {
  try {
    createClient(setId);
    return true;
  } catch {
    return false;
  }
}

export function getAuthUrl(setId) {
  return createClient(setId).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    // Round-trips the chosen credential set through Google's consent screen
    // back to the callback, where it decides which client the returned code
    // belongs to. Only set when one was chosen — a bare /auth/google link
    // still connects with the default set.
    ...(setId ? { state: setId } : {}),
  });
}

// List of { id, email, credentialSet: { id, name }, calendars: [{ id,
// summary, backgroundColor, enabled }] }. Tokens are intentionally omitted —
// this is what the companion app reads. `credentialSet` is which of the
// deployment's credentials sets this account's tokens were minted under.
export function listAccounts() {
  return Object.values(loadAccounts()).map(({ id, email, calendars, credentialSetId }) => ({
    id,
    email,
    calendars,
    credentialSet: { id: credentialSetId, name: getGoogleSetLabel(credentialSetId) },
  }));
}

// Email addresses of the accounts pinned to one credential set — lets the
// API refuse to delete a set that's still in use and explain why.
export function accountsUsingSet(setId) {
  return Object.values(loadAccounts())
    .filter((account) => account.credentialSetId === setId)
    .map((account) => account.email)
    .sort();
}

export function isAuthorized() {
  return Object.keys(loadAccounts()).length > 0;
}

// Re-fetches this account's calendar list from Google and merges it with
// whatever enabled/disabled state the companion app already set — newly
// discovered calendars default to enabled, removed ones are dropped.
//
// Two of Google's defaults have to be overridden or calendars go missing
// from this list entirely, and shared calendars are the ones most likely to
// trip over either. The response is paginated at 100 entries (250 max), so
// without following nextPageToken everything past the first page is silently
// dropped. And entries the user hid in Google Calendar's own list are left
// out unless showHidden is asked for — invisible here even though the wall's
// visibility is meant to be decided by the toggles below, not Google's.
// A calendar hidden in Google still arrives switched off rather than on, so
// the wall keeps agreeing with Google Calendar until the user turns it on.
export async function refreshCalendarList(accountId) {
  const accounts = loadAccounts();
  const account = accounts[accountId];
  if (!account) throw new Error(`Unknown Google account: ${accountId}`);

  const client = createClient(account.credentialSetId);
  client.setCredentials(account.tokens);
  const calendarApi = google.calendar({ version: 'v3', auth: client });

  const items = [];
  let pageToken;
  do {
    const { data } = await calendarApi.calendarList.list({
      showHidden: true,
      maxResults: 250,
      pageToken,
    });
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  const existingById = new Map((account.calendars || []).map((cal) => [cal.id, cal]));
  account.calendars = items.map((item) => ({
    id: item.id,
    summary: item.summaryOverride || item.summary || item.id,
    backgroundColor: item.backgroundColor || null,
    enabled: existingById.get(item.id)?.enabled ?? !item.hidden,
  }));

  saveAccounts(accounts);
  return account.calendars;
}

// Exchanges an OAuth code for tokens, identifies which Google account they
// belong to, and stores/updates that account's record. Reconnecting an
// already-known email updates its tokens in place rather than duplicating it.
//
// `state` is the credential set id the connect flow started from, echoed
// back by Google's consent screen (see getAuthUrl) — it decides which
// client the code belongs to, and gets pinned on the account so refresh
// always uses the same client. A missing state means the flow started from
// a bare /auth/google link, so the account is pinned to the default set.
export async function exchangeCode(code, state) {
  const credentialSetId = state || getGoogleDefaultSetId();
  const client = createClient(credentialSetId);
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
    credentialSetId,
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

  const client = createClient(account.credentialSetId);
  client.setCredentials(account.tokens);
  client.on('tokens', (refreshed) => {
    const latest = loadAccounts();
    if (!latest[accountId]) return; // account was removed mid-request
    latest[accountId].tokens = { ...latest[accountId].tokens, ...refreshed };
    saveAccounts(latest);
  });
  return client;
}
