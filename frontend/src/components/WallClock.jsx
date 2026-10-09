import { useEffect, useState } from 'react';
import { clockParts } from '../utils/date.js';

// One of the colons between the clock's fields. Its own element rather than
// part of the assembled string so it can be styled apart from the digits --
// see .clock-divider--flash in base.css. Renders nothing extra, so a clock
// with the flash off has exactly the same text and the same layout as it
// always had.
function Divider({ flashing }) {
  return <span className={`clock-divider${flashing ? ' clock-divider--flash' : ''}`}>:</span>;
}

// The wall's clock — "5:21:07 pm" / "17:21:07" — ticking once a second,
// in whichever format the companion app's timeFormat setting picks, with the
// seconds shown or dropped per clockShowSeconds.
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
//
// Seconds off still ticks once a second, rather than only on the minute:
// the tick is what keeps `now` honest across a suspend or a clock that
// jumped (NTP, a DST change), and re-rendering one small span sixty times a
// minute is not what costs anything here — the fan of re-renders above it
// was.
export default function WallClock({ className, timeFormat, showSeconds = true, flashDivider = false }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Defaults to showing seconds when the setting hasn't arrived yet (the
  // first paint, before the WebSocket has pushed settings in), so the clock
  // doesn't visibly drop its seconds and then grow them back a moment later.
  const { hours, minutes, seconds, period } = clockParts(now, timeFormat);

  // The blink is pure CSS, so it stands down under prefers-reduced-motion on
  // its own (see .clock-divider--flash in base.css) — nothing here needs to
  // check REDUCED_MOTION, unlike the temperature count-up that JS drives.
  return (
    <span className={className}>
      {hours}
      <Divider flashing={flashDivider} />
      {minutes}
      {showSeconds && (
        <>
          <Divider flashing={flashDivider} />
          {seconds}
        </>
      )}
      {period ? ` ${period}` : null}
    </span>
  );
}
