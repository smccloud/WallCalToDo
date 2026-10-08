import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SunTimes from '../src/components/SunTimes.jsx';

afterEach(() => {
  vi.useRealTimers();
});

// Today and tomorrow, sent as the absolute timestamps getSettings builds.
const SUN = {
  sunrise: new Date(2026, 5, 21, 5, 30).toISOString(),
  sunset: new Date(2026, 5, 21, 20, 45).toISOString(),
  sunriseTomorrow: new Date(2026, 5, 22, 5, 31).toISOString(),
  sunsetTomorrow: new Date(2026, 5, 22, 20, 45).toISOString(),
};

function renderAt(time, settings) {
  vi.useFakeTimers();
  vi.setSystemTime(time);
  return render(<SunTimes settings={settings} />);
}

describe('SunTimes', () => {
  it('renders nothing at all without a saved location', () => {
    const { container } = renderAt(new Date(2026, 5, 21, 15, 0), { sunrise: null, sunset: null });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when handed no settings yet', () => {
    const { container } = renderAt(new Date(2026, 5, 21, 15, 0), undefined);
    expect(container.firstChild).toBeNull();
  });

  it('offers today’s sunset while the sun is still up', () => {
    const { getByText } = renderAt(new Date(2026, 5, 21, 15, 0), { ...SUN, timeFormat: '24' });
    expect(getByText('Sunset at')).toBeDefined();
    expect(document.body.textContent).toContain('20:45');
  });

  it('offers today’s sunrise while it is still dark', () => {
    const { getByText } = renderAt(new Date(2026, 5, 21, 4, 0), { ...SUN, timeFormat: '24' });
    expect(getByText('Sunrise at')).toBeDefined();
    expect(document.body.textContent).toContain('5:30');
  });

  it('moves on to tomorrow’s sunrise once today’s has passed', () => {
    // The server sends tomorrow's pair for exactly this: at 9pm today's
    // sunrise is two hours old and cannot be presented as upcoming.
    const { getByText } = renderAt(new Date(2026, 5, 21, 21, 0), { ...SUN, timeFormat: '24' });
    expect(getByText('Sunrise tomorrow at')).toBeDefined();
    expect(document.body.textContent).toContain('5:31');
  });

  it('picks the format the companion app chose', () => {
    renderAt(new Date(2026, 5, 21, 15, 0), { ...SUN, timeFormat: '12' });
    expect(document.body.textContent).toContain('8:45 pm');
  });

  it('shows the next event even when tomorrow’s pair was not sent', () => {
    const { getByText } = renderAt(new Date(2026, 5, 21, 15, 0), {
      sunrise: SUN.sunrise,
      sunset: SUN.sunset,
      timeFormat: '24',
    });
    expect(getByText('Sunset at')).toBeDefined();
  });
});
