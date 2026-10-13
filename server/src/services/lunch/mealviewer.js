import { reverseGeocodeDetail } from '../geocodeService.js';
import { MEALS, localDateKey, addDays, requestFailed } from './sections.js';

// MealViewer's public, unauthenticated API -- the one the schools.mealviewer.com
// single-page app calls. A school is named by its "physicalLocationLookup"
// (e.g. "EisenhowerElementaryMN"), which is what the app puts in its URLs; the
// day range is two YYYY-MM-DD path segments. Search is by free text and returns
// schools with their city/state, which is what makes location discovery work
// here where Nutrislice's opaque slugs don't.
//
// Unlike Nutrislice's regional hostnames, MealViewer is one fixed host, so the
// only thing a caller supplies is the school id -- validated as the alphanumeric
// shape those ids take before it can reach a URL path.
const API_BASE = 'https://api.mealviewer.com/api/v4';
const LABEL = 'MealViewer';
const LOOKUP_RE = /^[A-Za-z0-9]{1,64}$/;

// Discovery returns each matching school as a one-school "group" whose id is
// prefixed with this, so the same district -> schools flow the picker uses for
// the other providers can carry a school straight through (fetchSchools decodes
// it) without a second kind of result.
const SCHOOL_PREFIX = 'school:';
const DISCOVER_TIMEOUT_MS = 6000;
const MAX_DISCOVERY_RESULTS = 12;

function isValidLookup(value) {
  return typeof value === 'string' && LOOKUP_RE.test(value);
}

// MealViewer's blocks are named for the meal ("Lunch", "Breakfast"); the item
// types within a block (ENTREES, VEGETABLES, ...) are the sections the wall
// draws, exactly like Nutrislice's section titles. Items are collected per type
// in first-seen order, and a "NO SCHOOL TODAY" placeholder -- which arrives as
// an ordinary item -- is dropped so a holiday reads as no menu rather than as a
// one-line menu.
function parseDay(block) {
  const order = [];
  const byType = new Map();
  for (const line of block.cafeteriaLineList?.data || []) {
    for (const item of line.foodItemList?.data || []) {
      const name = (item.item_Name || '').trim();
      if (!name || /^no school/i.test(name)) continue;
      const type = (item.item_Type || '').trim() || 'Menu';
      if (!byType.has(type)) {
        byType.set(type, []);
        order.push(type);
      }
      byType.get(type).push(name);
    }
  }
  return order.length ? order.map((type) => ({ title: type, items: byType.get(type) })) : null;
}

export function parseMenus(data) {
  const meals = {};
  for (const schedule of data?.menuSchedules || []) {
    for (const block of schedule?.menuBlocks || []) {
      if (!block || block.blackedOut) continue;
      const meal = (block.blockName || '').toLowerCase();
      if (!MEALS.includes(meal)) continue;
      const date = (block.scheduledDate || '').slice(0, 10);
      if (!date) continue;
      const sections = parseDay(block);
      if (!sections) continue;
      (meals[meal] ||= {})[date] = sections;
    }
  }
  return Object.fromEntries(MEALS.map((meal) => [meal, meals[meal] || null]));
}

export const id = 'mealviewer';
export const label = 'MealViewer';

// Shape-checks the ids that are present; a null/absent id is "not configured
// yet", not invalid, so switching providers (which clears the ids) is allowed
// before the new one is filled in.
export function validate(settings) {
  const school = settings?.schoolLunchSchool;
  if (school !== null && school !== undefined && school !== '' && !isValidLookup(school)) {
    return 'Invalid schoolLunchSchool';
  }
  const district = settings?.schoolLunchDistrict;
  if (district !== null && district !== undefined && district !== '' && !isValidLookup(district.replace(SCHOOL_PREFIX, ''))) {
    return 'Invalid schoolLunchDistrict';
  }
  return null;
}

export function configured(settings) {
  return isValidLookup(settings?.schoolLunchSchool);
}

export async function fetchSchools(settings) {
  const district = settings?.schoolLunchDistrict;
  if (typeof district === 'string' && district.startsWith(SCHOOL_PREFIX)) {
    const lookup = district.slice(SCHOOL_PREFIX.length);
    if (!isValidLookup(lookup)) throw new Error('Invalid district');
    const res = await fetch(`${API_BASE}/physicalLocation/${lookup}`);
    if (!res.ok) throw requestFailed(LABEL, res);
    const school = await res.json();
    return [{ id: school.physicalLocationLookup || lookup, name: school.name || lookup }];
  }
  if (!isValidLookup(district)) throw new Error('Invalid district');
  const res = await fetch(`${API_BASE}/physicalLocation/district/${district}`);
  if (!res.ok) throw requestFailed(LABEL, res);
  const body = await res.json();
  return (body.data || [])
    .filter((school) => isValidLookup(school.physicalLocationLookup))
    .map((school) => ({ id: school.physicalLocationLookup, name: school.name || school.physicalLocationLookup }));
}

export async function fetchMeals(settings, now) {
  const school = settings.schoolLunchSchool;
  if (!isValidLookup(school)) throw new Error('Invalid school');
  const start = localDateKey(now);
  const end = localDateKey(addDays(now, 6));
  const res = await fetch(`${API_BASE}/school/${school}/${start}/${end}/`);
  if (!res.ok) throw requestFailed(LABEL, res);
  return parseMenus(await res.json());
}

// The wall's location -> a place name -> MealViewer's text search for that
// place -> the schools in the matching state. The search matches on the name
// alone, so a same-named town in another state is filtered out by the state the
// reverse lookup gave back; each surviving school is returned as a selectable
// one-school group. Best-effort: a school whose name doesn't echo its town
// won't be found this way.
export async function discover(settings, { lat, lon } = {}) {
  const detail = await reverseGeocodeDetail(lat, lon);
  const term = detail.city || detail.county;
  if (!term) return { place: null, groups: [] };

  let results = [];
  try {
    const res = await fetch(`${API_BASE}/physicalLocation/search/${encodeURIComponent(term)}`, {
      signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS),
    });
    if (res.ok) results = (await res.json()).data || [];
  } catch {
    results = [];
  }

  const state = (detail.state || '').toLowerCase();
  const groups = results
    .filter((school) => isValidLookup(school.physicalLocationLookup))
    .filter((school) => !state || (school.state || '').toLowerCase() === state)
    .slice(0, MAX_DISCOVERY_RESULTS)
    .map((school) => ({
      id: `${SCHOOL_PREFIX}${school.physicalLocationLookup}`,
      label: school.name || school.physicalLocationLookup,
      schoolCount: 1,
    }));

  return { place: detail.city || detail.county || null, groups };
}
