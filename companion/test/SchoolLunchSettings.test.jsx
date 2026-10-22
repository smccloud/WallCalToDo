import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SchoolLunchSettings from '../src/components/SchoolLunchSettings.jsx';

const api = vi.hoisted(() => vi.fn());
vi.mock('../src/api.js', () => ({ api }));

const SC_SCHOOL = 'c4e37fa7-2a43-4cb1-8c3e-19a1d194d73c';
const SC_LINE = 'AHS Pizza (Line 1)';

const PROVIDERS = [
  { id: 'nutrislice', label: 'Nutrislice' },
  { id: 'mealviewer', label: 'MealViewer' },
  { id: 'healthepro', label: 'Health-e Pro' },
  { id: 'schoolcafe', label: 'SchoolCafe' },
];

// Answers by path so the provider-list fetch the component makes on mount never
// eats a test's one-shot stub. A test supplies only the route(s) it cares about;
// an Error value makes that route reject.
function mockRoutes(routes = {}) {
  api.mockImplementation(async (path) => {
    const match = Object.keys(routes).find((route) => String(path).startsWith(route));
    if (match !== undefined) {
      const value = routes[match];
      if (value instanceof Error) throw value;
      return value;
    }
    if (String(path).startsWith('/lunch/providers')) return { providers: PROVIDERS };
    // The preview under the scroll-speed slider asks for the cached menu.
    // Nothing cached is the normal case for a test that isn't about the
    // preview itself.
    if (String(path).startsWith('/lunch')) return null;
    throw new Error(`unexpected api ${path}`);
  });
}

beforeEach(() => {
  api.mockReset();
  mockRoutes();
});

function renderSettings(settings, overrides = {}) {
  const handlers = {
    onSetSchoolLunchEnabled: vi.fn(),
    onSetSchoolLunch: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <SchoolLunchSettings settings={settings} settingsLoading={false} {...handlers} />
  );
  return { ...handlers, ...utils };
}

const switchFor = () =>
  [...document.querySelectorAll('.setting-toggle')]
    .find((row) => row.querySelector('.setting-toggle__label').textContent === 'Show the school lunch view')
    .querySelector('input[type="checkbox"]');

const timeInputs = (container) => [...container.querySelectorAll('input[type="time"]')];
const schoolButtons = (container) => [...container.querySelectorAll('.location-settings__results button')];

const ON = {
  schoolLunchEnabled: true,
  schoolLunchProvider: 'nutrislice',
  schoolLunchDistrict: 'dallas',
  schoolLunchSchool: 'lincoln',
  schoolLunchSchoolName: 'Lincoln Elementary',
};

