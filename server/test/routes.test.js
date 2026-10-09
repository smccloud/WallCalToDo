import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeJson } from '../src/store/fileStore.js';
import { apiRouter } from '../src/routes/api.js';
import { accountsRouter } from '../src/routes/accounts.js';
import { settingsRouter } from '../src/routes/settings.js';
import { credentialsRouter } from '../src/routes/credentials.js';

// The real routers, running against an empty temp data dir (see setup.js) so
// every GET is the "nothing connected/cached yet" baseline and every PATCH/
// POST exercises validation without touching real state. broadcast() and
// broadcastCalendar() are no-ops here because ws/hub's wss is still null
// (no initWebSocket call), so nothing leaks timers or sockets.

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  app.use('/api', accountsRouter);
  app.use('/api', settingsRouter);
  app.use('/api', credentialsRouter);

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function api(path, options) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('GET /api/status', () => {
  it('reports nothing connected on a fresh install', async () => {
    const { status, body } = await api('/status');
    expect(status).toBe(200);
    expect(body.googleConnected).toBe(false);
    expect(body.microsoftConnected).toBe(false);
    // Which build of the display this backend is serving -- null when there
    // is no built frontend to serve (the case in a test run), a 12-char id
    // otherwise. Asserted by shape rather than toEqual'd against a literal
    // so that adding a field to /status later doesn't read as a behaviour
    // change in this test.
    expect(body.build ?? 'none').toMatch(/^(none|[0-9a-f]{12})$/);
  });
});

describe('GET /api/calendar and /api/todo', () => {
  it('returns empty feeds before any cache exists', async () => {
    const calendar = await api('/calendar');
    expect(calendar.status).toBe(200);
    expect(calendar.body).toEqual([]);

    const todo = await api('/todo');
    expect(todo.status).toBe(200);
    expect(todo.body).toEqual([]);
  });
});

describe('GET /api/accounts', () => {
  it('shows no accounts and loopback auth access', async () => {
    const { status, body } = await api('/accounts');
    expect(status).toBe(200);
    expect(body.google).toEqual([]);
    expect(body.microsoft.account).toBeNull();
    expect(body.microsoft.calendarAccess).toBe('not_connected');
    expect(body.microsoft.calendars).toEqual([]);
    expect(body.authAccess.canAddAccounts).toBe(true);
    expect(typeof body.authAccess.clientAddress).toBe('string');
  });
});

describe('GET /api/settings', () => {
  it('returns defaults with no sunrise/sunset', async () => {
    const { status, body } = await api('/settings');
    expect(status).toBe(200);
    expect(body.theme).toBe('dark');
    expect(body.location).toBeNull();
    expect(body.sunrise).toBeNull();
    expect(body.sunset).toBeNull();
    expect(body.sunriseTomorrow).toBeNull();
    expect(body.sunsetTomorrow).toBeNull();
  });
});

describe('PATCH /api/settings', () => {
  it('applies a valid patch and echoes the merged settings', async () => {
    const { status, body } = await api('/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'light', tempUnit: 'C', timeFormat: '24', clockShowSeconds: false }),
    });
    expect(status).toBe(200);
    expect(body.theme).toBe('light');
    expect(body.tempUnit).toBe('C');
    expect(body.timeFormat).toBe('24');
    expect(body.clockShowSeconds).toBe(false);
    expect(body.privacyMode).toBe(false); // others untouched
  });

  it('clears a saved location when patched to null', async () => {
    // Seed a location through the store directly (a PATCH of a real location
    // would fire a live weather poll — see settings.js — which is not this
    // test's concern).
    writeJson('settings.json', { location: { lat: 40.71, lon: -74.0 } });
    const { body: withLocation } = await api('/settings');
    expect(withLocation.location).toEqual({ lat: 40.71, lon: -74.0 });
    expect(Number.isFinite(Date.parse(withLocation.sunrise))).toBe(true);
    expect(Number.isFinite(Date.parse(withLocation.sunset))).toBe(true);

    await api('/settings', { method: 'PATCH', body: JSON.stringify({ location: null }) });
    const { body: cleared } = await api('/settings');
    expect(cleared.location).toBeNull();
    expect(cleared.sunrise).toBeNull();
  });

  it.each([
    [{ theme: 'neon' }, 'Invalid theme'],
    [{ tempUnit: 'K' }, 'Invalid tempUnit'],
    [{ windUnit: 'furlongs' }, 'Invalid windUnit'],
    [{ precipUnit: 'bugs' }, 'Invalid precipUnit'],
    [{ timeFormat: '3' }, 'Invalid timeFormat'],
    [{ clockShowSeconds: 'yes' }, 'Invalid clockShowSeconds'],
    [{ clockShowSeconds: 1 }, 'Invalid clockShowSeconds'],
    [{ clockFlashDivider: 'yes' }, 'Invalid clockFlashDivider'],
    [{ clockFlashDivider: 0 }, 'Invalid clockFlashDivider'],
    [{ privacyMode: 'yes' }, 'Invalid privacyMode'],
    [{ advancedEnabled: 1 }, 'Invalid advancedEnabled'],
    [{ weatherEnabled: 'yes' }, 'Invalid weatherEnabled'],
    [{ weatherEnabled: 1 }, 'Invalid weatherEnabled'],
    [{ location: {} }, 'Invalid location'],
    [{ location: { lat: 'x', lon: 0 } }, 'Invalid location'],
    [{ sunriseOffset: { minutes: 7, direction: 'before' } }, 'Invalid sunriseOffset'],
    [{ sunriseOffset: { minutes: 30, direction: 'sideways' } }, 'Invalid sunriseOffset'],
    [{ weatherIntervalMinutes: 17 }, 'Invalid weatherIntervalMinutes'],
    [{ weatherDurationSeconds: 999 }, 'Invalid weatherDurationSeconds'],
    [{ weatherHourlyHours: 0 }, 'Invalid weatherHourlyHours'],
    [{ weatherHourlyHours: 25 }, 'Invalid weatherHourlyHours'],
    [{ weatherHourlyHours: -1 }, 'Invalid weatherHourlyHours'],
    // A fractional count would slice an array at a non-integer and show
    // something nobody asked for, so it is rejected rather than rounded.
    [{ weatherHourlyHours: 6.5 }, 'Invalid weatherHourlyHours'],
    [{ weatherHourlyHours: '12' }, 'Invalid weatherHourlyHours'],
    [{ weatherHourlyHours: null }, 'Invalid weatherHourlyHours'],
    [{ weatherDailyDays: 4 }, 'Invalid weatherDailyDays'],
    [{ weatherDailyDays: 11 }, 'Invalid weatherDailyDays'],
    [{ weatherDailyDays: 7.5 }, 'Invalid weatherDailyDays'],
    [{ weatherDailyDays: '7' }, 'Invalid weatherDailyDays'],
  ])('rejects %j with %s', async (patch, message) => {
    const { status, body } = await api('/settings', { method: 'PATCH', body: JSON.stringify(patch) });
    expect(status).toBe(400);
    expect(body.error).toBe(message);
  });

  it('accepts every valid offset and weather value', async () => {
    const { status } = await api('/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        advancedEnabled: true,
        sunriseOffset: { minutes: 120, direction: 'after' },
        sunsetOffset: { minutes: 15, direction: 'after' },
        weatherIntervalMinutes: 360,
        weatherDurationSeconds: 30,
      }),
    });
    expect(status).toBe(200);
  });
});

