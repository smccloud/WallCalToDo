import { randomUUID } from 'node:crypto';
import { readJson, writeJson } from '../store/fileStore.js';
import { config, DEFAULT_MS_TENANT_ID } from '../config.js';

const CREDENTIALS_FILE = 'apiCredentials.json';

// server/.env's GOOGLE_CLIENT_ID/SECRET and MS_CLIENT_ID/SECRET are the
// original way to configure these (still fine for anyone who prefers
// editing a file over the UI) — whatever's saved through the companion
// app's own credentials form just takes priority over them, so an .env
// value only ever acts as a fallback default.
function envDefaults(provider) {
  return provider === 'google'
    ? { clientId: config.google.clientId || '', clientSecret: config.google.clientSecret || '' }
    : { clientId: config.ms.clientId || '', clientSecret: config.ms.clientSecret || '' };
}

// The Entra portal shows a tenant in two shapes, and people paste both: a
// bare "Directory (tenant) ID" GUID, or a full authority URL copied off the
// app's Overview page ("Application ID URI") or its sign-in link. Reduce
// either to the segment after the host, so pasting the whole URL doesn't
// turn into a nonsense authority. Returns '' for blank/unusable input, which
// every caller treats as "not specified" rather than as a value.
function normalizeTenantId(value) {
  const raw = (value || '').trim();
  if (!raw) return '';
  const fromUrl = raw.match(/login\.microsoftonline\.com\/([^/?#]+)/i);
  return (fromUrl ? fromUrl[1] : raw).replace(/\/+$/, '').trim();
}

// Which tenant the sign-in URL should point at, most specific source first:
// the companion app's Tenant ID field, then server/.env, then "common".
// Deliberately resolved on its own rather than alongside the client
// ID/secret pair — a tenant only scopes *whose accounts may sign in*, so a
// stored pair and a stored tenant can each be present independently without
// either being half-overridden by the other.
function resolveTenantId(stored) {
  return normalizeTenantId(stored?.tenantId) || normalizeTenantId(config.ms.tenantId) || DEFAULT_MS_TENANT_ID;
}

// ---------------------------------------------------------------- Google
//
// Google credentials are a *set of sets*: one app registration per "set"
// (some deployments keep several, e.g. one per organisation whose calendars
// the wall shows). Each has an id, a name, and its Client ID/Secret pair.
// The pair from server/.env is surfaced as an implicit extra set under the
// reserved id ENV_GOOGLE_SET_ID — accounts can be pinned to it like any
// other set, but it only exists while the .env pair is complete, so it can
// appear and disappear from the list by editing that file.

export const ENV_GOOGLE_SET_ID = 'env';

const load = () => readJson(CREDENTIALS_FILE, {});
const save = (data) => writeJson(CREDENTIALS_FILE, data);

function envGoogleSet() {
  const { clientId, clientSecret } = envDefaults('google');
  return clientId && clientSecret ? { id: ENV_GOOGLE_SET_ID, name: 'server/.env', clientId, clientSecret } : null;
}

// Google is stored as an array of sets. Before multi-set support it was a
// single provider-keyed object; that older shape is migrated here, once, to
// the id 'default' so any accounts already connected (which the migration
// in googleAuth.js then pins to the same id) keep working unchanged.
function loadGoogleSets() {
  const data = load();
  const stored = data.google;
  if (Array.isArray(stored)) return stored;
  const legacy = stored && stored.clientId && stored.clientSecret ? stored : null;
  if (legacy) {
    data.google = [{ id: 'default', name: 'Default', clientId: legacy.clientId, clientSecret: legacy.clientSecret }];
    save(data);
  }
  return legacy ? data.google : [];
}

const saveGoogleSets = (sets) => {
  const data = load();
  data.google = sets;
  save(data);
};

const findGoogleSet = (setId) => loadGoogleSets().find((set) => set.id === setId);

export function getGoogleSetLabel(setId) {
  if (setId === ENV_GOOGLE_SET_ID) return envGoogleSet()?.name || 'server/.env';
  return findGoogleSet(setId)?.name || 'Default';
}

// Which set a connection that doesn't name one uses: the first stored set if
// any is fully configured, else the .env pair. This is also what accounts
// connected before the multi-set feature existed get pinned to on their
// first load after upgrade (see googleAuth.js).
export function getGoogleDefaultSetId() {
  const first = loadGoogleSets().find((set) => set.clientId && set.clientSecret);
  return first ? first.id : ENV_GOOGLE_SET_ID;
}

// { clientId, clientSecret } actually used to build the OAuth client for a
// particular set. Throws clean messages rather than handing out a half-set:
// a pair is a matched pair from one app registration, so falling back to
// .env for one field but not the other would mix two registrations and fail
// with a baffling auth error instead of a clean "not configured". With no
// setId this is the default set (see getGoogleDefaultSetId).
export function resolveGoogleCredentials(setId) {
  const requirePair = (set, hint) => {
    if (!set?.clientId || !set?.clientSecret) {
      throw new Error(
        hint || 'Google OAuth is not configured — enter a Client ID/Secret in the companion app’s Google Calendar section.'
      );
    }
    return { clientId: set.clientId, clientSecret: set.clientSecret };
  };

  if (setId === ENV_GOOGLE_SET_ID) return requirePair(envGoogleSet(), 'Google OAuth is not configured — server/.env has no Google Client ID/Secret.');
  if (setId) return requirePair(findGoogleSet(setId), `The Google credentials set you picked no longer exists — pick another one and try again.`);
  return requirePair(loadGoogleSets().find((set) => set.clientId && set.clientSecret) || envGoogleSet());
}

export function addGoogleSet({ name, clientId, clientSecret }) {
  const set = {
    id: randomUUID(),
    name: (name || '').trim() || 'Default',
    clientId: (clientId || '').trim(),
    clientSecret: (clientSecret || '').trim(),
  };
  const sets = loadGoogleSets();
  sets.push(set);
  saveGoogleSets(sets);
  return set;
}

export function updateGoogleSet(setId, { name, clientId, clientSecret }) {
  if (setId === ENV_GOOGLE_SET_ID) throw new Error('The server/.env credentials set is read-only — edit server/.env to change it.');
  const sets = loadGoogleSets();
  const set = sets.find((candidate) => candidate.id === setId);
  if (!set) throw new Error('Unknown Google credentials set.');

  // A blank secret on update means "keep the saved one": the secret is
  // write-only, so the edit form can't pre-fill it and must not be forced to
  // re-type it every time. Same reasoning as the form itself (see
  // ApiCredentialsForm.jsx).
  if (name !== undefined) set.name = (name || '').trim() || 'Default';
  if (clientId !== undefined) set.clientId = (clientId || '').trim();
  if (clientSecret !== undefined && (clientSecret || '').trim()) set.clientSecret = clientSecret.trim();
  saveGoogleSets(sets);
  return set;
}

export function deleteGoogleSet(setId) {
  if (setId === ENV_GOOGLE_SET_ID) throw new Error('The server/.env credentials set can’t be deleted.');
  const sets = loadGoogleSets();
  const next = sets.filter((set) => set.id !== setId);
  if (next.length === sets.length) throw new Error('Unknown Google credentials set.');
  saveGoogleSets(next);
}

function googleSetStatus(set) {
  return {
    id: set.id,
    name: set.name,
    clientId: set.clientId,
    configured: Boolean(set.clientId && set.clientSecret),
  };
}

// What the companion app's credential-sets panel reads/shows: every stored
// set plus the .env pair when it's complete, each with its client ID (not
// sensitive, safe to echo back) and whether a secret is on file — the secret
// itself is write-only, never sent back out once saved. `configured` overall
// is whether *any* set could connect an account right now.
export function getGoogleSetStatuses() {
  const sets = loadGoogleSets().map(googleSetStatus);
  const env = envGoogleSet();
  if (env) sets.unshift({ id: env.id, name: env.name, clientId: env.clientId, configured: true });
  return sets;
}

export function getCredentialsStatus() {
  const googleSets = getGoogleSetStatuses();
  const msStatus = () => {
    const stored = load().ms;
    const fallback = envDefaults('ms');
    const clientId = stored?.clientId || fallback.clientId;
    const configured = Boolean(
      (stored?.clientId && stored?.clientSecret) || (fallback.clientId && fallback.clientSecret)
    );
    return { clientId, configured, tenantId: resolveTenantId(stored), redirectUri: config.ms.redirectUri };
  };
  return {
    google: {
      sets: googleSets,
      configured: googleSets.some((set) => set.configured),
      redirectUri: config.google.redirectUri,
    },
    ms: msStatus(),
  };
}

// { clientId, clientSecret } actually used to build the OAuth client (plus
// tenantId for Microsoft) — read by googleAuth.js/microsoftAuth.js, never by
// the companion app directly (see getCredentialsStatus above for what that
// gets). For Google, setId picks which of the credential sets the client is
// built from (see resolveGoogleCredentials).
export function getCredentials(provider, setId) {
  if (provider === 'google') return resolveGoogleCredentials(setId);
  const stored = load()[provider];
  const base = stored?.clientId && stored?.clientSecret ? stored : envDefaults(provider);
  return { ...base, tenantId: resolveTenantId(stored) };
}

export function setCredentials(provider, { clientId, clientSecret, tenantId }) {
  const data = load();
  // tenantId is Microsoft-only (Google has no equivalent) and stored as
  // given, blank included — a blank field means "fall back to .env/common",
  // so deliberately clearing it here takes effect rather than silently
  // keeping whatever was there before.
  data[provider] = { clientId, clientSecret, ...(provider === 'ms' ? { tenantId: normalizeTenantId(tenantId) } : {}) };
  save(data);
}