import { useEffect, useState } from 'react';
import { api } from '../api.js';

// <input type="time"> reads and writes exactly the 'HH:MM' strings the server
// stores (see the LUNCH_TIME_RE check in routes/settings.js), so a value passes
// through untouched. Only one normalization is needed: clearing the input
// yields '', which becomes null ("no bound") so the server stores a real
// absence rather than an invalid time.
function timeValue(value) {
  return value || '';
}

// The providers the server offers, used only until /lunch/providers answers
// (so the picker isn't empty on first paint). Id order matches the server's.
const FALLBACK_PROVIDERS = [
  { id: 'nutrislice', label: 'Nutrislice' },
  { id: 'mealviewer', label: 'MealViewer' },
  { id: 'healthepro', label: 'Health-e Pro' },
  { id: 'schoolcafe', label: 'SchoolCafe' },
];

// The parts of the picker that differ per provider: a Nutrislice district is a
// hostname slug (lower-cased before it goes out), MealViewer's is a district
// lookup (case-sensitive), the other two are numeric ids, and only SchoolCafe
// needs a serving line and has no location discovery.
const PROVIDER_META = {
  nutrislice: {
    districtPlaceholder: 'District slug',
    districtHint: 'The part before ".nutrislice.com", e.g. "dallas" for dallas.nutrislice.com.',
    lowercasesDistrict: true,
    discovers: true,
  },
  mealviewer: {
    districtPlaceholder: 'District id',
    districtHint: 'MealViewer\'s district id, e.g. "HopkinsISD270".',
    lowercasesDistrict: false,
    discovers: true,
  },
  healthepro: {
    districtPlaceholder: 'District id (number)',
    districtHint: 'Health-e Pro\'s numeric district (organization) id.',
    lowercasesDistrict: false,
    discovers: true,
  },
  schoolcafe: {
    districtPlaceholder: 'District id (number)',
    districtHint: 'SchoolCafe\'s numeric district id.',
    lowercasesDistrict: false,
    discovers: false,
  },
};

const metaFor = (provider) => PROVIDER_META[provider] || PROVIDER_META.nutrislice;

// How often the view flips between breakfast and lunch. These are the values
// the server validates against (LUNCH_ALTERNATE_SECONDS in
// server/src/routes/settings.js) with friendlier labels; adding one means
// adding it in both places. 0 is "Off", which leaves the view on lunch
// whenever the day serves it.
const ALTERNATE_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 15, label: 'Every 15 seconds' },
  { value: 30, label: 'Every 30 seconds' },
  { value: 60, label: 'Every minute' },
  { value: 120, label: 'Every 2 minutes' },
  { value: 300, label: 'Every 5 minutes' },
];

