import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LunchView from '../src/components/LunchView.jsx';

// Data shape: meals = [{ meal, sections }], sections being
// [{ title: string|null, items: string[] }], the shape lunchService.js caches
// after folding Nutrislice's flat menu_items stream (see mealsFor/orderMeals in
// utils/lunch.js).

const SECTIONS = [
  { title: 'Entrees', items: ['Cheese Pizza', 'Veggie Burger'] },
  { title: 'Sides', items: ['Green Beans'] },
];

const meal = (name, sections) => [{ meal: name, sections }];

describe('LunchView', () => {
  it('names the meal in the heading', () => {
    render(<LunchView meals={meal('lunch', SECTIONS)} />);
    expect(document.querySelector('.lunch__heading').textContent).toBe('Lunch');
  });

  it('labels a tomorrow menu as such', () => {
    render(<LunchView meals={meal('breakfast', SECTIONS)} tomorrow />);
    expect(document.querySelector('.lunch__heading').textContent).toBe("Tomorrow's Breakfast");
  });

  it('renders each section title and its foods in order', () => {
    render(<LunchView meals={meal('breakfast', SECTIONS)} />);

    const titles = [...document.querySelectorAll('.lunch-list__section-title')].map((el) => el.textContent);
    expect(titles).toEqual(['Entrees', 'Sides']);

    const items = [...document.querySelectorAll('.lunch-list__item')].map((el) => el.textContent);
    expect(items).toEqual(['Cheese Pizza', 'Veggie Burger', 'Green Beans']);
  });

  it('renders sections with no title (a menu with no headings) without an empty heading', () => {
    render(<LunchView meals={meal('lunch', [{ title: null, items: ['Tacos'] }])} />);

    expect(document.querySelectorAll('.lunch-list__section-title')).toHaveLength(0);
    expect(document.querySelector('.lunch-list__item').textContent).toBe('Tacos');
  });

  it('leaves the menu at full size instead of shrinking it to fit', () => {
    render(<LunchView meals={meal('lunch', SECTIONS)} />);
    // The list's size comes from the stylesheet's own control point now (see
    // .lunch-list in base.css) -- the component no longer overrides it with
    // a shrink-to-fit search, so a long menu scrolls rather than shrinking.
    expect(document.querySelector('.lunch-list').style.getPropertyValue('--lunch-font-size')).toBe('');
  });

  it('stays on the first meal when alternation is off', () => {
    vi.useFakeTimers();
    try {
      render(
        <LunchView
          meals={[meal('breakfast', [{ title: null, items: ['Eggs'] }])[0], meal('lunch', SECTIONS)[0]]}
        />
      );
      act(() => vi.advanceTimersByTime(120_000));
      expect(document.querySelector('.lunch__heading').textContent).toBe('Breakfast');
    } finally {
      vi.useRealTimers();
    }
  });

  it('flips between the day’s meals on the configured interval', () => {
    vi.useFakeTimers();
    try {
      render(
        <LunchView
          alternateSeconds={15}
          meals={[meal('breakfast', [{ title: null, items: ['Eggs'] }])[0], meal('lunch', SECTIONS)[0]]}
        />
      );

      expect(document.querySelector('.lunch__heading').textContent).toBe('Breakfast');
      act(() => vi.advanceTimersByTime(15_000));
      expect(document.querySelector('.lunch__heading').textContent).toBe('Lunch');
      act(() => vi.advanceTimersByTime(15_000));
      expect(document.querySelector('.lunch__heading').textContent).toBe('Breakfast');
    } finally {
      vi.useRealTimers();
    }
  });
});
