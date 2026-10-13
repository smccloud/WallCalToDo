import { describe, expect, it } from 'vitest';
import { MEAL_ORDER, isLunchTime, mealLabel, menuFor, menuForTomorrow, parseTimeOfDay, pickMeal } from '../src/utils/lunch.js';

// The lunch view's whole decision surface, none of which needs a server: when
// the window opens, which meal is current inside it, and whether there's
// actually a menu to draw.

const at = (hours, minutes = 0) => new Date(2026, 9, 8, hours, minutes);

describe('parseTimeOfDay', () => {
  it('reads a valid 24-hour time as minutes since midnight', () => {
    expect(parseTimeOfDay('00:00')).toBe(0);
    expect(parseTimeOfDay('07:30')).toBe(450);
    expect(parseTimeOfDay('23:59')).toBe(1439);
  });

  it('returns null for anything that is not one', () => {
    expect(parseTimeOfDay(null)).toBeNull();
    expect(parseTimeOfDay(undefined)).toBeNull();
    expect(parseTimeOfDay('7:30')).toBeNull(); // no leading zero
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('10:60')).toBeNull();
    expect(parseTimeOfDay(730)).toBeNull();
  });
});

describe('isLunchTime', () => {
  it('is off whenever the feature is', () => {
    expect(isLunchTime({ schoolLunchEnabled: false, schoolLunchStartTime: '08:00', schoolLunchEndTime: '15:00' }, at(10))).toBe(false);
    expect(isLunchTime(undefined, at(10))).toBe(false);
  });

  it('is all day when neither bound is set', () => {
    expect(isLunchTime({ schoolLunchEnabled: true }, at(3))).toBe(true);
    expect(isLunchTime({ schoolLunchEnabled: true }, at(22))).toBe(true);
  });

  it('is inside an ordinary window, bounds inclusive of the start only', () => {
    const settings = { schoolLunchEnabled: true, schoolLunchStartTime: '08:00', schoolLunchEndTime: '15:00' };
    expect(isLunchTime(settings, at(7, 59))).toBe(false);
    expect(isLunchTime(settings, at(8, 0))).toBe(true);
    expect(isLunchTime(settings, at(14, 59))).toBe(true);
    expect(isLunchTime(settings, at(15, 0))).toBe(false);
  });

  it('treats a window that ends before it starts as crossing midnight', () => {
    const settings = { schoolLunchEnabled: true, schoolLunchStartTime: '19:00', schoolLunchEndTime: '08:00' };
    expect(isLunchTime(settings, at(20))).toBe(true);
    expect(isLunchTime(settings, at(3))).toBe(true);
    expect(isLunchTime(settings, at(12))).toBe(false);
  });

  it('treats a start with no end as running to the end of the day', () => {
    const settings = { schoolLunchEnabled: true, schoolLunchStartTime: '15:00' };
    expect(isLunchTime(settings, at(14, 59))).toBe(false);
    expect(isLunchTime(settings, at(23))).toBe(true);
  });
});

describe('pickMeal', () => {
  it('is null when neither meal has a menu today', () => {
    expect(pickMeal({}, at(10), [])).toBeNull();
    expect(pickMeal({}, at(10), [null, null])).toBeNull();
  });

  it('prefers lunch with no switch time configured', () => {
    expect(pickMeal({}, at(7), ['breakfast', 'lunch'])).toBe('lunch');
  });

  it('falls back to whatever is actually served', () => {
    expect(pickMeal({}, at(7), ['breakfast'])).toBe('breakfast');
  });

  it('switches breakfast to lunch at the configured time', () => {
    const settings = { schoolLunchMealSwitchTime: '11:15' };
    expect(pickMeal(settings, at(10), ['breakfast', 'lunch'])).toBe('breakfast');
    expect(pickMeal(settings, at(11, 15), ['breakfast', 'lunch'])).toBe('lunch');
  });

  it('ignores the switch when the meal it would pick is not served', () => {
    const settings = { schoolLunchMealSwitchTime: '11:15' };
    expect(pickMeal(settings, at(10), ['lunch'])).toBe('lunch');
    expect(pickMeal(settings, at(13), ['breakfast'])).toBe('breakfast');
  });
});

describe('menuFor', () => {
  const lunch = { meals: { lunch: { '2026-10-08': [{ title: null, items: ['Pizza'] }] } } };

  it('returns the sections for the meal on the given day', () => {
    expect(menuFor(lunch, 'lunch', at(12))).toEqual([{ title: null, items: ['Pizza'] }]);
  });

  it('returns null for a meal or day with no menu cached', () => {
    expect(menuFor(lunch, 'breakfast', at(12))).toBeNull();
    expect(menuFor(lunch, 'lunch', new Date(2026, 9, 9, 12))).toBeNull();
    expect(menuFor(null, 'lunch', at(12))).toBeNull();
  });
});

describe('menuForTomorrow', () => {
  const lunch = {
    meals: {
      lunch: {
        '2026-10-08': [{ title: null, items: ['Pizza'] }],
        '2026-10-09': [{ title: null, items: ['Steak'] }],
      },
    },
  };

  it('returns tomorrow's menu when today has a menu', () => {
    const tomorrow = new Date(2026, 9, 9, 12);
    expect(menuForTomorrow(lunch, 'lunch', new Date(2026, 9, 8, 12))).toEqual([{ title: null, items: ['Steak'] }]);
  });

  it('returns null when today has no menu for the meal', () => {
    expect(menuForTomorrow(lunch, 'breakfast', at(12))).toBeNull();
  });

  it('returns null when lunch is missing', () => {
    expect(menuForTomorrow(null, 'lunch', at(12))).toBeNull();
  });
});

describe('MEAL_ORDER and mealLabel', () => {
  it('orders the meals as a day serves them', () => {
    expect(MEAL_ORDER).toEqual(['breakfast', 'lunch']);
  });

  it('labels the meals it knows and falls back for anything else', () => {
    expect(mealLabel('breakfast')).toBe('Breakfast');
    expect(mealLabel('lunch')).toBe('Lunch');
    expect(mealLabel('dinner')).toBe('Menu');
  });
});
