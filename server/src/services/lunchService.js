import { readJson, writeJson } from '../store/fileStore.js';
import { getSettings } from './settingsService.js';
import { reverseGeocodeDetail } from './geocodeService.js';

const LUNCH_FILE = 'lunch.json';

// Nutrislice's public, unauthenticated menu API — same endpoints the community
// MMM-Nutrislice MagicMirror module uses, no key required. Two reads only:
// the district's school list once, then one week menu per served meal. The
// week endpoint takes any day in the week and returns the whole Sunday-to-
// Saturday window, so the cache carries several days at a time and the poll
// gate can be long (see LUNCH_POLL_INTERVAL_MS in poller.js) instead of
// re-fetching for every request — Nutrislice asks callers to keep requests to
// a minimum.
//
// The district is the site's own subdomain and its exact form is the
// district's choice ("soudertonsd", "fcps", ...) — Nutrislice publishes no
// "districts near me" endpoint, so there's nothing to look a location up
// against. The companion app therefore takes the slug by hand, with an
// optional best-effort discovery path (discoverDistricts below) that derives
// candidate slugs from the wall's reverse-geocoded location and keeps only
// the ones that actually resolve.
const API_SUFFIX = '.api.nutrislice.com';
const SCHOOLS_PATH = '/menu/api/schools?format=json';

// The district becomes part of the hostname and the school part of the path,
// so both are validated against the one shape Nutrislice slugs ever take.
// This is the same rule the settings route enforces (see SLUG_RE there) --
// duplicated rather than shared because this module must not trust its
// caller, and a request URL is a much worse place to be wrong than a 400.
const SLUG_RE = /^[a-z0-9-]{1,63}$/;
const SCHOOL_RE = /^[a-z0-9-]{1,100}$/;

// Every meal the wall knows how to show, in the order a day serves them.
// Breakfast is optional: a district that doesn't serve it 404s, which reads
// as "not served" (null), not as a failed poll.
const MEALS = ['breakfast', 'lunch'];

// Discovery guesses a district slug by appending these to a place name, in
// rough order of how often US districts use each shape. Both the hyphenated
// and concatenated forms are included because both are common — "souderton-sd"
// and "soudertonsd" are equally real — and the list is deliberately short:
// every candidate is one real HTTP request, so discovery stays a handful of
// probes per press rather than a crawl of a naming space that can't be
// enumerated to begin with (the slug is the district's own choice).
const DISTRICT_SUFFIXES = [
  '',
  '-sd',
  'sd',
  '-schools',
  'schools',
  '-school-district',
  '-isd',
  'isd',
  '-public-schools',
  '-county-schools',
];
const DISCOVER_TIMEOUT_MS = 6000;
const MAX_DISCOVERY_CANDIDATES = 24;

function apiBase(district) {
  return `https://${district}${API_SUFFIX}`;
}

function isValidDistrict(district) {
  return typeof district === 'string' && SLUG_RE.test(district);
}

function isValidSchool(school) {
  return typeof school === 'string' && SCHOOL_RE.test(school);
}

// The districts' school list, trimmed to what the companion app's picker
// needs: a display name and the slug the week endpoint takes, plus which meal
// types that school actually serves (so a breakfast-less school doesn't get
// offered a breakfast phase it will never fill). Shared with the discovery
// probes below so "what counts as a usable school" is defined once.
function collectSchools(data) {
  return (Array.isArray(data) ? data : [])
    .filter((school) => school && isValidSchool(school.slug))
    .map((school) => ({
      name: school.name || school.slug,
      slug: school.slug,
      menuTypes: (school.active_menu_types || []).map((type) => type.slug).filter(Boolean),
    }));
}

export async function fetchSchools(district) {
  if (!isValidDistrict(district)) throw new Error('Invalid district');
  const res = await fetch(`${apiBase(district)}${SCHOOLS_PATH}`);
  if (!res.ok) throw new Error(`Nutrislice request failed (${res.status})`);
  return collectSchools(await res.json());
}

// A day's menu_items are a flat, ordered stream of section titles and foods
// (and the occasional announcement line, or a blank spacer). This folds it
// into the shape the display draws: a list of titled sections, each with its
// food names in order. A title with nothing under it is dropped along with
// the spacer lines -- an empty heading is worse on the wall than no heading.
export function parseMenuItems(items) {
  const sections = [];
  let current = { title: null, items: [] };
  const flush = () => {
    if (current.items.length) sections.push(current);
  };
  for (const item of items || []) {
    if (!item || item.blank_line) continue;
    if (item.is_section_title) {
      flush();
      current = { title: (item.text || '').trim() || null, items: [] };
      continue;
    }
    const name = (item.food?.name || item.text || '').trim();
    if (name) current.items.push(name);
  }
  flush();
  return sections;
}

