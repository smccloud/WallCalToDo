import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import GeneralSettings from './components/GeneralSettings.jsx';
import GoogleAccounts from './components/GoogleAccounts.jsx';
import Microsoft from './components/Microsoft.jsx';

// Same logic as frontend/src/App.jsx's effectiveTheme() — kept as its own
// copy here since the two apps are separate Vite builds with nothing
// shared between them. 'light'/'dark' settings are direct; 'auto'
// switches at sunrise/sunset for the saved location; falls back to 'light'
// (the companion app's own original, only-ever-shipped look) if settings
// haven't loaded yet or auto mode has no location/sun-times to go on.
function effectiveTheme(settings, now) {
  if (!settings) return 'light';
  if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
  if (!settings.sunrise || !settings.sunset) return 'light';
  const sunrise = new Date(settings.sunrise);
  const sunset = new Date(settings.sunset);
  return now >= sunrise && now < sunset ? 'light' : 'dark';
}

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyAccountId, setBusyAccountId] = useState(null);

  const [todoLists, setTodoLists] = useState([]);
  const [todoLoading, setTodoLoading] = useState(true);
  // One account supplies both halves of the Microsoft section, and the
  // credentials/toggles for both live behind /accounts, so the connected
  // account and its calendars are read from there rather than from
  // /todo/lists (which still reports the account, but only because the To
  // Do side has always needed to know who it's fetching for). `msBusy`
  // covers every action in the section — a single connection being the one
  // thing that state is about, so there's nothing to tell apart.
  const [msAccount, setMsAccount] = useState(null);
  const [msCalendars, setMsCalendars] = useState([]);
  // 'granted' | 'missing' | 'not_connected' -- whether the connected
  // account's token actually carries Calendars.Read. An account connected
  // before this feature existed has a perfectly valid token that was never
  // consented to it, so this is the server telling us to ask the user to
  // sign in again rather than the calendars list just coming back empty.
  const [msCalendarAccess, setMsCalendarAccess] = useState('not_connected');
  const [msBusy, setMsBusy] = useState(false);

  // Whether *this* device is allowed to run an account connect flow, as the
  // server decides it (see its trustedNetworks.js) rather than as this app
  // guesses from its own hostname: the answer is about the network the
  // request came in on, and either provider section has to act on it. Null
  // until /accounts has answered, so the sections show nothing about it in
  // the meantime instead of claiming it's not allowed.
  const [authAccess, setAuthAccess] = useState(null);

  const [credentials, setCredentials] = useState(null);
  // Separate from `error` below on purpose: `error` reflects live API call
  // failures and gets cleared to null the moment any of them next
  // succeeds (see loadSettings/loadAccounts/loadTodoLists), which raced
  // with and immediately wiped this out when it shared that same state --
  // this is a one-off notice about an OAuth attempt that already finished,
  // so it needs its own lifecycle, cleared only when the user dismisses it.
  const [authError, setAuthError] = useState(null);

  const [settings, setSettings] = useState(null);
  // Its own clock, same pattern as the kiosk display's App.jsx: only needs
  // to catch the sunrise/sunset boundary passing while this page happens to
  // be left open, not tick every second.
  const [now, setNow] = useState(() => new Date());
  const [settingsLoading, setSettingsLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    try {
      const data = await api('/settings');
      setSettings(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await api('/accounts');
      setAccounts(data.google);
      setMsAccount(data.microsoft.account);
      setMsCalendars(data.microsoft.calendars);
      setMsCalendarAccess(data.microsoft.calendarAccess);
      setAuthAccess(data.authAccess ?? null);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTodoLists = useCallback(async () => {
    try {
      setTodoLists((await api('/todo/lists')).lists);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setTodoLoading(false);
    }
  }, []);

  const loadCredentials = useCallback(async () => {
    try {
      setCredentials(await api('/credentials'));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
    loadTodoLists();
    loadSettings();
    loadCredentials();
  }, [loadAccounts, loadTodoLists, loadSettings, loadCredentials]);

  // The OAuth connect flow is a real page navigation through Google/
  // Microsoft's own consent screen (see routes/auth.js), not a fetch this
  // app makes itself -- if it fails before even getting there (credentials
  // not configured, request rejected), the server sends the browser back
  // here with the reason in the query string instead of a raw JSON error
  // page. Surface it once, then clean the URL so a refresh doesn't re-show
  // a stale error.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message = params.get('authError');
    if (message) {
      setAuthError(message);
      params.delete('authError');
      const query = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Credentials are editable from any device on the network, but this page
  // has no live connection to the server (the WebSocket push is the kiosk
  // display's, not this app's), so a tab left open on the Pi would otherwise
  // sit on whatever it loaded at page load indefinitely -- save a Microsoft
  // tenant ID from a laptop, and the Pi's own companion tab keeps reporting
  // the old one until someone reloads it by hand. Re-read on a slow interval
  // and again whenever this tab is actually being looked at, which covers
  // both "left open in the background" and "just walked over to the Pi".
  //
  // Only the credentials here, not the other panels: these have no optimistic
  // state to disturb, so a refresh landing mid-edit can't visibly undo
  // anything the user is doing. loadAccounts/loadTodoLists/settings do have
  // that (see the optimistic toggles), where a poll arriving while a PATCH
  // is in flight would visibly flip the control back until the write landed.
  useEffect(() => {
    const refresh = () => loadCredentials();
    const refreshIfVisible = () => {
      if (!document.hidden) refresh();
    };
    const timer = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadCredentials]);

  // Matches the companion app's own look to whatever theme is actually
  // active on the wall display -- switching Light/Dark/Automatic here
  // updates `settings` immediately (see patchSetting below), which this
  // picks straight up.
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme(settings, now);
  }, [settings, now]);

  // Single implementation shared by every plain settings field below
  // (theme, sunrise/sunset offsets, advanced toggle, privacy mode):
  // optimistic local update so the control feels instant, then a PATCH
  // reconciled against whatever the server actually saved, or rolled back
  // via a fresh loadSettings() if the request fails.
  async function patchSetting(patch) {
    setSettings((prev) => ({ ...prev, ...patch }));
    try {
      const data = await api('/settings', { method: 'PATCH', body: JSON.stringify(patch) });
      setSettings(data);
    } catch (err) {
      setError(err.message);
      loadSettings();
    }
  }

  const setTheme = (theme) => patchSetting({ theme });
  // key is 'sunriseOffset' or 'sunsetOffset'.
  const setOffset = (key, offset) => patchSetting({ [key]: offset });
  // A real on/off for whether sunriseOffset/sunsetOffset apply at all, not
  // just a local show/hide -- off means the theme switches exactly at the
  // real sunrise/sunset regardless of what's saved, on reapplies the saved
  // values without needing to re-enter them.
  const setAdvancedEnabled = (enabled) => patchSetting({ advancedEnabled: enabled });
  // On the wall display: strips event titles down to just their colored
  // pills, and swaps the today-agenda and to-do list contents for a
  // placeholder notice -- their headings stay so the display still reads
  // as "there's a calendar/to-do here", just not what's on it.
  const setPrivacyMode = (enabled) => patchSetting({ privacyMode: enabled });
  // 'F' or 'C' -- which unit the temperature display uses.
  const setTempUnit = (tempUnit) => patchSetting({ tempUnit });
  // Wind speed and precipitation units, same idea. The reading itself is
  // cached in km/h and mm; these only pick what the wall prints (see
  // frontend/src/utils/units.js for the conversions themselves).
  const setWindUnit = (windUnit) => patchSetting({ windUnit });
  const setPrecipUnit = (precipUnit) => patchSetting({ precipUnit });
  // How often the full-screen weather view takes over the display, in
  // minutes, and how long it holds it in seconds. 0 minutes means it never
  // appears; the wall works out which window it's in from the clock (see
  // isWeatherTime in the frontend's App.jsx), so nothing is sent to displays
  // beyond the settings themselves.
  const setWeatherInterval = (weatherIntervalMinutes) => patchSetting({ weatherIntervalMinutes });
  const setWeatherDuration = (weatherDurationSeconds) => patchSetting({ weatherDurationSeconds });

  // Unlike the settings above, a location save isn't optimistic (there's no
  // sensible "local" value to show before the server geocodes/validates
  // it) and never throws -- LocationSettings owns the busy-state around
  // this call itself.
  async function saveLocation(lat, lon, label) {
    try {
      const location = label ? { lat, lon, label } : { lat, lon };
      const data = await api('/settings', { method: 'PATCH', body: JSON.stringify({ location }) });
      setSettings(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  // provider is 'ms' ('google' isn't a single set on the PUT route anymore —
  // Google's multiple credential sets have their own add/update/delete API,
  // see addGoogleSet/updateGoogleSet/deleteGoogleSet below). `extra` is the
  // form's optional Microsoft tenant ID, merged straight into the request
  // body. Throws on failure so ApiCredentialsForm can show the error inline
  // next to the fields instead of it going to the shared banner above the
  // account list.
  async function saveCredentials(provider, { clientId, clientSecret }, extra) {
    const data = await api(`/credentials/${provider}`, {
      method: 'PUT',
      body: JSON.stringify({ clientId, clientSecret, ...extra }),
    });
    setCredentials(data);
  }

  // Google credential sets (each its own OAuth client, see
  // GoogleCredentialSets.jsx). All three return the full status, same as
  // saveCredentials, so setCredentials stays in one shape.
  async function addGoogleSet(payload) {
    setCredentials(await api('/credentials/google', { method: 'POST', body: JSON.stringify(payload) }));
  }

  async function updateGoogleSet(setId, payload) {
    setCredentials(await api(`/credentials/google/${setId}`, { method: 'PUT', body: JSON.stringify(payload) }));
  }

  async function deleteGoogleSet(setId) {
    setCredentials(await api(`/credentials/google/${setId}`, { method: 'DELETE' }));
  }

  async function toggleCalendar(accountId, calendarId, enabled) {
    // Optimistic update so the switch feels instant; reconciled by the
    // next loadAccounts() if the request fails.
    setAccounts((prev) =>
      prev.map((account) =>
        account.id !== accountId
          ? account
          : {
              ...account,
              calendars: account.calendars.map((cal) => (cal.id === calendarId ? { ...cal, enabled } : cal)),
            }
      )
    );
    try {
      await api(`/accounts/${accountId}/calendars/${encodeURIComponent(calendarId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
    } catch (err) {
      setError(err.message);
      loadAccounts();
    }
  }

  async function refreshAccount(accountId) {
    setBusyAccountId(accountId);
    try {
      await api(`/accounts/${accountId}/refresh`, { method: 'POST' });
      await loadAccounts();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAccountId(null);
    }
  }

  // Which of an account's Google task lists show on the wall. Same
  // optimistic pattern as toggleCalendar.
  async function toggleTaskList(accountId, listId, enabled) {
    setAccounts((prev) =>
      prev.map((account) =>
        account.id !== accountId
          ? account
          : {
              ...account,
              taskLists: (account.taskLists || []).map((list) => (list.id === listId ? { ...list, enabled } : list)),
            }
      )
    );
    try {
      await api(`/accounts/${accountId}/task-lists/${encodeURIComponent(listId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
    } catch (err) {
      setError(err.message);
      loadAccounts();
    }
  }

  // Google doesn't push task-list changes, so this is how a newly created
  // list shows up (it defaults to enabled).
  async function refreshTaskLists(accountId) {
    setBusyAccountId(accountId);
    try {
      await api(`/accounts/${accountId}/task-lists/refresh`, { method: 'POST' });
      await loadAccounts();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAccountId(null);
    }
  }

  async function disconnectAccount(accountId, email) {
    if (!window.confirm(`Disconnect ${email}? Its events will disappear from the display.`)) return;
    setBusyAccountId(accountId);
    try {
      await api(`/accounts/${accountId}`, { method: 'DELETE' });
      await loadAccounts();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAccountId(null);
    }
  }

  async function toggleTodoList(listId, enabled) {
    // Optimistic update so the switch feels instant; reconciled by the
    // next loadTodoLists() if the request fails.
    setTodoLists((prev) => prev.map((list) => (list.id === listId ? { ...list, enabled } : list)));
    try {
      await api(`/todo/lists/${encodeURIComponent(listId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
    } catch (err) {
      setError(err.message);
      loadTodoLists();
    }
  }

  // Same optimistic-update-then-reconcile as the Google toggles above. No
  // account id in the path, since Microsoft's side is always the one
  // connected account -- the same reason the server nests Google's toggles
  // under one and this one isn't.
  async function toggleMsCalendar(calendarId, enabled) {
    setMsCalendars((prev) => prev.map((cal) => (cal.id === calendarId ? { ...cal, enabled } : cal)));
    try {
      await api(`/ms/calendars/${encodeURIComponent(calendarId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
    } catch (err) {
      setError(err.message);
      loadAccounts();
    }
  }

  // Microsoft doesn't push calendar or list changes either, so these are how
  // a newly-shared calendar or list (e.g. one your spouse just shared with
  // you) shows up without waiting for a reconnect.
  async function refreshTodoLists() {
    setMsBusy(true);
    try {
      await api('/todo/refresh', { method: 'POST' });
      await loadTodoLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setMsBusy(false);
    }
  }

  async function refreshMsCalendars() {
    setMsBusy(true);
    try {
      await api('/ms/calendars/refresh', { method: 'POST' });
      await loadAccounts();
    } catch (err) {
      setError(err.message);
    } finally {
      setMsBusy(false);
    }
  }

  async function disconnectMsAccount(email) {
    if (!window.confirm(`Disconnect ${email}? Its events and to-do items will disappear from the display.`)) return;
    setMsBusy(true);
    try {
      // Both halves share one sign-in, so this is a single route for both --
      // leaving to-do items behind after disconnecting would just be a way to
      // end up with a display showing one half of a disconnected account.
      await api('/ms/account', { method: 'DELETE' });
      await loadAccounts();
      await loadTodoLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setMsBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page__header page__header--main">
        {/* import.meta.env.BASE_URL, not a hardcoded "/" -- this app is
            served at /companion/ in production (see vite.config.js's
            base), and unlike index.html's own <link> tags, Vite doesn't
            rewrite a plain runtime string here to add that prefix. */}
        <img src={`${import.meta.env.BASE_URL}icon-180.png`} alt="" className="page__logo" />
        <h1>WallCalToDo</h1>
      </header>

      <header className="page__header page__header--sub">
        <h1>General settings</h1>
      </header>

      {/* Top-level, not tucked inside whichever section triggered it --
          errors here can come from Google, Microsoft, or settings, so a
          single spot at the top is the only one guaranteed to be visible
          regardless of which one it was. */}
      {error && <p className="banner banner--error">{error}</p>}

      {/* A failed OAuth redirect (see the authError effect above) --
          dismissible, since unlike `error` above nothing else clears it
          automatically. */}
      {authError && (
        <p className="banner banner--error">
          {authError}{' '}
          <button type="button" className="link-button banner__dismiss" onClick={() => setAuthError(null)}>
            Dismiss
          </button>
        </p>
      )}

      <GeneralSettings
        settings={settings}
        settingsLoading={settingsLoading}
        onSetPrivacyMode={setPrivacyMode}
        onSetTheme={setTheme}
        onSetAdvancedEnabled={setAdvancedEnabled}
        onSetOffset={setOffset}
        onSetTempUnit={setTempUnit}
        onSetWindUnit={setWindUnit}
        onSetPrecipUnit={setPrecipUnit}
        onSetWeatherInterval={setWeatherInterval}
        onSetWeatherDuration={setWeatherDuration}
        onSaveLocation={saveLocation}
        onError={setError}
      />

      <GoogleAccounts
        accounts={accounts}
        loading={loading}
        busyAccountId={busyAccountId}
        googleCredentials={credentials?.google}
        canAddAccounts={authAccess?.canAddAccounts}
        clientAddress={authAccess?.clientAddress}
        onAddGoogleSet={addGoogleSet}
        onUpdateGoogleSet={updateGoogleSet}
        onDeleteGoogleSet={deleteGoogleSet}
        onToggleCalendar={toggleCalendar}
        onRefreshAccount={refreshAccount}
        onToggleTaskList={toggleTaskList}
        onRefreshTaskLists={refreshTaskLists}
        onDisconnectAccount={disconnectAccount}
      />

      <Microsoft
        account={msAccount}
        calendars={msCalendars}
        calendarAccess={msCalendarAccess}
        todoLists={todoLists}
        loading={loading || todoLoading}
        busy={msBusy}
        credentialsStatus={credentials?.ms}
        canAddAccounts={authAccess?.canAddAccounts}
        clientAddress={authAccess?.clientAddress}
        onSaveCredentials={(creds, extra) => saveCredentials('ms', creds, extra)}
        onToggleCalendar={toggleMsCalendar}
        onRefreshCalendars={refreshMsCalendars}
        onToggleTodoList={toggleTodoList}
        onRefreshTodoLists={refreshTodoLists}
        onDisconnect={disconnectMsAccount}
      />
    </div>
  );
}
