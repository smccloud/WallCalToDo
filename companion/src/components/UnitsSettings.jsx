// The units the wall prints weather in.
//
// The values are the ones the API validates against (WIND_UNITS /
// PRECIP_UNITS in server/src/routes/settings.js, alongside tempUnit's own
// 'F'/'C'); the labels are what a person should read on a button. They live
// in the same place in the list as the value they set, so adding an option
// means adding it to both -- a value the server doesn't know is a 400, not a
// quietly-ignored control.
//
// Every reading is cached in one canonical unit (Celsius and Fahrenheit both,
// km/h, mm -- see weatherService.js) and converted at display time by
// frontend/src/utils/units.js, so choosing a unit here never triggers a
// refetch or changes what is stored, only what it reads as.
const TEMP_OPTIONS = [
  { value: 'F', label: '°F' },
  { value: 'C', label: '°C' },
];

const WIND_OPTIONS = [
  { value: 'mph', label: 'mph' },
  { value: 'kmh', label: 'km/h' },
  { value: 'ms', label: 'm/s' },
  { value: 'kn', label: 'kn' },
];

const PRECIP_OPTIONS = [
  { value: 'inch', label: 'in' },
  { value: 'mm', label: 'mm' },
];

// One row of the section, so the three read as a set rather than as three
// separate settings that happen to be near each other. `label` doubles as the
// group name, which is what a screen reader announces for the buttons inside.
function UnitRow({ label, options, value, disabled, onChange }) {
  return (
    <div className="units-settings__row">
      <p className="settings-label">{label}</p>
      <div className="segmented" role="group" aria-label={`${label} unit`}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`segmented__option${value === option.value ? ' is-active' : ''}`}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Temperature, wind speed and precipitation units, in one place. All three
// are disabled (with an explanatory notice) until a location is set -- there's
// nothing to show units for without one, since every reading comes from that
// location. The temperature unit predates the other two and already worked
// this way; the rule just now covers three controls instead of one.
export default function UnitsSettings({
  settings,
  settingsLoading,
  onSetTempUnit,
  onSetWindUnit,
  onSetPrecipUnit,
}) {
  const disabled = settingsLoading || !settings?.location;
  return (
    <div className="units-settings">
      <p className="settings-label section-label">Units</p>

      <UnitRow
        label="Temperature"
        options={TEMP_OPTIONS}
        value={settings?.tempUnit}
        disabled={disabled}
        onChange={onSetTempUnit}
      />
      <UnitRow
        label="Wind speed"
        options={WIND_OPTIONS}
        value={settings?.windUnit}
        disabled={disabled}
        onChange={onSetWindUnit}
      />
      <UnitRow
        label="Precipitation"
        options={PRECIP_OPTIONS}
        value={settings?.precipUnit}
        disabled={disabled}
        onChange={onSetPrecipUnit}
      />

      {!settings?.location && <p className="settings-notice">Set a location to see the weather.</p>}
    </div>
  );
}
