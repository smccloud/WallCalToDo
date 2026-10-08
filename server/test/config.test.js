import { afterEach, describe, expect, it, vi } from 'vitest';

// config.js reads process.env at import time, so every case below reloads the
// module after setting (or clearing) the vars it looks at.

const KEYS = [
  'PORT',
  'POLL_INTERVAL_MS',
  'TRUSTED_CIDRS',
  'LOG_MS_CALENDAR_ROUNDS',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'MS_CLIENT_ID',
  'MS_CLIENT_SECRET',
  'MS_TENANT_ID',
  'MS_REDIRECT_URI',
];

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

async function loadConfig(env = {}) {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, env);
  vi.resetModules();
  return import('../src/config.js');
}

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe('config', () => {
  it('falls back to the documented defaults with no .env at all', async () => {
    const { config, DEFAULT_MS_TENANT_ID } = await loadConfig();
    expect(config.port).toBe(3000);
    expect(config.pollIntervalMs).toBe(60000);
    expect(config.trustedCidrs).toBe('');
    expect(config.logMsCalendarRounds).toBe(false);
    expect(DEFAULT_MS_TENANT_ID).toBe('common');
    expect(config.ms.tenantId).toBe('common');
  });

  it('points both OAuth callbacks at localhost:3000 by default', async () => {
    const { config } = await loadConfig();
    expect(config.google.redirectUri).toBe('http://localhost:3000/auth/google/callback');
    expect(config.ms.redirectUri).toBe('http://localhost:3000/auth/microsoft/callback');
  });

  it('reads port, poll interval and trusted networks from the environment', async () => {
    const { config } = await loadConfig({
      PORT: '8080',
      POLL_INTERVAL_MS: '5000',
      TRUSTED_CIDRS: '192.168.1.0/24,10.0.0.7',
    });
    expect(config.port).toBe(8080);
    expect(config.pollIntervalMs).toBe(5000);
    expect(config.trustedCidrs).toBe('192.168.1.0/24,10.0.0.7');
  });

  it('only enables the Microsoft round tally for LOG_MS_CALENDAR_ROUNDS=1', async () => {
    expect((await loadConfig({ LOG_MS_CALENDAR_ROUNDS: '1' })).config.logMsCalendarRounds).toBe(true);
    expect((await loadConfig({ LOG_MS_CALENDAR_ROUNDS: '0' })).config.logMsCalendarRounds).toBe(false);
    expect((await loadConfig()).config.logMsCalendarRounds).toBe(false);
  });

  it('exposes the .env credential pairs verbatim when set', async () => {
    const { config } = await loadConfig({
      GOOGLE_CLIENT_ID: 'g-id',
      GOOGLE_CLIENT_SECRET: 'g-secret',
      MS_CLIENT_ID: 'm-id',
      MS_CLIENT_SECRET: 'm-secret',
      MS_TENANT_ID: 'contoso.onmicrosoft.com',
    });
    expect(config.google).toMatchObject({ clientId: 'g-id', clientSecret: 'g-secret' });
    expect(config.ms).toMatchObject({
      clientId: 'm-id',
      clientSecret: 'm-secret',
      tenantId: 'contoso.onmicrosoft.com',
    });
  });

  it('honours overridden redirect URIs for a reverse proxy', async () => {
    const { config } = await loadConfig({
      GOOGLE_REDIRECT_URI: 'https://wall.example/auth/google/callback',
      MS_REDIRECT_URI: 'https://wall.example/auth/microsoft/callback',
    });
    expect(config.google.redirectUri).toBe('https://wall.example/auth/google/callback');
    expect(config.ms.redirectUri).toBe('https://wall.example/auth/microsoft/callback');
  });
});
