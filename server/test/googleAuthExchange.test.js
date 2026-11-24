import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readJson, writeJson } from '../src/store/fileStore.js';

// exchangeCode() is the one place a refresh token is minted, so it is also the
// only chance to record how long Google will honour it. Mocking googleapis
// keeps the exchange itself off the network while still driving the real
// persistence path (getAuthorizedClient's listener included).

const m = vi.hoisted(() => ({
  tokens: {},
  email: 'a@example.com',
  calendarItems: [],
}));

class FakeOAuth2 {
  constructor() {
    this.credentials = {};
    this.handlers = {};
  }
  generateAuthUrl() {
    return 'https://accounts.google.com/mock';
  }
  async getToken() {
    return { tokens: { ...m.tokens } };
  }
  setCredentials(credentials) {
    this.credentials = credentials;
  }
  on(event, handler) {
    this.handlers[event] = handler;
  }
}

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: FakeOAuth2 },
    oauth2: () => ({ userinfo: { get: async () => ({ data: { email: m.email } }) } }),
    calendar: () => ({
      calendarList: { list: async () => ({ data: { items: m.calendarItems } }) },
    }),
  },
}));

const { exchangeCode, listAccounts, markNeedsReauth } = await import('../src/auth/googleAuth.js');

const ACCOUNTS = 'googleAccounts.json';
const CREDENTIALS = 'apiCredentials.json';

function stored() {
  return readJson(ACCOUNTS, {});
}

beforeEach(() => {
  m.tokens = {};
  m.email = 'a@example.com';
  m.calendarItems = [];
  writeJson(CREDENTIALS, {
    google: [{ id: 'set', name: 'Home', clientId: 'client-id', clientSecret: 'client-secret' }],
  });
});

describe('recording a Google connection', () => {
  it('stores the deadline Google puts on a Testing-mode refresh token', async () => {
    m.tokens = { access_token: 'access', refresh_token: 'refresh', refresh_token_expires_in: 604799 };
    const before = Date.now();

    const accountId = await exchangeCode('code', 'set');

    expect(accountId).toBe('a_example_com');
    const account = stored()[accountId];
    expect(account.tokens.refresh_token).toBe('refresh');
    expect(account.refreshTokenExpiresAt).toBeGreaterThanOrEqual(before + 604799 * 1000);
    expect(account.refreshTokenExpiresAt).toBeLessThanOrEqual(Date.now() + 604799 * 1000);
    expect(listAccounts()[0].refreshTokenExpiresAt).toBe(account.refreshTokenExpiresAt);
  });

  it('stores no deadline for an In production app, which returns none', async () => {
    m.tokens = { access_token: 'access', refresh_token: 'refresh' };

    const accountId = await exchangeCode('code', 'set');

    expect(stored()[accountId].refreshTokenExpiresAt).toBeUndefined();
    expect(listAccounts()[0].refreshTokenExpiresAt).toBeNull();
  });

  it('is also the repair for an account that had stopped renewing', async () => {
    m.tokens = { access_token: 'access', refresh_token: 'refresh' };
    await exchangeCode('code', 'set');
    markNeedsReauth('a_example_com');
    expect(listAccounts()[0].needsReauth).toBe(true);

    m.tokens = { access_token: 'access-2', refresh_token: 'refresh-2' };
    await exchangeCode('code', 'set');

    const account = listAccounts()[0];
    expect(account.needsReauth).toBe(false);
    // A reconnect keeps the record rather than duplicating it, and replaces
    // the stale seven-day deadline with the new token's (here: none).
    expect(listAccounts()).toHaveLength(1);
    expect(account.refreshTokenExpiresAt).toBeNull();
    expect(stored().a_example_com.tokens.refresh_token).toBe('refresh-2');
  });

  it('refreshes the calendar list under the newly saved tokens', async () => {
    m.tokens = { access_token: 'access', refresh_token: 'refresh' };
    m.calendarItems = [{ id: 'cal', summary: 'Work', backgroundColor: '#111111', accessRole: 'owner' }];

    await exchangeCode('code', 'set');

    expect(stored().a_example_com.calendars).toEqual([
      { id: 'cal', summary: 'Work', backgroundColor: '#111111', accessLevel: 'owner', enabled: true },
    ]);
  });
});
