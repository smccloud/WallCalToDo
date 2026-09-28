import { useEffect, useState } from 'react';
import { REDUCED_MOTION } from '../utils/motion.js';

// How long the dither takes to open, in either direction.
//
// Slow on purpose, and slower than the fade it replaces was. A dither only
// reads as a dither if you can see it happening: cross-fade this fast and the
// pattern is gone before it registers, leaving what looks like a slightly
// uneven dissolve. 1.8s is slow enough to watch the dots spread and short
// enough to be over before someone looking up from their phone has decided
// to read the calendar — the shortest rotation window the companion app
// offers is 30s, so this is a small fraction of one appearance.
//
// This number and the animation duration in base.css have to be the same:
// the timer below is what unmounts the view underneath, so a dither that
// outran it would be cut off mid-pattern and one that fell short would
// leave the two views stacked.
export const DITHER_MS = 1800;

/*
 * Hands the wall over between two views.
 *
 * `want` is the view that should be on screen ('calendar' or 'weather');
 * the return is what's on it — { view, from } — where `view` is the one
 * being shown and `from` is the one it is arriving over, still mounted
 * underneath for as long as the dither takes. Null once the dither has
 * finished, which is almost always.
 *
 * Both up at once is the point: a dither can only interleave two images
 * pixel by pixel if both are on screen, and that is what saves it from the
 * fault of a plain cross-fade here, where the two views are dense grids of
 * text and superimposing them leaves every row of both legible at the same
 * time. The pattern alternates between them instead, so there is never a
 * moment where two sets of words are fighting for the same pixels.
 */
export function useViewSwap(want) {
  // Seeded from the first render, so the app's opening paint is the plain
  // view it has always been — a kiosk that restarts shows its calendar
  // immediately, and there's no frame of nothing while the hook settles.
  const [screen, setScreen] = useState(() => ({ view: want, from: null }));

  useEffect(() => {
    // The swap was called off: what's being asked for is the view we were in
    // the middle of leaving, so drop the incoming one and settle on the view
    // that was already there. Left alone, the two stay stacked with the
    // dither frozen part-open and the view underneath never unmounted.
    if (want === screen.from) {
      setScreen({ view: want, from: null });
      return;
    }

    // Already showing it — which is also true partway through a dither. The
    // timer below is what ends a transition, not another change of want, so
    // this is where a running dither is left alone to finish.
    if (want === screen.view) return;

    // Reduced motion: the handover happens, the dither doesn't. Shortening
    // the animation in CSS alone would only leave the incoming view masked to
    // nothing for the length of the timer — invisible, which is worse than
    // either having the dither or not.
    if (REDUCED_MOTION) {
      setScreen({ view: want, from: null });
      return;
    }

    // Both up: the incoming view dithers in over the one it replaces, which
    // stays put and fully readable underneath.
    setScreen({ view: want, from: screen.view });
  }, [want, screen.view]);

  // Unmounting the view underneath is timed separately from starting the
  // dither, because arming the timer inside the effect above doesn't survive
  // its own state change: setting `from` re-runs that effect, whose cleanup
  // then cancels the timer it had just started, and the transition never
  // ends — both views stay stacked for good. Keyed on the transition rather
  // than on `want` so a swap that is called off cancels its timer instead of
  // leaving it to fire later and cut short whatever replaced it.
  useEffect(() => {
    if (!screen.from) return undefined;
    const timer = setTimeout(() => setScreen(({ view }) => ({ view, from: null })), DITHER_MS);
    return () => clearTimeout(timer);
  }, [screen.from, screen.view]);

  return screen;
}
