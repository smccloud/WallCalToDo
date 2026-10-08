import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GeneralSettings from '../src/components/GeneralSettings.jsx';

// The whole settings card: the sections it composes, and the privacy toggle
// that guards everything else on the wall.

const SETTINGS = {
  privacyMode: true,
  location: { label: 'Austin, TX', lat: 30.27, lon: -97.74 },
  theme: 'auto',
  advancedEnabled: false,
  sunrise: new Date('2026-06-21T11:30:00Z').toISOString(),
  sunset: new Date('2026-06-22T01:45:00Z').toISOString(),
  sunriseOffset: { minutes: 30, direction: 'before' },
  sunsetOffset: { minutes: 0, direction: 'after' },
  timeFormat: '12',
  tempUnit: 'F',
  windUnit: 'mph',
  precipUnit: 'inch',
  weatherIntervalMinutes: 60,
  weatherDurationSeconds: 60,
};

const HANDLER_NAMES = [
  'onSetPrivacyMode',
  'onSetTheme',
  'onSetAdvancedEnabled',
  'onSetOffset',
  'onSetTempUnit',
  'onSetWindUnit',
  'onSetPrecipUnit',
  'onSetTimeFormat',
  'onSetWeatherInterval',
  'onSetWeatherDuration',
  'onSaveLocation',
  'onError',
];

function renderCard({ settings = SETTINGS, settingsLoading = false, ...overrides } = {}) {
  const handlers = Object.fromEntries(HANDLER_NAMES.map((name) => [name, overrides[name] ?? vi.fn()]));
  const utils = render(
    <GeneralSettings settings={settings} settingsLoading={settingsLoading} {...handlers} />
  );
  return { handlers, ...utils };
}

describe('GeneralSettings', () => {
  it('renders every section it is meant to compose', () => {
    const { getByText } = renderCard();

    for (const heading of ['Privacy mode', 'Location', 'Theme', 'Time format', 'Units', 'Weather view']) {
      expect(getByText(heading)).toBeDefined();
    }
  });

  it('shows privacy mode as on and reports it switching off', () => {
    const { handlers, container } = renderCard();
    const toggle = container.querySelector('.privacy-toggle input[type="checkbox"]');

    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);
    expect(handlers.onSetPrivacyMode).toHaveBeenCalledWith(false);
  });

  it('shows privacy mode as off when the setting is off', () => {
    const { container } = renderCard({ settings: { ...SETTINGS, privacyMode: false } });

    expect(container.querySelector('.privacy-toggle input[type="checkbox"]').checked).toBe(false);
  });

  it('wires the theme picker through to its handler', () => {
    const { handlers, getByRole } = renderCard();

    fireEvent.click(getByRole('button', { name: 'Dark' }));
    expect(handlers.onSetTheme).toHaveBeenCalledWith('dark');
  });

  it('wires the weather-view interval through to its handler', () => {
    const { handlers, getByRole } = renderCard();

    fireEvent.click(getByRole('button', { name: '2 hours' }));
    expect(handlers.onSetWeatherInterval).toHaveBeenCalledWith(120);
  });

  it('locks the section controls while a save is in flight', () => {
    const { getByRole } = renderCard({ settingsLoading: true });

    expect(getByRole('button', { name: 'Dark' }).disabled).toBe(true);
  });
});
