import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UnitsSettings from '../src/components/UnitsSettings.jsx';

function renderUnits(settings, handlers = {}) {
  return render(
    <UnitsSettings
      settings={settings}
      settingsLoading={false}
      onSetTempUnit={handlers.temp ?? vi.fn()}
      onSetWindUnit={handlers.wind ?? vi.fn()}
      onSetPrecipUnit={handlers.precip ?? vi.fn()}
    />
  );
}

const WITH_LOCATION = { location: { label: 'Austin, TX', lat: 30.27, lon: -97.74 }, tempUnit: 'F', windUnit: 'mph', precipUnit: 'inch' };

describe('UnitsSettings', () => {
  it('marks the unit in effect for each of the three rows', () => {
    renderUnits({ ...WITH_LOCATION, tempUnit: 'C', windUnit: 'kn', precipUnit: 'mm' });

    const active = [...document.querySelectorAll('.segmented__option.is-active')].map((button) => button.textContent);
    expect(active).toEqual(['°C', 'kn', 'mm']);
  });

  it('disables everything and says why until a location is set', () => {
    const { getByText } = renderUnits({ tempUnit: 'F', windUnit: 'mph', precipUnit: 'inch' });

    expect(getByText('Set a location to see the weather.')).toBeDefined();
    for (const button of document.querySelectorAll('.segmented__option')) {
      expect(button.disabled).toBe(true);
    }
  });

  it('enables the controls once there is a location', () => {
    renderUnits(WITH_LOCATION);

    expect(document.body.textContent).not.toContain('Set a location to see the weather.');
    for (const button of document.querySelectorAll('.segmented__option')) {
      expect(button.disabled).toBe(false);
    }
  });

  it('sends each pick to its own setter, in the API value rather than the label', () => {
    const onSetTempUnit = vi.fn();
    const onSetWindUnit = vi.fn();
    const onSetPrecipUnit = vi.fn();
    renderUnits(WITH_LOCATION, { temp: onSetTempUnit, wind: onSetWindUnit, precip: onSetPrecipUnit });

    const button = (name) => [...document.querySelectorAll('.segmented__option')].find((b) => b.textContent === name);
    fireEvent.click(button('°C'));
    fireEvent.click(button('km/h'));
    fireEvent.click(button('mm'));

    expect(onSetTempUnit).toHaveBeenCalledWith('C');
    expect(onSetWindUnit).toHaveBeenCalledWith('kmh');
    expect(onSetPrecipUnit).toHaveBeenCalledWith('mm');
  });
});
