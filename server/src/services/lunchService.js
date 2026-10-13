import { readJson, writeJson } from '../store/fileStore.js';
import { getSettings } from './settingsService.js';
import { DEFAULT_PROVIDER, getProvider, PROVIDER_LIST } from './lunch/index.js';

const LUNCH_FILE = 'lunch.json';

// The school lunch view's data layer. Providers (see services/lunch/) each know
// one menu system's API and how to fold it into the cached shape below; this
// module is what the rest of the server talks to. It reads the saved provider,
// delegates the fetch, and caches the result:
//
//   { provider, district, school, schoolName,
//     meals: { breakfast: { 'YYYY-MM-DD': [{ title, items }] } | null,
//              lunch: { ... } | null },
//     fetchedAt }
//
// The display only reads `meals`, so a new provider changes nothing on the
// frontend (see frontend/src/utils/lunch.js). A failed refresh throws with the
// cache left untouched, so the wall keeps the last good menu through an outage.
export function getCachedLunch() {
  return readJson(LUNCH_FILE, null);
}

function saveLunch(lunch) {
  writeJson(LUNCH_FILE, lunch);
}

// The provider the saved settings choose, defaulting to Nutrislice so an install
// that predates the provider setting keeps working unchanged.
export function currentProvider(settings = getSettings()) {
  return getProvider(settings.schoolLunchProvider || DEFAULT_PROVIDER);
}

// Whether the feature is pointed at something it can actually fetch for. Used by
// the poll gate and the settings route so "enabled but unconfigured" never
// becomes a fetch every cycle.
export function isLunchConfigured(settings = getSettings()) {
  return currentProvider(settings).configured(settings);
}

// The active provider's own check of a full settings object, or null when it's
// valid. The settings route calls this after merging a patch so each provider
// owns the shape rules for its own ids (a Nutrislice slug, a numeric site id, a
// SchoolCafe GUID, ...).
export function validateLunchSettings(settings) {
  return currentProvider(settings).validate(settings);
}

// The schools in a district, for the companion app's school picker. `district`
// is whatever the active provider treats as a district id.
export async function fetchSchools(district, provider = DEFAULT_PROVIDER) {
  return getProvider(provider).fetchSchools({
    schoolLunchProvider: provider,
    schoolLunchDistrict: district,
  });
}

// A SchoolCafe-only extra step: the serving lines within a school. Providers
// without serving lines don't define it.
export async function fetchLines(school, district, provider = DEFAULT_PROVIDER) {
  const implementation = getProvider(provider);
  if (typeof implementation.fetchLines !== 'function') return [];
  return implementation.fetchLines({
    schoolLunchProvider: provider,
    schoolLunchDistrict: district,
    schoolLunchSchool: school,
  });
}

// Best-effort district discovery from the wall's saved location, provider by
// provider (see each module's discover). Returns { place, groups }, where each
// group is a selectable district-ish choice the school picker can drill into.
export async function discoverDistricts({ lat, lon } = {}, provider = DEFAULT_PROVIDER) {
  return getProvider(provider).discover({ schoolLunchProvider: provider }, { lat, lon });
}

// Fetches the active provider's breakfast and lunch menus for the saved school
// and caches them together. Returns null when the feature isn't configured yet
// (nothing to fetch), and throws when a fetch fails so the previous menu
// survives.
export async function pollLunch() {
  const settings = getSettings();
  const provider = currentProvider(settings);
  if (!provider.configured(settings)) return null;

  const meals = await provider.fetchMeals(settings, new Date());
  const lunch = {
    provider: provider.id,
    district: settings.schoolLunchDistrict,
    school: settings.schoolLunchSchool,
    schoolName: settings.schoolLunchSchoolName,
    meals,
    fetchedAt: new Date().toISOString(),
  };
  saveLunch(lunch);
  return lunch;
}

export { PROVIDER_LIST };
export { parseMenuItems, parseWeek, candidateSlugs } from './lunch/nutrislice.js';
