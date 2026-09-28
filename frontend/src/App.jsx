import { useEffect, useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useViewSwap } from './hooks/useViewSwap.js';
import CalendarHeader from './components/CalendarHeader.jsx';
import CalendarView from './components/CalendarView.jsx';
import DayAgenda from './components/DayAgenda.jsx';
import TodoView from './components/TodoView.jsx';
import WeatherView from './components/WeatherView.jsx';

// 'light'/'dark' settings are direct; 'auto' switches at sunrise/sunset for
// the location saved in the companion app. Falls back to 'dark' (this
// project's original, only-ever-shipped look) if settings haven't loaded
// yet or auto mode has no location/sun-times to go on.
function effectiveTheme(settings, now) {
  if (!settings) return 'dark';
  if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
  if (!settings.sunrise || !settings.sunset) return 'dark';
  const sunrise = new Date(settings.sunrise);
  const sunset = new Date(settings.sunset);
  return now >= sunrise && now < sunset ? 'light' : 'dark';
}

// Is the wall supposed to be showing the weather right now?
//
// Measured against the clock rather than counted down by a timer, which is
// what makes this work at all on a display nobody is looking after: no state
// to keep, nothing to drift, nothing to reset, and a display that restarts
// mid-window lands back in the right place instead of either skipping its
// turn or starting a fresh one. Two displays on the same network also agree
// without talking to each other, since they share a clock.
//
// The window is anchored to the interval rather than to whenever the setting
// was turned on, so with an hourly interval the weather appears on the hour
// and at the same minute past it every hour — predictable to wait for, which
// matters more than it sounds for something on a wall in a room someone
// walks through.
function isWeatherTime(settings, now) {
  const intervalMs = Number(settings?.weatherIntervalMinutes || 0) * 60_000;
  if (intervalMs <= 0) return false;
  const durationMs = Number(settings?.weatherDurationSeconds || 0) * 1000;
  return now.getTime() % intervalMs < durationMs;
}

// How often the rotation is re-checked while it's enabled. Shorter than the
// smallest duration the companion app offers (30s), because a check that ran
// less often than the shortest window could step clean over it and the view
// would never appear at all.
const WEATHER_CHECK_MS = 5_000;

export default function App() {
  const { calendar, todo, settings, weather, connected } = useWebSocket();

  // Its own clock, same pattern as CalendarView/DayAgenda: this only needs
  // to catch the sunrise/sunset boundary passing, not tick every second, so
  // once a minute is plenty.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Whether the full-screen weather view is up, and the moment it went up.
  // Only ever transitions between "off" (null) and "on" (a timestamp): a new
  // Date is stamped in on the way in and then left alone, so the 5s check
  // below doesn't re-render the display twelve times a minute while the
  // weather is up. The view keeps its own clock for the time readout.
  const [weatherSince, setWeatherSince] = useState(null);
  useEffect(() => {
    if (!settings?.weatherIntervalMinutes) {
      setWeatherSince(null);
      return;
    }
    const check = () =>
      setWeatherSince((upSince) => {
        if (!isWeatherTime(settings, new Date())) return null;
        return upSince || new Date();
      });
    check();
    const timer = setInterval(check, WEATHER_CHECK_MS);
    return () => clearInterval(timer);
  }, [settings?.weatherIntervalMinutes, settings?.weatherDurationSeconds]);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme(settings, now);
  }, [settings, now]);

  const privacyMode = Boolean(settings?.privacyMode);

  // Landscape only (see .secondary in base.css -- ignored by portrait's
  // own column split) -- the exact pixel height CalendarView measured for
  // today's agenda, so the line between it and the to-do list lands on
  // one of the calendar's own row lines instead of an arbitrary split.
  // null until the first measurement lands (effectively instant --
  // CalendarView measures in useLayoutEffect, before paint) or if it's
  // ever unmeasurable, in which case .secondary's own CSS fallback covers it.
  const [todayHeight, setTodayHeight] = useState(null);

  // The weather view replaces the display outright, so it needs something to
  // show: a location, and a reading fetched for it. Without either the
  // calendar stays up rather than the wall blanking to an error — the same
  // reason WeatherWidget renders nothing at all without a reading.
  const showWeather = weatherSince !== null && Boolean(weather?.hourly?.length || weather?.daily?.length);

  // Which view belongs on the wall, and — while one is dithering in over the
  // other — the one it's covering, which stays mounted and readable
  // underneath until the pattern has finished opening (see useViewSwap.js).
  const swap = useViewSwap(showWeather ? 'weather' : 'calendar');

  // One renderer for both views rather than an early return each, because a
  // dither needs them on screen at the same time. Keyed by view name, so
  // React keeps whichever one is already mounted rather than tearing it down
  // and building it again mid-transition.
  const renderView = (name, layerClass) =>
    name === 'weather' ? (
      <WeatherView key={name} weather={weather} settings={settings} className={layerClass} />
    ) : (
      <div key={name} className={layerClass ? `app ${layerClass}` : 'app'}>
        <CalendarHeader connected={connected} />
        <div className="body">
          <CalendarView events={calendar} privacyMode={privacyMode} onMeasureSplit={setTodayHeight} />
          <div className="secondary" style={{ '--today-height': todayHeight ? `${todayHeight}px` : undefined }}>
            <DayAgenda events={calendar} privacyMode={privacyMode} />
            <TodoView tasks={todo} privacyMode={privacyMode} weather={weather} settings={settings} />
          </div>
        </div>
      </div>
    );

  return (
    <>
      {/* Outgoing first, so the incoming one paints over it. */}
      {swap.from && renderView(swap.from, '')}
      {renderView(swap.view, swap.from ? 'view-layer--dither' : '')}
    </>
  );
}
