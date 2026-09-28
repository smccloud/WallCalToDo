// Unit conversion and formatting for the weather display.
//
// Everything the server caches arrives in one canonical unit per quantity --
// kilometres per hour, millimetres, and both Celsius and Fahrenheit -- and the
// companion app's unit settings decide what the wall actually shows. The
// conversions live here rather than in the components so they're one tested
// set of numbers instead of arithmetic repeated across a component tree, and
// so the server never has to care which display a reading ends up on.

// Factors are exact definitions rather than magic numbers scattered at each
// call site: a mile is 1.609344 km, a knot is one nautical mile (1.852 km)
// per hour, and an inch is 25.4 mm exactly. Rounding is the display's
// business, not the conversion's, so these stay full precision.
const KM_PER_MILE = 1.609344;
const KM_PER_NAUTICAL_MILE = 1.852;
const MM_PER_INCH = 25.4;
const SECONDS_PER_HOUR = 3600;
const METRES_PER_KM = 1000;

// Wind speed, in whatever unit the settings ask for. Input is always km/h.
// Returns null for a missing reading rather than 0, so "no data" and "calm"
// stay distinguishable -- a wall that shows "0 mph" because the field was
// absent is lying about the weather.
export function windSpeed(kmh, unit) {
  if (kmh == null || !Number.isFinite(kmh)) return null;
  switch (unit) {
    // km/h to m/s is a factor of 1000 and a factor of time in the same step,
    // which is the easiest place in this file to get backwards: kilometres
    // per hour is not kilometres per second.
    case 'ms':
      return (kmh * METRES_PER_KM) / SECONDS_PER_HOUR;
    // A knot is a nautical mile per hour, so dividing km/h by km-per-nautical-
    // mile lands on nautical miles per hour directly -- no time factor.
    case 'kn':
      return kmh / KM_PER_NAUTICAL_MILE;
    case 'kmh':
      return kmh;
    case 'mph':
    default:
      return kmh / KM_PER_MILE;
  }
}

// The label that goes with a converted speed. Separate from the number
// because a wind speed is never shown without its unit -- "12" on a weather
// wall is a temperature.
export function windUnitLabel(unit) {
  switch (unit) {
    case 'ms':
      return 'm/s';
    case 'kn':
      return 'kn';
    case 'kmh':
      return 'km/h';
    case 'mph':
    default:
      return 'mph';
  }
}

// Precipitation amount, in millimetres or inches. Same null handling as wind.
export function precipitation(mm, unit) {
  if (mm == null || !Number.isFinite(mm)) return null;
  return unit === 'inch' ? mm / MM_PER_INCH : mm;
}

export function precipitationUnitLabel(unit) {
  return unit === 'inch' ? 'in' : 'mm';
}

// Rounding for display, kept beside the conversions so the rules live with
// the numbers they apply to. Wind rounds to a whole number in every unit
// except m/s, where the values are small enough that a whole number throws
// away the difference between a breeze and still air.
function roundWind(value, unit) {
  return unit === 'ms' ? Math.round(value * 10) / 10 : Math.round(value);
}

// Below this, an inch-based precipitation amount is shown to two decimals so a
// trace of rain doesn't render as "0 in" -- which is not a forecast, it's a
// rounding error. At or above it, one decimal is plenty: the difference
// between 0.1 and 0.2 in matters, the third decimal never does.
const FINE_PRECIP_INCH = 0.1;

function roundPrecip(value, unit) {
  if (unit !== 'inch') return Math.round(value * 10) / 10;
  const places = value < FINE_PRECIP_INCH ? 100 : 10;
  return Math.round(value * places) / places;
}

// A ready-to-render wind reading: "12 mph", or null when there's nothing to
// show. The compass point rides in separately (the server sends it as its own
// field) so a reading with a speed but no direction still renders.
export function formatWind(kmh, unit) {
  const value = windSpeed(kmh, unit);
  return value == null ? null : `${roundWind(value, unit)} ${windUnitLabel(unit)}`;
}

// A ready-to-render precipitation amount: "0.2 in", "1.4 mm".
export function formatPrecipitation(mm, unit) {
  const value = precipitation(mm, unit);
  return value == null ? null : `${roundPrecip(value, unit)} ${precipitationUnitLabel(unit)}`;
}

// Chance of precipitation needs no conversion at all -- every provider quotes
// it as a percentage, so this exists only so the null case is handled the
// same way everywhere ("no chance data" rather than "0%", which is a claim
// about the sky).
export function formatPrecipChance(percent) {
  if (percent == null || !Number.isFinite(percent)) return null;
  const value = Math.round(percent);
  return value > 0 ? `${value}%` : null;
}
