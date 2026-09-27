import { Router } from 'express';
import { getCredentialsStatus, setCredentials } from '../services/credentialsService.js';
import { resetClient as resetMsalClient } from '../auth/microsoftAuth.js';

export const credentialsRouter = Router();

// { google: { clientId, configured }, ms: { clientId, tenantId, configured } }
// — never the client secret itself, just enough for the companion app's
// credentials form to show what's already saved (and pre-fill the fields it
// can) instead of always looking blank/unset.
credentialsRouter.get('/credentials', (req, res) => {
  res.json(getCredentialsStatus());
});

credentialsRouter.put('/credentials/:provider', (req, res) => {
  const { provider } = req.params;
  if (!['google', 'ms'].includes(provider)) return res.status(400).json({ error: 'Unknown provider' });

  const clientId = (req.body?.clientId || '').trim();
  const clientSecret = (req.body?.clientSecret || '').trim();
  if (!clientId || !clientSecret) return res.status(400).json({ error: 'Client ID and Client Secret are both required' });

  // Microsoft's Entra tenant is optional, so unlike the two above an empty
  // value is allowed through rather than rejected — it just means "use the
  // .env one, or 'common'". Ignored for Google, which has no equivalent.
  const tenantId = (req.body?.tenantId || '').trim();

  setCredentials(provider, { clientId, clientSecret, tenantId });
  // The MSAL client is built once and cached — without this, saving new
  // Microsoft credentials (or a new tenant) wouldn't take effect until the
  // server restarted.
  if (provider === 'ms') resetMsalClient();

  res.json(getCredentialsStatus());
});
