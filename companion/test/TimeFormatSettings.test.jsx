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
});
