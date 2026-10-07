import { useEffect, useState } from 'react';
import { formatClock } from '../utils/date.js';

// The next sun event, and when: whichever of sunrise and sunset is still
// ahead. The times come from the same sunrise/sunset the server already
// computes for the Automatic theme (server/src/services/sunService.js) and
// hands over on every settings push -- not recomputed here, so what the wall
// prints can never disagree with the theme switch those same times drive.
// The server also folds in the companion app's Before/After offsets, so with
// Advanced off (the default) these are the true astronomical times and with
// it on they're the times the display is actually acting on.
//
// One event rather than both, because which one matters depends on the hour:
// at 3pm "sunrise 7:09 am" is something that already happened, and at 8pm
// "sunset 7:01 pm" likewise. What someone wants off a wall is when it next
// gets light or dark, which is always exactly one of them. After sunset that
// is tomorrow's sunrise, so the server sends tomorrow's pair as well
// (sunriseTomorrow/sunsetTomorrow in getSettings) -- showing today's sunrise
// there would be an hour-old event presented as a future one.
//
// Its own clock, same pattern as every other view in this app (see
// WeatherWidget.jsx, which watches the same two times for the same reason):
// which event is next changes *at* sunrise and sunset, and a display nobody
// is looking after can't be told the boundary passed by the arrival of a
// settings push — those only come once a day, and the times are absolute
// timestamps for a fixed day.
export default function SunTimes({ settings }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const sunrise = settings?.sunrise ? new Date(settings.sunrise) : null;
  const sunset = settings?.sunset ? new Date(settings.sunset) : null;
  const sunriseTomorrow = settings?.sunriseTomorrow ? new Date(settings.sunriseTomorrow) : null;
  const sunsetTomorrow = settings?.sunsetTomorrow ? new Date(settings.sunsetTomorrow) : null;

  // The next one still to come, in the order they actually happen. Comparing
  // against `now` rather than recomputing anything is what lets this be one
  // linear walk: today's sunrise, today's sunset, then tomorrow's.
  const upcoming = [
    sunrise && { label: 'Sunrise at', time: sunrise },
    sunset && { label: 'Sunset at', time: sunset },
    sunriseTomorrow && { label: 'Sunrise tomorrow at', time: sunriseTomorrow },
    sunsetTomorrow && { label: 'Sunset tomorrow at', time: sunsetTomorrow },
  ]
    .filter(Boolean)
    .find((event) => event.time > now);

  // Nothing at all without a saved location (the server sends null for all
  // four then), which is deliberately no change to the header rather than an
  // empty placeholder. The same is true at a latitude where the sun neither
  // rises nor sets today and tomorrow alike — better an absent row than a
  // time that isn't going to happen.
  if (!upcoming) return null;

  return (
    <div className="calendar-header__sun">
      <span className="calendar-header__sun-time">
        <span aria-hidden="true">{upcoming.label.startsWith('Sunrise') ? '🌅' : '🌇'}</span>{' '}
        <span className="calendar-header__sun-label">{upcoming.label}</span>
        {formatClock(upcoming.time, settings?.timeFormat)}
      </span>
    </div>
  );
}
