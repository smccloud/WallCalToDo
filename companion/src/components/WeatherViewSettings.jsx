// How often the wall display hands the whole screen over to the weather view
// (the next 24 hours hour by hour on top, the next 10 days day by day
// underneath), and how long it keeps it before giving the calendar back.
//
// The values here are the numbers the API validates against (see
// WEATHER_INTERVAL_MINUTES / WEATHER_DURATION_SECONDS in
// server/src/routes/settings.js) with friendlier labels — a stored 120 has to
// be offered as "2 hours" somewhere, and "Off" is a label for 0 rather than
// an absence. Adding an option means adding it in both places; a value the
// server doesn't know is a 400, not a silently-ignored control.
//
// Nothing here can strand the display on the weather view: the shortest
// interval offered is 15 minutes and the longest duration is 5, so the
// calendar always comes back for at least twice as long as the weather took.
const INTERVAL_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: 'Hour' },
  { value: 120, label: '2 hours' },
  { value: 180, label: '3 hours' },
  { value: 360, label: '6 hours' },
];

const DURATION_OPTIONS = [
  { value: 30, label: '30s' },
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
  { value: 300, label: '5 min' },
];

export default function WeatherViewSettings({
  settings,
  settingsLoading,
  onSetWeatherInterval,
  onSetWeatherDuration,
}) {
  // Number() rather than a truthiness check, because 0 is a real value here
  // ("Off") and `settings.weatherIntervalMinutes || 0` would quietly agree
  // with it for the wrong reason. Settings can also be null before the first
  // load, so the default matters.
  const interval = Number(settings?.weatherIntervalMinutes ?? 0);
  const enabled = interval > 0;

  return (
    <div className="weather-view-settings">
      <p className="settings-label section-label">Weather view</p>
      <div className="segmented" role="group" aria-label="How often the weather view appears">
        {INTERVAL_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={`segmented__option${interval === value ? ' is-active' : ''}`}
            disabled={settingsLoading}
            onClick={() => onSetWeatherInterval(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* The duration only means anything once there's an interval to be a
          duration *of*, and showing it while the view is off would be asking
          someone to set a number that does nothing. */}
      {enabled && (
        <>
          <p className="settings-label section-label">For how long</p>
          <div className="segmented" role="group" aria-label="How long the weather view stays up">
            {DURATION_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`segmented__option${Number(settings?.weatherDurationSeconds) === value ? ' is-active' : ''}`}
                disabled={settingsLoading}
                onClick={() => onSetWeatherDuration(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {!settings?.location && (
        <p className="settings-notice">Set a location above — the weather view has nothing to show without one.</p>
      )}

      <p className="location-settings__hint">
        Takes over the whole display, showing the next 24 hours hour by hour and the next 10 days day by day. The
        window is timed from the interval rather than from when you turned it on, so an hourly setting appears on
        the hour.
      </p>
    </div>
  );
}
