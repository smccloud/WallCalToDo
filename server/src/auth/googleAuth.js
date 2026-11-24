import { google } from 'googleapis';
import { config } from '../config.js';
import { readJson, writeJson } from '../store/fileStore.js';
import {
  getCredentials,
  getGoogleDefaultSetId,
  getGoogleSetLabel,
} from '../services/credentialsService.js';

function isInvalidGrantError(err) {
  const text = `${err?.message || ''} ${err?.error || ''} ${err?.error_description || ''} ${err?.response?.data?.error || ''} ${err?.response?.data?.error_description || ''}`;
  return /invalid_grant/i.test(text);
}

// Google returns `refresh_token_expires_in` (seconds) only when the refresh
// token it just issued actually has a deadline. That is the whole difference
// between an app whose OAuth consent screen is In production (no such field —
// the token lives until revoked or six months of disuse) and one still in
// Testing (seven days, no matter how often the access token is renewed). We
// keep the deadline as an absolute timestamp so the companion app can say
// "this will need reconnecting on <date>" *before* the wall goes quiet,
// instead of only finding out when Google starts answering invalid_grant.
function refreshTokenExpiry(tokens) {
  const seconds = Number(tokens?.refresh_token_expires_in);
  return Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : null;
}

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

// Cache OAuth2 clients per account to avoid attaching multiple 'tokens'
// event listeners on every call to getAuthorizedClient(), which can cause
// race conditions and lose refresh tokens.
const clientCache = new Map();

function createClient(setId) {
  const { clientId, clientSecret } = getCredentials('google', setId);
  return new google.auth.OAuth2(clientId, clientSecret, config.google.redirectUri);
}

