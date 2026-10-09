// The weather view's own on/off switch, and — while it's on — how often the
// wall display hands the whole screen over to it, how long it keeps it before
// giving the calendar back, how many hours of hourly forecast it draws across
// the top, and how many days of daily forecast underneath that.
//
// The values here are the numbers the API validates against (see
// WEATHER_INTERVAL_MINUTES / WEATHER_DURATION_SECONDS in
// server/src/routes/settings.js) with friendlier labels — a stored 120 has to
// be offered as "2 hours" somewhere. Adding an option means adding it in both
// places; a value the server doesn't know is a 400, not a silently-ignored
// control.
//
// "Off" is no longer one of the interval options: whether the view appears at
// all is the switch's job, and having it be both was two controls that mean
// the same thing and can disagree. The interval now only ever answers "how
// often, once it's on".
//
// Nothing here can strand the display on the weather view: the shortest
// interval offered is 15 minutes and the longest duration is 5, so the
// calendar always comes back for at least twice as long as the weather took.
const INTERVAL_OPTIONS = [
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

// How many hours of hourly forecast to draw across the top of the view, and
// how many days of daily forecast underneath it.
//
// Dropdowns rather than the segmented controls above, because these are runs
// of 24 and 6 values rather than the handful those hold: as buttons they'd
// wrap into a block taller than the rest of the settings card put together,
// and every one of them would be a target you have to hit on a phone.
//
// The bounds are the same ones the API validates against
// (WEATHER_HOURLY_HOURS_MIN/_MAX and WEATHER_DAILY_DAYS_MIN/_MAX in
// server/src/routes/settings.js), and each ceiling is also the most the
// server's fetch can be trusted to supply — see weatherHourlyHours and
// weatherDailyDays in settingsService.js.
const HOURLY_HOURS_MIN = 1;
const HOURLY_HOURS_MAX = 24;
const DAILY_DAYS_MIN = 5;
const DAILY_DAYS_MAX = 10;

// Every value in a range, one step at a time, labelled the way a person
// would say it out loud ("1 hour" but "2 hours"). Built here rather than
// written out twice because the two dropdowns differ only in their bounds
// and their noun.
function countOptions(min, max, unit) {
  return Array.from({ length: max - min + 1 }, (_, i) => {
    const value = min + i;
    return { value, label: `${value} ${unit}${value === 1 ? '' : 's'}` };
  });
}

const HOURLY_HOURS_OPTIONS = countOptions(HOURLY_HOURS_MIN, HOURLY_HOURS_MAX, 'hour');
const DAILY_DAYS_OPTIONS = countOptions(DAILY_DAYS_MIN, DAILY_DAYS_MAX, 'day');

export default function WeatherViewSettings({
  settings,
  settingsLoading,
  onSetWeatherEnabled,
  onSetWeatherInterval,
  onSetWeatherDuration,
  onSetWeatherHourlyHours,
  onSetWeatherDailyDays,
}) {
  const enabled = Boolean(settings?.weatherEnabled);
  // `||` rather than `??` here, which is the opposite of the rule the interval
  // used to follow: 0 is not one of this control's options (the switch above
  // is what turns the view off), and an install saved before the switch existed
  // can still be carrying a 0. Falling back on it with `??` would leave the
  // control with nothing marked at all, which reads as broken rather than as
  // "you're on the first option".
  const interval = Number(settings?.weatherIntervalMinutes) || INTERVAL_OPTIONS[0].value;
  // Both strip counts fall back to the display's own defaults (all 24 hours,
  // all 10 days) rather than to 0, so a control read before the first settings
  // load shows what the wall is actually showing instead of "0 hours", which
  // isn't one of the options.
  const hours = Number(settings?.weatherHourlyHours ?? HOURLY_HOURS_MAX);
  const days = Number(settings?.weatherDailyDays ?? DAILY_DAYS_MAX);

  // Turning the view on is one user action, so it has to be enough: an install
  // from before the switch existed may still have an interval of 0 saved, and
  // enabling on top of that would produce a view that never appears and no
  // obvious reason why. Sending the first option alongside means "on" always
  // has something to repeat on.
  function enable() {
    if (Number(settings?.weatherIntervalMinutes) > 0) {
      onSetWeatherEnabled(true);
      return;
    }
    onSetWeatherEnabled(true, { weatherIntervalMinutes: INTERVAL_OPTIONS[0].value });
  }

  return (
    <div className="weather-view-settings">
      <p className="settings-label section-label">Weather view</p>

      {/* The switch, and nothing else, while the view is off. Every control
          below it configures a view that never comes up, and a settings card
          full of numbers that do nothing is worse than a card with one switch
          on it — the interval, the duration and both strip counts are all
          still remembered underneath, so switching back on restores whatever
          it was set to rather than resetting it. */}
      <div className="setting-toggle setting-toggle--flush">
        <span className="setting-toggle__label">Show the weather view</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={enabled}
            disabled={settingsLoading}
            onChange={(e) => (e.target.checked ? enable() : onSetWeatherEnabled(false))}
          />
          <span className="switch__track" />
        </label>
      </div>

      {enabled && (
        <>
          <p className="settings-label section-label">How often</p>
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

          <p className="settings-label section-label">Hours of forecast</p>
          <select
            className="select"
            aria-label="How many hours of hourly forecast to show"
            value={hours}
            disabled={settingsLoading}
            onChange={(e) => onSetWeatherHourlyHours(Number(e.target.value))}
          >
            {HOURLY_HOURS_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <p className="settings-label section-label">Days of forecast</p>
          <select
            className="select"
            aria-label="How many days of daily forecast to show"
            value={days}
            disabled={settingsLoading}
            onChange={(e) => onSetWeatherDailyDays(Number(e.target.value))}
          >
            {DAILY_DAYS_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </>
      )}

      {enabled && (
        <>
          {!settings?.location && (
            <p className="settings-notice">Set a location above — the weather view has nothing to show without one.</p>
          )}

          <p className="location-settings__hint">
            Takes over the whole display, showing up to {hours} hours hour by hour and {days} days day by day. The
            window is timed from the interval rather than from when you turned it on, so an hourly setting appears on
            the hour.
          </p>
        </>
      )}
    </div>
  );
}
