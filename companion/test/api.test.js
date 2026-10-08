import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api.js';

// One wrapper underlies every request the companion app makes, so this is
// where the "/api" prefix, the JSON headers, and the try/catch contract
// callers rely on are pinned down.

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('prefixes /api and parses the JSON back out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ theme: 'dark' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/settings')).resolves.toEqual({ theme: 'dark' });
    expect(fetchMock).toHaveBeenCalledWith('/api/settings', {
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('passes request options through alongside the JSON headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/settings', { method: 'PUT', body: JSON.stringify({ theme: 'dark' }) });

    expect(fetchMock).toHaveBeenCalledWith('/api/settings', {
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
      body: JSON.stringify({ theme: 'dark' }),
    });
  });

  it('throws the error message the server sent, so callers can just catch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'Bad location' }, { ok: false, status: 400 })));

    await expect(api('/settings')).rejects.toThrow('Bad location');
  });

  it('falls back to the status line when the body carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, { ok: false, status: 500 })));

    await expect(api('/settings')).rejects.toThrow('Request failed (500)');
  });

  it('falls back to the status line when the body is not JSON at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError('not json');
        },
      })
    );

    await expect(api('/settings')).rejects.toThrow('Request failed (502)');
  });

  it('lets a network failure through as itself', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(api('/settings')).rejects.toThrow('Failed to fetch');
  });
});
