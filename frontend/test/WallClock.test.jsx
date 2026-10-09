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

  describe('flashDivider', () => {
    function dividers() {
      return [...document.querySelectorAll('.clock-divider')];
    }

    it('leaves the colons plain by default', () => {
      renderAt(new Date(2026, 5, 21, 17, 21, 7), { timeFormat: '24' });
      // Default off, like the setting itself: an upgrade must not start
      // blinking on somebody's wall.
      for (const divider of dividers()) {
        expect(divider.className).toBe('clock-divider');
      }
    });

    it('marks every divider for flashing, both colons when seconds are on', () => {
      renderAt(new Date(2026, 5, 21, 17, 21, 7), { timeFormat: '24', flashDivider: true });

      const marked = dividers().filter((divider) => divider.className.includes('clock-divider--flash'));
      expect(marked).toHaveLength(2);
    });

    it('does not change the text it renders', () => {
      // The blink is decoration on a colon that was already there — if this
      // ever fails, the setting has changed what the clock says rather than
      // how it looks.
      renderAt(new Date(2026, 5, 21, 17, 21, 7), { timeFormat: '12', flashDivider: true });
      expect(document.body.textContent).toBe('5:21:07 pm');
    });

    it('flashes on its own without the clock re-rendering', () => {
      // The blink is CSS, deliberately: tying it to the 1Hz tick would mean
      // a re-render per second per colon for no gain, and an animation the
      // compositor can run without React at all.
      renderAt(new Date(2026, 5, 21, 17, 21, 7), { timeFormat: '24', flashDivider: true });
      const before = dividers()[0];
      expect(getComputedStyle(before).animationName).not.toBe('');

      act(() => vi.advanceTimersByTime(1000));
      // Same element, same animation — only the digits around it changed.
      expect(dividers()[0]).toBe(before);
    });
  });

  // The display is a Pi with nothing plugged into it but a screen: nobody can
  // reload its page to pick up a setting changed from the companion app, so
  // every setting has to land on the existing tree. This is the test for
  // that — it fails if the clock ever caches the setting or the formatted
  // string internally instead of reading them per render.
  describe('a settings change arriving over the websocket', () => {
    const noonish = new Date(2026, 5, 21, 17, 21, 7);

    it('turns the seconds off without the clock remounting', () => {
      vi.useFakeTimers();
      vi.setSystemTime(noonish);
      const { rerender, container } = render(
        <WallClock className="wall-clock" timeFormat="24" showSeconds flashDivider={false} />
      );
      expect(container.textContent).toBe('17:21:07');

      // Same component instance, new props — which is what a pushed settings
      // message looks like from in here.
      rerender(<WallClock className="wall-clock" timeFormat="24" showSeconds={false} flashDivider={false} />);
      expect(container.textContent).toBe('17:21');
    });

    it('turns the blinking on without the clock remounting', () => {
      vi.useFakeTimers();
      vi.setSystemTime(noonish);
      const { rerender, container } = render(
        <WallClock className="wall-clock" timeFormat="24" showSeconds flashDivider={false} />
      );
      expect(container.querySelector('.clock-divider--flash')).toBeNull();

      rerender(<WallClock className="wall-clock" timeFormat="24" showSeconds flashDivider />);
      expect(container.querySelectorAll('.clock-divider--flash')).toHaveLength(2);
    });

    it('keeps ticking across the change rather than freezing until reload', () => {
      vi.useFakeTimers();
      vi.setSystemTime(noonish);
      const { rerender, container } = render(
        <WallClock className="wall-clock" timeFormat="24" showSeconds flashDivider={false} />
      );

      act(() => vi.advanceTimersByTime(1000));
      rerender(<WallClock className="wall-clock" timeFormat="24" showSeconds flashDivider />);
      act(() => vi.advanceTimersByTime(1000));

      expect(container.textContent).toBe('17:21:09');
    });
  });
});
