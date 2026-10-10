import LocationSettings from './LocationSettings.jsx';
import ThemeSettings from './ThemeSettings.jsx';
import TimeFormatSettings from './TimeFormatSettings.jsx';
import UnitsSettings from './UnitsSettings.jsx';
import WeatherViewSettings from './WeatherViewSettings.jsx';

// Privacy, then location (shared by theme and the units below, so it comes
// before both), then theme, then time format (also location-free, and part
// of how the display looks like the theme above it), then units, then the
// Microsoft section on/off (it decides whether Office365 content shows on the
// wall, so it sits with the display-content settings rather than the account
// sections further down the page), then the full-screen weather view — last,
// because it's the one setting here that depends on everything above it: it
// needs a location, and it's about what the display does with one rather than
// how it looks.
export default function GeneralSettings({
  settings,
  settingsLoading,
  onSetPrivacyMode,
  onSetTheme,
  onSetAdvancedEnabled,
  onSetMicrosoftEnabled,
  onSetOffset,
  onSetTempUnit,
  onSetWindUnit,
  onSetPrecipUnit,
  onSetTimeFormat,
  onSetClockShowSeconds,
  onSetClockFlashDivider,
  onSetWeatherInterval,
  onSetWeatherDuration,
  onSetWeatherHourlyHours,
  onSetWeatherDailyDays,
  onSetWeatherEnabled,
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

      <TimeFormatSettings
        settings={settings}
        settingsLoading={settingsLoading}
        onSetTimeFormat={onSetTimeFormat}
        onSetClockShowSeconds={onSetClockShowSeconds}
        onSetClockFlashDivider={onSetClockFlashDivider}
      />

      <UnitsSettings
        settings={settings}
        settingsLoading={settingsLoading}
        onSetTempUnit={onSetTempUnit}
        onSetWindUnit={onSetWindUnit}
        onSetPrecipUnit={onSetPrecipUnit}
      />

      <div className="microsoft-toggle">
        <span className="settings-label">Show Microsoft section</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={Boolean(settings?.microsoftEnabled)}
            disabled={settingsLoading}
            onChange={(e) => onSetMicrosoftEnabled(e.target.checked)}
          />
          <span className="switch__track" />
        </label>
      </div>
      <p className="microsoft-toggle__hint">
        Shows your Office365 calendars and to-do lists on the wall display. Turn it off to leave them out
        without disconnecting the account.
      </p>

      <WeatherViewSettings
        settings={settings}
        settingsLoading={settingsLoading}
        onSetWeatherInterval={onSetWeatherInterval}
        onSetWeatherDuration={onSetWeatherDuration}
        onSetWeatherHourlyHours={onSetWeatherHourlyHours}
        onSetWeatherDailyDays={onSetWeatherDailyDays}
        onSetWeatherEnabled={onSetWeatherEnabled}
      />
    </section>
  );
}
