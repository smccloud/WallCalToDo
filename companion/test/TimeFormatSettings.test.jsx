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

  describe('show seconds', () => {
    function secondsToggle(settingsLoading = false) {
      return document.querySelector('.setting-toggle input[type="checkbox"]');
    }

    it('reflects whether the wall clock is currently showing seconds', () => {
      render(
        <TimeFormatSettings
          settings={{ timeFormat: '12', clockShowSeconds: true }}
          settingsLoading={false}
          onSetTimeFormat={() => {}}
          onSetClockShowSeconds={() => {}}
        />
      );
      expect(secondsToggle().checked).toBe(true);
    });

    it('sends a real boolean when flipped, not the event', () => {
      const onSetClockShowSeconds = vi.fn();
      render(
        <TimeFormatSettings
          settings={{ timeFormat: '12', clockShowSeconds: false }}
          settingsLoading={false}
          onSetTimeFormat={() => {}}
          onSetClockShowSeconds={onSetClockShowSeconds}
        />
      );

      fireEvent.click(secondsToggle());

      expect(onSetClockShowSeconds).toHaveBeenCalledWith(true);
    });

    it('reads off while settings are still loading, and cannot be flipped mid-save', () => {
      render(
        <TimeFormatSettings
          settings={null}
          settingsLoading={true}
          onSetTimeFormat={() => {}}
          onSetClockShowSeconds={() => {}}
        />
      );
      // Same as every other toggle in this app (privacy, advanced): no
      // settings means nothing to reflect, so the control reads off until
      // the fetch lands. The wall clock doesn't flicker with it — it keeps
      // its own default-until-known behavior (see WallClock.jsx).
      expect(secondsToggle().checked).toBe(false);
      expect(secondsToggle().disabled).toBe(true);
    });
  });
});