describe('geocode endpoints', () => {
  it('returns an empty result list for a blank query', async () => {
    const { status, body } = await api('/geocode?q=');
    expect(status).toBe(200);
    expect(body).toEqual({ results: [] });
  });

  it('rejects a missing/invalid reverse-geocode position', async () => {
    const missing = await api('/geocode/reverse');
    expect(missing.status).toBe(400);

    const invalid = await api('/geocode/reverse?lat=abc&lon=def');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('Invalid lat/lon');
  });
});

describe('credentials endpoints', () => {
  it('GET returns the fresh-install status shape', async () => {
    const { status, body } = await api('/credentials');
    expect(status).toBe(200);
    expect(body.google.sets).toEqual([]);
    expect(body.google.configured).toBe(false);
    expect(body.ms.configured).toBe(false);
    expect(body.google.redirectUri).toMatch(/^http/);
    expect(body.ms.redirectUri).toMatch(/^http/);
  });

  it('PUT /credentials/ms stores a tenant URL and clears the MSAL cache', async () => {
    const { status, body } = await api('/credentials/ms', {
      method: 'PUT',
      body: JSON.stringify({
        clientId: 'api-ms-id',
        clientSecret: 'api-ms-secret',
        tenantId: 'https://login.microsoftonline.com/api-tenant',
      }),
    });
    expect(status).toBe(200);
    expect(body.ms.configured).toBe(true);
    expect(body.ms.clientId).toBe('api-ms-id');
    expect(body.ms.tenantId).toBe('api-tenant');
  });

  it('rejects a PUT for google with a pointer to the new routes', async () => {
    const { status, body } = await api('/credentials/google', {
      method: 'PUT',
      body: JSON.stringify({ clientId: 'x', clientSecret: 'y' }),
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/\/credentials\/google/);
  });

  it('rejects a PUT with a missing client id or secret', async () => {
    const missingId = await api('/credentials/ms', {
      method: 'PUT',
      body: JSON.stringify({ clientSecret: 'only-secret' }),
    });
    expect(missingId.status).toBe(400);

    const missingSecret = await api('/credentials/ms', {
      method: 'PUT',
      body: JSON.stringify({ clientId: 'only-id' }),
    });
    expect(missingSecret.status).toBe(400);
    expect(missingSecret.body.error).toMatch(/both required/i);
  });

  it('adds, edits, and deletes a Google credential set', async () => {
    const created = await api('/credentials/google', {
      method: 'POST',
      body: JSON.stringify({ name: 'API Org', clientId: 'cid', clientSecret: 'csec' }),
    });
    expect(created.status).toBe(201);
    const setId = created.body.google.sets[0].id;
    expect(created.body.google.sets[0]).toMatchObject({ name: 'API Org', clientId: 'cid', configured: true });

    const edited = await api(`/credentials/google/${setId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'API Org 2' }),
    });
    expect(edited.status).toBe(200);
    expect(edited.body.google.sets[0].name).toBe('API Org 2');

    const deleted = await api(`/credentials/google/${setId}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(deleted.body.google.sets).toEqual([]);
  });

  it('rejects a duplicate Google add when the secret is missing', async () => {
    const { status, body } = await api('/credentials/google', {
      method: 'POST',
      body: JSON.stringify({ name: 'Broken', clientId: 'cid' }),
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/both required/i);
  });
});

describe('misbehaved accounts calls', () => {
  it('PATCH an unknown todo list returns 400', async () => {
    const { status, body } = await api('/todo/lists/nope', { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
    expect(status).toBe(400);
    expect(body.error).toMatch(/unknown/i);
  });

  it('POST /todo/refresh returns 400 while Microsoft is unconfigured', async () => {
    const { status } = await api('/todo/refresh', { method: 'POST' });
    expect(status).toBe(400);
  });

  it('POST /ms/calendars/refresh returns 400 while Microsoft is unconfigured', async () => {
    const { status } = await api('/ms/calendars/refresh', { method: 'POST' });
    expect(status).toBe(400);
  });
});