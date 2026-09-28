import { useEffect, useState } from 'react';
import { WEEKDAYS, dateKey, formatClock, ordinalSuffix } from '../utils/date.js';
import { formatPrecipChance, formatPrecipitation, formatWind } from '../utils/units.js';

// The two windows the wall shows, per the feature's shape: the rest of today
// and the whole of tomorrow broken out hour by hour across the top, and ten
// days broken out day by day underneath. These are the numbers the user asked
// for, so they're fixed rather than settings — the *timing* of the view is
// configurable (see weatherIntervalMinutes in settingsService.js), its content
// isn't.
const HOURLY_COUNT = 24;
const DAILY_COUNT = 10;

// "7p" rather than formatClock()'s "7:00 pm": twenty-four of those across the
// top of a wall display is far too much text per column, and the minutes are
// always :00 in an hourly series anyway. "12a"/"12p" rather than a 24-hour
// clock because the rest of the display (the header, the agenda) is 12-hour,
// and a wall read at a glance shouldn't switch conventions halfway.
function hourLabel(date) {
  const hours = date.getHours();
  return `${hours % 12 || 12}${hours < 12 ? 'a' : 'p'}`;
}

// Just the city out of a saved location's label, which is a full
// "City, State, Country" display_name from the geocoder — fine in the
// companion app's one-line list, far too long as a headline on the wall.
function placeName(location) {
  if (!location) return null;
  return (location.label || '').split(',')[0].trim() || null;
}

// The forecast the wall can actually show right now, rather than everything
// the server cached.
//
// The server deliberately fetches more hours than this view uses (see
// HOURLY_FETCH_HOURS), because the cache is only refreshed every
// WEATHER_POLL_INTERVAL_MS: a view that asked for exactly its own 24 hours
// would start short whenever the reading underneath it was more than an hour
// old. So the extra depth is spent here instead, trimming anything already
// past and taking the next 24 from what's left. Days are trimmed the same way
// against local midnight, which is where the server's daily entries sit.
function visibleForecast(weather, now) {
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  return {
    hourly: (weather.hourly || [])
      .filter((hour) => new Date(hour.time).getTime() >= hourStart.getTime())
      .slice(0, HOURLY_COUNT),
    daily: (weather.daily || [])
      .filter((day) => new Date(day.date).getTime() >= dayStart.getTime())
      .slice(0, DAILY_COUNT),
  };
}

