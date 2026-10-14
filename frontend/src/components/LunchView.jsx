import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import WeatherWidget from './WeatherWidget.jsx';
import { mealLabel } from '../utils/lunch.js';

// Same shrink-to-fit floor/ceiling the to-do list and today agenda use, so a
// long menu scales down by the same rule as everything else on the panel
// instead of being the one list that just overflows.
const LUNCH_FONT_MAX = 22;
const LUNCH_FONT_MIN = 12;

// Data shape: meals = [{ meal: 'breakfast'|'lunch', sections: [{ title, items }] }]
// (see mealsFor/orderMeals in utils/lunch.js). The first entry is the one
// pickMeal chose; when alternateSeconds is set and the day serves more than one
// meal, the view cycles through them at that interval instead of sitting on it.
//
// The same shrink-to-fit binary search as TodoView.jsx, against .lunch-list
// instead of .todo-list. Section headings and item text are all sized in em
// off --lunch-font-size (see base.css), so the whole menu scales together
// rather than the headings drifting out of proportion with the items.
export default function LunchView({ meals, tomorrow, alternateSeconds, weather, settings }) {
  const listRef = useRef(null);
  const count = meals.length;
  const alternateMs = Number(alternateSeconds || 0) * 1000;
  // Only ever alternate when there's a second meal to alternate to -- one meal,
  // or an interval of 0 ("Off"), leaves the view on the first entry.
  const cycling = count > 1 && alternateMs > 0;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!cycling) {
      setIndex(0);
      return;
    }
    setIndex(0);
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), alternateMs);
    return () => clearInterval(timer);
  }, [cycling, alternateMs, count]);

  const active = meals[cycling ? index % count : 0];
  const { meal, sections } = active;
  const heading = tomorrow ? `Tomorrow's ${mealLabel(meal)}` : mealLabel(meal);
  const signature = `${meal}:${sections
    .map((section) => `${section.title || ''}[${section.items.join('|')}]`)
    .join(';')}`;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let lo = LUNCH_FONT_MIN;
    let hi = LUNCH_FONT_MAX;
    let best = LUNCH_FONT_MIN;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      list.style.setProperty('--lunch-font-size', `${mid}px`);
      if (list.scrollHeight <= list.clientHeight + 0.5) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    list.style.setProperty('--lunch-font-size', `${best}px`);
    // Re-runs whenever the menu's actual content changes -- a plain
    // `[sections]` dependency would also fire on every reference change with
    // the same content, same reasoning as TodoView's tasksSignature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <section className="lunch">
      <h2 className="lunch__heading">{heading}</h2>
      <div className="lunch-list" ref={listRef}>
        {sections.map((section, sectionIndex) => (
          <div className="lunch-list__section" key={`${section.title || 'section'}-${sectionIndex}`}>
            {section.title && <h3 className="lunch-list__section-title">{section.title}</h3>}
            <ul className="lunch-list__items">
              {section.items.map((item, itemIndex) => (
                <li className="lunch-list__item" key={`${item}-${itemIndex}`}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {/* Same outside-temperature widget the to-do panel carries, in the same
          bottom-right corner -- the lunch view takes over that slot, and the
          temperature is a fact about the day rather than about the to-do list,
          so it stays put across the handover. */}
      <WeatherWidget weather={weather} settings={settings} />
    </section>
  );
}
