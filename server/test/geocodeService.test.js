import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reverseGeocode, reverseGeocodeDetail, searchPlaces } from '../src/services/geocodeService.js';

// Nominatim is the only network call here, and it's one fetch per press of
// "Search"/"Use my location" in the companion app — stubbed wholesale so the
// suite never reaches the real service (which asks for a descriptive
// User-Agent and rate-limits anything that looks automated).

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const nominatim = (payload) => ({ ok: true, json: async () => payload });

describe('searchPlaces', () => {
  it('maps Nominatim rows to the label/lat/lon shape the picker wants', async () => {
    fetchMock.mockResolvedValue(
      nominatim([
        { display_name: 'Springfield, Illinois, United States', lat: '39.7817', lon: '-89.6501' },
        { display_name: 'Springfield, Massachusetts, United States', lat: '42.1015', lon: '-72.5898' },
      ])
    );

    const results = await searchPlaces('Springfield');
    expect(results).toEqual([
      { label: 'Springfield, Illinois, United States', lat: 39.7817, lon: -89.6501 },
      { label: 'Springfield, Massachusetts, United States', lat: 42.1015, lon: -72.5898 },
    ]);
  });

  it('asks for five results, encodes the query, and sends the project User-Agent', async () => {
    fetchMock.mockResolvedValue(nominatim([]));
    await searchPlaces('St. Louis, MO');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://nominatim.openstreetmap.org/search?format=json&limit=5&q=St.%20Louis%2C%20MO'
    );
    expect(init.headers['User-Agent']).toMatch(/^WallCalToDo \(/);
  });

  it('rejects when Nominatim answers with an error status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    await expect(searchPlaces('Paris')).rejects.toThrow('Geocoding lookup failed (429)');
  });
});

describe('reverseGeocode', () => {
  it('returns the display name for a coordinate', async () => {
    fetchMock.mockResolvedValue(
      nominatim({ display_name: 'Austin, Travis County, Texas, United States' })
    );
    expect(await reverseGeocode(30.2672, -97.7431)).toBe(
      'Austin, Travis County, Texas, United States'
    );
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=30.2672&lon=-97.7431'
    );
  });

  it('returns null when Nominatim has nothing for the position', async () => {
    fetchMock.mockResolvedValue(nominatim({}));
    expect(await reverseGeocode(0, 0)).toBeNull();
  });
});

describe('reverseGeocodeDetail', () => {
  it('picks the town name out of whichever address key Nominatim used', async () => {
    fetchMock.mockResolvedValue(
      nominatim({
        display_name: 'Souderton, Montgomery County, Pennsylvania, United States',
        address: { town: 'Souderton', county: 'Montgomery County', state: 'Pennsylvania' },
      })
    );

    expect(await reverseGeocodeDetail(40.31, -75.32)).toEqual({
      city: 'Souderton',
      county: 'Montgomery County',
      state: 'Pennsylvania',
      label: 'Souderton, Montgomery County, Pennsylvania, United States',
    });
    // jsonv2 is what carries the address object the discovery path reads.
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=40.31&lon=-75.32'
    );
  });

  it('falls through to `city` when there is no town, and nulls what it lacks', async () => {
    fetchMock.mockResolvedValue(nominatim({ address: { city: 'Austin', county: 'Travis County' } }));

    expect(await reverseGeocodeDetail(30.2672, -97.7431)).toEqual({
      city: 'Austin',
      county: 'Travis County',
      state: null,
      label: null,
    });
  });

  it('returns all nulls when Nominatim has nothing for the position', async () => {
    fetchMock.mockResolvedValue(nominatim({}));
    expect(await reverseGeocodeDetail(0, 0)).toEqual({
      city: null,
      county: null,
      state: null,
      label: null,
    });
  });
});
