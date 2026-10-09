import GoogleCredentialSets from './GoogleCredentialSets.jsx';

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
                <li key={cal.id} className="calendar-row">
               <span className="calendar-row__swatch" style={{ background: cal.backgroundColor || '#888' }} />
                   <span className="calendar-row__label">{`${cal.summary}${cal.accessLevel === 'reader' ? ' (shared)' : ''}`}</span>
                   {cal.accessLevel === 'owner' && (
                     <div className="color-picker-wrapper">
                       <span className="color-picker-label">Color: </span>
                       <div className="color-picker-preview"
                           style={{ background: cal.backgroundColor || '#58cc02' }} />
                       <input
                         type="color"
                         value={cal.backgroundColor}
                         onChange={(e) => onToggleCalendar(account.id, cal.id, e.target.value)}
                       />
                     </div>
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
              ))}
              {account.calendars.length === 0 && <li className="calendar-row calendar-row--empty">No calendars found.</li>}
            </ul>

            <h3>Google Tasks</h3>
            {!account.tasksAccess ? (
              <p className="banner">
                This account hasn't granted Tasks access yet. Disconnect it and add it again to enable Google Tasks.
              </p>
            ) : (
              <>
                <div className="account-card__actions">
                  <button
                    className="button button--ghost"
                    disabled={busyAccountId === account.id}
                    onClick={() => onRefreshTaskLists(account.id)}
                  >
                    Refresh task lists
                  </button>
                </div>
                <ul className="calendar-list">
                  {(account.taskLists || []).map((list) => (
                    <li key={list.id} className="calendar-row">
                      <span className="calendar-row__label">{list.title}</span>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={list.enabled}
                          onChange={(e) => onToggleTaskList(account.id, list.id, e.target.checked)}
                        />
                        <span className="switch__track" />
                      </label>
                    </li>
                  ))}
                  {(account.taskLists || []).length === 0 && (
                    <li className="calendar-row calendar-row--empty">No task lists yet. Press Refresh task lists.</li>
                  )}
                </ul>
              </>
            )}
          </section>
        ))}
      </div>

      {/* `!loading` on the blocked branch so it doesn't flash up while the
          page's first /accounts call — the one carrying canAddAccounts — is
          still in flight. Connection restrictions are already explained
          per credential set above (each set's "+ Add account" link is
          replaced by the reason it's missing); this note only covers "no
          credentials at all yet". */}
      {!configured && sets.length === 0 && (
        <p className="add-account-note">Add your Google API credentials above before connecting an account.</p>
      )}
    </>
  );
}
