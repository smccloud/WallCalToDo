import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataPath } from './setup.js';
import { writeJson } from '../src/store/fileStore.js';
import {
  candidateSlugs,
  discoverDistricts,
  fetchSchools,
  getCachedLunch,
  parseMenuItems,
  parseWeek,
  pollLunch,
} from '../src/services/lunchService.js';

// Nutrislice is stubbed at the fetch level: what this suite cares about is how
// the two responses are folded into the cached shape -- which meal types come
// back, how a flat menu_items stream becomes titled sections, and how a meal
// the district doesn't serve (a 404) reads differently from a real failure.

const SCHOOLS_URL = '.api.nutrislice.com/menu/api/schools';
const WEEKS_URL = '/menu/api/weeks/school/';

function schoolsBody() {
  return [
    { name: 'Lincoln Elementary', slug: 'lincoln', active_menu_types: [{ name: 'Lunch', slug: 'lunch' }] },
    {
      name: 'Roosevelt High',
      slug: 'roosevelt',
      active_menu_types: [
        { name: 'Breakfast', slug: 'breakfast' },
        { name: 'Lunch', slug: 'lunch' },
      ],
    },
    // No slug -- dropped rather than cached as an unpickable entry.
    { name: 'Broken Entry' },
  ];
}

function weekBody() {
  return {
    start_date: '2026-10-04',
    days: [
      {
        date: '2026-10-05',
        menu_items: [
          { text: 'Entrees', is_section_title: true },
          { food: { name: 'Cheese Pizza' } },
          { text: 'Veggie Burger' },
          { blank_line: true },
          { text: 'Sides', is_section_title: true },
          { food: { name: 'Green Beans' } },
          // A section title with nothing under it is dropped.
          { text: 'Milk', is_section_title: true },
          { text: 'Announcement line' }, // no food, falls back to text
        ],
      },
      // A day with no food at all isn't cached as an empty menu.
      { date: '2026-10-06', menu_items: [{ blank_line: true }] },
    ],
  };
}

const fetchMock = vi.fn();

function respond({ schools = schoolsBody(), week = weekBody() } = {}) {
  fetchMock.mockImplementation(async (url) => {
    if (url.includes(SCHOOLS_URL)) return { ok: true, status: 200, json: async () => schools };
    if (url.includes(WEEKS_URL)) return { ok: true, status: 200, json: async () => week };
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fs.rmSync(dataPath('lunch.json'), { force: true });
  writeJson('settings.json', { schoolLunchDistrict: 'dallas', schoolLunchSchool: 'lincoln' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchSchools', () => {
  it('returns each school with its display name, slug, and served meal types', async () => {
    respond();
    const schools = await fetchSchools('dallas');
    expect(schools).toEqual([
      { id: 'lincoln', name: 'Lincoln Elementary', menuTypes: ['lunch'] },
      { id: 'roosevelt', name: 'Roosevelt High', menuTypes: ['breakfast', 'lunch'] },
    ]);
  });

  it('refuses a district slug that isn’t safe to put in a hostname, without fetching', async () => {
    await expect(fetchSchools('evil.example.com')).rejects.toThrow('Invalid district');
    await expect(fetchSchools('../etc')).rejects.toThrow('Invalid district');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the district lookup fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchSchools('dallas')).rejects.toThrow('Nutrislice request failed (500)');
  });
});

describe('parseMenuItems', () => {
  it('folds the flat stream into titled sections with the food names in order', () => {
    expect(parseMenuItems(weekBody().days[0].menu_items)).toEqual([
      { title: 'Entrees', items: ['Cheese Pizza', 'Veggie Burger'] },
      { title: 'Sides', items: ['Green Beans'] },
      { title: 'Milk', items: ['Announcement line'] },
    ]);
  });

  it('drops blank spacer lines and empty sections', () => {
    expect(parseMenuItems([{ blank_line: true }, { text: 'Entrees', is_section_title: true }])).toEqual([]);
  });

  it('drops Nutrislice’s empty-day placeholder so the day reads as no menu', () => {
    expect(parseMenuItems([{ text: 'There is currently nothing on the menu today' }])).toEqual([]);
    expect(parseMenuItems([{ text: 'NO SCHOOL TODAY' }])).toEqual([]);
    // A placeholder alongside real food is dropped but the food survives.
    expect(
      parseMenuItems([{ text: 'There is currently nothing on the menu today' }, { food: { name: 'Pizza' } }])
    ).toEqual([{ title: null, items: ['Pizza'] }]);
  });
});

describe('parseWeek', () => {
  it('keys sections by day and leaves empty days out', () => {
    const days = parseWeek(weekBody());
    expect(Object.keys(days)).toEqual(['2026-10-05']);
    expect(days['2026-10-05'][0].items).toContain('Cheese Pizza');
  });

  it('leaves a placeholder-only day out so tomorrow wins the fallback', () => {
    const week = {
      days: [
        { date: '2026-10-10', menu_items: [{ text: 'There is currently nothing on the menu today' }] },
        { date: '2026-10-12', menu_items: [{ food: { name: 'Tacos' } }] },
      ],
    };
    expect(Object.keys(parseWeek(week))).toEqual(['2026-10-12']);
  });
});

describe('pollLunch', () => {
  it('fetches both meals for the saved school and caches them', async () => {
    respond();
    const lunch = await pollLunch();

    expect(lunch.district).toBe('dallas');
    expect(lunch.school).toBe('lincoln');
    expect(lunch.meals.lunch['2026-10-05'][0].items).toContain('Cheese Pizza');
    expect(lunch.meals.breakfast).not.toBeNull(); // both requests stubbed the same
    expect(getCachedLunch().school).toBe('lincoln');
  });

  it('treats a 404 for one meal as "not served" rather than a failure', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/menu-type/breakfast/')) return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => weekBody() };
    });

    const lunch = await pollLunch();
    expect(lunch.meals.breakfast).toBeNull();
    expect(lunch.meals.lunch['2026-10-05']).toBeTruthy();
  });

  it('returns null when no school is configured', async () => {
    writeJson('settings.json', {});
    expect(await pollLunch()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a real failure and leaves the last good cache untouched', async () => {
    respond();
    await pollLunch();

    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(pollLunch()).rejects.toThrow('Nutrislice request failed (503)');
    expect(getCachedLunch().meals.lunch['2026-10-05']).toBeTruthy();
  });
});

