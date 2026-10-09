import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname doesn't exist in an ES module -- see server/src/index.js for the
// same dance. Vitest supplies one, so this is the kind of mistake that only
// shows up when the server is actually started by node.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Identifies which build of the wall display's frontend is on disk, so a
// display that is already running can be told to go and get the new one.
//
// Why this exists: the display is a Pi with nothing plugged into it but a
// screen. Its browser loads a page once and then sits on it, so after a
// deploy the wall is running code that predates the deploy -- and the only
// way to load the new code is to reload the page, which is exactly the thing
// nobody can do at the wall. Worse, it fails silently and looks like a bug
// in whatever was just deployed: the companion app happily offers a setting
// for a feature the running page has never heard of, and flipping it does
// nothing. This module is the half that makes that impossible to miss.
//
// The id is a hash of the built index.html rather than of the source tree or
// of a timestamp. index.html is the one file Vite rewrites on every build
// (the asset filenames are hashed into it), so any change to the built
// JS or CSS changes it, and an unchanged build leaves it alone -- meaning no
// spurious reloads when someone rebuilds without changing anything.

const INDEX_PATH = path.join(__dirname, '..', '..', '..', 'frontend', 'dist', 'index.html');

// How often to look for a new build. Five seconds is fast enough that nobody
// notices the wall is briefly on the old build after a deploy, and slow
// enough to be invisible on a Pi.
//
// The check re-reads and re-hashes the file every tick rather than watching
// its mtime, which is both simpler and less surprising: a build swaps
// "index-abc.js" for "index-def.js" and leaves the file the same number of
// bytes, so an mtime check has to get its timing right to notice anything at
// all. Re-hashing a file this size a few hundred times a day costs nothing.
const POLL_MS = 5000;

// The stamp is injected as a meta tag rather than fetched over the API
// because it has to be in the document the page was served: the page's own
// build id is the only thing it can be compared against, and asking the API
// "what build is current" before the app has loaded would be one more thing
// that can fail on a display nobody is watching.
const META_TAG = /<meta\s+name="wall-build"\s+content="[^"]*"\s*\/?>/i;

// Vite writes the hashed assets first and index.html last, so a poll landing
// mid-build can catch a half-written file. Requiring the two markers that
// only exist in a complete document means a truncated read is ignored and
// the next tick picks up the finished file -- rather than broadcasting a
// hash of garbage and having every display reload onto a broken page.
function looksComplete(html) {
  return html.includes('<div id="root">') && html.includes('<script');
}

// The current build, or null when there is nothing to serve (dev mode, before
// the first build). Returns the stamped HTML ready to send, so the caller
// doesn't have to know how the tag is put in.
//
// indexPath is injectable purely so the tests can point this at a scratch
// file; production always uses the real one.
export function currentBuild(indexPath = INDEX_PATH) {
  let html;
  try {
    html = fs.readFileSync(indexPath, 'utf8');
  } catch {
    return null;
  }
  if (!looksComplete(html)) return null;

  const id = createHash('sha256').update(html).digest('hex').slice(0, 12);
  const stamped = META_TAG.test(html)
    ? html.replace(META_TAG, `<meta name="wall-build" content="${id}" />`)
    : html.replace('</head>', `    <meta name="wall-build" content="${id}" />\n  </head>`);
  return { id, html: stamped };
}

// Just the id, for the call sites that don't need the HTML.
export function currentBuildId(indexPath = INDEX_PATH) {
  return currentBuild(indexPath)?.id ?? null;
}

// Watches for a new build and calls onChange(id) when one appears.
//
// Calls onChange at most once per new id: a build that flaps between two
// states while someone is mid-`npm run build` would otherwise reload every
// display twice, and the first reload may land on the half-written build the
// second one is reacting to. Returns a stop function for tests and for a
// clean shutdown.
export function watchBuild(onChange, { indexPath = INDEX_PATH, pollMs = POLL_MS } = {}) {
  let lastId = currentBuildId(indexPath);

  const timer = setInterval(() => {
    const id = currentBuildId(indexPath);
    // Skips unchanged builds (every tick, normally) and half-written ones
    // (currentBuild returns null), so onChange only ever fires for a real,
    // complete build that isn't the one already reported.
    if (!id || id === lastId) return;
    lastId = id;
    onChange(id);
  }, pollMs);

  return () => clearInterval(timer);
}