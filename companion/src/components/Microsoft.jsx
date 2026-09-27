import { CAN_ADD_ACCOUNTS } from '../constants.js';
import ApiCredentialsForm from './ApiCredentialsForm.jsx';

// Both delegated Graph permissions this section needs, in one walkthrough —
// calendars and to-do lists come off the same sign-in, so the app
// registration needs both before either half can connect.
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
    add <code>Tasks.Read</code> and <code>Calendars.Read</code>.
  </>,
];

// The Entra tenant the sign-in page points at, as an optional third field on
// the credentials form. Blank means "any Microsoft account" -- the server
// falls back to server/.env's MS_TENANT_ID and then to Microsoft's multi-
// tenant "common" endpoint, which is what a personal account needs since it
// has no directory of its own. A tenant ID only matters if sign-ins should
// be restricted to one organization's directory, which is why this is an
// optional afterthought to the walkthrough above rather than one of its steps.
const MICROSOFT_OPTIONAL_FIELD = {
  name: 'tenantId',
  label: 'Tenant ID',
  summaryLabel: 'Tenant',
  placeholder: 'Tenant ID (optional)',
  hint: (
    <>
      <strong>Tenant ID is optional</strong> — leave it blank to accept any Microsoft account, which is the default. Set
      it only to limit sign-ins to your own organization's directory, using the <strong>Directory (tenant) ID</strong>{' '}
      from the app's <strong>Overview</strong> page.
    </>
  ),
};

// Microsoft section: the credentials this deployment needs before it can
// connect at all, then the one connected account with its calendars *and*
// its To Do lists, each with enable toggles, plus connect/refresh/disconnect
// actions. One sign-in covers both halves — the same Client ID/Secret and
// the same Microsoft account — so they're presented as two labelled groups
// under one account card rather than as the two separate sections this
// replaced.
export default function Microsoft({
  account,
  calendars,
  calendarAccess,
  todoLists,
  loading,
  busy,
  credentialsStatus,
  onSaveCredentials,
  onToggleCalendar,
  onRefreshCalendars,
  onToggleTodoList,
  onRefreshTodoLists,
  onDisconnect,
}) {
  const configured = Boolean(credentialsStatus?.configured);
  const connected = Boolean(account);
  // An account that connected before this app asked for Calendars.Read holds
  // a token that was never consented to it. Nothing is broken — the to-do
  // half works exactly as before — but the calendar half can't be fetched
  // until the user signs in again and Microsoft's consent screen offers the
  // new permission, so say that instead of showing an empty calendar list.
  const needsCalendarAccess = connected && calendarAccess === 'missing';

  return (
    <>
      <header className="page__header page__header--section page__header--sub">
        <h1>Microsoft</h1>
        <p className="page__subtitle">
          One Microsoft account supplies both calendars and to-do lists — including ones shared with you.
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
          optionalField={MICROSOFT_OPTIONAL_FIELD}
          onSave={onSaveCredentials}
        />
      )}

      {needsCalendarAccess && (
        <p className="banner banner--warning">
          This account was connected before calendar access was requested, so its calendars can't be read yet — its to-do
          lists still work. Sign in again to grant it.{' '}
          {CAN_ADD_ACCOUNTS ? (
            <a href="/auth/microsoft">Reconnect</a>
          ) : (
            <span>
              Reconnect from the Pi's own screen (<code>http://localhost:3000/companion</code>).
            </span>
          )}
        </p>
      )}

      {!loading && !connected && (
        <p className="banner">No Microsoft account connected yet. Add one below to get started.</p>
      )}

      {connected && (
        <section className="account-card">
          <div className="account-card__header">
            <h2>{account.email}</h2>
            <div className="account-card__actions">
              <button className="button button--ghost" disabled={busy} onClick={onRefreshCalendars}>
                Refresh calendars
              </button>
              <button className="button button--ghost" disabled={busy} onClick={onRefreshTodoLists}>
                Refresh lists
              </button>
              <button className="button button--danger" disabled={busy} onClick={() => onDisconnect(account.email)}>
                Disconnect
              </button>
            </div>
          </div>

          <p className="account-card__label">Calendars</p>
          <ul className="calendar-list">
            {calendars.map((cal) => (
              <li key={cal.id} className="calendar-row">
                {/* Same swatch the wall display's legend will use for this
                    calendar — the server resolves Graph's color-theme name to
                    one hex and sends it as displayColor (see
                    microsoftAuth.js), rather than each app picking its own. */}
                <span className="calendar-row__swatch" style={{ background: cal.displayColor || '#888' }} />
                <span className="calendar-row__label">{cal.name}</span>
                <label className="switch">
                  <input type="checkbox" checked={cal.enabled} onChange={(e) => onToggleCalendar(cal.id, e.target.checked)} />
                  <span className="switch__track" />
                </label>
              </li>
            ))}
            {calendars.length === 0 && (
              <li className="calendar-row calendar-row--empty">
                {needsCalendarAccess ? 'Calendars unavailable until this account is reconnected.' : 'No calendars found.'}
              </li>
            )}
          </ul>

          <p className="account-card__label">To&nbsp;Do lists</p>
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
        </section>
      )}

      {configured && !connected && CAN_ADD_ACCOUNTS && (
        <a className="button button--primary add-account" href="/auth/microsoft">
          + Connect Microsoft account
        </a>
      )}
      {!configured && (
        <p className="add-account-note">Enter your Microsoft API credentials above before connecting an account.</p>
      )}
      {configured && !CAN_ADD_ACCOUNTS && (
        <p className="add-account-note">
          You can only connect a new Microsoft account on the Pi's own screen — open{' '}
          <code>http://localhost:3000/companion</code> there.
        </p>
      )}
    </>
  );
}
