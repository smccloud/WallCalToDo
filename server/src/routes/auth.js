import { Router } from 'express';
import * as googleAuth from '../auth/googleAuth.js';
import * as microsoftAuth from '../auth/microsoftAuth.js';
import { pollCalendar, getCachedEvents } from '../services/calendarService.js';
import { pollMsCalendar } from '../services/msCalendarService.js';
import { pollTodo } from '../services/todoService.js';
import { broadcast } from '../ws/hub.js';

export const authRouter = Router();

// These are meant to be visited from a laptop/phone on the same network as
// the Pi to grant access — the "Add Google Account" button in the
// companion app links here directly. A real page navigation, not a fetch
// (the browser has to land on Google's own consent screen), so a failure
// here can't just be a JSON response — send the browser back to the
// companion app with the reason in the query string instead of hanging or
// showing a raw JSON error page.
authRouter.get('/google', (req, res) => {
  try {
    res.redirect(googleAuth.getAuthUrl());
  } catch (err) {
    res.redirect(`/companion?authError=${encodeURIComponent(err.message)}`);
  }
});

authRouter.get('/google/callback', async (req, res) => {
  try {
    await googleAuth.exchangeCode(req.query.code);
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
