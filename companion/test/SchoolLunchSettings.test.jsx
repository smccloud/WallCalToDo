import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SchoolLunchSettings from '../src/components/SchoolLunchSettings.jsx';

const api = vi.hoisted(() => vi.fn());
vi.mock('../src/api.js', () => ({ api }));

beforeEach(() => {
  api.mockReset();
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

const ON = {
  schoolLunchEnabled: true,
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

  describe('finding a school', () => {
    it('does not offer a search until a district has been typed', () => {
      const { getByPlaceholderText, getByRole } = renderSettings({ schoolLunchEnabled: true });

      expect(getByRole('button', { name: 'Find schools' }).disabled).toBe(true);
      fireEvent.change(getByPlaceholderText('District slug'), { target: { value: 'dallas' } });
      expect(getByRole('button', { name: 'Find schools' }).disabled).toBe(false);
    });

    it('looks the district up and saves the school that was picked', async () => {
      api.mockResolvedValue({
        schools: [
          { name: 'Lincoln Elementary', slug: 'lincoln', menuTypes: ['lunch'] },
          { name: 'Roosevelt High', slug: 'roosevelt', menuTypes: ['breakfast', 'lunch'] },
        ],
      });
      const handlers = renderSettings({ schoolLunchEnabled: true });
      const { getByPlaceholderText, getByRole, container } = handlers;

      fireEvent.change(getByPlaceholderText('District slug'), { target: { value: 'Dallas' } });
      fireEvent.click(getByRole('button', { name: 'Find schools' }));

      // Normalized to lowercase before it goes out, since the slug is a hostname part.
      expect(api).toHaveBeenCalledWith('/lunch/schools?district=dallas');
      await waitFor(() => expect(container.querySelectorAll('.location-settings__results button')).toHaveLength(2));

      const results = [...container.querySelectorAll('.location-settings__results button')];
      expect(results.map((button) => button.textContent)).toEqual(['Lincoln Elementary', 'Roosevelt High']);

      fireEvent.click(results[1]);
      expect(handlers.onSetSchoolLunch).toHaveBeenCalledWith({
        schoolLunchDistrict: 'dallas',
        schoolLunchSchool: 'roosevelt',
        schoolLunchSchoolName: 'Roosevelt High',
      });
    });

    it('says so when the district matched nothing', async () => {
      api.mockResolvedValue({ schools: [] });
      const { getByPlaceholderText, getByRole, findByText } = renderSettings({ schoolLunchEnabled: true });

      fireEvent.change(getByPlaceholderText('District slug'), { target: { value: 'nowhere' } });
      fireEvent.click(getByRole('button', { name: 'Find schools' }));

      expect(await findByText('No schools found for that district.')).toBeDefined();
    });

    it('surfaces a lookup failure under the search box', async () => {
      api.mockRejectedValue(new Error('Request failed (502)'));
      const { getByPlaceholderText, getByRole, findByText } = renderSettings({ schoolLunchEnabled: true });

      fireEvent.change(getByPlaceholderText('District slug'), { target: { value: 'dallas' } });
      fireEvent.click(getByRole('button', { name: 'Find schools' }));

      expect(await findByText('Request failed (502)')).toBeDefined();
    });

    it('shows the school already saved and warns when none is set', () => {
      renderSettings(ON);
      expect(document.body.textContent).toContain('Lincoln Elementary');

      renderSettings({ schoolLunchEnabled: true });
      expect(document.body.textContent).toContain('Pick a school above');
    });
  });

  describe('finding a district from the location', () => {
    const LOCATED = { ...ON, location: { lat: 40.31, lon: -75.32, label: 'Souderton, PA' } };

    it('offers discovery only once a location is saved', () => {
      const without = renderSettings({ schoolLunchEnabled: true });
      expect(without.queryByRole('button', { name: 'Find my district' })).toBeNull();
      expect(document.body.textContent).toContain('Set a location above');

      const withLocation = renderSettings(LOCATED);
      expect(withLocation.getByRole('button', { name: 'Find my district' })).toBeDefined();
      expect(withLocation.getByText('near Souderton, PA')).toBeDefined();
    });

    it('finds districts, then loads the chosen district’s schools', async () => {
      api
        .mockResolvedValueOnce({ place: 'Souderton', districts: [{ slug: 'soudertonsd', schoolCount: 3 }] })
        .mockResolvedValueOnce({
          schools: [{ name: 'Safford Hills Elementary', slug: 'safford-hills', menuTypes: ['lunch'] }],
        });
      const { getByRole, findByRole, container } = renderSettings(LOCATED);

      fireEvent.click(getByRole('button', { name: 'Find my district' }));
      expect(api).toHaveBeenCalledWith('/lunch/discover?lat=40.31&lon=-75.32');

      const districtButton = await findByRole('button', { name: /soudertonsd/ });
      expect(districtButton.textContent).toContain('3 schools');

      fireEvent.click(districtButton);
      await waitFor(() => expect(api).toHaveBeenCalledWith('/lunch/schools?district=soudertonsd'));
      await waitFor(() =>
        expect(container.querySelectorAll('.location-settings__results button')).toHaveLength(1)
      );
      expect(container.querySelector('.location-settings__results button').textContent).toBe(
        'Safford Hills Elementary'
      );
    });

    it('says so when the location resolves but no district does', async () => {
      api.mockResolvedValueOnce({ place: 'Souderton', districts: [] });
      const { getByRole, findByText } = renderSettings(LOCATED);

      fireEvent.click(getByRole('button', { name: 'Find my district' }));
      expect(
        await findByText('No Nutrislice district found near Souderton. Try entering it by hand.')
      ).toBeDefined();
    });

    it('surfaces a discovery failure under the controls', async () => {
      api.mockRejectedValueOnce(new Error('Request failed (502)'));
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
        schoolLunchMealSwitchTime: '11:15',
      });
      const [start, end, mealSwitch] = timeInputs(handlers.container);

      expect([start.value, end.value, mealSwitch.value]).toEqual(['07:30', '13:00', '11:15']);

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
});