describe('SchoolLunchSettings', () => {
  describe('the on/off switch', () => {
    it('shows only itself while the view is off', () => {
      renderSettings({ schoolLunchEnabled: false });

      expect(switchFor().checked).toBe(false);
      // Everything below configures a view that never comes up.
      expect(document.querySelectorAll('input[type="time"]')).toHaveLength(0);
      expect(document.querySelector('.location-settings__search')).toBeNull();
    });

    it('turns the view on and off on its own', () => {
      const handlers = renderSettings({ schoolLunchEnabled: true });

      fireEvent.click(switchFor());
      expect(handlers.onSetSchoolLunchEnabled).toHaveBeenCalledWith(false);
    });

    it('locks the switch while a save is in flight', () => {
      render(
        <SchoolLunchSettings settings={null} settingsLoading={true} onSetSchoolLunchEnabled={vi.fn()} onSetSchoolLunch={vi.fn()} />
      );
      expect(switchFor().disabled).toBe(true);
    });
  });

  describe('the provider picker', () => {
    it('offers every provider and defaults to the saved one', () => {
      const { getByRole } = renderSettings(ON);
      const select = getByRole('combobox', { name: 'Menu provider' });

      expect(select.value).toBe('nutrislice');
      expect([...select.options].map((option) => option.value)).toEqual([
        'nutrislice',
        'mealviewer',
        'healthepro',
        'schoolcafe',
      ]);
    });

    it('clears the provider-specific ids when the provider changes', () => {
      const handlers = renderSettings(ON);

      fireEvent.change(handlers.getByRole('combobox', { name: 'Menu provider' }), {
        target: { value: 'mealviewer' },
      });
      expect(handlers.onSetSchoolLunch).toHaveBeenCalledWith({
        schoolLunchProvider: 'mealviewer',
        schoolLunchDistrict: null,
        schoolLunchSchool: null,
        schoolLunchSchoolName: null,
        schoolLunchServingLine: null,
      });
    });

    it('relabels the district field for the chosen provider', () => {
      const mealviewer = renderSettings({ ...ON, schoolLunchProvider: 'mealviewer' });
      expect(mealviewer.getByPlaceholderText('District id')).toBeDefined();

      const schoolcafe = renderSettings({ ...ON, schoolLunchProvider: 'schoolcafe' });
      expect(schoolcafe.getByPlaceholderText('District id (number)')).toBeDefined();
    });
  });

  describe('finding a school', () => {
    it('does not offer a search until a district has been typed', () => {
      const { getByPlaceholderText, getByRole } = renderSettings({ schoolLunchEnabled: true, schoolLunchProvider: 'nutrislice' });

      expect(getByRole('button', { name: 'Find schools' }).disabled).toBe(true);
      fireEvent.change(getByPlaceholderText('District slug'), { target: { value: 'dallas' } });
      expect(getByRole('button', { name: 'Find schools' }).disabled).toBe(false);
    });

    it('looks the district up and saves the school that was picked', async () => {
      mockRoutes({
        '/lunch/schools': {
          schools: [
            { id: 'lincoln', name: 'Lincoln Elementary' },
            { id: 'roosevelt', name: 'Roosevelt High' },
          ],
        },
      });
      const handlers = renderSettings({ schoolLunchEnabled: true, schoolLunchProvider: 'nutrislice' });
      const { getByPlaceholderText, getByRole, container } = handlers;

      fireEvent.change(getByPlaceholderText('District slug'), { target: { value: 'Dallas' } });
      fireEvent.click(getByRole('button', { name: 'Find schools' }));

      // Normalized to lowercase before it goes out, since a Nutrislice slug is a hostname part.
      expect(api).toHaveBeenCalledWith('/lunch/schools?provider=nutrislice&district=dallas');
      await waitFor(() => expect(schoolButtons(container)).toHaveLength(2));
      expect(schoolButtons(container).map((button) => button.textContent)).toEqual([
        'Lincoln Elementary',
        'Roosevelt High',
      ]);

      fireEvent.click(schoolButtons(container)[1]);
      expect(handlers.onSetSchoolLunch).toHaveBeenCalledWith({
        schoolLunchDistrict: 'dallas',
        schoolLunchSchool: 'roosevelt',
        schoolLunchSchoolName: 'Roosevelt High',
      });
    });

    it('keeps a case-sensitive provider id as typed', async () => {
      mockRoutes({ '/lunch/schools': { schools: [] } });
      const { getByPlaceholderText, getByRole } = renderSettings({
        schoolLunchEnabled: true,
        schoolLunchProvider: 'mealviewer',
      });

      fireEvent.change(getByPlaceholderText('District id'), { target: { value: 'HopkinsISD270' } });
      fireEvent.click(getByRole('button', { name: 'Find schools' }));

      await waitFor(() => expect(api).toHaveBeenCalledWith('/lunch/schools?provider=mealviewer&district=HopkinsISD270'));
    });

    it('says so when the district matched nothing', async () => {
      mockRoutes({ '/lunch/schools': { schools: [] } });
      const { getByPlaceholderText, getByRole, findByText } = renderSettings({
        schoolLunchEnabled: true,
        schoolLunchProvider: 'nutrislice',
      });

      fireEvent.change(getByPlaceholderText('District slug'), { target: { value: 'nowhere' } });
      fireEvent.click(getByRole('button', { name: 'Find schools' }));

      expect(await findByText('No schools found for that district.')).toBeDefined();
    });

    it('surfaces a lookup failure under the search box', async () => {
      mockRoutes({ '/lunch/schools': new Error('Request failed (502)') });
      const { getByPlaceholderText, getByRole, findByText } = renderSettings({
        schoolLunchEnabled: true,
        schoolLunchProvider: 'nutrislice',
      });

      fireEvent.change(getByPlaceholderText('District slug'), { target: { value: 'dallas' } });
      fireEvent.click(getByRole('button', { name: 'Find schools' }));

      expect(await findByText('Request failed (502)')).toBeDefined();
    });

    it('shows the school already saved and warns when none is set', () => {
      renderSettings(ON);
      expect(document.body.textContent).toContain('Lincoln Elementary');

      renderSettings({ schoolLunchEnabled: true, schoolLunchProvider: 'nutrislice' });
      expect(document.body.textContent).toContain('Pick a school above');
    });
  });

  describe('SchoolCafe serving lines', () => {
    const SC = {
      schoolLunchEnabled: true,
      schoolLunchProvider: 'schoolcafe',
      schoolLunchDistrict: null,
      schoolLunchSchool: null,
    };

    it('has no location discovery', () => {
      const { queryByRole } = renderSettings({
        ...SC,
        location: { lat: 40.31, lon: -75.32, label: 'Souderton, PA' },
      });
      expect(queryByRole('button', { name: 'Find my district' })).toBeNull();
    });

    it('loads and saves a serving line after the school is picked', async () => {
      mockRoutes({
        '/lunch/schools': { schools: [{ id: SC_SCHOOL, name: 'Angleton High School' }] },
        '/lunch/lines': { lines: [{ id: SC_LINE, name: SC_LINE }] },
      });
      const handlers = renderSettings(SC);
      const { getByPlaceholderText, getByRole, container, findByRole } = handlers;

      fireEvent.change(getByPlaceholderText('District id (number)'), { target: { value: '1' } });
      fireEvent.click(getByRole('button', { name: 'Find schools' }));
      await waitFor(() => expect(schoolButtons(container)).toHaveLength(1));

      fireEvent.click(schoolButtons(container)[0]);
      expect(handlers.onSetSchoolLunch).toHaveBeenCalledWith({
        schoolLunchDistrict: '1',
        schoolLunchSchool: SC_SCHOOL,
        schoolLunchSchoolName: 'Angleton High School',
      });

      await waitFor(() =>
        expect(api).toHaveBeenCalledWith(
          `/lunch/lines?provider=schoolcafe&school=${SC_SCHOOL}&district=1`
        )
      );
      const lineButton = await findByRole('button', { name: SC_LINE });
      fireEvent.click(lineButton);
      expect(handlers.onSetSchoolLunch).toHaveBeenCalledWith({ schoolLunchServingLine: SC_LINE });
    });
  });

  describe('finding a district from the location', () => {
    const LOCATED = { ...ON, location: { lat: 40.31, lon: -75.32, label: 'Souderton, PA' } };

    it('offers discovery only once a location is saved', () => {
      const without = renderSettings({ schoolLunchEnabled: true, schoolLunchProvider: 'nutrislice' });
      expect(without.queryByRole('button', { name: 'Find my district' })).toBeNull();
      expect(document.body.textContent).toContain('Set a location above');

      const withLocation = renderSettings(LOCATED);
      expect(withLocation.getByRole('button', { name: 'Find my district' })).toBeDefined();
      expect(withLocation.getByText('near Souderton, PA')).toBeDefined();
    });

    it('finds districts, then loads the chosen district’s schools', async () => {
      mockRoutes({
        '/lunch/discover': {
          place: 'Souderton',
          groups: [{ id: 'soudertonsd', label: 'soudertonsd', schoolCount: 3 }],
        },
        '/lunch/schools': { schools: [{ id: 'safford-hills', name: 'Safford Hills Elementary' }] },
      });
      const { getByRole, findByRole, container } = renderSettings(LOCATED);

      fireEvent.click(getByRole('button', { name: 'Find my district' }));
      expect(api).toHaveBeenCalledWith('/lunch/discover?provider=nutrislice&lat=40.31&lon=-75.32');

      const districtButton = await findByRole('button', { name: /soudertonsd/ });
      expect(districtButton.textContent).toContain('3 schools');

      fireEvent.click(districtButton);
      await waitFor(() =>
        expect(api).toHaveBeenCalledWith('/lunch/schools?provider=nutrislice&district=soudertonsd')
      );
      await waitFor(() => expect(schoolButtons(container)).toHaveLength(1));
      expect(schoolButtons(container)[0].textContent).toBe('Safford Hills Elementary');
    });

    it('says so when the location resolves but no district does', async () => {
      mockRoutes({ '/lunch/discover': { place: 'Souderton', groups: [] } });
      const { getByRole, findByText } = renderSettings(LOCATED);

      fireEvent.click(getByRole('button', { name: 'Find my district' }));
      expect(
        await findByText('No Nutrislice district found near Souderton. Try entering it by hand.')
      ).toBeDefined();
    });

    it('surfaces a discovery failure under the controls', async () => {
      mockRoutes({ '/lunch/discover': new Error('Request failed (502)') });
      const { getByRole, findByText } = renderSettings(LOCATED);

      fireEvent.click(getByRole('button', { name: 'Find my district' }));
      expect(await findByText('Request failed (502)')).toBeDefined();
    });
  });

  describe('the times', () => {
    it('shows the saved window and sends changes through as HH:MM', () => {
      const handlers = renderSettings({
        ...ON,
        schoolLunchStartTime: '07:30',
        schoolLunchEndTime: '13:00',
      });
      const [start, end] = timeInputs(handlers.container);

      expect([start.value, end.value]).toEqual(['07:30', '13:00']);

      fireEvent.change(start, { target: { value: '08:00' } });
      expect(handlers.onSetSchoolLunch).toHaveBeenCalledWith({ schoolLunchStartTime: '08:00' });
    });

    it('clears a bound to null rather than storing an empty string', () => {
      const handlers = renderSettings({ ...ON, schoolLunchStartTime: '07:30' });
      const [start] = timeInputs(handlers.container);

      fireEvent.change(start, { target: { value: '' } });
      expect(handlers.onSetSchoolLunch).toHaveBeenCalledWith({ schoolLunchStartTime: null });
    });
  });

  describe('alternating breakfast and lunch', () => {
    const selectFor = (getByRole) =>
      getByRole('combobox', { name: 'How often to alternate between breakfast and lunch' });

    it('defaults to off and sends a number when changed', () => {
      const handlers = renderSettings(ON);
      const select = selectFor(handlers.getByRole);

      expect(select.value).toBe('0');
      fireEvent.change(select, { target: { value: '30' } });
      expect(handlers.onSetSchoolLunch).toHaveBeenCalledWith({ schoolLunchAlternateSeconds: 30 });
    });

    it('shows the saved interval', () => {
      const { getByRole } = renderSettings({ ...ON, schoolLunchAlternateSeconds: 120 });
      expect(selectFor(getByRole).value).toBe('120');
    });
  });

  describe('the scroll speed', () => {
    // The slider saves once it settles rather than on every step of a drag,
    // so the clock is under the test's control here.
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const sliderFor = (container) => container.querySelector('input[type="range"]');

    it('shows the saved speed', () => {
      const { container } = renderSettings({ ...ON, schoolLunchScrollSpeed: 24 });
      expect(sliderFor(container).value).toBe('24');
    });

    it('falls back to the speed the wall has always used', () => {
      const { container } = renderSettings(ON);
      expect(sliderFor(container).value).toBe('16');
    });

    it('moves at once and saves once the slider settles', () => {
      const handlers = renderSettings({ ...ON, schoolLunchScrollSpeed: 16 });

      fireEvent.change(sliderFor(handlers.container), { target: { value: '40' } });
      // The slider moves at once...
      expect(sliderFor(handlers.container).value).toBe('40');
      expect(handlers.onSetSchoolLunch).not.toHaveBeenCalled();

      // ...and the new speed is saved once it settles.
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(handlers.onSetSchoolLunch).toHaveBeenCalledWith({ schoolLunchScrollSpeed: 40 });
    });

    it('does not save a speed that is already saved', () => {
      const handlers = renderSettings({ ...ON, schoolLunchScrollSpeed: 16 });

      fireEvent.change(sliderFor(handlers.container), { target: { value: '16' } });
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(handlers.onSetSchoolLunch).not.toHaveBeenCalled();
    });

    it('can stop the menu drifting altogether', () => {
      const handlers = renderSettings({ ...ON, schoolLunchScrollSpeed: 16 });

      fireEvent.change(sliderFor(handlers.container), { target: { value: '0' } });
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(handlers.onSetSchoolLunch).toHaveBeenCalledWith({ schoolLunchScrollSpeed: 0 });
    });
  });
});
