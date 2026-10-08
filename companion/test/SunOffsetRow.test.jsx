import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SunOffsetRow from '../src/components/SunOffsetRow.jsx';

afterEach(() => {
  vi.useRealTimers();
});

const OFFSET = { minutes: 30, direction: 'before' };

function renderRow({
  offset = OFFSET,
  time = new Date('2026-06-21T22:30:00Z').toISOString(),
  disabled,
  onChange = vi.fn(),
} = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 21, 12, 0));
  const utils = render(
    <SunOffsetRow title="Sunrise" time={time} offset={offset} disabled={disabled} onChange={onChange} />
  );
  return { onChange, ...utils };
}

describe('SunOffsetRow', () => {
  it('titles the row and shows the already-offset time the theme switches at', () => {
    renderRow();
    expect(document.body.textContent).toContain('Sunrise');
    // 22:30Z is 5:30 pm in America/Chicago -- the moment actually in effect,
    // not the raw astronomical time.
    expect(document.body.textContent).toContain('5:30 PM');
  });

  it('shows an em dash rather than a bogus time when there is none', () => {
    renderRow({ time: null });
    expect(document.body.textContent).toContain('—');
  });

  it('starts the dropdown on the current minutes', () => {
    const { getByRole } = renderRow();
    expect(getByRole('combobox').value).toBe('30');
  });

  it('reports a change of amount as a number, keeping the direction', () => {
    const { onChange, getByRole } = renderRow();

    fireEvent.change(getByRole('combobox'), { target: { value: '60' } });

    expect(onChange).toHaveBeenCalledWith({ minutes: 60, direction: 'before' });
  });

  it('reports a change of direction, keeping the amount', () => {
    const { onChange, getByRole } = renderRow();

    fireEvent.click(getByRole('button', { name: 'After' }));

    expect(onChange).toHaveBeenCalledWith({ minutes: 30, direction: 'after' });
  });

  it('marks the selected direction as active', () => {
    renderRow({ offset: { minutes: 15, direction: 'after' } });

    const after = [...document.querySelectorAll('.segmented__option')].find(
      (button) => button.textContent === 'After'
    );
    expect(after.className).toContain('is-active');
  });

  it('disables Before/After at "No delay", where the direction means nothing', () => {
    const { getAllByRole } = renderRow({ offset: { minutes: 0, direction: 'before' } });

    for (const button of getAllByRole('button')) {
      expect(button.disabled).toBe(true);
    }
    expect(getAllByRole('combobox')[0].disabled).toBe(false);
  });

  it('disables every control while the row is disabled', () => {
    const { getAllByRole } = renderRow({ disabled: true });

    for (const control of [...getAllByRole('button'), ...getAllByRole('combobox')]) {
      expect(control.disabled).toBe(true);
    }
  });
});
