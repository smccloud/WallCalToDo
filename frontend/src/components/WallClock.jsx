import { useEffect, useState } from 'react';
import { formatClockSeconds } from '../utils/date.js';

// The wall's clock — "5:21:07 pm" — ticking once a second.
//
// Its own component with its own timer, rather than reading a `now` from
// whichever view happens to be on screen. Formatting lives in one place, but
// the reason for the split is cost: both views that show a clock keep a `now`
// of their own for other reasons (the header for the month and year, the
// weather view to trim the forecast to the next 24 hours), and a clock
// reading a time from up there means the seconds tick on *that* view's
// re-render. For the weather view that is 34 forecast columns redrawn sixty
// times a minute to redraw a string, on a Pi. A clock that owns its tick
// re-renders only itself, whatever else is on the display.
export default function WallClock({ className }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <span className={className}>{formatClockSeconds(now)}</span>;
}
