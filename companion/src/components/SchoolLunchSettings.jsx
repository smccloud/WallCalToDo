import { useState } from 'react';
import { api } from '../api.js';

// <input type="time"> reads and writes exactly the 'HH:MM' strings the server
// stores (see the LUNCH_TIME_RE check in routes/settings.js), so a value passes
// through untouched. Only one normalization is needed: clearing the input
// yields '', which becomes null ("no bound") so the server stores a real
// absence rather than an invalid time.
function timeValue(value) {
  return value || '';
}

// Optional school lunch view: replaces the to-do list with the school's
// breakfast/lunch menus during a daily window (see frontend/src/App.jsx). The
// district slug is the subdomain of the district's Nutrislice site, which
// Nutrislice gives no way to look up directly, so this section offers two
// ways in: "Find my district", which reverse-geocodes the wall's saved
// location and probes the plausible slugs (see discoverDistricts on the
// server), and typing the part before ".nutrislice.com" by hand. Either way
// you then pick your school from the list.
export default function SchoolLunchSettings({
  settings,
  settingsLoading,
  onSetSchoolLunchEnabled,
  onSetSchoolLunch,
}) {
  const enabled = Boolean(settings?.schoolLunchEnabled);
  const location = settings?.location || null;
  const [district, setDistrict] = useState(settings?.schoolLunchDistrict || '');
  const [schools, setSchools] = useState(null);
  const [districts, setDistricts] = useState(null);
  const [searching, setSearching] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const setTime = (key, value) => onSetSchoolLunch({ [key]: value || null });

  // One lookup path for both entry points: the manual "Find schools" button
  // and picking a district from the discovery results both end up here, so
  // the school list and the error handling are defined once.
  async function findSchoolsFor(slug) {
    const normalized = slug.trim().toLowerCase();
    if (!normalized) return;
    setSearching(true);
    setSearchError(null);
    try {
      const { schools: results } = await api(`/lunch/schools?district=${encodeURIComponent(normalized)}`);
      setSchools(results);
      setDistrict(normalized);
      if (results.length === 0) setSearchError('No schools found for that district.');
    } catch (err) {
      // Surfaced inline next to the field, like the location search's errors --
      // a bad district slug is expected input, not a page-level failure.
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  }

  function findSchools(e) {
    e.preventDefault();
    findSchoolsFor(district);
  }

  // Hand the wall's saved location to the server, which reverse-geocodes it
  // and returns the districts it could verify. Doesn't set a district on its
  // own -- finding one is a suggestion, not a decision, so the user picks.
  async function discoverDistricts() {
    if (!location) return;
    setDiscovering(true);
    setSearchError(null);
    setDistricts(null);
    setSchools(null);
    try {
      const data = await api(
        `/lunch/discover?lat=${encodeURIComponent(location.lat)}&lon=${encodeURIComponent(location.lon)}`
      );
      const found = data.districts || [];
      setDistricts(found);
      if (found.length === 0) {
        setSearchError(
          data.place
            ? `No Nutrislice district found near ${data.place}. Try entering it by hand.`
            : 'Couldn’t work out where that location is. Try entering the district by hand.'
        );
      }
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setDiscovering(false);
    }
  }

  function chooseDistrict(slug) {
    setDistricts(null);
    findSchoolsFor(slug);
  }

  function chooseSchool(school) {
    setSchools(null);
    setSearchError(null);
    onSetSchoolLunch({
      schoolLunchDistrict: district.trim().toLowerCase(),
      schoolLunchSchool: school.slug,
      schoolLunchSchoolName: school.name,
    });
  }

  return (
    <div className="school-lunch-settings">
      <p className="settings-label section-label">School lunch</p>
      <p className="location-settings__hint">
        Optionally replaces the to-do list with your school's breakfast and lunch menus during a daily window.
        Menus come from Nutrislice.
      </p>

      <div className="setting-toggle setting-toggle--flush">
        <span className="setting-toggle__label">Show the school lunch view</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={enabled}
            disabled={settingsLoading}
            onChange={(e) => onSetSchoolLunchEnabled(e.target.checked)}
          />
          <span className="switch__track" />
        </label>
      </div>

      {enabled && (
        <>
          <p className="settings-label section-label">District and school</p>
          {location ? (
            <>
              <p className="location-settings__hint">
                Look your district up from the wall's saved location, or enter its Nutrislice address by
                hand — the part before ".nutrislice.com", e.g. "dallas" for dallas.nutrislice.com.
              </p>
              <button
                type="button"
                className="button button--ghost school-lunch-settings__discover"
                disabled={discovering || settingsLoading}
                onClick={discoverDistricts}
              >
                {discovering ? 'Searching…' : 'Find my district'}
              </button>
              <p className="location-settings__hint school-lunch-settings__near">
                near {location.label || 'your saved location'}
              </p>
            </>
          ) : (
            <p className="location-settings__hint">
              Enter your district's Nutrislice address — the part before ".nutrislice.com", e.g. "dallas" for
              dallas.nutrislice.com. Set a location above to have it found automatically instead.
            </p>
          )}

          {districts && districts.length > 0 && (
            <ul className="location-settings__results school-lunch-settings__districts">
              {districts.map((d) => (
                <li key={d.slug}>
                  <button
                    type="button"
                    className="location-settings__result"
                    disabled={settingsLoading || searching}
                    onClick={() => chooseDistrict(d.slug)}
                  >
                    {d.slug} ({d.schoolCount} {d.schoolCount === 1 ? 'school' : 'schools'})
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="location-settings__search" onSubmit={findSchools}>
            <input
              type="text"
              placeholder="District slug"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
            />
            <button type="submit" className="button button--ghost" disabled={searching || !district.trim()}>
              Find schools
            </button>
          </form>

          {searchError && <p className="location-settings__error">{searchError}</p>}

          {schools && schools.length > 0 && (
            <ul className="location-settings__results">
              {schools.map((school) => (
                <li key={school.slug}>
                  <button
                    type="button"
                    className="location-settings__result"
                    disabled={settingsLoading}
                    onClick={() => chooseSchool(school)}
                  >
                    {school.name}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {settings?.schoolLunchSchoolName && !schools && (
            <p className="location-settings__current">
              Currently set to{' '}
              <span className="location-settings__current-value">{settings.schoolLunchSchoolName}</span>
            </p>
          )}

          {!settings?.schoolLunchSchool && (
            <p className="settings-notice">Pick a school above — the lunch view has nothing to show without one.</p>
          )}

          <p className="settings-label section-label">Daily window</p>
          <p className="location-settings__hint">
            When the lunch view replaces the to-do list. Leave both blank to show it all day.
          </p>
          <div className="school-lunch-settings__times">
            <label className="school-lunch-settings__time">
              <span>Start</span>
              <input
                type="time"
                value={timeValue(settings?.schoolLunchStartTime)}
                disabled={settingsLoading}
                onChange={(e) => setTime('schoolLunchStartTime', e.target.value)}
              />
            </label>
            <label className="school-lunch-settings__time">
              <span>End</span>
              <input
                type="time"
                value={timeValue(settings?.schoolLunchEndTime)}
                disabled={settingsLoading}
                onChange={(e) => setTime('schoolLunchEndTime', e.target.value)}
              />
            </label>
          </div>

          <p className="settings-label section-label">Breakfast to lunch</p>
          <p className="location-settings__hint">
            The time the view switches from breakfast to lunch. Leave blank to prefer lunch whenever it's served.
          </p>
          <label className="school-lunch-settings__time">
            <span>Switch</span>
            <input
              type="time"
              value={timeValue(settings?.schoolLunchMealSwitchTime)}
              disabled={settingsLoading}
              onChange={(e) => setTime('schoolLunchMealSwitchTime', e.target.value)}
            />
          </label>
        </>
      )}
    </div>
  );
}
