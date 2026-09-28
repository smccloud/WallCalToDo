import LocationSettings from './LocationSettings.jsx';
import ThemeSettings from './ThemeSettings.jsx';
import UnitsSettings from './UnitsSettings.jsx';
import WeatherViewSettings from './WeatherViewSettings.jsx';

// Privacy, then location (shared by theme and the units below, so it comes
// before both), then theme, then units, then the full-screen weather view —
// last, because it's the one setting here that depends on everything above it:
// it needs a location, and it's about what the display does with one rather
// than how it looks.
export default function GeneralSettings({
  settings,
  settingsLoading,
  onSetPrivacyMode,
  onSetTheme,
  onSetAdvancedEnabled,
  onSetOffset,
  onSetTempUnit,
  onSetWindUnit,
  onSetPrecipUnit,
  onSetWeatherInterval,
  onSetWeatherDuration,
  onSaveLocation,
  onError,
}) {
  return (
    <section className="settings-card">
      <div className="privacy-toggle">
        <span className="settings-label">Privacy mode</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={Boolean(settings?.privacyMode)}
            disabled={settingsLoading}
            onChange={(e) => onSetPrivacyMode(e.target.checked)}
          />
          <span className="switch__track" />
        </label>
      </div>
      <p className="privacy-toggle__hint">
        Hides event titles (only their colored pills stay visible) and replaces today's agenda and the to-do
        list with a placeholder notice on the wall display.
      </p>

      <LocationSettings settings={settings} onSaveLocation={onSaveLocation} onError={onError} />

      <ThemeSettings
        settings={settings}
        settingsLoading={settingsLoading}
        onSetTheme={onSetTheme}
        onSetAdvancedEnabled={onSetAdvancedEnabled}
        onSetOffset={onSetOffset}
      />

      <UnitsSettings
        settings={settings}
        settingsLoading={settingsLoading}
        onSetTempUnit={onSetTempUnit}
        onSetWindUnit={onSetWindUnit}
        onSetPrecipUnit={onSetPrecipUnit}
      />

      <WeatherViewSettings
        settings={settings}
        settingsLoading={settingsLoading}
        onSetWeatherInterval={onSetWeatherInterval}
        onSetWeatherDuration={onSetWeatherDuration}
      />
    </section>
  );
}
