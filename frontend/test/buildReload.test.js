import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBuild, servedBuild } from '../src/utils/buildReload.js';

// Stamps the document the way the server does (see server/src/services/
// buildStamp.js), so these tests exercise the real read path rather than a
// mock of it.
function stampDocument(id) {
  const existing = document.querySelector('meta[name="wall-build"]');
  if (existing) existing.remove();
  if (id === null) return;
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'wall-build');
  meta.setAttribute('content', id);
  document.head.appendChild(meta);
}

afterEach(() => {
  stampDocument(null);
  sessionStorage.clear();
});

describe('servedBuild', () => {
  it('reads the build the server stamped into this document', () => {
    stampDocument('abc123');
    expect(servedBuild()).toBe('abc123');
  });

  it('is null on a page the server did not stamp', () => {
    // An older backend, or a Vite dev server. Callers must be able to tell
    // "not stamped" apart from a real id.
    expect(servedBuild()).toBeNull();
  });
});

describe('applyBuild', () => {
  it('reloads when the pushed build is not the one this page was served', () => {
    stampDocument('old');
    const reload = vi.fn();

    expect(applyBuild('new', { reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the pushed build is already ours', () => {
    // The message every display gets on connect, including the one that just
    // reloaded onto the current build -- the common case by far.
    stampDocument('same');
    const reload = vi.fn();

    expect(applyBuild('same', { reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing when the page cannot identify its own build', () => {
    // Dev server, or a backend older than the stamping. Reloading here would
    // be a loop with no way out, so an unknowing page never reloads.
    stampDocument(null);
    const reload = vi.fn();

    expect(applyBuild('new', { reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing when the server has no build to offer', () => {
    stampDocument('old');
    const reload = vi.fn();

    expect(applyBuild(null, { reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  // The load-bearing one. An unattended display that reloads itself forever
  // is worse than one that needs a human, so a second push of the same build
  // after a reload has to be refused.
  it('refuses to reload twice for the same build', () => {
    const reload = vi.fn();

    stampDocument('old');
    expect(applyBuild('new', { reload })).toBe(true);

    // Still the old page after the reload -- a proxy caching the HTML, or a
    // build that changed again mid-deploy.
    expect(applyBuild('new', { reload })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('survives the reload itself, which is what the guard is stored in', () => {
    // sessionStorage is the only state that outlives the reload, which is the
    // whole reason the guard lives there rather than in a module variable.
    stampDocument('old');
    applyBuild('new', { reload: vi.fn() });
    expect(sessionStorage.getItem('wall-build-reload-target')).toBe('new');
  });

  it('tries again once a genuinely newer build shows up', () => {
    const reload = vi.fn();

    stampDocument('old');
    applyBuild('new', { reload });
    stampDocument('new');
    applyBuild('newer', { reload });

    expect(reload).toHaveBeenCalledTimes(2);
  });
});