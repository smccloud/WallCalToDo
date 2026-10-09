import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WeatherWidget from '../src/components/WeatherWidget.jsx';

afterEach(() => {
  vi.useRealTimers();
});

const SUN = {
  sunrise: new Date(2026, 5, 21, 5, 30).toISOString(),
  sunset: new Date(2026, 5, 21, 20, 45).toISOString(),
};

const WEATHER = {
  weatherEmoji: '⛅',
  moonPhase: { emoji: '🌕' },
  tempC: 21.6,
  tempF: 70.9,
  isUnhealthyAir: false,
};

function renderAt(time, weather, settings) {
  vi.useFakeTimers();
  vi.setSystemTime(time);
  return render(<WeatherWidget weather={weather} settings={settings} />);
}

const DAY = new Date(2026, 5, 21, 15, 0);
const NIGHT = new Date(2026, 5, 21, 21, 30);
const PREDAWN = new Date(2026, 5, 21, 4, 0);

describe('WeatherWidget', () => {
  it('renders nothing before the first reading lands', () => {
    const { container } = renderAt(DAY, null, SUN);
    expect(container.firstChild).toBeNull();
  });

  it('shows the weather icon and a rounded Fahrenheit temperature by day', () => {
    renderAt(DAY, WEATHER, { ...SUN, tempUnit: 'F' });
    expect(document.body.textContent).toBe('⛅71°F');
  });

  it('shows the moon instead once the sun has set', () => {
    renderAt(NIGHT, WEATHER, { ...SUN, tempUnit: 'F' });
    expect(document.body.textContent).toBe('🌕71°F');
  });

  it('counts the hours before sunrise as night too', () => {
    renderAt(PREDAWN, WEATHER, { ...SUN, tempUnit: 'F' });
    expect(document.body.textContent).toBe('🌕71°F');
  });

  it('switches to Celsius when the companion app asked for it', () => {
    renderAt(DAY, WEATHER, { ...SUN, tempUnit: 'C' });
    expect(document.body.textContent).toBe('⛅22°C');
  });

  it('lets unhealthy air win over both the conditions and the moon', () => {
    renderAt(NIGHT, { ...WEATHER, isUnhealthyAir: true }, { ...SUN, tempUnit: 'F' });
    expect(document.body.textContent).toBe('😷71°F');
  });

  it('falls back to the weather icon when there are no sun times to judge by', () => {
    // No location, or a latitude where the sun neither rises nor sets: better
    // the plain weather icon than guessing at night.
    renderAt(NIGHT, WEATHER, { tempUnit: 'F' });
    expect(document.body.textContent).toBe('⛅71°F');
  });
});
