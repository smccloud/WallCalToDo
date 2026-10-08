import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LocationSettings from '../src/components/LocationSettings.jsx';

const api = vi.hoisted(() => vi.fn());
vi.mock('../src/api.js', () => ({ api }));

beforeEach(() => {
  api.mockReset();
});

function renderLocation(settings, { onSaveLocation = vi.fn(), onError = vi.fn() } = {}) {
  const utils = render(
    <LocationSettings settings={settings} onSaveLocation={onSaveLocation} onError={onError} />
  );
  return { onSaveLocation, onError, ...utils };
}

describe('LocationSettings', () => {
  it('shows the label of the location already saved', () => {
    const { getByText } = renderLocation({ location: { label: 'Austin, TX', lat: 30.27, lon: -97.74 } });

    expect(getByText('Austin, TX')).toBeDefined();
  });

  it('falls back to the coordinates when there is no label for them', () => {
    const { getByText } = renderLocation({ location: { lat: 30.2672, lon: -97.7431 } });

    expect(getByText('30.27, -97.74')).toBeDefined();
  });

  it('does not offer a search until something has been typed', () => {
    const { getByRole, getByPlaceholderText } = renderLocation({});

    expect(getByRole('button', { name: 'Search' }).disabled).toBe(true);

    fireEvent.change(getByPlaceholderText('Search for a city'), { target: { value: 'Austin' } });
    expect(getByRole('button', { name: 'Search' }).disabled).toBe(false);
  });

  it('does not search on a blank query', () => {
    const { getByPlaceholderText, container } = renderLocation({});

    fireEvent.change(getByPlaceholderText('Search for a city'), { target: { value: '   ' } });
    fireEvent.submit(container.querySelector('form.location-settings__search'));

    expect(api).not.toHaveBeenCalled();
  });

  it('searches for what was typed and saves the place that was picked', async () => {
    api.mockResolvedValue({
      results: [
        { label: 'Austin, TX, USA', lat: 30.2672, lon: -97.7431 },
        { label: 'Austin, MN, USA', lat: 43.6666, lon: -92.9741 },
      ],
    });
    const { onSaveLocation, getByPlaceholderText, getByRole, container } = renderLocation({});

    fireEvent.change(getByPlaceholderText('Search for a city'), { target: { value: 'Austin' } });
    fireEvent.click(getByRole('button', { name: 'Search' }));

    expect(api).toHaveBeenCalledWith('/geocode?q=Austin');
    // Scoped to the results list -- by role there is always the Search button too.
    await waitFor(() =>
      expect(container.querySelectorAll('.location-settings__results button')).toHaveLength(2)
    );
    const results = [...container.querySelectorAll('.location-settings__results button')];
    expect(results.map((button) => button.textContent)).toEqual(['Austin, TX, USA', 'Austin, MN, USA']);

    fireEvent.click(results[1]);
    await waitFor(() => expect(onSaveLocation).toHaveBeenCalledWith(43.6666, -92.9741, 'Austin, MN, USA'));
  });

  it('says so when nothing matched, rather than showing an empty list', async () => {
    api.mockResolvedValue({ results: [] });
    const { getByPlaceholderText, getByRole, findByText } = renderLocation({});

    fireEvent.change(getByPlaceholderText('Search for a city'), { target: { value: 'Nowhere' } });
    fireEvent.click(getByRole('button', { name: 'Search' }));

    expect(await findByText('No matches — try a different search.')).toBeDefined();
  });

  it('surfaces the failure under the search box', async () => {
    api.mockRejectedValue(new Error('Request failed (502)'));
    const { getByPlaceholderText, getByRole, findByText } = renderLocation({});

    fireEvent.change(getByPlaceholderText('Search for a city'), { target: { value: 'Austin' } });
    fireEvent.click(getByRole('button', { name: 'Search' }));

    expect(await findByText('Request failed (502)')).toBeDefined();
  });
});
