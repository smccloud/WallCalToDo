import { google } from 'googleapis';
import { getAuthorizedClient, listAccounts } from '../auth/googleAuth.js';
import { getSettings } from './settingsService.js';
import { readJson, writeJson } from '../store/fileStore.js';

const CACHE_FILE = 'googleTasksCache.json';
const LISTS_FILE = 'googleTaskLists.json';
// Google has no delta feed for Tasks, so each poll re-lists everything in
// the enabled lists. Completed tasks stay visible for a week, then drop off
// the wall (the Microsoft side clears them on Mondays; this is the rolling
// equivalent).
const COMPLETED_KEEP_MS = 7 * 86400000;

const loadCache = () => readJson(CACHE_FILE, {});
const saveCache = (cache) => writeJson(CACHE_FILE, cache);
// { [accountId]: [{ id, title, enabled }] }
const loadLists = () => readJson(LISTS_FILE, {});
const saveLists = (lists) => writeJson(LISTS_FILE, lists);

const warnedAccounts = new Set();

// Google's `due` is a date at midnight UTC, so new Date(due) would land on
// the previous evening in US timezones. Re-read it as a local date.
function localDue(due) {
  return due ? `${due.slice(0, 10)}T00:00:00` : null;
}

function normalizeTask(task, accountId, list) {
  return {
    id: `g:${accountId}:${task.id}`,
    title: task.title,
    completed: task.status === 'completed',
    completedAt: task.completed || null,
    due: localDue(task.due),
    importance: 'normal',
    listLabel: list.title,
    listId: list.id,
  };
}

// False for accounts connected before the Tasks scope was added -- they
// need a disconnect/reconnect before Google will hand back any tasks.
export function hasTasksAccess(accountId) {
  try {
    return Boolean(getAuthorizedClient(accountId).credentials.scope?.includes('auth/tasks'));
  } catch {
    return false;
  }
}

// What the companion app reads: [{ id, title, enabled }].
export function getGoogleTaskLists(accountId) {
  return loadLists()[accountId] || [];
}

// Re-fetches this account's task lists from Google and merges them with the
// enabled/disabled state already saved -- newly discovered lists default to
// enabled, removed ones are dropped. Mirrors refreshCalendarList().
export async function refreshGoogleTaskLists(accountId) {
  if (!hasTasksAccess(accountId)) {
    throw new Error('This Google account has no Tasks permission yet -- disconnect and reconnect it.');
  }
  const api = google.tasks({ version: 'v1', auth: getAuthorizedClient(accountId) });
  const { data } = await api.tasklists.list({ maxResults: 100 });

  const all = loadLists();
  const existing = new Map((all[accountId] || []).map((l) => [l.id, l]));
  all[accountId] = (data.items || []).map((item) => ({
    id: item.id,
    title: item.title || item.id,
    enabled: existing.get(item.id)?.enabled ?? true,
  }));
  saveLists(all);
  return all[accountId];
}

export function setGoogleTaskListEnabled(accountId, listId, enabled) {
  const all = loadLists();
  const list = (all[accountId] || []).find((l) => l.id === listId);
  if (!list) throw new Error(`Unknown task list ${listId} for account ${accountId}`);
  list.enabled = enabled;
  saveLists(all);
}

async function fetchListTasks(api, accountId, list) {
  const tasks = [];
  let pageToken;
  do {
    const { data } = await api.tasks.list({
      tasklist: list.id,
      showCompleted: true,
      showHidden: false,
      maxResults: 100,
      pageToken,
    });
    for (const task of data.items || []) {
      if (task.title) tasks.push(normalizeTask(task, accountId, list));
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return tasks;
}

// Returns true if anything changed since the last poll.
export async function pollGoogleTasks() {
  const accounts = listAccounts();
  const cache = loadCache();
  const allLists = loadLists();
  let changed = false;

  // Drop cached tasks/lists for accounts that were disconnected.
  const knownIds = new Set(accounts.map((a) => a.id));
  for (const id of Object.keys(cache)) {
    if (!knownIds.has(id)) { delete cache[id]; changed = true; }
  }
  for (const id of Object.keys(allLists)) {
    if (!knownIds.has(id)) delete allLists[id];
  }
  saveLists(allLists);

  for (const account of accounts) {
    try {
      if (!hasTasksAccess(account.id)) {
        if (!warnedAccounts.has(account.id)) {
          warnedAccounts.add(account.id);
          console.error(`[google-tasks] ${account.email} has no Tasks permission yet -- disconnect and reconnect it.`);
        }
        continue;
      }

      // First time through: discover this account's lists. After that, new
      // lists only show up via the companion app's refresh button, so a list
      // you've chosen not to sync never sneaks back in.
      let lists = getGoogleTaskLists(account.id);
      if (lists.length === 0) lists = await refreshGoogleTaskLists(account.id);

      const api = google.tasks({ version: 'v1', auth: getAuthorizedClient(account.id) });
      const fresh = [];
      for (const list of lists.filter((l) => l.enabled)) {
        fresh.push(...(await fetchListTasks(api, account.id, list)));
      }
      if (JSON.stringify(cache[account.id]) !== JSON.stringify(fresh)) {
        cache[account.id] = fresh;
        changed = true;
      }
    } catch (err) {
      // Keep the last good cache for this account rather than wiping it.
      console.error(`[google-tasks] poll failed for ${account.email}:`, err.message);
    }
  }

  if (changed) saveCache(cache);
  return changed;
}

// Filtered by the current enabled flags at read time, so toggling a list off
// takes effect on the wall immediately without waiting for a poll. Skipped
// entirely while the display-wide Google on/off (see googleEnabled in
// settingsService.js) is off.
export function getCachedGoogleTasks() {
  if (!getSettings().googleEnabled) return [];
  const cache = loadCache();
  const lists = loadLists();
  const knownIds = new Set(listAccounts().map((a) => a.id));
  const cutoff = Date.now() - COMPLETED_KEEP_MS;
  const tasks = [];
  for (const [accountId, entries] of Object.entries(cache)) {
    if (!knownIds.has(accountId)) continue;
    const enabled = new Set((lists[accountId] || []).filter((l) => l.enabled).map((l) => l.id));
    for (const task of entries || []) {
      if (!task || !enabled.has(task.listId)) continue;
      if (task.completed && task.completedAt && new Date(task.completedAt).getTime() < cutoff) continue;
      tasks.push(task);
    }
  }
  return tasks;
}
