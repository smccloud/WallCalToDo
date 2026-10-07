// How the wall prints clock times: "5:21 pm" or "17:21".
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

export default function TimeFormatSettings({ settings, settingsLoading, onSetTimeFormat }) {
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
    </div>
  );
}
