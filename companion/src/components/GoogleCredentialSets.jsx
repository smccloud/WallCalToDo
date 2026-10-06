import { useState } from 'react';
import AddAccountNote from './AddAccountNote.jsx';

// The env-set id is a fixed reserved value defined on the server (see
// credentialsService.js's ENV_GOOGLE_SET_ID) — the companion app is a
// separate Vite build with nothing shared with it, so it's kept here as a
// local constant rather than importing across packages.
const ENV_SET_ID = 'env';

const GOOGLE_HELP_STEPS = [
  <>
    Go to the{' '}
    <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
      Google Cloud Console
    </a>{' '}
    and create a project (any name is fine).
  </>,
  <>
    <strong>APIs &amp; Services → Library</strong>, search "Google Calendar API", click <strong>Enable</strong>.
  </>,
  <>
    <strong>APIs &amp; Services → OAuth consent screen</strong>: choose <strong>External</strong>, fill in an app
    name and your email, save. Under <strong>Test users</strong>, add every Google account you plan to connect.
  </>,
  <>
    <strong>APIs &amp; Services → Credentials → Create Credentials → OAuth client ID</strong>. Application type:{' '}
    <strong>Web application</strong>.
  </>,
];

// The name + Client ID/Secret editor shown when adding a new credentials set
// or editing an existing one. `requireSecret` is true only for add: the
// secret is write-only on the server, so edits leave it blank to mean "keep
// the saved one" and the form can't pre-fill it (same reasoning as
// ApiCredentialsForm.jsx).
function CredentialForm({ initialName, initialClientId, requireSecret, saving, error, onSave, onCancel }) {
  const [name, setName] = useState(initialName || '');
  const [clientId, setClientId] = useState(initialClientId || '');
  const [clientSecret, setClientSecret] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    await onSave({
      name: name.trim(),
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
    });
  }

  const canSave = name.trim() && clientId.trim() && (!requireSecret || clientSecret.trim());

  return (
    <div className="api-credentials">
      <form className="api-credentials__form" onSubmit={handleSubmit}>
        <input type="text" placeholder="Name (e.g. Home)" aria-label="Name" value={name} disabled={saving} onChange={(e) => setName(e.target.value)} />
        <input type="text" placeholder="Client ID" value={clientId} disabled={saving} onChange={(e) => setClientId(e.target.value)} />
        <input
          type="password"
          placeholder={requireSecret ? 'Client Secret' : 'Client Secret (blank keeps the saved one)'}
          value={clientSecret}
          disabled={saving}
          onChange={(e) => setClientSecret(e.target.value)}
        />
        <div className="api-credentials__actions">
          <button type="submit" className="button button--primary" disabled={saving || !canSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="link-button" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
      {error && <p className="banner banner--error">{error}</p>}
    </div>
  );
}

// Google API credentials live as multiple *sets*: each is its own OAuth
// client (a Google app registration), and every connected account is tied to
// exactly one of them. This is the list + add/edit/delete UI for those sets;
// each set carries its own "connect a Google account" link, since a
// connection has to know which client it's authenticating against (see
// /auth/google?set=… on the server).
export default function GoogleCredentialSets({
  sets,
  redirectUri,
  canAddAccounts,
  clientAddress,
  onAdd,
  onUpdate,
  onDelete,
}) {
  const [mode, setMode] = useState(() => (sets.length === 0 ? 'add' : null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // canAddAccounts is null until the first /accounts response lands -- don't
  // flash "you can't add from here" before we actually know.
  const addAccessKnown = canAddAccounts !== null && canAddAccounts !== undefined;
  const canConnect = canAddAccounts === true;

  async function run(action) {
    setSaving(true);
    setError(null);
    try {
      await action();
      setMode(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleAdd(payload) {
    return run(() => onAdd(payload));
  }

  function handleUpdate(setId, payload) {
    return run(() => onUpdate(setId, payload));
  }

  function handleDelete(set) {
    if (!window.confirm(`Delete the "${set.name}" credentials set?`)) return;
    return run(() => onDelete(set.id));
  }

  const editingSet = mode !== 'add' && mode ? sets.find((set) => set.id === mode) : null;

  return (
    <div className="google-credential-sets">
      <div className="api-credentials api-credentials--list">
        <div className="api-credentials__header">
          <p className="settings-label section-label">Google API credentials</p>
          <button type="button" className="link-button" disabled={saving} onClick={() => setMode('add')}>
            + Add credentials set
          </button>
        </div>
        <p className="api-credentials__status">
          Each set is your own Google OAuth app. Accounts connected with it stay tied to it, so add a set per{" "}
          organisation whose calendars the wall shows.
        </p>

        <ul className="credential-sets">
          {sets.map((set) => (
            <li key={set.id} className="credential-set">
              <div className="credential-set__row">
                <div className="credential-set__info">
                  <span className="credential-set__name">{set.name}</span>
                  <span className="credential-set__clientid">Client ID ends in …{set.clientId.slice(-6)}</span>
                  {set.id === ENV_SET_ID && (
                    <span className="credential-set__source">Defined in server/.env — edit that file to change it.</span>
                  )}
                </div>
                <div className="credential-set__actions">
                  {canConnect ? (
                    <a className="button button--ghost" href={`/auth/google?set=${encodeURIComponent(set.id)}`}>
                      + Add account
                    </a>
                  ) : null}
                  {set.id !== ENV_SET_ID && (
                    <>
                      <button type="button" className="link-button" disabled={saving} onClick={() => setMode(set.id)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="link-button link-button--danger"
                        disabled={saving || set.inUseBy.length > 0}
                        title={
                          set.inUseBy.length > 0
                            ? `Still used by ${set.inUseBy.join(', ')} — disconnect those first`
                            : undefined
                        }
                        onClick={() => handleDelete(set)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              {set.id !== ENV_SET_ID && editingSet?.id === set.id && (
                <>
                  {/* Changing the Client ID is effectively deleting the set
                      for accounts already pinned to it: their tokens were
                      minted by the old client, so refreshes fail until they
                      reconnect under the new one. Say so before it matters. */}
                  {set.inUseBy.length > 0 && (
                    <p className="credential-set__inuse">
                      Changing the Client ID will require reconnecting {set.inUseBy.join(', ')}.
                    </p>
                  )}
                  <CredentialForm
                    initialName={set.name}
                    initialClientId={set.clientId}
                    saving={saving}
                    error={error}
                    onSave={(payload) => handleUpdate(set.id, payload)}
                    onCancel={() => setMode(null)}
                  />
                </>
              )}

              {set.inUseBy.length > 0 && (
                <p className="credential-set__inuse">
                  Connected to {set.inUseBy.join(', ')}.
                </p>
              )}

              {!canConnect && addAccessKnown && (
                <AddAccountNote what="Adding a Google account" clientAddress={clientAddress} inline />
              )}
            </li>
          ))}
        </ul>
      </div>

      {mode === 'add' && (
        <>
          <div className="api-credentials">
            <details className="api-credentials__help">
              <summary>Where do I get a new set?</summary>
              <ol>
                {GOOGLE_HELP_STEPS.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
                <li>
                  Under authorized redirect URIs, add exactly: <code>{redirectUri}</code> — this one, for every set.
                </li>
                <li>Copy the Client ID and Client Secret it gives you into the fields below.</li>
              </ol>
            </details>
          </div>
          <CredentialForm requireSecret saving={saving} error={error} onSave={handleAdd} onCancel={() => setMode(null)} />
        </>
      )}
    </div>
  );
}