// Full-screen weather, shown in place of the calendar for a configurable
// stretch of time (see the rotation in App.jsx).
//
// The clock comes along even though this replaces the whole display: a wall
// that stops telling the time for a minute every hour is a worse wall, and
// it's the one thing here that isn't weather. It's this component's own rather
// than passed down, because it's the only thing on screen that needs it
// ticking at all — the rotation that decides whether this view is up runs on
// its own faster timer, and re-rendering the whole display every few seconds
// to keep a clock fresh is not a trade worth making when the calendar is the
// thing not being shown.
export default function WeatherView({ weather, settings }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const { hourly, daily } = visibleForecast(weather, now);
  // Same unit handling as the corner widget, off the same two fields, so the
  // two can't disagree about what the temperature is.
  const celsius = settings?.tempUnit === 'C';
  const temp = (c, f) => `${Math.round(celsius ? c : f)}°`;
  const place = placeName(settings?.location);
  const windUnit = settings?.windUnit;
  const precipUnit = settings?.precipUnit;
  // Today's own numbers, for the headline. The current-hour precipitation
  // amount is almost always 0 and says nothing useful ("0.00 in" now, rain at
  // 4pm), so the headline quotes the day instead: what fell or is coming, and
  // how likely.
  const today = daily[0];
  const headlinePrecip = today
    ? formatPrecipChance(today.precipChance) || formatPrecipitation(today.precipMm, precipUnit)
    : null;

  // A stale cache can be all that's left after a location change, and an
  // empty strip would read as a rendering bug rather than as "no data".
  if (!hourly.length && !daily.length) {
    return (
      <div className="weather-view weather-view--empty">
        <p className="weather-view__empty">No forecast for this location yet.</p>
      </div>
    );
  }

  return (
    <div className="weather-view">
      <header className="weather-view__head">
        <div className="weather-view__now">
          {place && <span className="weather-view__place">{place}</span>}
          <span className="weather-view__now-reading">
            {/* Air quality outranks the sky, same as the corner widget: a
                genuinely bad-air day is worth more of the view than which
                cloud it's behind. */}
            <span className="weather-view__now-emoji" aria-hidden="true">
              {weather.isUnhealthyAir ? '😷' : weather.weatherEmoji}
            </span>
            <span className="weather-view__now-temp">{temp(weather.tempC, weather.tempF)}</span>
          </span>
          {/* Wind and rain, in the units the companion app was told to use.
              Spelled out rather than given an emoji: the wind glyphs in the
              emoji font are a face with a swirl, which at any size this
              display can afford reads as a grey smudge rather than as wind.
              Two short words cost less width than a legible glyph would and
              can't be misread at a distance. */}
          <span className="weather-view__now-details">
            {formatWind(weather.windKmh, windUnit) && (
              <span className="weather-view__detail">
                <span className="weather-view__detail-label">Wind</span>
                {formatWind(weather.windKmh, windUnit)}
                {weather.windDir && <span className="weather-view__detail-dir">{weather.windDir}</span>}
              </span>
            )}
            {headlinePrecip && (
              <span className="weather-view__detail">
                <span className="weather-view__detail-label">Rain</span>
                {headlinePrecip}
              </span>
            )}
          </span>
        </div>
        <div className="weather-view__clock">
          <span className="weather-view__date">
            {now.toLocaleDateString(undefined, { weekday: 'long' })},{' '}
            {now.toLocaleDateString(undefined, { month: 'long' })} {now.getDate()}
            {ordinalSuffix(now.getDate())}
          </span>
          <span className="weather-view__time">{formatClock(now)}</span>
        </div>
      </header>

      {/* The two halves as one centred block rather than two boxes each
          claiming half the screen. At 1080x1920 -- a portrait panel, which
          is how this display is actually mounted in a hallway -- a 50/50
          split leaves each strip marooned in ~800px of black, and the
          emptiness reads as a rendering failure rather than as space.
          Sized to their content and centred as a pair, they read as one
          deliberate block on any aspect ratio, and on the landscape shape
          they still fill the screen and look like the split they are. */}
      <div className="weather-view__body">
        <section className="weather-view__half weather-view__half--hourly">
          <p className="weather-view__label">Next 24 hours</p>
          <ol className="weather-view__hours">
            {hourly.map((hour, index) => (
              <li key={hour.time} className="weather-view__hour">
                {/* The first column is the hour already in progress, so it says
                    so rather than repeating a time the viewer can read off the
                    clock in the corner. */}
                <span className="weather-view__hour-label">{index === 0 ? 'Now' : hourLabel(new Date(hour.time))}</span>
                <span className="weather-view__hour-emoji" aria-hidden="true">
                  {hour.emoji}
                </span>
                <span className="weather-view__hour-temp">{temp(hour.tempC, hour.tempF)}</span>
                {/* Always rendered, blank when there's nothing to say, because
                    a cell that skips its last line entirely is a cell that
                    centers differently from its neighbours -- and with 24 of
                    them side by side that turns the temperature row into a
                    visible stagger. The empty span costs nothing and keeps
                    every column the same height. */}
                <span className="weather-view__hour-precip">{formatPrecipChance(hour.precipChance)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="weather-view__half weather-view__half--daily">
          <p className="weather-view__label">Next 10 days</p>
          <ol className="weather-view__days">
            {daily.map((day) => {
              const date = new Date(day.date);
              return (
                // dateKey rather than the raw instant: the same helper the
                // calendar cells key on, so a day reads the same here as it
                // does there.
                <li key={dateKey(date)} className="weather-view__day">
                  <span className="weather-view__day-name">{WEEKDAYS[date.getDay()]}</span>
                  <span className="weather-view__day-date">{date.getDate()}</span>
                  <span className="weather-view__day-emoji" aria-hidden="true">
                    {day.emoji}
                  </span>
                  <span className="weather-view__day-temps">
                    <span className="weather-view__day-high">{temp(day.highC, day.highF)}</span>
                    <span className="weather-view__day-low">{temp(day.lowC, day.lowF)}</span>
                  </span>
                  {/* A day's rainfall total and its windiest hour — amounts
                      rather than chances, deliberately. The hourly strip
                      above already answers "is it raining during this hour",
                      and a ten-day outlook is for planning, where "1.2 in" is
                      the number that decides whether a day works and "60%"
                      only says go and look. It is also the only place the
                      precipitation *unit* setting becomes visible at all,
                      since a percentage needs no unit. A dry day says
                      nothing rather than "0.0 in" ten times over.

                      The droplet is the one emoji kept here: it survives
                      being this small, which the wind glyphs don't. */}
                  <span className="weather-view__day-extras">
                    {[
                      day.precipMm > 0 && `💧${formatPrecipitation(day.precipMm, precipUnit)}`,
                      formatWind(day.windKmh, windUnit),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </div>
  );
}
