import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WeatherViewSettings from '../src/components/WeatherViewSettings.jsx';

// Every handler is a spy by default so a test can assert on the one it cares
// about, and so an unexpected call from one control can't blow up on an
// undefined prop the way a bare () => {} would hide.
const HANDLERS = () => ({
  onSetWeatherEnabled: vi.fn(),
  onSetWeatherInterval: vi.fn(),
  onSetWeatherDuration: vi.fn(),
  onSetWeatherHourlyHours: vi.fn(),
  onSetWeatherDailyDays: vi.fn(),
});

const ON = {
  weatherEnabled: true,
  weatherIntervalMinutes: 60,
  weatherDurationSeconds: 60,
  weatherHourlyHours: 24,
  weatherDailyDays: 10,
  location: { lat: 1, lon: 1 },
};

const labels = () => [...document.querySelectorAll('.settings-label')].map((el) => el.textContent);
const selectLabelled = (name) =>
  document.querySelector(`select[aria-label="${name}"]`);

// Scoped by the group's own aria-label rather than by ".segmented__option",
// which matches both segmented controls on this card — reaching for it
// unscoped picks up the duration buttons along with the interval ones.
const groupOptions = (name) => [
  ...document.querySelector(`[aria-label="${name}"]`).querySelectorAll('.segmented__option'),
];
const weatherSwitch = () =>
  [...document.querySelectorAll('.setting-toggle')]
    .find((row) => row.querySelector('.setting-toggle__label').textContent === 'Show the weather view')
    .querySelector('input[type="checkbox"]');

