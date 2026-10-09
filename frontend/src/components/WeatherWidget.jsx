import { useEffect, useState } from 'react';
import { formatTemperature } from '../utils/units.js';

// Bottom-right of the To Do panel, mirroring the legend's bottom-left
// corner of the agenda panel -- see .weather in base.css for the matching
// 10px inset. Font-size 28px to match the legend circles' own height.
export default function WeatherWidget({ weather, settings }) {
  // Its own clock, same pattern as DayAgenda/CalendarView: needs to catch
  // the sunrise/sunset boundary passing live, not just whenever `weather`
  // happens to update next (which can be up to 15 minutes away).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Nothing to show without a real reading yet -- no location set, or the
  // first poll hasn't landed since boot.
  if (!weather) return null;

  // Same sunrise/sunset already driving Automatic theme (see App.jsx),
  // not a separate day/night calculation -- if neither is available (no
  // location, or the sun doesn't rise/set there today) this just falls
  // back to the regular weather icon rather than guessing at night.
  const sunrise = settings?.sunrise ? new Date(settings.sunrise) : null;
  const sunset = settings?.sunset ? new Date(settings.sunset) : null;
  const isNight = sunrise && sunset && (now < sunrise || now >= sunset);

  // A real air-quality problem (wildfire smoke, etc.) always wins over
  // either the weather condition or the moon phase -- knowing the air is
  // bad matters more than knowing it's also cloudy or that it's a full
  // moon out.
  const emoji = weather.isUnhealthyAir ? '😷' : isNight ? weather.moonPhase.emoji : weather.weatherEmoji;
  // Unit spelled out on the corner widget for the same reason the forecast
  // strip carries it: the two are read together, and a bare degree sign
  // doesn't say which scale it's in. EPA AQI color scale for values that
  // aren't masked (isUnhealthyAir).
  const temp = formatTemperature(weather.tempC, weather.tempF, settings?.tempUnit);

  return (
    <div className="weather">
      <span className="weather__emoji">{emoji}</span>
      <span className="weather__temp">{temp}</span>
      {weather.aqi != null && !weather.isUnhealthyAir && (
        <span
          className={isNight ? `weather__aqi is-night` : `weather__aqi`}
          aria-label="Air quality index"
        >
          {weather.aqi}
        </span>
      ) : null}
    </div>
  );
}
