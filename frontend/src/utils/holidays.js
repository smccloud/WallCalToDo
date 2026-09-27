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
const HOLIDAYS = [
  { name: "New Year's Day", match: ['new year'] },
  // Google's title for this has been both "Martin Luther King Jr. Day" and
  // "Birthday of Martin Luther King, Jr." — matching the name itself covers
  // either, and "mlk" catches the abbreviated form.
  { name: 'Martin Luther King Jr. Day', match: ['martin luther king', 'mlk'] },
  // Two names for the same thing, and which one Google uses has changed
  // between years.
  { name: "Presidents' Day", match: ['presidents day', 'washingtons birthday'] },
  { name: 'Memorial Day', match: ['memorial day'] },
  // Officially "Juneteenth National Independence Day", and shortened to plain
  // "Juneteenth" in some years' calendars.
  { name: 'Juneteenth', match: ['juneteenth'] },
  { name: 'Independence Day', match: ['independence day'] },
  { name: 'Labor Day', match: ['labor day'] },
  { name: 'Columbus Day', match: ['columbus day'] },
  { name: 'Veterans Day', match: ['veterans day'] },
  { name: 'Thanksgiving', match: ['thanksgiving'] },
  { name: 'Christmas Day', match: ['christmas'] },
  { name: 'Halloween', match: ['halloween'] },
  { name: "Valentine's Day", match: ['valentine'] },
  { name: 'Easter', match: ['easter'] },
  { name: "St. Patrick's Day", match: ['patricks day'] },
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

// Whether an event is one of the holidays to decorate. Two halves: it has to
// come from a holiday calendar (so a personal all-day event called "Halloween
// party" isn't mistaken for one) and match one of the fifteen above. The
// all-day check is belt-and-braces — the holiday calendars have no timed
// events — but it also keeps a timed event sitting on a holiday calendar out
// of it.
//
// The matched entry's `name` is the canonical spelling rather than whatever
// the calendar called it ("New Year's Day" for an event titled "New Year's Day
// (observed)"), and is what the README's list is written from; the display
// itself marks the day in the event's own color and leaves the naming to the
// event's own pill, so nothing here has to agree with it.
//
// Asked per event rather than as a precomputed list of dates, so it can't
// disagree with the events actually on the wall.
export function isHolidayEvent(event) {
  if (!event.allDay) return false;
  const fromHolidayCalendar =
    HOLIDAY_CALENDAR_ID.test(event.calendarKey || '') || HOLIDAY_CALENDAR_LABEL.test(event.calendarLabel || '');
  if (!fromHolidayCalendar) return false;
  const title = normalize(event.title || '');
  return HOLIDAYS.some((holiday) => holiday.match.some((needle) => title.includes(needle)));
}
