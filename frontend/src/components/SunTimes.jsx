import { formatClock } from '../utils/date.js';

// Today's sunrise and sunset, from the same sunrise/sunset the server already
// computes for the Automatic theme (server/src/services/sunService.js) and
// hands over on every settings push -- not recomputed here, so what the wall
// prints can never disagree with the theme switch that times also drives.
// The server also folds in the companion app's Before/After offsets, so with
// Advanced off (the default) these are the true astronomical times and with
// it on they're the times the display is actually acting on.
//
// Its own clock isn't needed: these are absolute timestamps for a fixed day,
// and the server rebroadcasts them once the day rolls over (see the daily
// settings broadcast in server/src/services/poller.js) -- unlike the day/night
// boundary itself, which has to be watched live by whoever switches on it.
//
// The words are spelled out rather than left to the emoji alone. Two
// pictograms that differ only in which way the sun is sitting are not
// something to decode from across a room, and this row is exactly where the
// header had room to say so -- which also leaves the emoji purely decorative,
// hence aria-hidden.
export default function SunTimes({ settings }) {
  const sunrise = settings?.sunrise ? new Date(settings.sunrise) : null;
  const sunset = settings?.sunset ? new Date(settings.sunset) : null;

  // Nothing to print without a saved location (the server sends null for both
  // then), which is deliberately no change at all to the header rather than an
  // empty placeholder where the times would be. Either one can also be null on
  // its own, at a latitude where the sun currently never quite makes it up or
  // all the way down, so each is rendered independently.
  if (!sunrise && !sunset) return null;

  return (
    <div className="calendar-header__sun">
      {sunrise && (
        <span className="calendar-header__sun-time">
          <span aria-hidden="true">🌅</span> <span className="calendar-header__sun-label">Sunrise</span>
          {formatClock(sunrise)}
        </span>
      )}
      {sunset && (
        <span className="calendar-header__sun-time">
          <span aria-hidden="true">🌇</span> <span className="calendar-header__sun-label">Sunset</span>
          {formatClock(sunset)}
        </span>
      )}
    </div>
  );
}
