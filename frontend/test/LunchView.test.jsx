import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LunchView from '../src/components/LunchView.jsx';

// Data shape: sections = [{ title: string|null, items: string[] }], the shape
// lunchService.js caches after folding Nutrislice's flat menu_items stream.

const SECTIONS = [
  { title: 'Entrees', items: ['Cheese Pizza', 'Veggie Burger'] },
  { title: 'Sides', items: ['Green Beans'] },
];

describe('LunchView', () => {
  it('names the meal in the heading', () => {
    render(<LunchView meal="lunch" sections={SECTIONS} />);
    expect(document.querySelector('.lunch__heading').textContent).toBe('Lunch');
  });

  it('renders each section title and its foods in order', () => {
    render(<LunchView meal="breakfast" sections={SECTIONS} />);

    const titles = [...document.querySelectorAll('.lunch-list__section-title')].map((el) => el.textContent);
    expect(titles).toEqual(['Entrees', 'Sides']);

    const items = [...document.querySelectorAll('.lunch-list__item')].map((el) => el.textContent);
    expect(items).toEqual(['Cheese Pizza', 'Veggie Burger', 'Green Beans']);
  });

  it('renders sections with no title (a menu with no headings) without an empty heading', () => {
    render(<LunchView meal="lunch" sections={[{ title: null, items: ['Tacos'] }]} />);

    expect(document.querySelectorAll('.lunch-list__section-title')).toHaveLength(0);
    expect(document.querySelector('.lunch-list__item').textContent).toBe('Tacos');
  });

  it('sizes the list through the shared shrink-to-fit control point', () => {
    render(<LunchView meal="lunch" sections={SECTIONS} />);
    // jsdom reports zero heights, so the binary search lands on the ceiling --
    // what matters is that it set the one variable the CSS sizes everything
    // from, rather than leaving the list unsized.
    expect(document.querySelector('.lunch-list').style.getPropertyValue('--lunch-font-size')).toBe('22px');
  });
});
