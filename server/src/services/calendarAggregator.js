import { getCachedEvents as getCachedGoogleEvents } from './calendarService.js';
import { getCachedEvents as getCachedMicrosoftEvents } from './microsoftCalendarService.js';

// Mirrors todoAggregator.js exactly, one domain over. Both providers'
// getCachedEvents() already sort by start internally; merging just needs
// to fold the two already-sorted arrays together. Kept in one place for
// the same reason as todoAggregator.js: two callers (ws/hub.js's initial
// connect snapshot and poller.js's post-poll broadcasts) need the exact
// same merged view, and duplicating the merge in both risks them quietly
// drifting apart later.
export function getMergedEvents() {
  return [...getCachedGoogleEvents(), ...getCachedMicrosoftEvents()].sort(
    (a, b) => new Date(a.start) - new Date(b.start)
  );
}