describe('WeatherViewSettings', () => {
  describe('the on/off switch', () => {
    it('shows only itself while the view is off', () => {
      render(<WeatherViewSettings settings={{ ...ON, weatherEnabled: false }} settingsLoading={false} {...HANDLERS()} />);

      expect(weatherSwitch().checked).toBe(false);
      // Every other control configures a view that never comes up, so none of
      // them should be on screen to be adjusted and then ignored.
      expect(document.querySelectorAll('.segmented')).toHaveLength(0);
      expect(document.querySelectorAll('select')).toHaveLength(0);
    });

    it('shows nothing but the switch on a fresh install, before settings load', () => {
      render(<WeatherViewSettings settings={null} settingsLoading={true} {...HANDLERS()} />);

      expect(weatherSwitch().checked).toBe(false);
      expect(weatherSwitch().disabled).toBe(true);
      expect(document.querySelectorAll('.segmented')).toHaveLength(0);
    });

    it('shows the rest of the settings once the view is on', () => {
      render(<WeatherViewSettings settings={ON} settingsLoading={false} {...HANDLERS()} />);

      expect(weatherSwitch().checked).toBe(true);
      expect(labels()).toEqual(['Weather view', 'How often', 'For how long', 'Hours of forecast', 'Days of forecast']);
    });

    it('turns the view off on its own', () => {
      const handlers = HANDLERS();
      render(<WeatherViewSettings settings={ON} settingsLoading={false} {...handlers} />);

      fireEvent.click(weatherSwitch());

      expect(handlers.onSetWeatherEnabled).toHaveBeenCalledWith(false);
    });

    it('gives a legacy install an interval to repeat on when it turns the view on', () => {
      // An install saved before the switch existed may still have an interval
      // of 0 — back then that meant "off". Enabling on top of it would
      // produce a view that never appears and no obvious reason why, so both
      // settings go out together.
      const handlers = HANDLERS();
      render(
        <WeatherViewSettings settings={{ ...ON, weatherEnabled: false, weatherIntervalMinutes: 0 }} settingsLoading={false} {...handlers} />
      );

      fireEvent.click(weatherSwitch());

      expect(handlers.onSetWeatherEnabled).toHaveBeenCalledWith(true, { weatherIntervalMinutes: 15 });
    });

    it('leaves a working interval alone when it turns the view on', () => {
      const handlers = HANDLERS();
      render(<WeatherViewSettings settings={{ ...ON, weatherEnabled: false }} settingsLoading={false} {...handlers} />);

      fireEvent.click(weatherSwitch());

      expect(handlers.onSetWeatherEnabled).toHaveBeenCalledWith(true);
    });
  });

  describe('the interval', () => {
    it('has no "Off" option, since the switch is what turns the view off', () => {
      render(<WeatherViewSettings settings={ON} settingsLoading={false} {...HANDLERS()} />);

      // Two controls that mean the same thing and can disagree is worse than
      // one: someone picks "Off" here and the switch above still reads on.
      const options = groupOptions('How often the weather view appears').map((b) => b.textContent);
      expect(options).toEqual(['15 min', '30 min', 'Hour', '2 hours', '3 hours', '6 hours']);
    });

    it('marks the interval in effect', () => {
      render(<WeatherViewSettings settings={{ ...ON, weatherIntervalMinutes: 120 }} settingsLoading={false} {...HANDLERS()} />);

      const buttons = groupOptions('How often the weather view appears');
      expect(buttons.find((b) => b.textContent === '2 hours').className).toContain('is-active');
    });

    it('always has something marked, even on a legacy 0 interval', () => {
      // A saved 0 can survive an upgrade (the API still accepts it). Falling
      // back to 0 would leave the control with nothing selected at all.
      render(<WeatherViewSettings settings={{ ...ON, weatherIntervalMinutes: 0 }} settingsLoading={false} {...HANDLERS()} />);

      const active = groupOptions('How often the weather view appears')
        .filter((b) => b.className.includes('is-active'))
        .map((b) => b.textContent);
      expect(active).toEqual(['15 min']);
    });
  });

  describe('hours of forecast', () => {
    it('offers every hour from 1 to 24', () => {
      render(<WeatherViewSettings settings={ON} settingsLoading={false} {...HANDLERS()} />);

      const options = [...selectLabelled('How many hours of hourly forecast to show').options];
      expect(options).toHaveLength(24);
      expect(options[0].value).toBe('1');
      expect(options[23].value).toBe('24');
      // Singular for one, plural for the rest — how a person says it.
      expect(options[0].textContent).toBe('1 hour');
      expect(options[2].textContent).toBe('3 hours');
    });

    it('shows the count in effect and sends the number, not the string', () => {
      const handlers = HANDLERS();
      render(<WeatherViewSettings settings={{ ...ON, weatherHourlyHours: 6 }} settingsLoading={false} {...handlers} />);

      const select = selectLabelled('How many hours of hourly forecast to show');
      expect(select.value).toBe('6');

      fireEvent.change(select, { target: { value: '18' } });
      expect(handlers.onSetWeatherHourlyHours).toHaveBeenCalledWith(18);
    });
  });

  describe('days of forecast', () => {
    it('offers every day from 5 to 10', () => {
      render(<WeatherViewSettings settings={ON} settingsLoading={false} {...HANDLERS()} />);

      const options = [...selectLabelled('How many days of daily forecast to show').options];
      expect(options).toHaveLength(6);
      expect(options[0].value).toBe('5');
      expect(options[5].value).toBe('10');
      expect(options[5].textContent).toBe('10 days');
    });

    it('shows the count in effect and sends the number, not the string', () => {
      const handlers = HANDLERS();
      render(<WeatherViewSettings settings={{ ...ON, weatherDailyDays: 7 }} settingsLoading={false} {...handlers} />);

      const select = selectLabelled('How many days of daily forecast to show');
      expect(select.value).toBe('7');

      fireEvent.change(select, { target: { value: '5' } });
      expect(handlers.onSetWeatherDailyDays).toHaveBeenCalledWith(5);
    });
  });

  it('describes both counts in the hint, so the card explains itself', () => {
    render(<WeatherViewSettings settings={{ ...ON, weatherHourlyHours: 6, weatherDailyDays: 7 }} settingsLoading={false} {...HANDLERS()} />);

    expect(document.querySelector('.location-settings__hint').textContent).toContain('6 hours hour by hour');
    expect(document.querySelector('.location-settings__hint').textContent).toContain('7 days day by day');
  });

  it('locks every control while a save is in flight', () => {
    render(<WeatherViewSettings settings={ON} settingsLoading={true} {...HANDLERS()} />);

    expect(weatherSwitch().disabled).toBe(true);
    for (const button of document.querySelectorAll('.segmented__option')) {
      expect(button.disabled).toBe(true);
    }
    for (const select of document.querySelectorAll('select')) {
      expect(select.disabled).toBe(true);
    }
  });
});