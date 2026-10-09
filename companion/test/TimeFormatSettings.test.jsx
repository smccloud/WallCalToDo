import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TimeFormatSettings from '../src/components/TimeFormatSettings.jsx';

describe('TimeFormatSettings', () => {
  it('marks the format currently in effect', () => {
    render(<TimeFormatSettings settings={{ timeFormat: '24' }} settingsLoading={false} onSetTimeFormat={() => {}} />);

    const buttons = [...document.querySelectorAll('.segmented__option')];
    expect(buttons.find((button) => button.textContent === '24-hour').className).toContain('is-active');
    expect(buttons.find((button) => button.textContent === '12-hour').className).not.toContain('is-active');
  });

  it('leaves both unmarked while settings are still loading', () => {
    render(<TimeFormatSettings settings={null} settingsLoading={true} onSetTimeFormat={() => {}} />);

    for (const button of document.querySelectorAll('.segmented__option')) {
      expect(button.className).not.toContain('is-active');
    }
  });

  it('sends the API value, not the label, when one is picked', () => {
    const onSetTimeFormat = vi.fn();
    render(<TimeFormatSettings settings={{ timeFormat: '12' }} settingsLoading={false} onSetTimeFormat={onSetTimeFormat} />);

    fireEvent.click([...document.querySelectorAll('.segmented__option')].find((b) => b.textContent === '24-hour'));

    expect(onSetTimeFormat).toHaveBeenCalledWith('24');
  });

  it('locks the buttons while a save is in flight', () => {
    render(<TimeFormatSettings settings={{ timeFormat: '12' }} settingsLoading={true} onSetTimeFormat={() => {}} />);

    for (const button of document.querySelectorAll('.segmented__option')) {
      expect(button.disabled).toBe(true);
    }
  });

  // Both sub-toggles are found by their label rather than by position: the
  // section now has two switches, and a "first .setting-toggle" selector
  // would silently start testing the wrong one the next time one is added.
  function toggleLabelled(label) {
    const row = [...document.querySelectorAll('.setting-toggle')].find(
      (row) => row.querySelector('.setting-toggle__label').textContent === label
    );
    return row.querySelector('input[type="checkbox"]');
  }

  const ALL_HANDLERS = {
    onSetTimeFormat: () => {},
    onSetClockShowSeconds: () => {},
    onSetClockFlashDivider: () => {},
  };

  describe('show seconds', () => {
    it('reflects whether the wall clock is currently showing seconds', () => {
      render(
        <TimeFormatSettings
          settings={{ timeFormat: '12', clockShowSeconds: true }}
          settingsLoading={false}
          {...ALL_HANDLERS}
        />
      );
      expect(toggleLabelled('Show seconds').checked).toBe(true);
    });

    it('sends a real boolean when flipped, not the event', () => {
      const onSetClockShowSeconds = vi.fn();
      render(
        <TimeFormatSettings
          settings={{ timeFormat: '12', clockShowSeconds: false }}
          settingsLoading={false}
          {...ALL_HANDLERS}
          onSetClockShowSeconds={onSetClockShowSeconds}
        />
      );

      fireEvent.click(toggleLabelled('Show seconds'));

      expect(onSetClockShowSeconds).toHaveBeenCalledWith(true);
    });

    it('reads off while settings are still loading, and cannot be flipped mid-save', () => {
      render(<TimeFormatSettings settings={null} settingsLoading={true} {...ALL_HANDLERS} />);
      // Same as every other toggle in this app (privacy, advanced): no
      // settings means nothing to reflect, so the control reads off until
      // the fetch lands. The wall clock doesn't flicker with it -- it keeps
      // its own default-until-known behavior (see WallClock.jsx).
      const toggle = toggleLabelled('Show seconds');
      expect(toggle.checked).toBe(false);
      expect(toggle.disabled).toBe(true);
    });
  });

  describe('flash divider', () => {
    it('reflects whether the colons are currently blinking', () => {
      render(
        <TimeFormatSettings
          settings={{ timeFormat: '12', clockFlashDivider: true }}
          settingsLoading={false}
          {...ALL_HANDLERS}
        />
      );
      expect(toggleLabelled('Flash the divider').checked).toBe(true);
    });

    it('defaults to off, matching the setting default', () => {
      render(
        <TimeFormatSettings
          settings={{ timeFormat: '12', clockFlashDivider: false }}
          settingsLoading={false}
          {...ALL_HANDLERS}
        />
      );
      expect(toggleLabelled('Flash the divider').checked).toBe(false);
    });

    it('sends a real boolean when flipped, on its own setting', () => {
      const onSetClockFlashDivider = vi.fn();
      const onSetClockShowSeconds = vi.fn();
      render(
        <TimeFormatSettings
          settings={{ timeFormat: '12', clockShowSeconds: true, clockFlashDivider: false }}
          settingsLoading={false}
          {...ALL_HANDLERS}
          onSetClockFlashDivider={onSetClockFlashDivider}
          onSetClockShowSeconds={onSetClockShowSeconds}
        />
      );

      fireEvent.click(toggleLabelled('Flash the divider'));

      expect(onSetClockFlashDivider).toHaveBeenCalledWith(true);
      // The two are separate settings; flipping one must not drag the other.
      expect(onSetClockShowSeconds).not.toHaveBeenCalled();
    });
  });
});