describe('candidateSlugs', () => {
  it('offers the place name with the common district suffixes', () => {
    expect(candidateSlugs({ city: 'Dallas' })).toEqual([
      'dallas',
      'dallas-sd',
      'dallassd',
      'dallas-schools',
      'dallasschools',
      'dallas-school-district',
      'dallas-isd',
      'dallasisd',
      'dallas-public-schools',
      'dallas-county-schools',
    ]);
  });

  it('normalizes a name into a hostname-safe slug', () => {
    expect(candidateSlugs({ city: 'Cañon City' })[0]).toBe('canon-city');
    expect(candidateSlugs({ city: 'St. Louis' })[0]).toBe('st-louis');
  });

  it('also tries a multi-word name run together, not just hyphenated', () => {
    const slugs = candidateSlugs({ city: 'Big Lake' });
    expect(slugs).toContain('big-lake');
    expect(slugs).toContain('biglake');
  });

  it('also tries the county, and dedupes when it matches the city', () => {
    expect(candidateSlugs({ city: 'Souderton', county: 'Montgomery County' })).toContain('montgomery-county');
    // One base, not two copies of every suffix.
    expect(candidateSlugs({ city: 'Fairfax', county: 'Fairfax' })).toEqual(candidateSlugs({ city: 'Fairfax' }));
  });

  it('returns nothing without a place to guess from', () => {
    expect(candidateSlugs({})).toEqual([]);
    expect(candidateSlugs()).toEqual([]);
  });
});

describe('discoverDistricts', () => {
  function respondDiscovery({ address = { town: 'Souderton', county: 'Montgomery County' }, resolves = [] } = {}) {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('nominatim')) return { ok: true, json: async () => ({ display_name: 'x', address }) };
      const match = url.match(/^https:\/\/([a-z0-9-]+)\.api\.nutrislice\.com\/menu\/api\/schools/);
      if (match && resolves.includes(match[1])) return { ok: true, status: 200, json: async () => schoolsBody() };
      return { ok: false, status: 404 };
    });
  }

  it('keeps only the guessed districts that actually resolve', async () => {
    respondDiscovery({ resolves: ['soudertonsd'] });
    const result = await discoverDistricts({ lat: 40.31, lon: -75.32 });

    expect(result.place).toBe('Souderton');
    expect(result.groups).toEqual([{ id: 'soudertonsd', label: 'soudertonsd', schoolCount: 2 }]);
  });

  it('returns an empty list, not an error, when nothing resolves', async () => {
    respondDiscovery();
    expect(await discoverDistricts({ lat: 40.31, lon: -75.32 })).toEqual({
      place: 'Souderton',
      groups: [],
    });
  });

  it('reports no place and probes nothing when the location has no town or county', async () => {
    respondDiscovery({ address: {} });
    const result = await discoverDistricts({ lat: 0, lon: 0 });

    expect(result).toEqual({ place: null, groups: [] });
    // The reverse lookup happened; no candidate was worth a second request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips a candidate whose request fails instead of failing the whole discovery', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('nominatim')) {
        return { ok: true, json: async () => ({ address: { city: 'Dallas' } }) };
      }
      if (url.includes('dallas-schools')) throw new Error('offline');
      if (url.includes('dallas-sd')) return { ok: true, status: 200, json: async () => schoolsBody() };
      return { ok: false, status: 404 };
    });

    const result = await discoverDistricts({ lat: 32.7, lon: -96.8 });
    expect(result.groups).toEqual([{ id: 'dallas-sd', label: 'dallas-sd', schoolCount: 2 }]);
  });
});