// Optional school lunch view: replaces the to-do list with the school's
// breakfast/lunch menus during a daily window (see frontend/src/App.jsx).
// Which menu system to read is a provider choice; each one names a district
// (and then a school) differently, so this section adapts its fields to the
// chosen provider, offers location-based discovery where the provider supports
// it, and asks for a serving line where the provider needs one (SchoolCafe).
export default function SchoolLunchSettings({
  settings,
  settingsLoading,
  onSetSchoolLunchEnabled,
  onSetSchoolLunch,
}) {
  const enabled = Boolean(settings?.schoolLunchEnabled);
  const location = settings?.location || null;
  const [providers, setProviders] = useState(FALLBACK_PROVIDERS);
  const [provider, setProvider] = useState(settings?.schoolLunchProvider || 'nutrislice');
  const [district, setDistrict] = useState(settings?.schoolLunchDistrict ? String(settings.schoolLunchDistrict) : '');
  const [schools, setSchools] = useState(null);
  const [groups, setGroups] = useState(null);
  const [lines, setLines] = useState(null);
  const [searching, setSearching] = useState(false);
  const [linesLoading, setLinesLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const meta = metaFor(provider);
  const providerLabel = providers.find((p) => p.id === provider)?.label || 'your menu provider';
  const alternateSeconds = Number(settings?.schoolLunchAlternateSeconds) || 0;

  useEffect(() => {
    let active = true;
    api('/lunch/providers')
      .then((data) => {
        if (active && data?.providers?.length) setProviders(data.providers);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const setTime = (key, value) => onSetSchoolLunch({ [key]: value || null });

  // Switching provider makes every stored id meaningless (they're provider-
  // specific), so clear them in the same PATCH and start the local picker over.
  function chooseProvider(next) {
    setProvider(next);
    setDistrict('');
    setSchools(null);
    setGroups(null);
    setLines(null);
    setSearchError(null);
    onSetSchoolLunch({
      schoolLunchProvider: next,
      schoolLunchDistrict: null,
      schoolLunchSchool: null,
      schoolLunchSchoolName: null,
      schoolLunchServingLine: null,
    });
  }

  // One lookup path for both entry points: the manual "Find schools" button and
  // picking a district from the discovery results both end up here, so the
  // school list and the error handling are defined once.
  async function findSchoolsFor(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return;
    const normalized = meta.lowercasesDistrict ? trimmed.toLowerCase() : trimmed;
    setSearching(true);
    setSearchError(null);
    try {
      const { schools: results } = await api(
        `/lunch/schools?provider=${provider}&district=${encodeURIComponent(normalized)}`
      );
      setSchools(results);
      setDistrict(normalized);
      if (results.length === 0) setSearchError('No schools found for that district.');
    } catch (err) {
      // Surfaced inline next to the field, like the location search's errors --
      // a bad district id is expected input, not a page-level failure.
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  }

  function findSchools(e) {
    e.preventDefault();
    findSchoolsFor(district);
  }

  // Hand the wall's saved location to the server, which reverse-geocodes it and
  // returns the districts it could verify (each as a selectable group). Doesn't
  // set a district on its own -- finding one is a suggestion, not a decision.
  async function discover() {
    if (!location || !meta.discovers) return;
    setDiscovering(true);
    setSearchError(null);
    setGroups(null);
    setSchools(null);
    try {
      const data = await api(
        `/lunch/discover?provider=${provider}&lat=${encodeURIComponent(location.lat)}&lon=${encodeURIComponent(location.lon)}`
      );
      const found = data.groups || [];
      setGroups(found);
      if (found.length === 0) {
        setSearchError(
          data.place
            ? `No ${providerLabel} district found near ${data.place}. Try entering it by hand.`
            : 'Couldn\u2019t work out where that location is. Try entering the district by hand.'
        );
      }
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setDiscovering(false);
    }
  }

  function chooseDistrict(group) {
    setGroups(null);
    findSchoolsFor(group.id);
  }

  // SchoolCafe-only: a menu is fetched by serving line, so once a school is
  // picked its lines are loaded and offered before the choice is complete.
  async function loadLines(schoolId) {
    setLinesLoading(true);
    try {
      const { lines: results } = await api(
        `/lunch/lines?provider=schoolcafe&school=${encodeURIComponent(schoolId)}&district=${encodeURIComponent(district.trim())}`
      );
      setLines(results);
      if (results.length === 0) setSearchError('No serving lines found for that school.');
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setLinesLoading(false);
    }
  }

  function chooseSchool(school) {
    setSchools(null);
    setSearchError(null);
    onSetSchoolLunch({
      schoolLunchDistrict: district.trim(),
      schoolLunchSchool: school.id,
      schoolLunchSchoolName: school.name,
    });
    if (provider === 'schoolcafe') loadLines(school.id);
  }

  function chooseLine(line) {
    setLines(null);
    setSearchError(null);
    onSetSchoolLunch({ schoolLunchServingLine: line.name });
  }

  return (
    <div className="school-lunch-settings">
      <p className="settings-label section-label">School lunch</p>
      <p className="location-settings__hint">
        Optionally replaces the to-do list with your school's breakfast and lunch menus during a daily window.
        Choose which menu system to read from below.
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
          <p className="settings-label section-label">Menu provider</p>
          <select
            className="select school-lunch-settings__provider"
            aria-label="Menu provider"
            value={provider}
            disabled={settingsLoading}
            onChange={(e) => chooseProvider(e.target.value)}
          >
            {providers.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>

          <p className="settings-label section-label">District and school</p>
          {meta.discovers ? (
            location ? (
              <>
                <p className="location-settings__hint">
                  Look your district up from the wall's saved location, or enter it by hand. {meta.districtHint}
                </p>
                <button
                  type="button"
                  className="button button--ghost school-lunch-settings__discover"
                  disabled={discovering || settingsLoading}
                  onClick={discover}
                >
                  {discovering ? 'Searching…' : 'Find my district'}
                </button>
                <p className="location-settings__hint school-lunch-settings__near">
                  near {location.label || 'your saved location'}
                </p>
              </>
            ) : (
              <p className="location-settings__hint">
                {meta.districtHint} Set a location above to have it found automatically instead.
              </p>
            )
          ) : (
            <p className="location-settings__hint">
              {meta.districtHint} SchoolCafe has no district search, so it has to be entered by hand.
            </p>
          )}

          {groups && groups.length > 0 && (
            <ul className="location-settings__results school-lunch-settings__districts">
              {groups.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    className="location-settings__result"
                    disabled={settingsLoading || searching}
                    onClick={() => chooseDistrict(group)}
                  >
                    {group.label}
                    {group.schoolCount != null &&
                      ` (${group.schoolCount} ${group.schoolCount === 1 ? 'school' : 'schools'})`}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="location-settings__search" onSubmit={findSchools}>
            <input
              type="text"
              placeholder={meta.districtPlaceholder}
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
                <li key={school.id}>
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

          {(linesLoading || (lines && lines.length > 0)) && (
            <>
              <p className="settings-label section-label">Serving line</p>
              <p className="location-settings__hint">
                Which line's menu to show. SchoolCafe fetches menus per serving line.
              </p>
              {linesLoading ? (
                <p className="location-settings__hint">Loading serving lines…</p>
              ) : (
                <ul className="location-settings__results">
                  {lines.map((line) => (
                    <li key={line.id}>
                      <button
                        type="button"
                        className="location-settings__result"
                        disabled={settingsLoading}
                        onClick={() => chooseLine(line)}
                      >
                        {line.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {settings?.schoolLunchSchoolName && !schools && (
            <p className="location-settings__current">
              Currently set to{' '}
              <span className="location-settings__current-value">{settings.schoolLunchSchoolName}</span>
            </p>
          )}

          {provider === 'schoolcafe' && settings?.schoolLunchSchool && !settings?.schoolLunchServingLine && (
            <p className="settings-notice">Pick a serving line above — SchoolCafe needs one to fetch a menu.</p>
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

          <p className="settings-label section-label">Alternate breakfast and lunch</p>
          <p className="location-settings__hint">
            When the school serves both, how often the view flips between them. Off keeps it on lunch whenever the
            day serves it.
          </p>
          <select
            className="select"
            aria-label="How often to alternate between breakfast and lunch"
            value={alternateSeconds}
            disabled={settingsLoading}
            onChange={(e) => onSetSchoolLunch({ schoolLunchAlternateSeconds: Number(e.target.value) })}
          >
            {ALTERNATE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <div className="setting-toggle">
            <span className="setting-toggle__label">Show tomorrow's menu</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings?.schoolLunchShowTomorrow || false}
                disabled={settingsLoading}
                onChange={(e) => onSetSchoolLunch({ schoolLunchShowTomorrow: e.target.checked })}
              />
              <span className="switch__track" />
            </label>
          </div>
          <p className="location-settings__hint">
            Read tomorrow's menu instead of today's. If tomorrow has no menu, the to-do list stays up.
          </p>
        </>
      )}
    </div>
  );
}
