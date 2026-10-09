import GoogleCredentialSets from './GoogleCredentialSets.jsx';
import ColorWheel from './ColorWheel.jsx';

// Google Calendar section: the credential sets this deployment needs before
// it can connect any account at all (each is its own Google OAuth app, see
// GoogleCredentialSets.jsx), then per-account calendar lists with enable
// toggles, plus connect/refresh/disconnect actions.
export default function GoogleAccounts({
  accounts,
  loading,
  busyAccountId,
  googleCredentials,
  canAddAccounts,
  clientAddress,
  onAddGoogleSet,
  onUpdateGoogleSet,
  onDeleteGoogleSet,
  onToggleCalendar,
  onToggleTaskList,
  onRefreshTaskLists,
  onRefreshAccount,
  onDisconnectAccount,
}) {
  const configured = Boolean(googleCredentials?.configured);
  const sets = googleCredentials?.sets || [];

  return (
    <>
      <header className="page__header page__header--gap page__header--sub">
        <h1>Google Calendar</h1>
        <p className="page__subtitle">Manage which Google calendars show up on the display.</p>
      </header>

      {/* Not rendered until the real status has loaded — GoogleCredentialSets
          picks its initial add-form-open state from the set count only once,
          on mount, so mounting it early with a still-loading empty list
          would leave it stuck asking for credentials even once sets load. */}
      {googleCredentials && (
        <GoogleCredentialSets
          sets={sets}
          redirectUri={googleCredentials.redirectUri}
          canAddAccounts={canAddAccounts}
          clientAddress={clientAddress}
          onAdd={onAddGoogleSet}
          onUpdate={onUpdateGoogleSet}
          onDelete={onDeleteGoogleSet}
        />
      )}

      {loading && <p className="banner">Loading…</p>}

      {!loading && accounts.length === 0 && (
        <p className="banner">No Google accounts connected yet. Add one below to get started.</p>
      )}

      <div className="account-list">
        {accounts.map((account) => (
          <section key={account.id} className="account-card">
            <div className="account-card__header">
              <h2>{account.email}</h2>
              {/* Which of the deployment's credential sets this account's
                  tokens were minted under — the wall stays working if other
                  sets change, but this one can't be deleted until the
                  account is disconnected or reconnected elsewhere. */}
              <p className="account-card__meta">
                Connected with <strong>{account.credentialSet?.name || 'server/.env'}</strong>
              </p>
              <div className="account-card__actions">
                <button
                  className="button button--ghost"
                  disabled={busyAccountId === account.id}
                  onClick={() => onRefreshAccount(account.id)}
                >
                  Refresh calendars
                </button>
                <button
                  className="button button--danger"
                  disabled={busyAccountId === account.id}
                  onClick={() => onDisconnectAccount(account.id, account.email)}
                >
                  Disconnect
                </button>
              </div>
            </div>

            <ul className="calendar-list">
              {account.calendars.map((cal) => (
{
{ key={cal.id} className="calendar-row">
               <span className="calendar-row__swatch" style={{ background: cal.backgroundColor || '#888' }} />
                   <span className="calendar-row__label">{`${cal.summary}${cal.accessLevel === 'reader' ? ' (shared)' : ''}`}</span>
                   {cal.accessLevel === 'owner' && (
                      <ColorWheel
                        onChange={() => onToggleCalendar(account.id, cal.id)}
                      />
                    )}
                   <label className="switch">
                     <input
                       type="checkbox"
                       checked={cal.enabled}
                       disabled={cal.accessLevel !== 'owner'}
                       onChange={(e) => onToggleCalendar(account.id, cal.id, e.target.checked)}
                     />
                     <span className="switch__track" />
                   </label>
                 </li>
