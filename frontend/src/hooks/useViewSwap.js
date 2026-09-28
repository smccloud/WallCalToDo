import { useEffect, useRef, useState } from 'react';
import { REDUCED_MOTION } from '../utils/motion.js';

// How long one beat of a swap takes: the outgoing view fades off over this,
// then the incoming one fades up over the same again — a second for the pair.
// The CSS in base.css uses the same number for the fade itself, and the
// two have to agree: the incoming view is mounted by the timer below, so if
// the fade were longer the outgoing one would be cut off mid-fade, and if it
// were shorter there'd be a gap of bare background between the two.
export const SWAP_MS = 500;

/*
 * Hands the wall over between two views, one beat at a time.
 *
 * `want` is the view that should be on screen ('calendar' or 'weather');
 * the return is what's actually on it — { view, phase }, where phase is
 * 'idle', 'leaving' (the outgoing view, fading off) or 'entering' (the
 * incoming one, fading up, which also means it just mounted).
 *
 * Sequential rather than a cross-dissolve, with both views up at once and
 * each fading through the other, because both are dense grids of text over a
 * full-screen background: overlapping them means every row of both is legible
 * simultaneously for a few hundred milliseconds, which from across a room
 * reads as a glitch rather than a dissolve. Out, then in, passes through
 * --color-bg instead — black under the default dark theme — so the display
 * looks like it blinked rather than like it broke. It also means only one
 * view is ever mounted, which on a Pi is the cheaper of the two by a mile.
 *
 * Nothing here is timed against a rotation: the caller re-asks for the view
 * it wants and the hook works out whether that means staying put or swapping.
 */
export function useViewSwap(want) {
  // Seeded from the first render, so the app's opening paint is the plain
  // view it has always been — a kiosk that restarts shows its calendar
  // immediately, and there's no frame of nothing while the hook settles.
  const [screen, setScreen] = useState(() => ({ view: want, phase: 'idle' }));
  const timerRef = useRef(null);

  useEffect(() => {
    if (screen.view === want) {
      // A swap called off partway — the rotation window being shorter than a
      // beat, or a reading that briefly arrived empty — leaves the outgoing
      // view marked 'leaving', i.e. faded to nothing and waiting to be
      // unmounted that never comes. Put it back rather than leaving the wall
      // on an invisible view.
      //
      // 'entering' is deliberately left alone: it belongs to the view that
      // mounted with it, and clearing it now would stop that view's own
      // fade-in halfway through.
      if (screen.phase === 'leaving') setScreen({ view: want, phase: 'idle' });
      return;
    }

    // Reduced motion: the handover happens, the fade doesn't. The count of
    // beats is the whole mechanism, so shortening it in CSS alone would only
    // leave the outgoing view hanging around for the length of the timer with
    // nothing fading it — this way the two halves agree that there is no
    // transition to be in.
    if (REDUCED_MOTION) {
      setScreen({ view: want, phase: 'idle' });
      return;
    }

    // Beat one: whatever is on the wall starts fading off.
    setScreen((current) => ({ ...current, phase: 'leaving' }));
    timerRef.current = setTimeout(() => {
      // Beat two: the other view mounts, already marked as entering, so its
      // fade-in starts with it rather than being added to it a moment later
      // (which would restart the animation and flash the view).
      setScreen({ view: want, phase: 'entering' });
    }, SWAP_MS);
    return () => clearTimeout(timerRef.current);
  }, [want, screen.view]);

  return screen;
}
