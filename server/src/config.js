import dotenv from 'dotenv';

dotenv.config();

// The Entra tenant to sign in against when one wasn't specified. "common"
// is Microsoft's multi-tenant endpoint — it accepts any work, school, or
// personal account, which is what almost everyone wants: a personal
// Microsoft account has no directory of its own to point at. A real tenant
// ID is only needed to deliberately restrict sign-ins to one organization's
// directory (see credentialsService.resolveTenantId).
export const DEFAULT_MS_TENANT_ID = 'common';

export const config = {
  port: Number(process.env.PORT || 3000),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 60000),
  // Comma-separated networks allowed to run an account connect flow from a
  // device other than the Pi's own screen (e.g. a laptop on the same
  // Wi-Fi). Unset/blank means the Pi's own screen only, which is the default
  // everything else in the README assumes -- see
  // services/trustedNetworks.js for the parsing and the check itself.
  trustedCidrs: process.env.TRUSTED_CIDRS || '',
  // Per-round tally of what the Microsoft calendar poll dropped (cancelled,
  // draft, declined, pruned, untitled). Off by default so a busy week of
  // declined invites doesn't fill the journal every interval; it's a
  // diagnostic for when the wall looks emptier than it should, so it only
  // needs to be on while you're actually looking for that.
  logMsCalendarRounds: process.env.LOG_MS_CALENDAR_ROUNDS === '1',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
  },
  ms: {
    clientId: process.env.MS_CLIENT_ID,
    clientSecret: process.env.MS_CLIENT_SECRET,
    tenantId: process.env.MS_TENANT_ID || DEFAULT_MS_TENANT_ID,
    redirectUri: process.env.MS_REDIRECT_URI || 'http://localhost:3000/auth/microsoft/callback',
  },
};
