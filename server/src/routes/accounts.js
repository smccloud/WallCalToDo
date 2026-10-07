import { Router } from 'express';
import * as googleAuth from '../auth/googleAuth.js';
import * as microsoftAuth from '../auth/microsoftAuth.js';
import { pollCalendar, dropAccountCache } from '../services/calendarService.js';
import {
  pollMsCalendar,
  dropCalendarCache,
  dropAllCalendarsCache,
} from '../services/msCalendarService.js';
import { getCachedTasks, dropListCache, dropAllListsCache } from '../services/todoService.js';
import {
  getGoogleTaskLists,
  hasTasksAccess,
  refreshGoogleTaskLists,
  setGoogleTaskListEnabled,
  pollGoogleTasks,
} from '../services/googleTodoService.js';
import { clientAddress, isTrustedRequest } from '../services/trustedNetworks.js';
import { broadcast, broadcastCalendar } from '../ws/hub.js';

export const accountsRouter = Router();

// Both calendar providers in one response, so the companion app's single
// load covers everything. Microsoft's half is a single account rather than a
// list (there's only ever one Microsoft sign-in, shared by calendars and To
// Do), carrying its calendars alongside it.
//
// `calendarAccess` is why that calendar list might be empty on an otherwise
// connected account: an account connected before calendars existed holds a
// token that was never consented to Calendars.Read, and asking for one
// anyway just fails. Saying so lets the companion app ask for a reconnect
// instead of showing an empty list with no explanation.
//
// Asked of the auth layer, which answers by attempting the same silent
// calendar-scoped token request the poll makes — see
// microsoftAuth.getCalendarAccess. A transient failure (no network, Entra
// briefly down) is not evidence about consent, so it falls back to the last
// thing we did establish rather than telling the user their permissions are
// wrong when they aren't.
//
// `authAccess` is whether *this* device may run an account connect flow (see
// trustedNetworks.js), which the companion app uses to decide between offering
// the add/reconnect buttons and explaining why it can't. The server decides
// rather than the app guessing from its own hostname, since the rule is about
// the network the request came in on, not the address the page was loaded
// from. The address comes along for the same reason the buttons need an
// explanation: "add your network to TRUSTED_CIDRS" isn't actionable without
// knowing which network you're on.
accountsRouter.get('/accounts', async (req, res) => {
  const account = await microsoftAuth.getConnectedAccount();
  let calendarAccess = 'not_connected';
  if (account) {
    try {
      calendarAccess = await microsoftAuth.getCalendarAccess();
    } catch (err) {
      console.error('[accounts] could not determine Microsoft calendar access:', err.message);
      calendarAccess = microsoftAuth.isCalendarScopeMissing() ? 'missing' : 'granted';
    }
  }

  res.json({
    google: googleAuth.listAccounts().map((acct) => ({
      ...acct,
      tasksAccess: hasTasksAccess(acct.id),
      taskLists: getGoogleTaskLists(acct.id),
    })),
    microsoft: { account, calendars: microsoftAuth.listCalendars(), calendarAccess },
    authAccess: { canAddAccounts: isTrustedRequest(req), clientAddress: clientAddress(req) },
  });
});

accountsRouter.get('/todo/lists', async (req, res) => {
  res.json({ lists: microsoftAuth.listTodoLists(), account: await microsoftAuth.getConnectedAccount() });
});

