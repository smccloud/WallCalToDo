import { CAN_ADD_ACCOUNTS } from '../constants.js';
import ApiCredentialsForm from './ApiCredentialsForm.jsx';

const MICROSOFT_HELP_STEPS = [
  <>
    Go to the{' '}
    <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade" target="_blank" rel="noreferrer">
      Azure Portal → App registrations → New registration
    </a>
    .
  </>,
  <>
    Under <strong>Redirect URI</strong>, choose platform <strong>Web</strong>.
  </>,
  <>
    <strong>Certificates &amp; secrets → New client secret</strong> — copy its value immediately, it's only shown
    once.
  </>,
  <>
    <strong>API permissions → Add a permission → Microsoft Graph → Delegated permissions</strong>, search for and
    add both <code>Tasks.Read</code> and <code>Calendars.Read</code> -- this section manages both from the same
    connected account.
  </>,
];

// Microsoft To Do + Calendar section: the credentials this deployment
// needs before it can connect an account, then the connected account's To
// Do lists and calendars (including ones shared with you) with enable
// toggles, plus connect/refresh/disconnect actions. Only ever one
// account, unlike Google's list of accounts.
export default function MicrosoftTodo({
  todoLists,
  todoLoading,
  todoBusy,
  msAccount,
  msCalendars,
  msCalendarsLoading,
  credentialsStatus,
  onSaveCredentials,
  onToggleTodoList,
  onToggleMsCalendar,
  onRefreshTodoLists,
  onDisconnectMsAccount,
}) {
  const configured = Boolean(credentialsStatus?.configured);

  return (
    <>
      <header className="page__header page__header--section page__header--sub">
        <h1>Microsoft To Do &amp; Calendar</h1>
        <p className="page__subtitle">
          Choose which lists and calendars show up on the display — including ones shared with you.
        </p>
      </header>

      {/* See the matching comment in GoogleAccounts.jsx -- not rendered
          until the real status has loaded, so it doesn't lock in a stale
          "expanded" state from a still-loading `undefined`. */}
      {credentialsStatus && (
        <ApiCredentialsForm
          providerLabel="Microsoft"
          redirectUri="http://localhost:3000/auth/microsoft/callback"
          helpSteps={MICROSOFT_HELP_STEPS}
          status={credentialsStatus}
          onSave={onSaveCredentials}
          withTenantId
        />
      )}

      {!todoLoading && !msAccount && (
        <p className="banner">No Microsoft account connected yet. Add one below to get started.</p>
      )}

      {msAccount && (
        <section className="account-card">
          <div className="account-card__header">
            <h2>{msAccount.email}</h2>
            <div className="account-card__actions">
              <button className="button button--ghost" disabled={todoBusy} onClick={onRefreshTodoLists}>
                Refresh
              </button>
              <button
                className="button button--danger"
                disabled={todoBusy}
                onClick={() => onDisconnectMsAccount(msAccount.email)}
              >
                Disconnect
              </button>
            </div>
          </div>

          <h3 className="account-card__subheading">Lists</h3>
          <ul className="calendar-list">
            {todoLists.map((list) => (
              <li key={list.id} className="calendar-row">
                <span className="calendar-row__label">{list.displayName}</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={list.enabled}
                    onChange={(e) => onToggleTodoList(list.id, e.target.checked)}
                  />
                  <span className="switch__track" />
                </label>
              </li>
            ))}
            {todoLists.length === 0 && <li className="calendar-row calendar-row--empty">No lists found.</li>}
          </ul>

          <h3 className="account-card__subheading">Calendars</h3>
          {msAccount.calendarScopeGranted === false && (
            // This account was connected before Microsoft Calendar
            // support existed (or the permission was later revoked) --
            // its token doesn't include Calendar access. There's no
            // separate "reconnect" action here either; "+ Connect
            // Microsoft account" below re-runs the consent screen for
            // this same account, same as Google's equivalent prompt in
            // GoogleAccounts.jsx.
            <p className="banner banner--warning">
              Microsoft Calendar needs an extra permission for this account. Use "+ Connect Microsoft account" below
              again to grant it.
            </p>
          )}
          {!msCalendarsLoading && (
            <ul className="calendar-list">
              {(msCalendars || []).map((cal) => (
                <li key={cal.id} className="calendar-row">
                  <span
                    className="calendar-row__swatch"
                    style={{ background: cal.hexColor ? `#${cal.hexColor.replace(/^#/, '')}` : '#888' }}
                  />
                  <span className="calendar-row__label">{cal.displayName}</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={cal.enabled}
                      onChange={(e) => onToggleMsCalendar(cal.id, e.target.checked)}
                    />
                    <span className="switch__track" />
                  </label>
                </li>
              ))}
              {(msCalendars || []).length === 0 && (
                <li className="calendar-row calendar-row--empty">No calendars found.</li>
              )}
            </ul>
          )}
        </section>
      )}

      {!configured ? (
        <p className="add-account-note">Enter your Microsoft API credentials above before connecting an account.</p>
      ) : CAN_ADD_ACCOUNTS ? (
        <a className="button button--primary add-account" href="/auth/microsoft">
          + Connect Microsoft account
        </a>
      ) : (
        <p className="add-account-note">
          You can only connect a new Microsoft account on the Pi's own screen — open{' '}
          <code>http://localhost:3000/companion</code> there.
        </p>
      )}
    </>
  );
}
