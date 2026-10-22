import { useLayoutEffect, useRef } from 'react';
import { REDUCED_MOTION } from '../utils/motion.js';

/*
 * Scrolls a panel's own overflow, gently, on its own.
 *
 * The wall display has no mouse and no touch (see the `cursor: none` rule in
 * base.css), so a panel holding more content than fits can't be scrolled by
 * whoever is reading it -- the content either shrinks to fit or part of it is
 * never seen at all. This is the other half of that choice: the text stays at
 * full size and the panel drifts through the overflow by itself, ping-ponging
 * between its top and its bottom so every line comes round again.
 *
 * The speed is in pixels per second rather than lines per second, so the
 * drift reads the same whatever size the panel's own text ends up being, and
 * slow enough that a line of text is still readable while it moves past.
 */
export const SCROLL_SPEED_PX_PER_SEC = 16;

// How long the panel sits still at each end of its travel, so the first and
// last lines of the content get a moment to be read rather than immediately
// running off the edge.
export const SCROLL_HOLD_MS = 3000;

// How long a scroll by hand holds the drift off, so the panel doesn't fight
// whoever is scrolling it.
const MANUAL_HOLD_MS = 4000;

/*
 * `ref` points at the scrolling element, `resetKey` identifies its content:
 * a changed key starts the scroll over at the top (a new meal, a changed
 * one), which is also when the drift restarts.
 *
 * `speedPxPerSec` is how fast the panel drifts, in pixels per second. It's
 * read through a ref rather than closed over, so changing it doesn't restart
 * the drift -- a new speed takes hold from wherever the panel already is
 * instead of throwing it back to the top and starting the travel over. A
 * speed of 0 means the panel doesn't drift at all.
 */
export function useAutoScroll(ref, resetKey, speedPxPerSec = SCROLL_SPEED_PX_PER_SEC) {
  // The live speed, read by the animation loop on every frame. A value that
  // isn't a usable number falls back to the default rather than freezing the
  // panel or sending it off at a nonsense rate.
  const speedRef = useRef(speedPxPerSec);
  useLayoutEffect(() => {
    const speed = Number(speedPxPerSec);
    const next = Number.isFinite(speed) && speed >= 0 ? speed : SCROLL_SPEED_PX_PER_SEC;
    // Switching the drift off leaves the panel where it happened to be, which
    // on a wall with no scroll input of its own would be the middle of the
    // menu with the start of it out of reach. So the panel goes back to the
    // top, where the menu begins, and stays there.
    if (next === 0 && ref.current && ref.current.scrollTop !== 0) {
      ref.current.scrollTop = 0;
    }
    speedRef.current = next;
  }, [speedPxPerSec, ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    // A new menu starts at its own first line, not wherever the last one
    // happened to be scrolled to.
    el.scrollTop = 0;

    // Reduced motion: the drift is motion, so it stays off. The text is
    // still full size (nothing shrinks it any more) -- the overflow is
    // simply there to be scrolled by hand.
    if (REDUCED_MOTION) return undefined;

    let frame = 0;
    let last = null;
    // The sub-pixel remainder of the drift, carried between frames -- see
    // the whole-pixel step below.
    let carry = 0;
    // 'down', 'up', or 'rest' -- resting at one end of the travel before
    // setting off in the other direction. nextPhase is where it goes when
    // the rest is over.
    let phase = 'down';
    let nextPhase = 'up';
    let holdUntil = 0;
    let pausedUntil = 0;

    const step = (now) => {
      const list = ref.current;
      if (!list) {
        frame = 0;
        return;
      }

      // Seconds since the last frame, so the drift moves at the same speed
      // whatever the frame rate turns out to be.
      const dt = last == null ? 0 : (now - last) / 1000;
      last = now;

      const max = list.scrollHeight - list.clientHeight;
      // The speed as it stands right now: the companion app's slider can
      // change it while the panel is drifting, and a new speed takes hold on
      // the next frame without the panel jumping back to the top.
      const speed = speedRef.current;

      // Nothing to scroll (the content fits), a scroll by hand is in charge
      // right now, or the drift is turned off (a speed of 0): hold still, but
      // keep the loop alive either way.
      if (max > 1 && now >= pausedUntil && speed > 0) {
        if (phase === 'rest') {
          if (now >= holdUntil) phase = nextPhase;
        } else {
          carry += speed * dt * (phase === 'down' ? 1 : -1);
          // Whole pixels only: a browser rounds a fractional scroll offset
          // to the nearest pixel, so a step smaller than one pixel would be
          // rounded away and the drift would sit still forever. The
          // remainder carries over to the next frame instead.
          const whole = carry < 0 ? Math.ceil(carry) : Math.floor(carry);
          carry -= whole;
          list.scrollTop = Math.min(max, Math.max(0, list.scrollTop + whole));
          if (phase === 'down' && list.scrollTop >= max - 0.5) {
            phase = 'rest';
            nextPhase = 'up';
            holdUntil = now + SCROLL_HOLD_MS;
          } else if (phase === 'up' && list.scrollTop <= 0.5) {
            phase = 'rest';
            nextPhase = 'down';
            holdUntil = now + SCROLL_HOLD_MS;
          }
        }
      }

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);

    // A scroll by hand (a wheel or a finger, if there ever is one) holds the
    // drift off for a moment rather than being fought.
    const onManualScroll = () => {
      pausedUntil = performance.now() + MANUAL_HOLD_MS;
      phase = 'rest';
      nextPhase = 'down';
      holdUntil = pausedUntil;
    };
    el.addEventListener('wheel', onManualScroll, { passive: true });
    el.addEventListener('touchmove', onManualScroll, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('wheel', onManualScroll);
      el.removeEventListener('touchmove', onManualScroll);
    };
    // `ref` is a stable object, so the content key is what re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, resetKey]);
}
