import { google } from 'googleapis';
import { getAuthorizedClient, listAccounts } from '../auth/googleAuth.js';
import { readJson, writeJson } from '../store/fileStore.js';

const CACHE_FILE = 'googleTasksCache.json';
// Google has no delta feed for Tasks, so each poll re-lists everything.
// Completed tasks stay visible for a week, then drop off the wall (the
// Microsoft side clears them on Mondays; this is the rolling equivalent).
const COMPLETED_KEEP_MS = 7 * 86400000;

const loadCache = () => readJson(CACHE_FILE, {});
const saveCache = (cache) => writeJson(CACHE_FILE, cache);

const warnedAccounts = new Set();

// Google's `due` is a date at midnight UTC, so new Date(due) would land on
// the previous evening in US timezones. Re-read it as a local date.
function localDue(due) {
  return due ? `${due.slice(0, 10)}T00:00:00` : null;
}

function normalizeTask(task, accountId, listTitle) {
  return {
    id: `g:${accountId}:${task.id}`,
    title: task.title,
    completed: task.status === 'completed',
    completedAt: task.completed || null,
    due: localDue(task.due),
    importance: 'normal',
    listLabel: listTitle,
  };
}

// Returns null if this account's token has no Tasks permission yet
// (connected before the scope was added) -- it needs a reconnect.
async function fetchAccountTasks(account) {
  const auth = getAuthorizedClient(account.id);
  if (!auth.credentials.scope?.includes('auth/tasks')) {
    if (!warnedAccounts.has(account.id)) {
      warnedAccounts.add(account.id);
      console.error(`[google-tasks] ${account.email} has no Tasks permission yet -- disconnect and reconnect it.`);
    }
    return null;
  }

  const api = google.tasks({ version: 'v1', auth });
  const tasks = [];
  const { data: lists } = await api.tasklists.list({ maxResults: 100 });

  for (const list of lists.items || []) {
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
        if (task.title) tasks.push(normalizeTask(task, account.id, list.title));
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  }
  return tasks;
}

// Returns true if anything changed since the last poll.
export async function pollGoogleTasks() {
  const accounts = listAccounts();
  const cache = loadCache();
  let changed = false;

  // Drop cached tasks for accounts that were disconnected.
  const knownIds = new Set(accounts.map((a) => a.id));
  for (const id of Object.keys(cache)) {
    if (!knownIds.has(id)) { delete cache[id]; changed = true; }
  }

  for (const account of accounts) {
    try {
      const fresh = await fetchAccountTasks(account);
      if (fresh === null) continue;
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

export function getCachedGoogleTasks() {
  const cache = loadCache();
  const knownIds = new Set(listAccounts().map((a) => a.id));
  const cutoff = Date.now() - COMPLETED_KEEP_MS;
  const tasks = [];
  for (const [accountId, entries] of Object.entries(cache)) {
    if (!knownIds.has(accountId)) continue;
    for (const task of entries || []) {
      if (!task) continue;
      if (task.completed && task.completedAt && new Date(task.completedAt).getTime() < cutoff) continue;
      tasks.push(task);
    }
  }
  return tasks;
}
