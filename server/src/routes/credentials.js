import { Router } from 'express';
import {
  getCredentialsStatus,
  setCredentials,
  addGoogleSet,
  updateGoogleSet,
  deleteGoogleSet,
} from '../services/credentialsService.js';
import { accountsUsingSet } from '../auth/googleAuth.js';
import { resetClient as resetMsalClient } from '../auth/microsoftAuth.js';

export const credentialsRouter = Router();

// { google: { sets: [{ id, name, clientId, configured, inUseBy }], configured,
// redirectUri }, ms: { clientId, configured, redirectUri, tenantId } } — never
// the client secret itself, just enough for the companion app's credential
// UI to show what's already saved (and pre-fill the fields it can) instead
// of always looking blank/unset, plus the redirect URI to register with the
// provider. Microsoft keeps a single set, so its status is unchanged; Google
// is a list of sets, each with the accounts currently pinned to it so the
// app can explain why one can't be deleted yet. Every credentials response
// carries this same shape, so a set's in-use state can't go stale between
// the initial GET and the response to an add/edit/delete.
const statusWithInUse = () => {
  const status = getCredentialsStatus();
  status.google.sets = status.google.sets.map((set) => ({
    ...set,
    inUseBy: accountsUsingSet(set.id),
  }));
  return status;
};

credentialsRouter.get('/credentials', (req, res) => {
  res.json(statusWithInUse());
});

// Google credentials are managed as multiple sets (see credentialsService).
// A PUT against the old single-set shape no longer applies to Google — the
// companion app now uses the /credentials/google routes below.
credentialsRouter.put('/credentials/:provider', (req, res) => {
  const { provider } = req.params;
  if (provider !== 'ms') {
    return res.status(400).json({ error: 'Use /credentials/google… to manage Google credential sets.' });
  }

  const clientId = (req.body?.clientId || '').trim();
  const clientSecret = (req.body?.clientSecret || '').trim();
  if (!clientId || !clientSecret) return res.status(400).json({ error: 'Client ID and Client Secret are both required' });

  // Microsoft's Entra tenant is optional, so unlike the two above an empty
  // value is allowed through rather than rejected — it just means "use the
  // .env one, or 'common'". Ignored for Google, which has no equivalent.
  const tenantId = (req.body?.tenantId || '').trim();

  setCredentials('ms', { clientId, clientSecret, tenantId });
  // The MSAL client is built once and cached — without this, saving new
  // Microsoft credentials (or a new tenant) wouldn't take effect until the
  // server restarted.
  resetMsalClient();

  res.json(statusWithInUse());
});

// Each Google handler returns the full status (so the companion app's one
// load covers both providers), and lets a thrown error become a clean 400
// with the reason rather than a raw 500.
credentialsRouter.post('/credentials/google', (req, res) => {
  try {
    const { name, clientId, clientSecret } = req.body || {};
    if (!(clientId || '').trim() || !(clientSecret || '').trim()) {
      return res.status(400).json({ error: 'Client ID and Client Secret are both required' });
    }
    addGoogleSet({ name, clientId, clientSecret });
    res.status(201).json(statusWithInUse());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

credentialsRouter.put('/credentials/google/:setId', (req, res) => {
  try {
    const { name, clientId, clientSecret } = req.body || {};
    // A name and/or new client ID can be saved on their own; the secret is
    // optional so edits don't force re-typing a write-only value (the saved
    // one is kept when blank).
    if (clientId && !(clientId || '').trim()) {
      return res.status(400).json({ error: 'Client ID cannot be blank' });
    }
    updateGoogleSet(req.params.setId, { name, clientId, clientSecret });
    res.json(statusWithInUse());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

credentialsRouter.delete('/credentials/google/:setId', (req, res) => {
  try {
    const { setId } = req.params;
    const inUseBy = accountsUsingSet(setId);
    if (inUseBy.length > 0) {
      return res.status(409).json({
        error: `This credentials set is still used by ${inUseBy.join(', ')} — disconnect those accounts, or connect them with a different set, before deleting it.`,
      });
    }
    deleteGoogleSet(setId);
    res.json(statusWithInUse());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});