import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WallClock from '../src/components/WallClock.jsx';

afterEach(() => {
  vi.useRealTimers();
});

function renderAt(time, props) {
  vi.useFakeTimers();
  vi.setSystemTime(time);
  return render(<WallClock {...props} />);
}

describe('WallClock', () => {
  it('shows the fixed moment with seconds, in whichever format it was given', () => {
    const noonish = new Date(2026, 5, 21, 17, 21, 7);

    const { unmount } = renderAt(noonish, { timeFormat: '24' });
    expect(document.body.textContent).toBe('17:21:07');
    unmount();

    renderAt(noonish, { timeFormat: '12' });
    expect(document.body.textContent).toBe('5:21:07 pm');
  });

  it('ticks forward one second at a time on its own timer', () => {
    renderAt(new Date(2026, 5, 21, 17, 21, 7), { timeFormat: '24' });

    act(() => vi.advanceTimersByTime(1000));
    expect(document.body.textContent).toBe('17:21:08');

    act(() => vi.advanceTimersByTime(3000));
    expect(document.body.textContent).toBe('17:21:11');
  });

  it('keeps its tick to itself: only it re-renders', () => {
    // The whole reason WallClock owns its interval (see the comment at the
    // top of the component): advancing the clock must not need a prop change.
    renderAt(new Date(2026, 5, 21, 23, 59, 58), { timeFormat: '24' });

    act(() => vi.advanceTimersByTime(2000));
    expect(document.body.textContent).toBe('00:00:00'); // midnight rollover
  });

  it('passes its className through to the span it renders', () => {
    renderAt(new Date(2026, 5, 21, 12, 0, 0), {
      timeFormat: '24',
      className: 'header-clock',
    });
    expect(document.querySelector('span.header-clock')).not.toBeNull();
  });

  describe('showSeconds', () => {
    it('drops the seconds when turned off, in both formats', () => {
      const noonish = new Date(2026, 5, 21, 17, 21, 7);

      const { unmount } = renderAt(noonish, { timeFormat: '24', showSeconds: false });
      expect(document.body.textContent).toBe('17:21');
      unmount();

      renderAt(noonish, { timeFormat: '12', showSeconds: false });
      expect(document.body.textContent).toBe('5:21 pm');
    });

    it('shows them when on', () => {
      renderAt(new Date(2026, 5, 21, 17, 21, 7), { timeFormat: '24', showSeconds: true });
      expect(document.body.textContent).toBe('17:21:07');
    });

    it('defaults to on, so the clock does not lose its seconds while settings load', () => {
      // Settings haven't arrived yet on first paint — clockShowSeconds is
      // undefined, not false. Showing them keeps the clock from visibly
      // dropping the seconds and growing them back a moment later.
      renderAt(new Date(2026, 5, 21, 17, 21, 7), { timeFormat: '24' });
      expect(document.body.textContent).toBe('17:21:07');
    });

    it('still rolls the minute over with the seconds off', () => {
      // The whole point of the clock owning a 1Hz timer is that `now` stays
      // honest; turning the seconds off must not turn that off with them.
      renderAt(new Date(2026, 5, 21, 23, 59, 58), { timeFormat: '24', showSeconds: false });

      act(() => vi.advanceTimersByTime(2000));
      expect(document.body.textContent).toBe('00:00'); // midnight rollover
    });
  });
});
