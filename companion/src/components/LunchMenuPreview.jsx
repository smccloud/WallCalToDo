import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/*
 * A miniature copy of the wall's lunch panel, so the companion app can show
 * what the display will actually look like while its settings are being
 * changed.
 *
 * It reads the same cached menu the wall reads (GET /api/lunch -- see
 * server/src/routes/api.js), picks the same day and meal the wall would pick
 * (see frontend/src/utils/lunch.js), and drifts at the same speed -- scaled
 * down to the preview's smaller text, so "Steady" on the wall reads as
 * "Steady" here rather than as a different speed entirely.
 */

// The wall's own menu text size (--lunch-font-size in the wall's base.css)
// and the preview's. The drift is scaled by the ratio of the two, so the
// preview drifts at the same *visual* rate as the wall rather than at the
// same number of pixels.
const WALL_FONT_PX = 22;
const PREVIEW_FONT_PX = 13;

// How long the preview sits still at each end of its travel, the same hold
// the wall's own drift uses (SCROLL_HOLD_MS in
// frontend/src/hooks/useAutoScroll.js).
const PREVIEW_HOLD_MS = 3000;

// The wall doesn't drift anything when the system asks for reduced motion
// (see frontend/src/utils/motion.js), and the preview follows suit: drifting
// here would be the very motion the setting is there to avoid.
const REDUCED_MOTION =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

// The cache keys days as 'YYYY-MM-DD' -- the same key the wall's dateKey()
// produces (frontend/src/utils/lunch.js).
function dateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date, count) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + count);
  return next;
}

// The menu for one day: { meal, sections }. Lunch leads when the day serves
// it, the same way the wall picks its meal (pickMeal in
// frontend/src/utils/lunch.js).
function mealOnDay(menu, key) {
  for (const meal of ['lunch', 'breakfast']) {
    const sections = menu?.meals?.[meal]?.[key];
    if (Array.isArray(sections) && sections.length) return { meal, sections };
  }
  return null;
}

// Every day the cache holds a menu for, sorted.
function menuDays(menu) {
  const days = new Set();
  for (const meal of ['breakfast', 'lunch']) {
    for (const key of Object.keys(menu?.meals?.[meal] || {})) days.add(key);
  }
  return [...days].sort();
}

// Which day to show: the one the wall would read (today, or tomorrow when
// "show tomorrow's menu" is on) when there's a menu for it, and otherwise the
// nearest day that has one -- so a preview is still worth looking at on a
// weekend or a holiday, labelled with the day it is actually showing.
function pickDay(menu, wanted) {
  if (mealOnDay(menu, wanted)) return wanted;
  const days = menuDays(menu);
  if (days.length === 0) return null;
  return days.find((key) => key >= wanted) || days[days.length - 1];
}

const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch' };

