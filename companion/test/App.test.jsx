import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../src/App.jsx';

// A smoke test that mounts the whole companion app. The point is to catch the
// class of bug that produced a blank white page: a handler referenced in the
// render (e.g. an `onDisconnectAccount={disconnectAccount}` whose function was
// deleted) throws a ReferenceError while rendering, which unmounts the whole
// tree and leaves the user staring at nothing. Rendering App with the API
// stubbed to its happy-path shape surfaces that as a test failure instead.

function json(body) {
  return { ok: true, status: 200, json: async () => body };
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url);
      if (path.includes('/accounts')) {
        return Promise.resolve(
          json({
            google: [],
            microsoft: { account: null, calendars: [], calendarAccess: 'not_connected' },
            authAccess: { canAddAccounts: false, clientAddress: '127.0.0.1' },
          })
        );
      }
      if (path.includes('/todo/lists')) {
        return Promise.resolve(json({ lists: [], account: null }));
      }
      if (path.includes('/credentials')) {
        return Promise.resolve(json({ google: { configured: false, sets: [] }, ms: { configured: false } }));
      }
      return Promise.resolve(json({}));
    })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  it('renders the page shell instead of blanking out', async () => {
    stubFetch();
    render(<App />);
    expect(await screen.findByText('WallCalToDo')).toBeTruthy();
    expect(await screen.findByText('General settings')).toBeTruthy();
    // The Google and Microsoft sections render even with nothing connected,
    // which is only reached if every callback they're handed was defined.
    expect(await screen.findByText('Google Calendar')).toBeTruthy();
    expect(await screen.findByText('Microsoft')).toBeTruthy();
  });
});
