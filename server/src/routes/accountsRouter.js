import { Router } from 'express';
import * as googleAuth from '../auth/googleAuth.js';
import * as microsoftAuth from '../auth/microsoftAuth.js';
import { pollCalendar as pollGoogleCalendar, dropAccountCache } from '../services/calendarService.js';
import { dropListCache, dropAllListsCache } from '../services/todoService.js';
import {
  pollTasks as pollGoogleTasks,
  dropListCache as dropGoogleTaskListCache,
  dropAccountCache as dropGoogleTasksAccountCache,
} from '../services/googleTasksService.js';
import { getMergedTasks } from '../services/todoAggregator.js';
import {
  pollCalendar as pollMicrosoftCalendar,
  dropCalendarCache as dropMsCalendarCache,
  dropAllCalendarsCache as dropAllMsCalendarsCache,
} from '../services/microsoftCalendarService.js';
import { getMergedEvents } from '../services/calendarAggregator.js';
import { broadcast } from '../ws/hub.js';

export const accountsRouter = Router();

accountsRouter.get('/accounts', (req, res) => {
  res.json({ google: googleAuth.listAccounts() });
});

accountsRouter.get('/todo/lists', async (req, res) => {
  res.json({ lists: microsoftAuth.listTodoLists(), account: await microsoftAuth.getConnectedAccount() });
});

// Only one Microsoft account is ever connected at a time, so this doesn't
// need an :accountId param the way Google's DELETE /accounts/:id does.
// Disconnecting removes both its To Do lists and its calendars -- both
// caches need dropping, and since Calendar's cache is emptied too,
// `calendar` needs rebroadcasting here alongside `todo`.
accountsRouter.delete('/todo/account', async (req, res) => {
  try {
    await microsoftAuth.disconnectAccount();
    dropAllListsCache();
    dropAllMsCalendarsCache();
    broadcast({ type: 'todo', data: getMergedTasks() });
    broadcast({ type: 'calendar', data: getMergedEvents() });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Toggling a list takes effect immediately — no repoll needed,
// getMergedTasks() filters by each provider's current enabled flags.
accountsRouter.patch('/todo/lists/:listId', (req, res) => {
  try {
    microsoftAuth.setTodoListEnabled(req.params.listId, Boolean(req.body?.enabled));
    broadcast({ type: 'todo', data: getMergedTasks() });
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
    broadcast({ type: 'todo', data: getMergedTasks() });
    res.json({ lists });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Removing a Google account removes both its calendars and its task
// lists — both caches need dropping, and since a removed task list can
// change what's on the to-do side, `todo` needs rebroadcasting here too,
// not just `calendar`.
accountsRouter.delete('/accounts/:accountId', (req, res) => {
  googleAuth.removeAccount(req.params.accountId);
  dropAccountCache(req.params.accountId);
  dropGoogleTasksAccountCache(req.params.accountId);
  broadcast({ type: 'calendar', data: getMergedEvents() });
  broadcast({ type: 'todo', data: getMergedTasks() });
  res.json({ ok: true });
});

// Toggling a calendar takes effect on the display immediately — no repoll
// needed, getMergedEvents() filters by each provider's current enabled
// flags.
accountsRouter.patch('/accounts/:accountId/calendars/:calendarId', (req, res) => {
  try {
    googleAuth.setCalendarEnabled(req.params.accountId, req.params.calendarId, Boolean(req.body?.enabled));
    broadcast({ type: 'calendar', data: getMergedEvents() });
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
    const { changed } = await pollGoogleCalendar();
    if (changed) broadcast({ type: 'calendar', data: getMergedEvents() });
    res.json({ calendars });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Toggling a Google task list takes effect immediately — no repoll
// needed, getMergedTasks() filters by each provider's current enabled
// flags, mirroring the Microsoft /todo/lists/:listId PATCH above.
accountsRouter.patch('/accounts/:accountId/tasklists/:listId', (req, res) => {
  try {
    googleAuth.setTaskListEnabled(req.params.accountId, req.params.listId, Boolean(req.body?.enabled));
    broadcast({ type: 'todo', data: getMergedTasks() });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manual "check for new/removed task lists on this account" — Google
// doesn't push task-list changes any more than it does calendar-list
// changes, so this mirrors both the calendar refresh above and
// Microsoft's /todo/refresh: pick up newly-created lists, drop cached
// data for any that disappeared, then actually poll so a newly-enabled
// list has tasks to show immediately rather than waiting for the next
// scheduled poll.
accountsRouter.post('/accounts/:accountId/tasklists/refresh', async (req, res) => {
  try {
    const before = new Set(
      (googleAuth.listAccounts().find((a) => a.id === req.params.accountId)?.tasklists || []).map((l) => l.id)
    );
    const tasklists = await googleAuth.refreshTaskList(req.params.accountId);
    for (const id of before) {
      if (!tasklists.some((list) => list.id === id)) dropGoogleTaskListCache(req.params.accountId, id);
    }
    const { changed } = await pollGoogleTasks();
    if (changed) broadcast({ type: 'todo', data: getMergedTasks() });
    res.json({ tasklists });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /ms/calendars, not GET /todo/calendars -- this is a calendar
// concept, not a To Do one, even though it's the same connected account
// as /todo/lists. Scope-status (calendarScopeGranted) already comes back
// on the /todo/lists account field, since getConnectedAccount() is shared
// by both sections -- no separate account fetch needed here.
accountsRouter.get('/ms/calendars', (req, res) => {
  res.json({ calendars: microsoftAuth.listCalendars() });
});

// Mirrors the Google tasklist PATCH above -- toggling takes effect
// immediately via getMergedEvents()'s read-time filtering, no repoll.
accountsRouter.patch('/ms/calendars/:calendarId', (req, res) => {
  try {
    microsoftAuth.setCalendarEnabled(req.params.calendarId, Boolean(req.body?.enabled));
    broadcast({ type: 'calendar', data: getMergedEvents() });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mirrors the Google tasklist refresh above: pick up newly-created
// calendars, drop cached events for any that disappeared, then actually
// poll so a newly-enabled calendar has events to show immediately.
accountsRouter.post('/ms/calendars/refresh', async (req, res) => {
  try {
    const before = new Set(microsoftAuth.listCalendars().map((cal) => cal.id));
    const calendars = await microsoftAuth.refreshCalendars();
    for (const id of before) {
      if (!calendars.some((cal) => cal.id === id)) dropMsCalendarCache(id);
    }
    const { changed } = await pollMicrosoftCalendar();
    if (changed) broadcast({ type: 'calendar', data: getMergedEvents() });
    res.json({ calendars });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