// Disconnecting drops both halves of the one Microsoft account — calendars
// and To Do — and their cached events/tasks, then rebroadcasts each feed so
// the wall display empties out immediately.
accountsRouter.delete('/ms/account', async (req, res) => {
  try {
    await microsoftAuth.disconnectAccount();
    dropAllCalendarsCache();
    dropAllListsCache();
    broadcastCalendar();
    broadcast({ type: 'todo', data: getCachedTasks() });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Toggling a list takes effect immediately — no repoll needed,
// getCachedTasks() filters by the current enabled flags.
accountsRouter.patch('/todo/lists/:listId', (req, res) => {
  try {
    microsoftAuth.setTodoListEnabled(req.params.listId, Boolean(req.body?.enabled));
    broadcast({ type: 'todo', data: getCachedTasks() });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manual "check for new/removed lists on this account" — Microsoft doesn't
// push list changes, so this is a deliberate refresh rather than something
// polled automatically. Also how a newly-shared list (e.g. one shared by a
// spouse) shows up without waiting for a reconnect.
accountsRouter.post('/todo/refresh', async (req, res) => {
  try {
    const before = new Set(microsoftAuth.listTodoLists().map((list) => list.id));
    const lists = await microsoftAuth.refreshTodoLists();
    for (const id of before) {
      if (!lists.some((list) => list.id === id)) dropListCache(id);
    }
    broadcast({ type: 'todo', data: getCachedTasks() });
    res.json({ lists });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manual "check for new/removed calendars on the Microsoft account" —
// neither Google nor Microsoft pushes calendar-list changes, so this is a
// deliberate refresh rather than something polled automatically. Also how a
// newly-shared calendar shows up without waiting for a reconnect. Mirrors
// Google's POST /accounts/:id/refresh above, minus the account id.
accountsRouter.post('/ms/calendars/refresh', async (req, res) => {
  try {
    const before = new Set(microsoftAuth.listCalendars().map((cal) => cal.id));
    const calendars = await microsoftAuth.refreshCalendars();
    for (const id of before) {
      if (!calendars.some((cal) => cal.id === id)) dropCalendarCache(id);
    }
    const { changed } = await pollMsCalendar();
    if (changed) broadcastCalendar();
    res.json({ calendars });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Toggling a calendar takes effect on the display immediately — no repoll
// needed, getCachedEvents() filters by the current enabled flags. No
// :accountId param because there's only the one Microsoft account, the same
// reason Google's equivalent is nested under an account id and this isn't.
accountsRouter.patch('/ms/calendars/:calendarId', (req, res) => {
  try {
    microsoftAuth.setCalendarEnabled(req.params.calendarId, Boolean(req.body?.enabled));
    broadcastCalendar();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

accountsRouter.delete('/accounts/:accountId', (req, res) => {
  googleAuth.removeAccount(req.params.accountId);
  dropAccountCache(req.params.accountId);
  broadcastCalendar();
  res.json({ ok: true });
});

// Toggling a calendar takes effect on the display immediately — no repoll
// needed, getCachedEvents() filters by the current enabled flags.
accountsRouter.patch('/accounts/:accountId/calendars/:calendarId', (req, res) => {
  try {
    googleAuth.setCalendarEnabled(req.params.accountId, req.params.calendarId, Boolean(req.body?.enabled));
    broadcastCalendar();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manual "check for new calendars on this account" — Google doesn't push
// calendar-list changes, so this is a deliberate refresh rather than
// something polled automatically.
accountsRouter.post('/accounts/:accountId/refresh', async (req, res) => {
  try {
    const calendars = await googleAuth.refreshCalendarList(req.params.accountId);
    const { changed } = await pollCalendar();
    if (changed) broadcastCalendar();
    res.json({ calendars });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manual "check for new/removed task lists on this Google account" -- same
// idea as the calendar refresh above. Also re-polls so the wall reflects it.
accountsRouter.post('/accounts/:accountId/task-lists/refresh', async (req, res) => {
  try {
    const taskLists = await refreshGoogleTaskLists(req.params.accountId);
    await pollGoogleTasks();
    broadcast({ type: 'todo', data: getCachedTasks() });
    res.json({ taskLists });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Choosing which Google task lists show on the wall. Turning one off hides
// it immediately (getCachedGoogleTasks() filters by the flag); turning one
// on fetches its tasks right away.
accountsRouter.patch('/accounts/:accountId/task-lists/:listId', async (req, res) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    setGoogleTaskListEnabled(req.params.accountId, req.params.listId, enabled);
    if (enabled) await pollGoogleTasks();
    broadcast({ type: 'todo', data: getCachedTasks() });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
