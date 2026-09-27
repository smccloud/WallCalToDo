import { readJson, writeJson } from '../store/fileStore.js';
import { config, DEFAULT_MS_TENANT_ID } from '../config.js';

const CREDENTIALS_FILE = 'apiCredentials.json';

const load = () => readJson(CREDENTIALS_FILE, {});
const save = (data) => writeJson(CREDENTIALS_FILE, data);

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

// { clientId, clientSecret } actually used to build the OAuth client (plus
// tenantId for Microsoft) — read by googleAuth.js/microsoftAuth.js, never by
// the companion app directly (see getCredentialsStatus below for what that
// gets).
export function getCredentials(provider) {
  const stored = load()[provider];
  // The ID and secret are all-or-nothing on purpose: they're a matched pair
  // from one app registration, so falling back to .env for one field but
  // not the other would mix two registrations' credentials and fail with a
  // baffling auth error rather than a clean "not configured".
  const base = stored?.clientId && stored?.clientSecret ? stored : envDefaults(provider);
  return provider === 'ms' ? { ...base, tenantId: resolveTenantId(stored) } : base;
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

// What the companion app's credentials form reads/shows: the client ID
// (not sensitive, safe to echo back so the field isn't blank after a
// reload), the resolved tenant ID so an optional field can show what it
// will actually use, and whether a secret is on file -- the secret itself
// is write-only, never sent back out once saved.
export function getCredentialsStatus() {
  const status = (provider) => {
    const stored = load()[provider];
    const fallback = envDefaults(provider);
    const clientId = stored?.clientId || fallback.clientId;
    const configured = Boolean((stored?.clientId && stored?.clientSecret) || (fallback.clientId && fallback.clientSecret));
    return { clientId, configured, ...(provider === 'ms' ? { tenantId: resolveTenantId(stored) } : {}) };
  };
  return { google: status('google'), ms: status('ms') };
}