// "Friday, October 24" -- the date of a day the preview is standing in for,
// so a preview of another day says which day it is.
function formatDay(key) {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

// The preview's own drift: the same ping-pong the wall's panel does (see
// frontend/src/hooks/useAutoScroll.js), at the same visual speed. Kept here
// rather than shared with the wall because the companion app is a separate
// build from the display, and this copy is small and shaped to the preview's
// own size.
//
// `contentKey` is the menu being shown: the drift starts when the list
// appears (the menu arrives from the server, so the list isn't there on the
// first render) and starts again for a new day of menus.
export function usePreviewDrift(ref, speedPxPerSec, contentKey) {
  // The live speed, read by the animation loop on every frame. It's kept in
  // a ref so that changing it doesn't restart the drift -- a new speed takes
  // hold from wherever the preview already is, rather than starting the
  // travel over.
  const speedRef = useRef(speedPxPerSec);
  useEffect(() => {
    const speed = Number(speedPxPerSec);
    // A value that isn't a usable number leaves the speed as it was rather
    // than freezing the preview or sending it off at a nonsense rate.
    if (!Number.isFinite(speed) || speed < 0) return;
    // Switching the drift off leaves the preview where it happened to be,
    // which would be the middle of the menu with the start of it out of
    // reach -- so it goes back to the top, where the menu begins.
    if (speed === 0 && ref.current && ref.current.scrollTop !== 0) {
      ref.current.scrollTop = 0;
    }
    speedRef.current = speed;
  }, [speedPxPerSec, ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (REDUCED_MOTION) return undefined;

    let frame = 0;
    let last = null;
    // The sub-pixel remainder of the drift, carried between frames: a browser
    // rounds a fractional scroll offset to a whole pixel, so a step smaller
    // than one pixel would be rounded away and the drift would sit still.
    let carry = 0;
    // 1 is down the list, -1 is back up.
    let direction = 1;
    let holdUntil = 0;

    const step = (now) => {
      const dt = last == null ? 0 : (now - last) / 1000;
      last = now;
      const max = el.scrollHeight - el.clientHeight;
      // The speed as it stands right now, scaled to the preview's smaller
      // text: 16px a second on the wall is the same visual rate as this
      // preview's 9.45, which is what makes the two read the same.
      const scaled = speedRef.current * (PREVIEW_FONT_PX / WALL_FONT_PX);

      if (max > 1 && now >= holdUntil) {
        carry += scaled * dt * direction;
        const whole = carry < 0 ? Math.ceil(carry) : Math.floor(carry);
        carry -= whole;
        el.scrollTop = Math.min(max, Math.max(0, el.scrollTop + whole));
        // At either end of the travel, turn around and sit still for a moment
        // so the first and last lines get read. Only the end being travelled
        // towards counts -- a drift that starts at the top is not a drift
        // that has reached the top.
        if (direction === 1 && el.scrollTop >= max - 0.5) {
          direction = -1;
          holdUntil = now + PREVIEW_HOLD_MS;
        } else if (direction === -1 && el.scrollTop <= 0.5) {
          direction = 1;
          holdUntil = now + PREVIEW_HOLD_MS;
        }
      }

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ref, contentKey]);
}

// What the wall's lunch panel will look like, drawn from the same cached
// menu the wall draws from. `speed` is the drift speed in pixels per second
// (0 means the menu doesn't drift at all).
export default function LunchMenuPreview({ speed, showTomorrow }) {
  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api('/lunch')
      .then((data) => {
        if (!active) return;
        setMenu(data || null);
        setFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  const today = new Date();
  const wanted = dateKey(showTomorrow ? addDays(today, 1) : today);
  const day = pickDay(menu, wanted);
  const meal = day ? mealOnDay(menu, day) : null;

  // Keyed on the day: the drift starts once the list is there (the menu
  // arrives from the server) and starts again for a new day's menu.
  usePreviewDrift(listRef, speed, day);

  // A new day of menus starts at its own first line, the way the wall's does
  // when the menu changes.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = 0;
  }, [day]);

  if (loading) {
    return (
      <div className="lunch-preview">
        <div className="lunch-preview__frame lunch-preview__frame--empty">Loading the menu…</div>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="lunch-preview">
        <div className="lunch-preview__frame lunch-preview__frame--empty">
          Couldn&rsquo;t load the cached menu.
        </div>
      </div>
    );
  }

  if (!meal) {
    return (
      <div className="lunch-preview">
        <div className="lunch-preview__frame lunch-preview__frame--empty">
          No menu cached yet — the wall shows the to-do list until one is.
        </div>
      </div>
    );
  }

  const heading = `${showTomorrow && day === wanted ? "Tomorrow's" : ''} ${MEAL_LABELS[meal.meal] || 'Menu'}`;
  const otherDay = day !== wanted;

  return (
    <div className="lunch-preview">
      <div className="lunch-preview__frame">
        <p className="lunch-preview__heading">{heading}</p>
        <div className="lunch-preview__list" ref={listRef}>
          {meal.sections.map((section, sectionIndex) => (
            <div className="lunch-preview__section" key={`${section.title || 'section'}-${sectionIndex}`}>
              {section.title && <p className="lunch-preview__section-title">{section.title}</p>}
              <ul className="lunch-preview__items">
                {section.items.map((item, itemIndex) => (
                  <li className="lunch-preview__item" key={`${item}-${itemIndex}`}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <p className="lunch-preview__caption">
        {otherDay
          ? `Showing ${formatDay(day)} — the wall shows this day’s menu instead.`
          : 'This is the menu as the wall draws it.'}
      </p>
      <button
        type="button"
        className="button button--ghost lunch-preview__refresh"
        onClick={() => setReload((n) => n + 1)}
      >
        Refresh preview
      </button>
    </div>
  );
}
