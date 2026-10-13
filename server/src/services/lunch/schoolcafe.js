import { buildSections, MEALS, addDays, localDateKey, requestFailed } from './sections.js';

// SchoolCafe's public menu API (webapis.schoolcafe.com). A district is an
// integer id and a school a GUID; the menu itself is requested per serving line
// ("AHS Pizza (Line 1)") and meal type, which is why SchoolCafe -- alone among
// the providers here -- needs a serving-line setting as well as a school. A
// school's serving lines are discoverable (GetDistinctLines); its districts are
// not (the search endpoints are not public and the full list fails to
// serialize), so this provider's discovery is a no-op and the district id is
// entered by hand.
const API_BASE = 'https://webapis.schoolcafe.com/api';
const LABEL = 'SchoolCafe';
const INT_RE = /^\d{1,10}$/;
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MEALS_BY_API = [['breakfast', 'Breakfast'], ['lunch', 'Lunch']];

function isValidDistrict(value) {
  return (typeof value === 'string' && INT_RE.test(value)) || (typeof value === 'number' && Number.isInteger(value));
}

function isValidSchool(value) {
  return typeof value === 'string' && GUID_RE.test(value);
}

function isValidServingLine(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
}

// One meal's entries across the requested window: each menu carries a date, an
// ordered list of categories, and the dishes under each. The category
// name is the section title and each dish's Desc the item -- the same shape the
// wall draws. Category display order is respected so sides don't jump the
// entrée.
export function parseMenu(entries) {
  const days = {};
  for (const entry of entries || []) {
    const date = (entry?.Servingdate || '').slice(0, 10);
    if (!date) continue;
    const sections = buildSections(
      (entry.Category || [])
        .slice()
        .sort((a, b) => (a.DisplayOrder || 0) - (b.DisplayOrder || 0))
        .flatMap((category) => [
          { type: 'category', name: category.Name },
          ...(category.Items || []).map((item) => ({ type: 'item', name: item.Desc })),
        ])
    );
    if (sections.length) days[date] = sections;
  }
  return days;
}

export const id = 'schoolcafe';
export const label = 'SchoolCafe';

// Shape-checks the ids that are present; a null/absent id is "not configured
// yet", not invalid, so switching providers (which clears the ids) is allowed
// before the new one is filled in.
export function validate(settings) {
  const district = settings?.schoolLunchDistrict;
  if (district !== null && district !== undefined && !isValidDistrict(district)) {
    return 'Invalid schoolLunchDistrict';
  }
  const school = settings?.schoolLunchSchool;
  if (school !== null && school !== undefined && !isValidSchool(school)) {
    return 'Invalid schoolLunchSchool';
  }
  const line = settings?.schoolLunchServingLine;
  if (line !== null && line !== undefined && !isValidServingLine(line)) {
    return 'Invalid schoolLunchServingLine';
  }
  return null;
}

export function configured(settings) {
  return (
    isValidDistrict(settings?.schoolLunchDistrict) &&
    isValidSchool(settings?.schoolLunchSchool) &&
    isValidServingLine(settings?.schoolLunchServingLine)
  );
}

export async function fetchSchools(settings) {
  const district = settings?.schoolLunchDistrict;
  if (!isValidDistrict(district)) throw new Error('Invalid district');
  const res = await fetch(`${API_BASE}/GetSchoolsList?districtId=${encodeURIComponent(district)}`);
  if (!res.ok) throw requestFailed(LABEL, res);
  const body = await res.json();
  return (Array.isArray(body) ? body : [])
    .filter((school) => isValidSchool(school.SchoolId))
    .map((school) => ({ id: school.SchoolId, name: school.SchoolName || school.SchoolId }));
}

export async function fetchLines(settings) {
  const school = settings?.schoolLunchSchool;
  if (!isValidSchool(school)) throw new Error('Invalid school');
  const res = await fetch(`${API_BASE}/GetDistinctLines?schoolId=${encodeURIComponent(school)}`);
  if (!res.ok) throw requestFailed(LABEL, res);
  const body = await res.json();
  return (Array.isArray(body) ? body : [])
    .map((line) => line?.Name)
    .filter((name) => typeof name === 'string' && name.trim())
    .map((name) => ({ id: name, name }));
}

export async function fetchMeals(settings, now) {
  const { schoolLunchSchool: school, schoolLunchServingLine: servingLine } = settings;
  const start = localDateKey(now);
  const end = localDateKey(addDays(now, 6));
  const meals = {};
  for (const [meal, apiMeal] of MEALS_BY_API) {
    const params = new URLSearchParams({
      SchoolId: school,
      StartDate: start,
      EndDate: end,
      ServingLine: servingLine,
      MealType: apiMeal,
    });
    const res = await fetch(`${API_BASE}/CalendarView/GetMonthlyMenuitems?${params}`);
    if (!res.ok) throw requestFailed(LABEL, res);
    const days = parseMenu(await res.json());
    meals[meal] = Object.keys(days).length ? days : null;
  }
  return meals;
}

// No public district search exists, so there's nothing to look a location
// against -- the picker falls back to typing the district id, then loading its
// schools and the chosen school's serving lines.
export async function discover() {
  return { place: null, groups: [] };
}
