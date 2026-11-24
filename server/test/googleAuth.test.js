import fs from 'fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { dataPath } from './setup.js';
import { readJson, writeJson } from '../src/store/fileStore.js';
import {
  getAuthorizedClient,
  listAccounts,
  markNeedsReauth,
  resetClient,
} from '../src/auth/googleAuth.js';

// The account record is the only durable thing between a Google connection
// and the next poll, so these cover the two states that used to be handled by
// deleting it: a refresh token Google has refused (needsReauth) and the
// deadline Google puts on one issued by an app that is still in Testing.

const ACCOUNTS = 'googleAccounts.json';
const CREDENTIALS = 'apiCredentials.json';

function seedAccount(extra = {}) {
  writeJson(ACCOUNTS, {
    acct: {
      id: 'acct',
      email: 'a@example.com',
      credentialSetId: 'set',
      tokens: { access_token: 'old', refresh_token: 'refresh-1' },
      calendars: [
        { id: 'cal', summary: 'Work', backgroundColor: '#123456', enabled: false, customColor: '#abcdef' },
      ],
      ...extra,
    },
  });
}

beforeEach(() => {
  resetClient();
  writeJson(CREDENTIALS, {
    google: [{ id: 'set', name: 'Home', clientId: 'client-id', clientSecret: 'client-secret' }],
  });
  seedAccount();
});

describe('an account whose refresh token Google refused', () => {
  it('is flagged instead of deleted, keeping its calendars and settings', () => {
    markNeedsReauth('acct');

    const [account] = listAccounts();
    expect(account.needsReauth).toBe(true);
    // The whole point of not deleting: a reconnect restores this record
    // whole, colors and enabled flags included.
    expect(account.calendars).toEqual([
      { id: 'cal', summary: 'Work', backgroundColor: '#123456', enabled: false, customColor: '#abcdef', accessLevel: 'owner', color: '#abcdef' },
    ]);
  });

  it('does not hand out an OAuth client that would only fail again', () => {
    markNeedsReauth('acct');
    expect(() => getAuthorizedClient('acct')).toThrow(/reconnect/i);
  });

  it('is idempotent — repeated polls must not rewrite the record', () => {
    markNeedsReauth('acct');
    const before = fs.statSync(dataPath(ACCOUNTS)).mtimeMs;
    markNeedsReauth('acct');
    expect(fs.statSync(dataPath(ACCOUNTS)).mtimeMs).toBe(before);
  });

  it('ignores an unknown account rather than creating one', () => {
    markNeedsReauth('nope');
    expect(readJson(ACCOUNTS, {}).nope).toBeUndefined();
  });
});

describe('the refresh token deadline Google reports', () => {
  // Google puts `refresh_token_expires_in` on the token response while the
  // OAuth app is in Testing; a refresh repeats it, and a rotated token with
  // no lifetime means the replacement has none. The listener is exercised
  // directly — no network is involved in persisting what it hands back.
  function emitTokens(tokens) {
    getAuthorizedClient('acct').emit('tokens', {
      access_token: 'new',
      expiry_date: Date.now() + 3600_000,
      ...tokens,
    });
  }

  it('is stored as an absolute timestamp when one is reported', () => {
    const before = Date.now();
    emitTokens({ refresh_token_expires_in: 604799 });

    const stored = readJson(ACCOUNTS, {}).acct;
    expect(stored.refreshTokenExpiresAt).toBeGreaterThanOrEqual(before + 604799 * 1000);
    expect(stored.refreshTokenExpiresAt).toBeLessThanOrEqual(Date.now() + 604799 * 1000);
    // The renewal itself still has to have been persisted alongside it.
    expect(stored.tokens.access_token).toBe('new');
    expect(stored.tokens.refresh_token).toBe('refresh-1');
  });

  it('is dropped when Google rotates in a token with no lifetime', () => {
    seedAccount({ refreshTokenExpiresAt: Date.now() + 7 * 86400_000 });
    emitTokens({ refresh_token: 'refresh-2' });

    const stored = readJson(ACCOUNTS, {}).acct;
    expect(stored.refreshTokenExpiresAt).toBeUndefined();
    expect(stored.tokens.refresh_token).toBe('refresh-2');
  });

  it('survives a renewal that neither rotates the token nor repeats the deadline', () => {
    seedAccount({ refreshTokenExpiresAt: 1234567890 });
    emitTokens({});

    expect(readJson(ACCOUNTS, {}).acct.refreshTokenExpiresAt).toBe(1234567890);
  });

  it('is reported to the companion app, and absent when there is none', () => {
    seedAccount({ refreshTokenExpiresAt: 1234567890 });
    expect(listAccounts()[0]).toMatchObject({
      needsReauth: false,
      refreshTokenExpiresAt: 1234567890,
    });

    seedAccount();
    expect(listAccounts()[0]).toMatchObject({ needsReauth: false, refreshTokenExpiresAt: null });
  });
});
