// The display's menu shape, shared by every provider: a day's menu is a list
// of titled sections, each with its item names in order. Every provider's API
// hands over a different flat stream of "headings and foods", so each one
// normalizes into the { type: 'category' | 'item', name } entries buildSections
// folds below -- the shape frontend/src/utils/lunch.js and LunchView.jsx read.
//
// A category starts a new section; a category with nothing under it is dropped,
// along with the empty leading section before any category, so an empty heading
// never reaches the wall.
export function buildSections(entries) {
  const sections = [];
  let current = { title: null, items: [] };
  const flush = () => {
    if (current.items.length) sections.push(current);
  };
  for (const entry of entries || []) {
    const name = (entry?.name || '').trim();
    if (!name) continue;
    if (entry.type === 'category') {
      flush();
      current = { title: name, items: [] };
    } else {
      current.items.push(name);
    }
  }
  flush();
  return sections;
}

// A local 'YYYY-MM-DD', the same key the display derives from its own local
// date (see dateKey in frontend/src/utils/date.js). Formatted from local parts
// rather than toISOString() so a wall east or west of UTC doesn't ask for the
// wrong day.
export function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// Every meal a day can serve, in the order a day serves them. Breakfast is
// optional everywhere: a provider that doesn't offer it reads as null, not as a
// failed poll.
export const MEALS = ['breakfast', 'lunch'];

// A per-provider fetch failure, carrying the provider's name so one failing
// provider's message can't be mistaken for another's, and so the orchestration
// layer can rethrow without knowing which provider it called.
export function requestFailed(label, res) {
  return new Error(`${label} request failed (${res.status})`);
}
