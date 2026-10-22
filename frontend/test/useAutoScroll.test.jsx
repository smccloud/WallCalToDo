import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { SCROLL_HOLD_MS, SCROLL_SPEED_PX_PER_SEC, useAutoScroll } from '../src/hooks/useAutoScroll.js';

// The panel drifts through its own overflow on requestAnimationFrame, so
// these drive the frames by hand (a stubbed rAF, fed timestamps) rather than
// waiting on a real clock -- the drift has to be exactly predictable for the
// rests at either end to be testable at all.

// The panel's own height and the height of the content in it: jsdom reports
// zero for both, since it does no layout of its own. Its scrollTop rounds
// to the nearest pixel on the way in, the way a browser's does -- a
// sub-pixel step is rounded away, so the drift has to carry its remainder
// between frames or it never gets anywhere.
function panel({ clientHeight, scrollHeight }) {
  const el = document.createElement('div');
  let scrollTop = 0;
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    get: () => scrollTop,
    set: (value) => {
      scrollTop = Math.round(value);
    },
    configurable: true,
  });
  document.body.appendChild(el);
  return el;
}

let frames = [];
let clock = 0;

beforeEach(() => {
  frames = [];
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// One frame, the given number of milliseconds later than the last.
function frame(ms = 1000) {
  clock += ms;
  const cb = frames.shift();
  // Nothing scheduled means the drift isn't running at all (reduced motion),
  // which is a state the tests check for rather than an error.
  if (!cb) return;
  act(() => cb(clock));
}

function setup(el, key = 'menu', speed) {
  return renderHook(
    ({ k, s }) => {
      const ref = useRef(el);
      useAutoScroll(ref, k, s);
    },
    { initialProps: { k: key, s: speed } }
  );
}

// A panel 100px tall holding 400px of menu: 300px of it is off the bottom.
const OVERFLOWS = { clientHeight: 100, scrollHeight: 400 };
const MAX_SCROLL = OVERFLOWS.scrollHeight - OVERFLOWS.clientHeight;

describe('useAutoScroll', () => {
  it('drifts the panel down through its own overflow', () => {
    const el = panel(OVERFLOWS);
    setup(el);

    frame(0);
    frame(1000);

    expect(el.scrollTop).toBe(SCROLL_SPEED_PX_PER_SEC);
  });

  it('keeps drifting when a frame is worth less than a pixel', () => {
    const el = panel(OVERFLOWS);
    setup(el);

    frame(0);
    // A 60fps frame is worth a fraction of a pixel at the drift's speed, and
    // a browser rounds a fractional scroll offset to the nearest pixel --
    // so the remainder has to carry between frames, or the drift is rounded
    // away every frame and the panel never moves at all.
    for (let i = 0; i < 60; i++) frame(16);

    expect(el.scrollTop).toBeGreaterThan(10);
  });

  it('rests at the bottom of the travel, then drifts back up', () => {
    const el = panel(OVERFLOWS);
    setup(el);

    frame(0);
    // Long enough to reach the bottom at the drift's speed, and no longer:
    // past that it would have rested there and started back up again.
    for (let i = 0; i < 20; i++) frame(1000);
    expect(el.scrollTop).toBe(MAX_SCROLL);

    // The rest at the bottom: it holds still rather than bouncing off the
    // end and starting again.
    frame(1000);
    expect(el.scrollTop).toBe(MAX_SCROLL);

    // Once the rest is over it travels the other way, so the menu comes
    // round again.
    frame(SCROLL_HOLD_MS);
    frame(1000);
    expect(el.scrollTop).toBeLessThan(MAX_SCROLL);
  });

  it('starts a changed menu at its own top', () => {
    const el = panel(OVERFLOWS);
    const { rerender } = setup(el, 'breakfast');

    frame(0);
    frame(1000);
    expect(el.scrollTop).toBe(SCROLL_SPEED_PX_PER_SEC);

    // A new meal (breakfast for lunch, say) starts over rather than
    // picking up wherever the last one was left.
    rerender({ k: 'lunch' });
    expect(el.scrollTop).toBe(0);
  });

  it('leaves a panel whose content fits alone', () => {
    const el = panel({ clientHeight: 400, scrollHeight: 400 });
    setup(el);

    frame(0);
    frame(1000);
    frame(1000);

    expect(el.scrollTop).toBe(0);
  });

  it('holds the drift off while the panel is scrolled by hand', () => {
    const el = panel(OVERFLOWS);
    setup(el);

    frame(0);
    frame(1000);

    act(() => {
      el.dispatchEvent(new Event('wheel'));
    });
    const paused = el.scrollTop;
    frame(1000);

    expect(el.scrollTop).toBe(paused);
  });

  it('drifts at the speed it is given', () => {
    const el = panel(OVERFLOWS);
    setup(el, 'menu', 40);

    frame(0);
    frame(1000);

    expect(el.scrollTop).toBe(40);
  });

  it('stands still at a speed of zero', () => {
    const el = panel(OVERFLOWS);
    setup(el, 'menu', 0);

    frame(0);
    frame(1000);
    frame(1000);

    expect(el.scrollTop).toBe(0);
  });

  it('takes a new speed on without starting the drift over', () => {
    const el = panel(OVERFLOWS);
    const { rerender } = setup(el, 'menu', 16);

    frame(0);
    frame(1000);
    expect(el.scrollTop).toBe(16);

    // A new speed -- the companion app's slider -- takes hold from where the
    // panel already is, rather than throwing it back to the top and starting
    // the travel over.
    rerender({ k: 'menu', s: 60 });
    expect(el.scrollTop).toBe(16);

    frame(1000);
    expect(el.scrollTop).toBe(76);
  });

  it('goes back to the top of the menu when the drift is switched off', () => {
    const el = panel(OVERFLOWS);
    const { rerender } = setup(el, 'menu', 16);

    frame(0);
    frame(1000);
    expect(el.scrollTop).toBe(16);

    // A wall with no scroll input of its own can't be scrolled back to the
    // start of the menu by hand, so switching the drift off leaves the
    // menu at its own first line rather than in the middle of it.
    rerender({ k: 'menu', s: 0 });
    expect(el.scrollTop).toBe(0);
  });

  it('stands the drift down when the system asks for less motion', async () => {
    window.matchMedia = vi.fn((query) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.resetModules(); // motion.js reads the preference at module load
    const { useAutoScroll: freshUseAutoScroll } = await import('../src/hooks/useAutoScroll.js');

    const el = panel(OVERFLOWS);
    renderHook(() => {
      const ref = useRef(el);
      freshUseAutoScroll(ref, 'menu');
    });

    frame(0);
    frame(1000);

    expect(el.scrollTop).toBe(0);
  });
});
