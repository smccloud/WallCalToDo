import { Router } from 'express';
import * as googleAuth from '../auth/googleAuth.js';
import * as microsoftAuth from '../auth/microsoftAuth.js';
import { pollCalendar, getCachedEvents } from '../services/calendarService.js';
import { pollMsCalendar } from '../services/msCalendarService.js';
import { pollTodo } from '../services/todoService.js';
import { clientAddress, isTrustedRequest } from '../services/trustedNetworks.js';
import { broadcast } from '../ws/hub.js';

export const authRouter = Router();

// Every route below is part of the one flow that can hand a new account's
// calendar to this display, so all of them -- the two starts and the two
// callbacks, not just the starts -- are limited to the Pi's own screen and the
// networks in server/.env's TRUSTED_CIDRS (see trustedNetworks.js). Gating
// only the starts would be pointless: the callback is the leg that exchanges
// the code for a token, so it's the one that actually has to be refused.
//
// A refusal redirects rather than answering 403, for the same reason the
// handlers below redirect their errors: these are real page navigations
// through a provider's own consent screen, and a bare status code would
// replace the companion app with an error page. This lands back on it with
// the reason in the query string, which the companion app shows as a
// dismissible banner (see its App.jsx).
authRouter.use((req, res, next) => {
  if (isTrustedRequest(req)) return next();
  const address = clientAddress(req);
  res.redirect(
    `/companion?authError=${encodeURIComponent(
      `Connecting an account isn't allowed from this device${
        address ? ` (${address})` : ''
      }. Add its network to TRUSTED_CIDRS in server/.env to allow it, or do it on the Pi's own screen at http://localhost:3000/companion.`
    )}`
  );
});

// These are meant to be visited from a device allowed to connect accounts
// (the guard above) — the "Add Google account" button in the companion app
// links here directly. A real page navigation, not a fetch
// (the browser has to land on Google's own consent screen), so a failure
// here can't just be a JSON response — send the browser back to the
// companion app with the reason in the query string instead of hanging or
// showing a raw JSON error page.
authRouter.get('/google', (req, res) => {
  try {
    // ?set=<credentialSetId> picks which of the deployment's Google API
    // credential sets this connection is made against (see googleAuth
    // getAuthUrl/exchangeCode) — each set is a separate OAuth client, and
    // the account this flow connects gets pinned to it.
    res.redirect(googleAuth.getAuthUrl(req.query.set));
  } catch (err) {
    res.redirect(`/companion?authError=${encodeURIComponent(err.message)}`);
  }
});

authRouter.get('/google/callback', async (req, res) => {
  try {
    // Google echoes the `state` we put in the auth URL back here; that's the
    // credential set the flow started from, and it decides which client the
    // returned code belongs to (see googleAuth.exchangeCode).
    await googleAuth.exchangeCode(req.query.code, req.query.state);
    // Pull the new account's events in immediately rather than waiting for
    // the next poll interval, then send the browser back to the companion
    // app so the just-connected account shows up right away.
    const { changed, events } = await pollCalendar();
    if (changed) broadcast({ type: 'calendar', data: events });
    res.redirect('/companion');
  } catch (err) {
    // A real page navigation landing back from Google, not a fetch this
    // app made itself -- a raw JSON 500 page here (e.g. from a pasted
    // Client Secret that doesn't match, or an account not added as a test
    // user yet) reads as the whole thing being broken. Same
    // redirect-with-reason treatment as the two GET routes above.
    res.redirect(`/companion?authError=${encodeURIComponent(`Google auth failed: ${err.message}`)}`);
  }
});

authRouter.get('/microsoft', async (req, res) => {
  try {
    res.redirect(await microsoftAuth.getAuthUrl());
  } catch (err) {
    res.redirect(`/companion?authError=${encodeURIComponent(err.message)}`);
  }
});

authRouter.get('/microsoft/callback', async (req, res) => {
  try {
    await microsoftAuth.exchangeCode(req.query.code);
    // Pull calendars and tasks in immediately rather than waiting for the
    // next poll interval, then send the browser back to the companion app so
    // the just-connected calendars/lists show up right away — same as the
    // Google flow.
    //
    // Polled in this order so the calendar broadcast lands last: the
    // calendar feed is both providers merged, so Microsoft has to be the one
    // that goes out or the display would briefly show Google's side with a
    // Microsoft list from before the connect.
    const { changed: tasksChanged, tasks } = await pollTodo();
    if (tasksChanged) broadcast({ type: 'todo', data: tasks });
    const { changed: calendarChanged } = await pollMsCalendar();
    if (calendarChanged) broadcast({ type: 'calendar', data: getCachedEvents() });
    res.redirect('/companion');
  } catch (err) {
    // Same reasoning as the Google callback above.
    res.redirect(`/companion?authError=${encodeURIComponent(`Microsoft auth failed: ${err.message}`)}`);
  }
});
