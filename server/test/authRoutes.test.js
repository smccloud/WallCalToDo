import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { authRouter } from '../src/routes/auth.js';

// The account-connect flow end to end from the server's side: every leg
// answers a browser navigation, so a refusal or a failure has to be a
// redirect back to the companion app with the reason -- never a JSON error
// page. Nothing here has credentials configured, which is exactly the case
// that makes each handler's error path reachable without a provider.

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') };
}

function reason(location) {
  return decodeURIComponent(location.split('authError=')[1] || '');
}

describe('start of an account connect', () => {
  it('sends an unconfigured Google start back to the companion app with the reason', async () => {
    const { status, location } = await get('/auth/google');
    expect(status).toBe(302);
    expect(location.startsWith('/companion?authError=')).toBe(true);
    expect(reason(location)).toMatch(/not configured/i);
  });

  it('does the same for Microsoft', async () => {
    const { status, location } = await get('/auth/microsoft');
    expect(status).toBe(302);
    expect(reason(location)).toMatch(/Microsoft OAuth is not configured/);
  });

  it('chooses a credential set from ?set= and reports the failure for that set', async () => {
    const { location } = await get('/auth/google?set=missing-set');
    expect(reason(location)).toMatch(/no longer exists/);
  });
});

describe('returning from a provider', () => {
  it('tags a failed Google callback and lands back on the companion app', async () => {
    const { status, location } = await get('/auth/google/callback?code=bogus&state=');
    expect(status).toBe(302);
    expect(location.startsWith('/companion?authError=')).toBe(true);
    expect(reason(location)).toMatch(/^Google auth failed:/);
  });

  it('tags a failed Microsoft callback the same way', async () => {
    const { status, location } = await get('/auth/microsoft/callback?code=bogus');
    expect(status).toBe(302);
    expect(reason(location)).toMatch(/^Microsoft auth failed:/);
  });
});

describe('the trusted-network guard', () => {
  // The guard is the router's own `use` middleware -- the one layer in the
  // stack with no route. Driven directly because loopback (the only address
  // a test client can legitimately come from) is trusted unconditionally, so
  // an untrusted request can't be produced over a real socket here.
  const guard = authRouter.stack.find((layer) => layer.route === undefined);

  function runGuard(remoteAddress) {
    const res = { redirect: vi.fn() };
    let nextCalled = false;
    guard.handle({ socket: { remoteAddress } }, res, () => {
      nextCalled = true;
    });
    return { nextCalled, location: res.redirect.mock.calls[0]?.[0] };
  }

  it('lets the Pi’s own screen through', () => {
    expect(runGuard('127.0.0.1').nextCalled).toBe(true);
    expect(runGuard('::1').nextCalled).toBe(true);
  });

  it('refuses an untrusted device with a redirect naming TRUSTED_CIDRS', () => {
    const { nextCalled, location } = runGuard('203.0.113.9');
    expect(nextCalled).toBe(false);
    expect(location.startsWith('/companion?authError=')).toBe(true);
    expect(reason(location)).toMatch(/TRUSTED_CIDRS/);
    expect(reason(location)).toContain('203.0.113.9');
  });

  it('refuses (without an address) when the socket has none', () => {
    const { nextCalled, location } = runGuard(undefined);
    expect(nextCalled).toBe(false);
    expect(reason(location)).toMatch(/isn't allowed from this device/);
  });
});
