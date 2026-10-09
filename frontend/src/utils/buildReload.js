// Reloads the wall display when the code it was served is no longer the code
// on disk.
//
// The problem this solves: this display is a Pi with nothing plugged into it
// but a screen, so its browser loads a page once and then sits on it. Deploy
// new frontend code and the wall keeps running the old build -- and it fails
// silently, looking like a bug in whatever was just deployed. The companion
// app will happily offer a setting for a feature this page has never heard
// of, and flipping it does nothing, because this page is running code from
// before that feature existed. The only cure is a reload, which is exactly
// the thing nobody can do at the wall.
//
// So the server stamps a build id into the HTML it serves, pushes the current
// one over the WebSocket, and this compares the two.

// Kept in sync with buildStamp.js on the server. Reading it rather than
// fetching it is the point: the page has to know which build *it* is, and
// asking the server what build is current before the app has loaded would be
// one more thing that can fail on a display nobody is watching.
const META_SELECTOR = 'meta[name="wall-build"]';

// Which build this tab last reloaded *to get*. sessionStorage rather than a
// module variable because a reload throws away all module state, and this is
// the one piece of state that has to survive exactly that moment -- it is
// what stops the reload loop below.
const RELOAD_TARGET_KEY = 'wall-build-reload-target';

// The build this page was served, or null if the page wasn't stamped (an
// older server, or a dev server). Null means "don't know", and this module
// does nothing when it doesn't know -- a display must never reload itself in
// a loop because it can't identify itself.
export function servedBuild() {
  return document.querySelector(META_SELECTOR)?.content ?? null;
}

// Decides what to do about a build id pushed over the WebSocket, and reloads
// if it isn't ours.
//
// Returns whether it reloaded, so callers and tests can tell the difference
// between "reloaded onto the new build" and "ignored a stale or unknown id".
//
// The reload function is a parameter rather than a direct
// window.location.reload() call because the real one throws in jsdom and
// navigates for real in a browser -- tests need to be able to watch for it
// without leaving the page.
export function applyBuild(id, { reload = () => window.location.reload() } = {}) {
  const mine = servedBuild();
  // An unidentifiable page, or a server with no build to offer (dev mode):
  // nothing to act on, and reloading here would be an infinite loop.
  if (!id || !mine || id === mine) return false;

  // Already tried for this exact build and are still seeing the old page --
  // which means the reload didn't actually get us the new code (a proxy
  // caching the HTML, a build that changed again mid-deploy). Refusing to
  // try again is the whole point: an unattended display that reloads itself
  // forever is worse than one that needs a human.
  if (sessionStorage.getItem(RELOAD_TARGET_KEY) === id) return false;

  sessionStorage.setItem(RELOAD_TARGET_KEY, id);
  reload();
  return true;
}