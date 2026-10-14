import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { accountsRouter } from '../src/routes/accounts.js';
import { settingsRouter } from '../src/routes/settings.js';
import { credentialsRouter } from '../src/routes/credentials.js';

// The companion API's state-changing routes must refuse an untrusted client
// (CWE-862), while reads stay open so the display and companion app keep
// working over the home network. The routers are mounted for real; a request
// header fakes the socket address, since a test client can only reach the
// server over loopback (which is trusted unconditionally).
vi.mock('../src/services/poller.js', () => ({
  pollWeatherNow: vi.fn(),
  pollLunchNow: vi.fn(),
}));
vi.mock('../src/services/lunchService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchSchools: vi.fn(async () => []),
    fetchLines: vi.fn(async () => []),
    discoverDistricts: vi.fn(async () => ({ place: null, groups: [] })),
    getCachedLunch: vi.fn(() => null),
  };
});

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Only present on requests that want to pretend to be remote; a real socket
  // address otherwise stays 127.0.0.1, which is trusted -- so each test picks
  // whether it's calling from the Pi's own screen or a foreign network.
  app.use((req, res, next) => {
    const fake = req.headers['x-test-address'];
    if (fake) Object.defineProperty(req, 'socket', { value: { remoteAddress: fake }, configurable: true });
    next();
  });
  app.use('/api', settingsRouter);
  app.use('/api', accountsRouter);
  app.use('/api', credentialsRouter);

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function api(path, { address, ...options } = {}) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...(address ? { 'x-test-address': address } : {}) },
    ...options,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const FOREIGN = '203.0.113.9';

describe('read-only requests from an untrusted network', () => {
  it('still answer', async () => {
    expect((await api('/settings', { address: FOREIGN })).status).toBe(200);
    expect((await api('/accounts', { address: FOREIGN })).status).toBe(200);
    expect((await api('/credentials', { address: FOREIGN })).status).toBe(200);
  });
});

describe('changes from an untrusted network', () => {
  // One entry per state-changing route across the three routers. Listing them
  // all (rather than a sample) is the point: the guard is mounted per router,
  // so a route added later that somehow escapes it -- or a router that loses
  // its `router.use(requireTrusted)` -- shows up here instead of shipping a
  // CWE-862 hole that nothing else would notice.
  it.each([
    // settings
    ['PATCH', '/settings', { body: JSON.stringify({ theme: 'light' }) }],
    // credentials
    ['PUT', '/credentials/ms', { body: JSON.stringify({ clientId: 'x', clientSecret: 'y' }) }],
    ['POST', '/credentials/google', { body: JSON.stringify({ clientId: 'x', clientSecret: 'y' }) }],
    ['PUT', '/credentials/google/abc', { body: JSON.stringify({ name: 'n' }) }],
    ['DELETE', '/credentials/google/abc', {}],
    // accounts — Microsoft
    ['DELETE', '/ms/account', {}],
    ['PATCH', '/todo/lists/abc', { body: JSON.stringify({ enabled: false }) }],
    ['POST', '/todo/refresh', {}],
    ['POST', '/ms/calendars/refresh', {}],
    ['PATCH', '/ms/calendars/abc', { body: JSON.stringify({ enabled: false }) }],
    ['PATCH', '/ms/calendars/abc/color', { body: JSON.stringify({ color: '#fff' }) }],
    // accounts — Google
    ['DELETE', '/accounts/abc', {}],
    ['PATCH', '/accounts/abc/calendars/def', { body: JSON.stringify({ enabled: false }) }],
    ['PATCH', '/accounts/abc/calendars/def/color', { body: JSON.stringify({ background: '#fff' }) }],
    ['POST', '/accounts/abc/refresh', {}],
    ['POST', '/accounts/abc/task-lists/refresh', {}],
    ['PATCH', '/accounts/abc/task-lists/def', { body: JSON.stringify({ enabled: false }) }],
  ])('are refused with a 403 (%s %s)', async (method, path, options) => {
    const { status, body } = await api(path, { address: FOREIGN, method, ...options });
    expect(status).toBe(403);
    expect(body.error).toMatch(/TRUSTED_CIDRS/);
    expect(body.error).toContain(FOREIGN);
  });
});

describe('changes from a trusted network', () => {
  it('go through', async () => {
    const { status, body } = await api('/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'light' }),
    });
    expect(status).toBe(200);
    expect(body.theme).toBe('light');
  });
});
