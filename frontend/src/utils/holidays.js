// Which days on the wall display get a holiday marker, and how a holiday is
// recognized in the first place.
//
// The holidays themselves aren't computed here or fetched from anywhere: they
// arrive as ordinary all-day events from a holiday calendar — Google's
// "Holidays in United States" (id `en.usa#holiday@group.v.calendar.google.com`,
// the one Google offers under "Browse calendars") or Microsoft's equivalent,
// which is named the same way. So this is a matcher over the event list the
// display already has, which also means the usual calendar toggles apply to
// it for free: switching the holidays calendar off in the companion app
// removes both its pills and its day markers, with nothing extra to keep in
// step.
//
// Google's own titles aren't stable enough to compare exactly — the same
// holiday is "Presidents' Day (Washington's Birthday)" in some years and
// "Washington's Birthday" in others, Easter arrives as "Easter Sunday",
// and a localized calendar won't be in English at all. So each entry lists
// the substrings to look for in a normalized title (see normalize below)
// rather than one exact string.
//
// `icon` is the one image the holiday is conventionally represented by —
// the thing you put on a card or a poster for it — and is drawn beside the
// day number on the wall. It is deliberately the first thing that comes to
// mind for the holiday rather than a second-best stand-in, since the point
// is that the day names itself at a glance from across the room without
// anyone having to read the pill under it. Emoji rather than drawn SVG
// because they inherit the theme (nothing to recolor per light/dark), and
// because Noto Color Emoji is already named in --font-family for exactly
// this reason. Ones that are a judgement call between two defensible
// images say why below; everything else is uncontroversial.
const HOLIDAYS = [
  { name: "New Year's Day", icon: '🎉', match: ['new year'] },
  // Google's title for this has been both "Martin Luther King Jr. Day" and
  // "Birthday of Martin Luther King, Jr." — matching the name itself covers
  // either, and "mlk" catches the abbreviated form.
  // The raised fist, which is the image this holiday is universally
  // represented by.
  { name: 'Martin Luther King Jr. Day', icon: '✊', match: ['martin luther king', 'mlk'] },
  // Two names for the same thing, and which one Google uses has changed
  // between years. The flag, since there is no conventional portrait for
  // Presidents' Day the way MLK Day has one.
  { name: "Presidents' Day", icon: '🇺🇸', match: ['presidents day', 'washingtons birthday'] },
  // The remembrance poppy, the established image for honoring the fallen
  // (Veterans Day takes the medal instead, and the flag is already used).
  { name: 'Memorial Day', icon: '🪻', match: ['memorial day'] },
  // Officially "Juneteenth National Independence Day", and shortened to plain
  // "Juneteenth" in some years' calendars.
  // The black heart, standing in for the red-black-green flag this holiday
  // is usually carried on. The other candidate is the raised fist again
  // (it's on the Juneteenth flag too), but one holiday owning the fist and
  // the other sharing it makes the two indistinguishable in a month.
  { name: 'Juneteenth', icon: '🖤', match: ['juneteenth'] },
  { name: 'Independence Day', icon: '🎆', match: ['independence day'] },
  // The tools, for the day that exists for workers rather than for any
  // particular trade — the hammer-and-wrench rather than a hard hat, which
  // would only read as construction.
  { name: 'Labor Day', icon: '🛠️', match: ['labor day'] },
  { name: 'Columbus Day', icon: '⛵', match: ['columbus day'] },
  { name: 'Veterans Day', icon: '🎖️', match: ['veterans day'] },
  { name: 'Thanksgiving', icon: '🦃', match: ['thanksgiving'] },
  { name: 'Christmas Day', icon: '🎄', match: ['christmas'] },
  { name: 'Halloween', icon: '🎃', match: ['halloween'] },
  { name: "Valentine's Day", icon: '❤️', match: ['valentine'] },
  // The chick, the spring/Easter half of the pair — the bunny reads as
  // Halloween's neighbor and would be the wrong animal next to a pumpkin.
  { name: 'Easter', icon: '🐣', match: ['easter'] },
  { name: "St. Patrick's Day", icon: '🍀', match: ['patricks day'] },
];

// Google's holiday calendars all have ids shaped like
// "<locale>#holiday@group.v.calendar.google.com", which is the only way to
// recognize one that isn't showing an English name.
const HOLIDAY_CALENDAR_ID = /#holiday@group\.v\.calendar\.google\.com$/i;
// Fallback for the ones with no such id — Microsoft's built-in holidays
// calendar, and any Google one the user has renamed.
const HOLIDAY_CALENDAR_LABEL = /^holidays\b/i;

// Lowercase, with apostrophes dropped and every other run of non-alphanumerics
// turned into a single space. Dropping the apostrophes rather than replacing
// them is what makes "President's Day" and "Presidents' Day" the same string
// ("presidents day"), which is the whole reason this isn't an exact
// comparison against Google's titles.
function normalize(title) {
  return title.toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, ' ');
}

// The table entry an event matches, or null if it isn't one of them. Two
// halves: it has to come from a holiday calendar (so a personal all-day event
// called "Halloween party" isn't mistaken for one) and match one of the
// fifteen above. The all-day check is belt-and-braces — the holiday calendars
// have no timed events — but it also keeps a timed event sitting on a holiday
// calendar out of it.
//
// Asked per event rather than as a precomputed list of dates, so it can't
// disagree with the events actually on the wall.
function matchHoliday(event) {
  if (!event.allDay) return null;
  const fromHolidayCalendar =
    HOLIDAY_CALENDAR_ID.test(event.calendarKey || '') || HOLIDAY_CALENDAR_LABEL.test(event.calendarLabel || '');
  if (!fromHolidayCalendar) return null;
  const title = normalize(event.title || '');
  return HOLIDAYS.find((holiday) => holiday.match.some((needle) => title.includes(needle))) || null;
}

// Everything the wall needs to decorate one event's day, off the one match:
// which holiday it is (for its icon, and for the canonical name rather than
// whatever the calendar called it — "New Year's Day" for an event titled "New
// Year's Day (observed)"), plus the color to draw the day marker in. Null for
// anything that isn't one of the decorated fifteen, which is the cell's cue to
// render an ordinary day.
//
// The color is the event's own rather than anything from the table, so the
// ring behind the day number is drawn in the same color as the pill that
// event already renders in this same cell (and its letter-circle in the
// legend) — which is also why it's read off the event here instead of the
// caller looking the event up a second time to get it. The icon is a color
// emoji and takes no color from this; that's the point of using one.
export function holidayFor(event) {
  const holiday = matchHoliday(event);
  if (!holiday) return null;
  return { name: holiday.name, icon: holiday.icon, color: event.color };
}