export function resetClient(accountId) {
  if (accountId) {
    clientCache.delete(accountId);
  } else {
    clientCache.clear();
  }
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
// summary, backgroundColor, color, customColor, enabled }] }. Tokens are
// intentionally omitted — this is what the companion app reads.
// `credentialSet` is which of the deployment's credentials sets this
// account's tokens were minted under. `color` is the one the display should
// actually use: the user's own choice when there is one, Google's otherwise.
export function listAccounts() {
  return Object.values(loadAccounts()).map(
    ({ id, email, calendars, credentialSetId, needsReauth, refreshTokenExpiresAt }) => ({
      id,
      email,
      calendars: (calendars || []).map((cal) => ({
        ...cal,
        accessLevel: cal.accessLevel || 'owner',
        color: cal.customColor || cal.backgroundColor || null,
      })),
      credentialSet: { id: credentialSetId, name: getGoogleSetLabel(credentialSetId) },
      // Google refused the saved refresh token (expired or revoked), so this
      // account is no longer being polled. The record is kept — calendars,
      // colors and enabled flags included — so reconnecting restores it whole
      // rather than making the user rebuild the account from scratch.
      needsReauth: Boolean(needsReauth),
      // When Google told us the refresh token has a deadline (see
      // refreshTokenExpiry above). Null for an In production app, where it
      // doesn't. Lets the companion app warn while the connection still works.
      refreshTokenExpiresAt: refreshTokenExpiresAt || null,
    })
  );
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

  // Use the shared, listener-backed client so any token refresh Google
  // performs while listing calendars is persisted (see getAuthorizedClient).
  // A direct client here used to drop refreshed tokens on the floor.
  const client = getAuthorizedClient(accountId);
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

  // The fetch above may have triggered a token refresh that persisted through
  // getAuthorizedClient's listener, so reload the account record before
  // writing calendars back — otherwise we'd overwrite the refreshed tokens
  // with the stale copy captured at the top of this function.
  const freshAccounts = loadAccounts();
  const freshAccount = freshAccounts[accountId];
  if (!freshAccount) throw new Error(`Unknown Google account: ${accountId}`);

  const existingById = new Map((account.calendars || []).map((cal) => [cal.id, cal]));
  freshAccount.calendars = items.map((item) => {
    const existing = existingById.get(item.id);
    return {
      id: item.id,
      summary: item.summaryOverride || item.summary || item.id,
      backgroundColor: item.backgroundColor || null,
      accessLevel: item.accessRole === 'owner' ? 'owner' : 'reader',
      enabled: existing?.enabled ?? !item.hidden,
      // A user-chosen color lives on the record alongside the color Google
      // reports, so a refresh (which rebuilds the list from Google's own
      // response) doesn't silently throw the choice away.
      ...(existing?.customColor ? { customColor: existing.customColor } : {}),
    };
  });

  saveAccounts(freshAccounts);
  return freshAccount.calendars;
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

  // Google may have silently refreshed the access token (and possibly the
  // refresh token) while fetching the profile above; persist whatever the
  // client actually ended up holding rather than the original exchange's
  // tokens, so a refresh that happened mid-flow isn't lost. The original
  // `tokens` from getToken() are kept as a fallback source for the refresh
  // token, since a mid-flow refresh's response often omits refresh_token and
  // would otherwise drop it (and, on a reconnect, clobber the freshly minted
  // one with the stale value already on disk).
  const finalTokens = client.credentials && Object.keys(client.credentials).length
    ? client.credentials
    : tokens;

  const accounts = loadAccounts();
  const existingTokens = accounts[accountId]?.tokens;
  const refreshToken = finalTokens.refresh_token != null
    ? finalTokens.refresh_token
    : (tokens.refresh_token != null
      ? tokens.refresh_token
      : (existingTokens?.refresh_token != null ? existingTokens.refresh_token : null));
  // Preserve existing scope if a mid-flow refresh's response omitted it.
  const scope = finalTokens.scope != null
    ? finalTokens.scope
    : (tokens.scope != null ? tokens.scope : existingTokens?.scope);
  const mergedTokens = {
    ...finalTokens,
    ...(refreshToken != null ? { refresh_token: refreshToken } : {}),
    ...(scope != null ? { scope } : {}),
  };

  // A fresh consent can mint a new refresh token with its own deadline (or,
  // once the app is In production, none at all), so the stored deadline is
  // only ever carried over when no new token was issued — e.g. a reconnect
  // that Google answered without one. Otherwise `refreshTokenExpiry` returns
  // null and any stale deadline is dropped: a reconnect against a published
  // app is exactly what turns a seven-day token into a permanent one.
  const issuedNewRefreshToken = refreshToken != null && refreshToken !== existingTokens?.refresh_token;
  const refreshTokenExpiresAt = issuedNewRefreshToken
    ? refreshTokenExpiry(tokens.refresh_token_expires_in != null ? tokens : finalTokens)
    : (existingTokens?.refreshTokenExpiresAt ?? null);

  accounts[accountId] = {
    id: accountId,
    email: profile.email,
    tokens: mergedTokens,
    credentialSetId,
    calendars: accounts[accountId]?.calendars || [],
    // Rebuilt rather than spread, which also clears a needsReauth flag left
    // by the previous connection: this consent is the repair.
    ...(refreshTokenExpiresAt != null ? { refreshTokenExpiresAt } : {}),
  };
  saveAccounts(accounts);
  clientCache.delete(accountId);

  // Warm the shared client cache so later calls (and any token refresh they
  // trigger) go through the listener-backed client instead of a bare one.
  getAuthorizedClient(accountId);
  await refreshCalendarList(accountId);
  return accountId;
}

export function removeAccount(accountId) {
  const accounts = loadAccounts();
  delete accounts[accountId];
  saveAccounts(accounts);
  clientCache.delete(accountId);
}

// A refresh Google refused with invalid_grant is final: the stored refresh
// token is dead (expired, revoked, or minted for a different OAuth client),
// and no amount of retrying will revive it. Flag the account instead of
// deleting it, unlike removeAccount above: the tokens are useless but the
// calendar list, the enabled flags and the colors are the user's own work,
// and exchangeCode() restores the whole record when the same email signs in
// again. Polling skips flagged accounts (see calendarService/googleTodoService)
// so a dead token isn't re-sent to Google every minute; the companion app
// shows the flag as a Reconnect prompt and the reason it keeps happening.
export function markNeedsReauth(accountId) {
  const accounts = loadAccounts();
  const account = accounts[accountId];
  if (!account || account.needsReauth) return;
  account.needsReauth = true;
  saveAccounts(accounts);
  clientCache.delete(accountId);
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

// Stores (or clears) the user's own color for a calendar. Passing an empty
// value drops the override, falling back to the color Google reports. Returns
// the color the calendar should now display, so the caller can recolor the
// cached events without re-reading the account.
export function setCalendarColor(accountId, calendarId, color) {
  const accounts = loadAccounts();
  const account = accounts[accountId];
  if (!account) throw new Error(`Unknown Google account: ${accountId}`);

  const calendar = account.calendars.find((cal) => cal.id === calendarId);
  if (!calendar) throw new Error(`Unknown calendar ${calendarId} for account ${accountId}`);

  if (color) calendar.customColor = color;
  else delete calendar.customColor;
  saveAccounts(accounts);
  return calendar.customColor || calendar.backgroundColor || null;
}

// Returns an OAuth2 client hydrated with one account's saved tokens.
// googleapis refreshes the access token automatically using the refresh
// token when it expires; we just persist whatever it hands back so future
// requests (and restarts) keep working.
export function getAuthorizedClient(accountId) {
  const accounts = loadAccounts();
  const account = accounts[accountId];
  if (!account) throw new Error(`Unknown Google account: ${accountId}`);
  // Flagged accounts have no usable refresh token, so handing out a client
  // would only produce another invalid_grant from the next API call. Fail with
  // the thing the user can actually do instead; pollers skip these accounts
  // before they get here (see markNeedsReauth).
  if (account.needsReauth) {
    throw new Error(
      `Google access for ${account.email} has expired — reconnect the account in the companion app.`
    );
  }

  if (clientCache.has(accountId)) {
    const cached = clientCache.get(accountId);
    // Update credentials in case they were refreshed elsewhere, but never let a
    // disk read that is missing a refresh_token/scope clobber the values the
    // cached client already holds in memory — losing them breaks silent renewal
    // and the companion app's "has Tasks access" check.
    const diskTokens = account.tokens || {};
    const cachedCreds = cached.credentials || {};
    const mergedTokens = {
      ...cachedCreds,
      ...diskTokens,
      refresh_token: diskTokens.refresh_token != null
        ? diskTokens.refresh_token
        : cachedCreds.refresh_token,
      scope: diskTokens.scope != null ? diskTokens.scope : cachedCreds.scope,
    };
    cached.setCredentials(mergedTokens);
    return cached;
  }

  const client = createClient(account.credentialSetId);
  client.setCredentials(account.tokens || {});
  client.on('tokens', (refreshed) => {
    const latest = loadAccounts();
    if (!latest[accountId]) return; // account was removed mid-request
    // Preserve existing refresh_token/scope if the refreshed tokens don't
    // include one (Google often omits refresh_token on refresh, and may omit
    // scope). Treat null/undefined as "omitted" so a missing value never
    // clobbers a stored value. Fall back to the client's in-memory copy if
    // disk already lost them.
    const existingTokens = latest[accountId].tokens || {};
    const cachedCreds = client.credentials || {};
    const refreshToken = refreshed.refresh_token != null
      ? refreshed.refresh_token
      : (existingTokens.refresh_token != null ? existingTokens.refresh_token : cachedCreds.refresh_token);
    const scope = refreshed.scope != null
      ? refreshed.scope
      : (existingTokens.scope != null ? existingTokens.scope : cachedCreds.scope);
    latest[accountId].tokens = {
      ...existingTokens,
      ...refreshed,
      refresh_token: refreshToken != null ? refreshToken : existingTokens.refresh_token,
      scope: scope != null ? scope : existingTokens.scope,
    };
    // Google's refresh response repeats the refresh token's remaining lifetime
    // while one is in force, which keeps the deadline current across renewals.
    // A rotated refresh token with no lifetime means the replacement doesn't
    // expire on a timer, so the old deadline must not linger.
    if (refreshed.refresh_token_expires_in != null) {
      const expiresAt = refreshTokenExpiry(refreshed);
      if (expiresAt != null) latest[accountId].refreshTokenExpiresAt = expiresAt;
      else delete latest[accountId].refreshTokenExpiresAt;
    } else if (refreshed.refresh_token != null) {
      delete latest[accountId].refreshTokenExpiresAt;
    }
    saveAccounts(latest);
  });
  clientCache.set(accountId, client);
  return client;
}

export function isInvalidGrant(err) {
  return isInvalidGrantError(err);
}
