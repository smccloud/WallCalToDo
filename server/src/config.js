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
