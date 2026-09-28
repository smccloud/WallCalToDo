import { useEffect, useState } from 'react';
import { formatClock } from '../utils/date.js';
import SunTimes from './SunTimes.jsx';

// Split out of CalendarView so it can sit as its own full-width row above
// everything else (calendar + today/to-do) in both portrait and landscape,
// instead of being nested inside the calendar section specifically — see
// App.jsx. Its own clock, same pattern as every other view in this app
// (CalendarView/DayAgenda/TodoView's WeatherWidget) rather than one shared
// timer passed down.
export default function CalendarHeader({ connected, settings }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="calendar-header">
      <h1 className="calendar-header__date">
        <span className="calendar-header__month">{now.toLocaleDateString(undefined, { month: 'long' })}</span>
        <span className="calendar-header__year"> {now.getFullYear()}</span>
      </h1>
      {/* Sunrise/sunset, between the month/year and the clock — the one gap in
          the header that was doing nothing. Renders nothing at all without a
          saved location, and both outer elements are pinned to their own
          columns (see .calendar-header), so the header then lays out exactly
          as it did before this existed. */}
      <SunTimes settings={settings} />
      <div className="calendar-header__right">
        <span className={`calendar-header__dot ${connected ? 'is-connected' : 'is-disconnected'}`} />
        <span className="calendar-header__clock">{formatClock(now)}</span>
      </div>
    </div>
  );
}
