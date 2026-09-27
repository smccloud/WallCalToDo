// Explains what each calendar's color means, plus any per-event color
// overrides actually in use within it (Google Calendar's "change color of
// this event" option) -- one letter-circle per calendar (its own default
// color, labeled with the calendar's first letter), with any override
// colors seen among its events stacked to its left as plain color
// swatches: the one furthest back (lowest in the stack, most covered)
// comes first/leftmost, on up through the main circle last/rightmost,
// which stays on top so its letter is always fully legible.
const CIRCLE_SIZE = 28;
const STACK_OFFSET = 7;

// One entry per distinct calendar seen in `events`. event.calendarColor is
// the calendar's own (never-overridden) color; events cached from before that
// field existed fall back to their own color, which is correct for the common
// case (no override) and self-corrects once the daily full resync refreshes
// them. Any other distinct color actually used within that same calendar
// becomes a secondary/override swatch, sorted for a stable order across
// renders instead of whatever order events happen to be in.
//
// Grouped by event.calendarKey rather than calendarLabel, since the display
// now merges more than one provider: two calendars are free to share a name
// (a Google "Work" and a Microsoft "Work" is the obvious one), and keying by
// label would silently collapse those into a single entry showing only one of
// their colors. The key is provider-unique, so that's the identity to group
// on; the label is kept for display. Events cached before calendarKey existed
// fall back to grouping by label, same as the missing-color and missing-order
// fallbacks above, until the next resync fills it in.
//
// Groups themselves are ordered by event.calendarOrder -- each calendar's
// position in the account-then-calendar order the server already fetched
// from the provider (see calendarService.js for Google,
// msCalendarService.js for Microsoft, which continues the same numbering so
// the two never interleave), the same order the companion app's own calendar
// list displays. Missing it (again, only possible for events cached before
// that field existed) sorts a group to the end rather than crashing the sort,
// until the next resync fills it in.
function buildGroups(events) {
  const byKey = new Map();
  for (const event of events) {
    const mainColor = event.calendarColor || event.color;
    if (!mainColor) continue;
    const key = event.calendarKey || event.calendarLabel;
    if (!byKey.has(key)) {
      byKey.set(key, { mainColor, secondary: new Set(), order: event.calendarOrder, label: event.calendarLabel });
    }
    const group = byKey.get(key);
    if (group.order === undefined) group.order = event.calendarOrder;
    // A calendar's name can be missing on the one event that happens to be
    // first in this batch, so prefer any label actually seen over whatever
    // the first event happened to have -- same tolerance as `order` above.
    if (!group.label && event.calendarLabel) group.label = event.calendarLabel;
    if (event.color && event.color !== group.mainColor) group.secondary.add(event.color);
  }
  return [...byKey.entries()]
    .sort(([, a], [, b]) => (a.order ?? Infinity) - (b.order ?? Infinity))
    .map(([key, { mainColor, secondary, label }]) => ({
      key,
      label,
      mainColor,
      secondaryColors: [...secondary].sort(),
    }));
}

export default function Legend({ events }) {
  const groups = buildGroups(events);
  if (groups.length === 0) return null;

  return (
    <div className="legend">
      {groups.map((group) => (
        <div
          key={group.key}
          className="legend__group"
          style={{ width: CIRCLE_SIZE + STACK_OFFSET * group.secondaryColors.length }}
        >
          {group.secondaryColors.map((color, i) => (
            <span
              key={color}
              className="event-pill legend__circle"
              style={{ '--event-color': color, left: i * STACK_OFFSET }}
            />
          ))}
          <span
            className="event-pill legend__circle legend__circle--main"
            style={{ '--event-color': group.mainColor, left: group.secondaryColors.length * STACK_OFFSET }}
          >
            {/* A nameless calendar still has to render something, and an
                empty circle reads as a rendering bug. */}
            {(group.label || '?').charAt(0).toUpperCase()}
          </span>
        </div>
      ))}
    </div>
  );
}
