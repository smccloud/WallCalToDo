import { reverseGeocodeDetail } from '../geocodeService.js';
import { buildSections, MEALS, addDays, requestFailed } from './sections.js';

// Health-e Pro's public, unauthenticated API -- what MySchoolMenus became, and
// what its own menu app (menus.healthepro.com) reads. A district is an
// organization id and a school a site id, both plain integers; each site has a
// meal menu (breakfast, lunch, ...) whose published days live under
// year/month "date_overwrites", each carrying its display items as a JSON
// string. Three reads: the site's menus once, then one month per published
// month the requested week touches.
//
// The directory endpoint lists every district grouped by state, so a location
// can be narrowed to a state's districts and then ranked by name -- the closest
// thing to discovery any of the non-Nutrislice providers offers.
const API_BASE = 'https://menus.healthepro.com/api';
const LABEL = 'Health-e Pro';
const INT_RE = /^\d{1,10}$/;
const MEAL_TYPE_IDS = { breakfast: 1, lunch: 2 };
const DISCOVER_TIMEOUT_MS = 8000;
const MAX_DISCOVERY_RESULTS = 12;

function isValidId(value) {
  return (typeof value === 'string' && INT_RE.test(value)) || (typeof value === 'number' && Number.isInteger(value));
}

async function getData(path, { timeout } = {}) {
  const res = await fetch(`${API_BASE}${path}`, timeout ? { signal: AbortSignal.timeout(timeout) } : undefined);
  if (!res.ok) return { ok: false, status: res.status };
  const body = await res.json();
  return { ok: true, data: body?.data };
}

// The months (as 'YYYY-MM' keys) a fetch from `now` through the next six days
// touches, deduped so a week inside one month is one request.
function monthsFor(now) {
  const months = new Map();
  for (const offset of [0, 6]) {
    const date = addDays(now, offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    months.set(key, { year: date.getFullYear(), month: date.getMonth() + 1 });
  }
  if (months.size === 2) {
    // A week spanning a month boundary; fill in any month in between.
    const [first, second] = [...months.values()].sort((a, b) => a.year - b.year || a.month - b.month);
    let cursor = new Date(first.year, first.month - 1, 1);
    const end = new Date(second.year, second.month - 1, 1);
    while (cursor < end) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      months.set(key, { year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    }
  }
  return [...months.values()];
}

// A day's `setting` is a JSON string whose current_display is an ordered stream
// of categories ("Lunch Entree") and dishes -- the same category/item shape the
// wall draws. A day whose display carries no recipe at all (a day off) becomes
// no sections, which parseMeal drops.
function parseDay(entry) {
  let setting;
  try {
    setting = JSON.parse(entry?.setting || 'null');
  } catch {
    return null;
  }
  const entries = (setting?.current_display || []).map((item) => ({
    type: item.type === 'category' ? 'category' : 'item',
    name: item.name,
  }));
  const sections = buildSections(entries);
  return sections.length ? sections : null;
}

async function fetchMeal(district, menu, now) {
  const published = new Set((menu.published_months || []).map((month) => String(month).slice(0, 7)));
  const days = {};
  for (const { year, month } of monthsFor(now)) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!published.has(key)) continue;
    const path = `/organizations/${district}/menus/${menu.id}/year/${year}/month/${String(month).padStart(2, '0')}/date_overwrites`;
    const result = await getData(path);
    if (!result.ok || !Array.isArray(result.data)) continue;
    for (const entry of result.data) {
      const day = (entry?.day || '').slice(0, 10);
      if (!day) continue;
      const sections = parseDay(entry);
      if (sections) days[day] = sections;
    }
  }
  return Object.keys(days).length ? days : null;
}

export const id = 'healthepro';
export const label = 'Health-e Pro';

// Shape-checks the ids that are present; a null/absent id is "not configured
// yet", not invalid, so switching providers (which clears the ids) is allowed
// before the new one is filled in.
export function validate(settings) {
  const district = settings?.schoolLunchDistrict;
  if (district !== null && district !== undefined && !isValidId(district)) {
    return 'Invalid schoolLunchDistrict';
  }
  const school = settings?.schoolLunchSchool;
  if (school !== null && school !== undefined && !isValidId(school)) {
    return 'Invalid schoolLunchSchool';
  }
  return null;
}

export function configured(settings) {
  return isValidId(settings?.schoolLunchDistrict) && isValidId(settings?.schoolLunchSchool);
}

export async function fetchSchools(settings) {
  const district = settings?.schoolLunchDistrict;
  if (!isValidId(district)) throw new Error('Invalid district');
  const res = await fetch(`${API_BASE}/organizations/${district}/sites/list`);
  if (!res.ok) throw requestFailed(LABEL, res);
  const body = await res.json();
  return (body.data || [])
    .filter((site) => site && site.id != null)
    .map((site) => ({ id: String(site.id), name: site.name || String(site.id) }));
}

export async function fetchMeals(settings, now) {
  const { schoolLunchDistrict: district, schoolLunchSchool: school } = settings;
  const menus = await getData(`/organizations/${district}/sites/${school}/menus`);
  if (!menus.ok) throw new Error(`${LABEL} request failed (${menus.status})`);
  const list = Array.isArray(menus.data) ? menus.data : [];

  const meals = {};
  for (const meal of MEALS) {
    const menu = list.find((entry) => entry?.meal_type_id === MEAL_TYPE_IDS[meal]);
    meals[meal] = menu ? await fetchMeal(district, menu, now) : null;
  }
  return meals;
}

// The wall's location -> the directory -> the districts in the matching state,
// ranked so a district whose name echoes the town/county comes first. The
// directory only carries state, so this can't pin a city exactly; it's a
// shortlist to pick from, not a verified match. Returns an empty list (not an
// error) when the state matches nothing.
export async function discover(settings, { lat, lon } = {}) {
  const detail = await reverseGeocodeDetail(lat, lon);
  const state = (detail.state || '').toLowerCase().trim();
  const terms = [detail.city, detail.county]
    .filter(Boolean)
    .map((value) => value.toLowerCase().replace(/ county$/i, '').trim())
    .filter(Boolean);

  const result = await getData('/organizations', { timeout: DISCOVER_TIMEOUT_MS });
  if (!result.ok || !Array.isArray(result.data)) return { place: detail.city || detail.county || null, groups: [] };

  const organizations = result.data.flatMap((group) => group?.organizations || []);
  const groups = organizations
    .filter((org) => org && org.id != null)
    .filter((org) => !state || (org.state || '').toLowerCase() === state)
    .map((org) => {
      const name = (org.name || '').toLowerCase();
      const score = terms.reduce((total, term) => total + (name.includes(term) ? term.length : 0), 0);
      return { id: String(org.id), label: org.name || String(org.id), score };
    })
    .filter((org) => !terms.length || org.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, MAX_DISCOVERY_RESULTS)
    .map(({ id: orgId, label: orgLabel }) => ({ id: orgId, label: orgLabel }));

  return { place: detail.city || detail.county || null, groups };
}
