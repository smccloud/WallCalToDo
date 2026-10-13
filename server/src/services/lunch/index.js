import * as nutrislice from './nutrislice.js';
import * as mealviewer from './mealviewer.js';
import * as healthepro from './healthepro.js';
import * as schoolcafe from './schoolcafe.js';

// Every menu provider the wall can read from. A provider supplies four things:
// a validated name for itself (validate/configured), the schools inside a
// saved district (fetchSchools), the breakfast and lunch menus for the saved
// school (fetchMeals), and a best-effort location -> districts step
// (discover). The orchestration in lunchService.js only ever talks to this
// interface, so adding a provider is adding a module and one line here.
//
// Order is the order the companion app lists them in, and nutrislice is first
// because it's the default an install with no saved provider falls back to.
export const PROVIDERS = {
  nutrislice,
  mealviewer,
  healthepro,
  schoolcafe,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);
export const DEFAULT_PROVIDER = 'nutrislice';

export function getProvider(providerId) {
  return PROVIDERS[providerId] || PROVIDERS[DEFAULT_PROVIDER];
}

// For the companion app's provider picker: id and human label, in display order.
export const PROVIDER_LIST = PROVIDER_IDS.map((providerId) => ({
  id: providerId,
  label: PROVIDERS[providerId].label,
}));
