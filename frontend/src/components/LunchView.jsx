import { useEffect, useRef, useState } from 'react';
import WeatherWidget from './WeatherWidget.jsx';
import { mealLabel } from '../utils/lunch.js';
import { useAutoScroll, SCROLL_SPEED_PX_PER_SEC } from '../hooks/useAutoScroll.js';

// Data shape: meals = [{ meal: 'breakfast'|'lunch', sections: [{ title, items }] }]
// (see mealsFor/orderMeals in utils/lunch.js). The first entry is the one
// pickMeal chose; when alternateSeconds is set and the day serves more than one
// meal, the view cycles through them at that interval instead of sitting on it.
//
// The menu's own text is the content, so it stays at one readable size
// (--lunch-font-size in base.css) rather than shrinking to fit the panel: a
// menu taller than the panel scrolls instead. The wall has no scroll input of
// its own, so the panel drifts through the overflow by itself (see
// useAutoScroll.js). Section headings and item text are both sized in em off
// --lunch-font-size, so the whole menu reads at the same scale.
export default function LunchView({ meals, tomorrow, alternateSeconds, weather, settings }) {
  const listRef = useRef(null);
  const count = meals.length;
  const alternateMs = Number(alternateSeconds || 0) * 1000;
  // How fast the menu drifts through its overflow, in pixels per second. The
  // companion app's slider sets it; 0 means the menu doesn't drift at all.
  // A missing value falls back to the hook's own default (16 px/s).
  const scrollSpeed = settings?.schoolLunchScrollSpeed ?? SCROLL_SPEED_PX_PER_SEC;
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

  // Keyed on the menu's own content: a new meal (breakfast for lunch, or a
  // changed menu) starts the scroll over at its own first line instead of
  // picking up wherever the last one was left.
  //
  // The speed comes from the companion app's slider (schoolLunchScrollSpeed),
  // in pixels per second; 0 means the menu doesn't drift at all. The hook
  // reads it through a ref, so changing it mid-drift doesn't throw the panel
  // back to the top.
  useAutoScroll(listRef, signature, scrollSpeed);

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
