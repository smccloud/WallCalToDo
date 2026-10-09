import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentBuild, currentBuildId, watchBuild } from '../src/services/buildStamp.js';

// The real module reads frontend/dist/index.html, which exists in this repo
// but is a build artifact nobody editing a test should depend on. Every test
// here points it at a scratch file instead.
const COMPLETE = `<!doctype html>
<html><head><title>WallCalToDo</title></head>
<body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body></html>`;

let indexPath;

beforeEach(() => {
  vi.useFakeTimers();
  indexPath = path.join(fs.mkdtempSync(path.join(process.env.WALLCAL_DATA_DIR, 'build-')), 'index.html');
});

afterEach(() => {
  vi.useRealTimers();
});

function write(html) {
  fs.writeFileSync(indexPath, html);
}

describe('currentBuild', () => {
  it('stamps a build id into the HTML it hands back', () => {
    write(COMPLETE);
    const build = currentBuild(indexPath);

    expect(build.html).toContain(`<meta name="wall-build" content="${build.id}" />`);
    // Everything else survives: a stamp that dropped the script tag would
    // reload displays onto a page with no app on it.
    expect(build.html).toContain('/assets/index-abc.js');
    expect(build.html).toContain('<div id="root">');
  });

  it('gives the same id for the same build, and a different one for a different build', () => {
    write(COMPLETE);
    const first = currentBuildId(indexPath);
    expect(currentBuildId(indexPath)).toBe(first);

    // Vite rewrites the hashed asset filename on any real change, so this is
    // what a new build actually looks like.
    write(COMPLETE.replace('index-abc.js', 'index-def.js'));
    expect(currentBuildId(indexPath)).not.toBe(first);
  });

  it('does not stamp the same id twice over a file that already has one', () => {
    // Defensive: a hand-edited dist/index.html that kept a stamp shouldn't
    // end up with two of them, which would leave the page reading whichever
    // the browser happened to pick first.
    write(COMPLETE);
    const stamped = currentBuild(indexPath).html;
    fs.writeFileSync(indexPath, stamped);

    const again = currentBuild(indexPath).html;
    expect(again.match(/name="wall-build"/g)).toHaveLength(1);
  });

  it('is null when there is no build to serve', () => {
    expect(currentBuild(indexPath)).toBeNull(); // no file at all
  });

  it('ignores a half-written index.html rather than hashing it', () => {
    // Vite writes assets before index.html, so a poll can land mid-build.
    // Broadcasting a hash of a truncated file would reload every display
    // onto a page with no app in it.
    write('<!doctype html><html><head><title>Wall');
    expect(currentBuild(indexPath)).toBeNull();

    write(COMPLETE);
    expect(currentBuildId(indexPath)).not.toBeNull();
  });
});

describe('watchBuild', () => {
  it('reports a new build, and only once for it', () => {
    write(COMPLETE);
    const onChange = vi.fn();
    const stop = watchBuild(onChange, { indexPath, pollMs: 10 });
    try {
      write(COMPLETE.replace('index-abc.js', 'index-def.js'));
      vi.advanceTimersByTime(30);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(currentBuildId(indexPath));

      // A file that keeps being touched but keeps hashing the same must not
      // reload a display on every pass.
      for (let i = 0; i < 5; i += 1) {
        fs.utimesSync(indexPath, new Date(), new Date(Date.now() + 10_000 * (i + 1)));
        vi.advanceTimersByTime(20);
      }
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('notices a rebuild that leaves the file exactly the same size', () => {
    // The hashed asset filename is the same length before and after, so
    // anything watching file size rather than contents would miss this.
    write(COMPLETE);
    const onChange = vi.fn();
    const stop = watchBuild(onChange, { indexPath, pollMs: 10 });
    try {
      fs.writeFileSync(indexPath, COMPLETE.replace('index-abc.js', 'index-def.js'));
      vi.advanceTimersByTime(30);
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('reports each new build as it lands', () => {
    write(COMPLETE);
    const onChange = vi.fn();
    const stop = watchBuild(onChange, { indexPath, pollMs: 10 });
    try {
      write(COMPLETE.replace('index-abc.js', 'index-def.js'));
      vi.advanceTimersByTime(30);
      write(COMPLETE.replace('index-abc.js', 'index-ghi.js'));
      vi.advanceTimersByTime(30);
      expect(onChange).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it('does not block on a watcher with nothing to watch', () => {
    const onChange = vi.fn();
    const stop = watchBuild(onChange, { indexPath: path.join(indexPath, 'nope'), pollMs: 10 });
    try {
      vi.advanceTimersByTime(50);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it('stops cleanly', () => {
    write(COMPLETE);
    const onChange = vi.fn();
    watchBuild(onChange, { indexPath, pollMs: 10 })();

    write(COMPLETE.replace('index-abc.js', 'index-def.js'));
    vi.advanceTimersByTime(50);
    expect(onChange).not.toHaveBeenCalled();
  });
});
// Vitest supplies __dirname to modules it loads, so a plain-node-only
// mistake -- using __dirname in this ESM package, which makes the server
// crash on startup with "ReferenceError: __dirname is not defined in ES
// module scope" -- passes every test here and then takes the whole backend
// down. Importing under real node is the only thing that catches it, and the
// module is imported for its default argument (the real dist path), which is
// exactly where that mistake lives.
describe('under plain node, the way the service actually starts', () => {
  const modulePath = fileURLToPath(new URL('../src/services/buildStamp.js', import.meta.url));

  it('imports and resolves its default path without throwing', () => {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
      const m = await import(${JSON.stringify(modulePath)});
      // Not just the import: the default argument is a module-level constant
      // that reads the filesystem's real location of frontend/dist.
      process.stdout.write(String(m.currentBuildId()));
    `], { encoding: 'utf8' });

    // Whatever it returns, it has to have returned -- the point of the test
    // is that node got far enough to produce it at all.
    expect(out).toMatch(/^[0-9a-f]{12}$|^$/);
  });
});
