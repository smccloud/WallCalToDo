import { dateKey } from './date.js';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// 'HH:MM' -> minutes since local midnight, or null if it isn't a time. The
// server already validates these on the way in (see routes/settings.js), but
// the display has to answer for whatever's actually in the settings it was
// handed -- including a null/absent value and the brief window before the
// first settings message lands.
export function parseTimeOfDay(value) {
  if (typeof value !== 'string') return null;
  const match = TIME_RE.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch' };

// Every meal a day can serve, in the order a day serves them -- used to scan
// what today actually has a menu for.
export const MEAL_ORDER = ['breakfast', 'lunch'];

export function mealLabel(meal) {
  return MEAL_LABELS[meal] || 'Menu';
}

// Is the lunch view supposed to be up right now?
//
// The window is what makes the feature feel like part of the day rather than a
// permanent replacement: before/after it, the to-do list is back. A null on
// both ends means all day, so someone who enables the view without touching
// the times sees it rather than a view that never opens. A start later than
// its end (e.g. "7pm to 8am") is treated as spanning midnight rather than as
// empty, since that's evidently what the person who typed it meant.
export function isLunchTime(settings, now) {
  if (!settings?.schoolLunchEnabled) return false;
  const start = parseTimeOfDay(settings.schoolLunchStartTime);
  const end = parseTimeOfDay(settings.schoolLunchEndTime);
  if (start === null && end === null) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const from = start ?? 0;
  const to = end ?? 24 * 60;
  if (from === to) return true;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

// Which meal to show. Breakfast before the switch time, lunch after it; the
// switch is optional, and without it the view falls back to whatever the
// school actually serves, preferring lunch (the view's namesake) over
// breakfast. Returns a meal key, or null when neither meal has a menu today --
// the caller uses that to leave the to-do list up instead of showing an empty
// panel.
export function pickMeal(settings, now, servedMeals) {
  const served = (servedMeals || []).filter(Boolean);
  if (served.length === 0) return null;
  let preferred;
  const switchAt = parseTimeOfDay(settings?.schoolLunchMealSwitchTime);
  if (switchAt === null) {
    preferred = served.includes('lunch') ? 'lunch' : served[0];
  } else {
    const minutes = now.getHours() * 60 + now.getMinutes();
    preferred = minutes < switchAt ? 'breakfast' : 'lunch';
  }
  return served.includes(preferred) ? preferred : served[0];
}

// The sections for one meal on one day, or null when there's no menu (a
// weekend, a holiday, a school that doesn't serve that meal, or a day still
// outside the cached week -- see lunchService.js). The cache keys days as
// 'YYYY-MM-DD', which is the same key dateKey() produces for the wall's local
// date.
export function menuFor(lunch, meal, date) {
  const sections = meal ? lunch?.meals?.[meal]?.[dateKey(date)] : null;
  return Array.isArray(sections) ? sections : null;
}

// Every meal that actually has a menu on the given day, in the order a day
// serves them: [{ meal, sections }]. Empty when the cache has nothing for that
// day. This is what lets the lunch view alternate between breakfast and lunch
// (see LunchView.jsx) rather than committing to whichever one meal pickMeal()
// chose.
export function mealsFor(lunch, date) {
  return MEAL_ORDER.map((meal) => ({ meal, sections: menuFor(lunch, meal, date) })).filter(
    (entry) => entry.sections
  );
}

// The day the lunch view should draw from, and the meals on it. Today wins
// whenever it has any menu at all; only when today has nothing (a weekend, a
// holiday) does tomorrow get a look, and only when the setting allows it.
// Returns { date, meals, tomorrow } or null when neither day has a menu -- null
// is what keeps the to-do list up instead of an empty panel, and `tomorrow`
// lets the view label what it's showing.
export function menuDay(lunch, settings, today) {
  const todayMeals = mealsFor(lunch, today);
  if (todayMeals.length > 0) return { date: today, meals: todayMeals, tomorrow: false };
  if (!settings?.schoolLunchShowTomorrow) return null;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowMeals = mealsFor(lunch, tomorrow);
  return tomorrowMeals.length > 0 ? { date: tomorrow, meals: tomorrowMeals, tomorrow: true } : null;
}

// The day's meals with the one pickMeal chose moved to the front: with
// alternation off the view draws the first entry, and with it on the cycle
// starts from that meal. Falls back to the given order when nothing matches.
export function orderMeals(meals, primary) {
  if (!primary) return meals;
  const lead = meals.find((entry) => entry.meal === primary);
  if (!lead) return meals;
  return [lead, ...meals.filter((entry) => entry.meal !== primary)];
}
