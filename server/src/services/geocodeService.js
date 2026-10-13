// City-name lookup for the companion app's "search for a city" location
// picker, and reverse lookup for a friendly label after "Use my location".
// Backed by OpenStreetMap's Nominatim — free, no API key/signup required.
// This runs server-side (not called directly from the browser) so a
// descriptive User-Agent can be sent, per Nominatim's usage policy, and so
// it isn't subject to CORS. Each call here is one person pressing "Search"
// or "Use my location" during setup — nowhere near Nominatim's "no bulk/
// automated use" limit.
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'WallCalToDo (github.com/smccloud/WallCalToDo)';

async function nominatimFetch(path) {
  const res = await fetch(`${NOMINATIM_BASE}${path}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Geocoding lookup failed (${res.status})`);
  return res.json();
}

// [{ label, lat, lon }] — up to 5 matches for a free-text place search.
export async function searchPlaces(query) {
  const data = await nominatimFetch(`/search?format=json&limit=5&q=${encodeURIComponent(query)}`);
  return data.map((r) => ({ label: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon) }));
}

// A friendly label for a lat/lon (used after browser geolocation, which
// only gives raw coordinates) — null if Nominatim has nothing for it.
export async function reverseGeocode(lat, lon) {
  const data = await nominatimFetch(`/reverse?format=json&zoom=10&lat=${lat}&lon=${lon}`);
  return data.display_name || null;
}

// Nominatim models a town's name under whichever OSM tag fits the place, so a
// reverse lookup has to try the common ones before falling back to the county.
// Ordered most- to least-specific so a real city wins over a broad district.
const CITY_KEYS = ['city', 'town', 'village', 'municipality', 'locality', 'hamlet'];

// The structured pieces behind reverseGeocode's single string, for the school
// lunch discovery path (see lunchService.discoverDistricts): which town the
// wall is in, and the county as a fallback, so a candidate district slug can
// be derived from an actual place name rather than from raw coordinates.
// `label` is the same friendly string reverseGeocode returns.
export async function reverseGeocodeDetail(lat, lon) {
  const data = await nominatimFetch(`/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}`);
  const address = data.address || {};
  return {
    city: CITY_KEYS.map((key) => address[key]).find(Boolean) || null,
    county: address.county || null,
    state: address.state || null,
    label: data.display_name || null,
  };
}
