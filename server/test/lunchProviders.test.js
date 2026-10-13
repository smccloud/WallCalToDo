import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataPath } from './setup.js';
import { writeJson } from '../src/store/fileStore.js';
import * as mealviewer from '../src/services/lunch/mealviewer.js';
import * as healthepro from '../src/services/lunch/healthepro.js';
import * as schoolcafe from '../src/services/lunch/schoolcafe.js';
import { isLunchConfigured, pollLunch, validateLunchSettings } from '../src/services/lunchService.js';

// Every provider's API is stubbed at the fetch level. What's under test is how
// each one folds its own response shape into the wall's menus, and that the
// dispatch layer routes by the saved provider.

const MV_SCHOOL = 'EisenhowerElementaryMN';
const HP_DISTRICT = '1265';
const HP_SITE = '12589';
const HP_MENU = '125549';
const SC_DISTRICT = '1';
const SC_SCHOOL = 'c4e37fa7-2a43-4cb1-8c3e-19a1d194d73c';
const SC_LINE = 'AHS Pizza (Line 1)';

const fetchMock = vi.fn();

function json(body) {
  return { ok: true, status: 200, json: async () => body };
}

const nm = (url) => url.replace(/%20/g, ' ').replace(/%\(/g, '(').replace(/%\)/g, ')').replace(/%2C/g, ',');

