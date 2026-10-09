// How the wall prints clock times: "5:21 pm" or "17:21", and whether its own
// clock ticks seconds alongside.
//
// The values are the ones the API validates against (timeFormat in
// server/src/routes/settings.js -- '12'/'24', not labels); the labels are
// what a person should read on a button, and the first option starts
// selected, which is why the default is '12' (the format the display has
// always used).
//
// Unlike the units below, this one needs no location: it only decides how
// an already-known time is printed, never what is fetched or stored.
const TIME_FORMAT_OPTIONS = [
  { value: '12', label: '12-hour' },
  { value: '24', label: '24-hour' },
];

export default function TimeFormatSettings({ settings, settingsLoading, onSetTimeFormat, onSetClockShowSeconds }) {
  return (
    <div className="time-format-settings">
      <p className="settings-label section-label">Time format</p>
      <div className="segmented" role="group" aria-label="Time format">
        {TIME_FORMAT_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={`segmented__option${settings?.timeFormat === value ? ' is-active' : ''}`}
            disabled={settingsLoading}
            onClick={() => onSetTimeFormat(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="settings-notice">Applies to every time on the wall — clock, agenda, to-do due dates and sun times.</p>

      {/* A second time setting rather than a third option on the segmented
          control, because it isn't a way of writing the same time — it's
          whether the wall's clock ticks at all. Seconds are what prove the
          display is alive when you glance at it; someone who finds that
          distracting wants them gone without also losing the 12/24-hour
          choice they already made. */}
      <div className="setting-toggle">
        <span className="setting-toggle__label">Show seconds</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={Boolean(settings?.clockShowSeconds)}
            disabled={settingsLoading}
            onChange={(e) => onSetClockShowSeconds(e.target.checked)}
          />
          <span className="switch__track" />
        </label>
      </div>
      {/* Says "the clock" and not "every time on the wall" on purpose: event
          times and sun times never show seconds, whatever this is set to. */}
      <p className="settings-notice">Clock only — event times and sun times stay as they are.</p>
    </div>
  );
}
