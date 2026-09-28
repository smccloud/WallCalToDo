/*
 * Whether the person looking at this display has asked their system to
 * animate less.
 *
 * Shared rather than read separately where it's needed, because the two
 * halves of any motion in this app have to agree: the CSS stands down under
 * the same query (see the prefers-reduced-motion blocks in base.css) and the
 * JavaScript skips the part it drives itself. If only one of the two heard
 * the preference, a temperature count-up would freeze at its starting value
 * for someone who asked for less motion — worse than no animation at all.
 *
 * Read once at module load rather than per render: the preference can't
 * change without a reload, and the alternative is a matchMedia listener
 * wired to a setting that is fixed for the life of the page.
 */
export const REDUCED_MOTION =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