// One mock that answers whichever provider's URLs a test drives -- each test
// only exercises one provider, so unreachable branches are harmless.
function respond() {
  fetchMock.mockImplementation(async (url) => {
    const u = nm(url);
    if (u.includes('/physicalLocation/district/')) {
      return json({ data: [{ name: 'Eisenhower Elementary', physicalLocationLookup: MV_SCHOOL }] });
    }
    if (u.includes('/physicalLocation/search/')) {
      return json({
        data: [
          { name: 'Eisenhower Elementary', physicalLocationLookup: MV_SCHOOL, city: 'Hopkins', state: 'Minnesota' },
          { name: 'Hopkins Elementary', physicalLocationLookup: 'HopkinsElementary', city: 'Hopkinton', state: 'Massachusetts' },
        ],
      });
    }
    if (u.includes('/school/')) {
      return json({
        menuSchedules: [
          {
            menuBlocks: [
              {
                blockName: 'Lunch',
                scheduledDate: '2026-10-05T00:00:00',
                cafeteriaLineList: {
                  data: [
                    {
                      name: 'Line 1',
                      foodItemList: {
                        data: [
                          { item_Type: 'ENTREES', item_Name: 'Cheese Pizza' },
                          { item_Type: 'VEGETABLES', item_Name: 'Baby Carrots' },
                          { item_Type: 'MISCELLANEOUS', item_Name: 'NO SCHOOL TODAY' },
                        ],
                      },
                    },
                  ],
                },
              },
              {
                blockName: 'Breakfast',
                scheduledDate: '2026-10-05T00:00:00',
                cafeteriaLineList: {
                  data: [{ foodItemList: { data: [{ item_Type: 'BREAKFAST', item_Name: 'Cereal' }] } }],
                },
              },
            ],
          },
        ],
      });
    }
    if (u.includes('menus.healthepro.com/api/organizations') && u.endsWith('/sites/list')) {
      return json({ data: [{ id: Number(HP_SITE), name: 'Chambers Primary' }] });
    }
    if (u.endsWith(`/sites/${HP_SITE}/menus`)) {
      return json({ data: [{ id: Number(HP_MENU), meal_type_id: 2, published_months: ['2026-10-01'] }] });
    }
    if (u.includes('/date_overwrites')) {
      return json({
        data: [
          {
            day: '2026-10-05',
            setting: JSON.stringify({
              current_display: [
                { type: 'category', name: 'Entree' },
                { type: 'recipe', name: 'Popcorn Chicken' },
              ],
            }),
          },
        ],
      });
    }
    if (u.endsWith('/api/organizations')) {
      return json({
        data: [
          {
            id: 1,
            name: 'Alabama',
            organizations: [{ id: 2492, name: 'Hale County Board of Education', state: 'Alabama' }],
          },
        ],
      });
    }
    if (u.includes('GetSchoolsList')) {
      return json([{ SchoolId: SC_SCHOOL, SchoolName: 'Angleton High School' }]);
    }
    if (u.includes('GetDistinctLines')) {
      return json([{ Name: SC_LINE }, { Name: 'SACK Lunch' }]);
    }
    if (u.includes('CalendarView/GetMonthlyMenuitems')) {
      if (u.includes('MealType=Breakfast')) return json([]);
      return json([
        {
          Servingdate: '2026-10-05',
          Category: [
            { DisplayOrder: 2, Name: 'MILK', Items: [{ Desc: 'Chocolate Milk' }] },
            { DisplayOrder: 1, Name: 'ENTREES', Items: [{ Desc: 'Thin Crust Cheese Pizza' }] },
          ],
        },
      ]);
    }
    if (u.includes('nominatim')) {
      // Two discovery tests need two different places; key off the lat.
      if (u.includes('lat=32.7')) {
        return json({
          display_name: 'Hale County, Alabama',
          address: { city: 'Hale', state: 'Alabama', county: 'Perry County' },
        });
      }
      return json({
        display_name: 'Hopkins, Minnesota',
        address: { city: 'Hopkins', state: 'Minnesota', county: 'Hennepin County' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fs.rmSync(dataPath('lunch.json'), { force: true });
  respond();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MealViewer', () => {
  it('lists a district’s schools', async () => {
    const schools = await mealviewer.fetchSchools({ schoolLunchDistrict: 'HopkinsISD270' });
    expect(schools).toEqual([{ id: MV_SCHOOL, name: 'Eisenhower Elementary' }]);
  });

  it('folds blocks into per-type sections and drops the no-school placeholder', async () => {
    const meals = await mealviewer.fetchMeals({ schoolLunchSchool: MV_SCHOOL }, new Date('2026-10-08T10:00:00'));
    expect(meals.lunch['2026-10-05']).toEqual([
      { title: 'ENTREES', items: ['Cheese Pizza'] },
      { title: 'VEGETABLES', items: ['Baby Carrots'] },
    ]);
    expect(meals.breakfast['2026-10-05']).toEqual([{ title: 'BREAKFAST', items: ['Cereal'] }]);
  });

  it('discovers schools in the matching state only', async () => {
    const result = await mealviewer.discover({}, { lat: 44.9, lon: -93.4 });
    expect(result.place).toBe('Hopkins');
    expect(result.groups).toEqual([
      { id: `school:${MV_SCHOOL}`, label: 'Eisenhower Elementary', schoolCount: 1 },
    ]);
  });

  it('validates the school id shape but allows an unconfigured null', () => {
    expect(mealviewer.validate({})).toBeNull();
    expect(mealviewer.validate({ schoolLunchSchool: MV_SCHOOL })).toBeNull();
    expect(mealviewer.validate({ schoolLunchSchool: 'has space' })).toBe('Invalid schoolLunchSchool');
  });
});

describe('Health-e Pro', () => {
  it('lists a district’s sites', async () => {
    const schools = await healthepro.fetchSchools({ schoolLunchDistrict: HP_DISTRICT });
    expect(schools).toEqual([{ id: HP_SITE, name: 'Chambers Primary' }]);
  });

  it('parses a month’s date_overwrites into sections', async () => {
    const meals = await healthepro.fetchMeals(
      { schoolLunchDistrict: HP_DISTRICT, schoolLunchSchool: HP_SITE },
      new Date('2026-10-08T10:00:00')
    );
    expect(meals.lunch['2026-10-05']).toEqual([{ title: 'Entree', items: ['Popcorn Chicken'] }]);
    expect(meals.breakfast).toBeNull();
  });

  it('discovers districts in the matching state, ranked by name', async () => {
    const result = await healthepro.discover({}, { lat: 32.7, lon: -87.6 });
    expect(result.groups).toEqual([{ id: '2492', label: 'Hale County Board of Education' }]);
  });

  it('requires numeric ids but tolerates absence', () => {
    expect(healthepro.validate({})).toBeNull();
    expect(healthepro.validate({ schoolLunchDistrict: 'abc' })).toBe('Invalid schoolLunchDistrict');
  });
});

describe('SchoolCafe', () => {
  it('lists schools, then their serving lines', async () => {
    const schools = await schoolcafe.fetchSchools({ schoolLunchDistrict: SC_DISTRICT });
    expect(schools).toEqual([{ id: SC_SCHOOL, name: 'Angleton High School' }]);
    const lines = await schoolcafe.fetchLines({ schoolLunchSchool: SC_SCHOOL });
    expect(lines).toEqual([
      { id: SC_LINE, name: SC_LINE },
      { id: 'SACK Lunch', name: 'SACK Lunch' },
    ]);
  });

  it('orders categories by DisplayOrder and reads both meals', async () => {
    const meals = await schoolcafe.fetchMeals(
      { schoolLunchSchool: SC_SCHOOL, schoolLunchServingLine: SC_LINE },
      new Date('2026-10-08T10:00:00')
    );
    expect(meals.lunch['2026-10-05']).toEqual([
      { title: 'ENTREES', items: ['Thin Crust Cheese Pizza'] },
      { title: 'MILK', items: ['Chocolate Milk'] },
    ]);
    expect(meals.breakfast).toBeNull();
  });

  it('needs a serving line to count as configured', () => {
    const base = { schoolLunchDistrict: SC_DISTRICT, schoolLunchSchool: SC_SCHOOL };
    expect(schoolcafe.validate(base)).toBeNull();
    expect(schoolcafe.validate({ ...base, schoolLunchServingLine: '' })).toBe('Invalid schoolLunchServingLine');
    expect(schoolcafe.configured(base)).toBe(false);
    expect(schoolcafe.configured({ ...base, schoolLunchServingLine: SC_LINE })).toBe(true);
  });

  it('has no location discovery', async () => {
    expect(await schoolcafe.discover({}, { lat: 1, lon: 2 })).toEqual({ place: null, groups: [] });
  });
});

describe('provider dispatch', () => {
  it('routes validation and configuration to the saved provider', () => {
    expect(validateLunchSettings({ schoolLunchProvider: 'schoolcafe', schoolLunchDistrict: 'x' })).toBe(
      'Invalid schoolLunchDistrict'
    );
    expect(validateLunchSettings({ schoolLunchProvider: 'nutrislice', schoolLunchDistrict: 'dallas' })).toBeNull();
    expect(
      isLunchConfigured({ schoolLunchProvider: 'mealviewer', schoolLunchSchool: MV_SCHOOL })
    ).toBe(true);
    expect(isLunchConfigured({ schoolLunchProvider: 'mealviewer', schoolLunchSchool: null })).toBe(false);
  });

  it('caches menus under the provider that produced them', async () => {
    writeJson('settings.json', {
      schoolLunchEnabled: true,
      schoolLunchProvider: 'mealviewer',
      schoolLunchSchool: MV_SCHOOL,
      schoolLunchSchoolName: 'Eisenhower Elementary',
    });
    const lunch = await pollLunch();
    expect(lunch.provider).toBe('mealviewer');
    expect(lunch.school).toBe(MV_SCHOOL);
    expect(lunch.meals.lunch['2026-10-05']).toEqual([
      { title: 'ENTREES', items: ['Cheese Pizza'] },
      { title: 'VEGETABLES', items: ['Baby Carrots'] },
    ]);
  });
});