// { 'YYYY-MM-DD': [ { title, items } ] } for one meal's week response. Days
// with nothing on them (a weekend, a holiday, an unpublished menu) are left
// out rather than cached as empty arrays, so the display can tell "no school
// today" from "a menu with no food on it".
export function parseWeek(week) {
  const days = {};
  for (const day of week?.days || []) {
    if (!day?.date) continue;
    const sections = parseMenuItems(day.menu_items);
    if (sections.length) days[day.date] = sections;
  }
  return days;
}

// One meal's week, or null when the district doesn't serve it (a 404 -- the
// endpoint's answer for an unknown menu type, which is how breakfast comes
// back for a lunch-only school). Any other failure throws so the caller can
// leave the last good cache in place.
async function fetchMealWeek(district, school, meal, date) {
  const url =
    `${apiBase(district)}/menu/api/weeks/school/${school}/menu-type/${meal}` +
    `/${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}/?format=json`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Nutrislice request failed (${res.status})`);
  return parseWeek(await res.json());
}

function loadLunch() {
  return readJson(LUNCH_FILE, null);
}

function saveLunch(lunch) {
  writeJson(LUNCH_FILE, lunch);
}

// Last successfully fetched menus, regardless of how stale -- a failed refresh
// leaves the wall showing the previous week's meals rather than nothing, the
// same "keep the last good state" rule the calendar/todo/weather caches follow.
export function getCachedLunch() {
  return loadLunch();
}

// Fetches both served meals' weeks for the school saved in settings and caches
// them together. Returns null when the feature isn't configured yet (nothing
// to fetch), and throws when a fetch fails with the cache left untouched so
// the previous menu survives a Nutrislice outage.
export async function pollLunch() {
  const { schoolLunchDistrict: district, schoolLunchSchool: school } = getSettings();
  if (!isValidDistrict(district) || !isValidSchool(school)) return null;

  const now = new Date();
  const results = await Promise.allSettled(
    MEALS.map((meal) => fetchMealWeek(district, school, meal, now))
  );
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) throw failures[0].reason;

  const meals = {};
  MEALS.forEach((meal, index) => {
    meals[meal] = results[index].status === 'fulfilled' ? results[index].value : null;
  });

  const lunch = { district, school, meals, fetchedAt: new Date().toISOString() };
  saveLunch(lunch);
  return lunch;
}

// A place name as a Nutrislice slug: lowercased, accents folded to ASCII so a
// name like "Cañon City" still becomes a hostname-safe slug, and everything
// that isn't a letter or digit collapsed to a single dash. The length cap
// mirrors the settings route's district bound.
function slugify(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

// The candidate district slugs for a place -- the town/city name and, as a
// fallback, the county -- each both in its hyphenated and run-together form
// ("big-lake" and "biglake"; districts with multi-word names use the second
// about as often as the first), then each with the common suffixes above.
// Deduped, capped, and filtered to the same shape the settings route accepts,
// so a bad guess can never become a request to a hostname we wouldn't
// otherwise allow.
export function candidateSlugs({ city, county } = {}) {
  const bases = [];
  for (const name of [city, county]) {
    const slug = slugify(name);
    if (!slug) continue;
    if (!bases.includes(slug)) bases.push(slug);
    const collapsed = slug.replace(/-/g, '');
    if (collapsed && !bases.includes(collapsed)) bases.push(collapsed);
  }

  const slugs = [];
  for (const base of bases) {
    for (const suffix of DISTRICT_SUFFIXES) {
      const slug = `${base}${suffix}`;
      if (isValidDistrict(slug) && !slugs.includes(slug)) slugs.push(slug);
      if (slugs.length >= MAX_DISCOVERY_CANDIDATES) return slugs;
    }
  }
  return slugs;
}

// One candidate check: does this slug resolve to a district with schools? A
// 404, any other error, or a slow host is simply "no" -- discovery must never
// fail because one guess in the list was wrong. Returns the school count (so
// the picker can rank the obviously-bigger districts) or null for no match.
async function probeDistrict(district) {
  if (!isValidDistrict(district)) return null;
  try {
    const res = await fetch(`${apiBase(district)}${SCHOOLS_PATH}`, {
      signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const count = collectSchools(await res.json()).length;
    return count || null;
  } catch {
    return null;
  }
}

// The wall's location -> a place name -> every candidate slug that resolves to
// a real Nutrislice district, most-likely first. `place` is null when the
// reverse lookup found no town or county to guess from, so the companion app
// can tell "we couldn't work out where this is" apart from "no district here".
// Discovery is best-effort by construction: it only finds districts whose slug
// is derived from the place name, which is common but not guaranteed.
export async function discoverDistricts({ lat, lon } = {}) {
  const detail = await reverseGeocodeDetail(lat, lon);
  const probed = await Promise.all(
    candidateSlugs(detail).map(async (slug) => ({ slug, schoolCount: await probeDistrict(slug) }))
  );
  return {
    place: detail.city || detail.county || null,
    districts: probed.filter((result) => result.schoolCount !== null),
  };
}
