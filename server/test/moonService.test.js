import { describe, expect, it } from 'vitest';
import { getMoonPhase } from '../src/services/moonService.js';

const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0); // reference epoch in the module
const SYNODIC_MONTH_MS = 29.53058867 * 86400000;

describe('getMoonPhase', () => {
  it('identifies the known new moon', () => {
    expect(getMoonPhase(new Date(KNOWN_NEW_MOON))).toEqual({ name: 'New Moon', emoji: '🌑' });
  });

  it('wraps a moment just before the new moon to the previous cycle (also new)', () => {
    const before = new Date(KNOWN_NEW_MOON - 60 * 1000);
    expect(getMoonPhase(before)).toEqual({ name: 'New Moon', emoji: '🌑' });
  });

  it('lands on the full moon roughly half a synodic month later', () => {
    const full = new Date(KNOWN_NEW_MOON + (SYNODIC_MONTH_MS / 2) + 4 * 3600e3);
    expect(getMoonPhase(full).name).toBe('Full Moon');
  });

  it('lands on the first quarter a quarter-cycle in', () => {
    const quarter = new Date(KNOWN_NEW_MOON + SYNODIC_MONTH_MS / 4);
    expect(getMoonPhase(quarter).name).toBe('First Quarter');
  });

  it('covers all eight phases across one full cycle', () => {
    const names = new Set();
    for (let step = 0; step < 8; step++) {
      names.add(getMoonPhase(new Date(KNOWN_NEW_MOON + (SYNODIC_MONTH_MS * step) / 8)).name);
    }
    expect(names.size).toBe(8);
  });

  it('returns a { name, emoji } pair for any date', () => {
    for (const date of [new Date(), new Date(2026, 0, 1), new Date(2049, 11, 31)]) {
      const phase = getMoonPhase(date);
      expect(typeof phase.name).toBe('string');
      expect(typeof phase.emoji).toBe('string');
    }
  });

  it('is deterministic for the same instant', () => {
    const date = new Date(2026, 6, 4, 12, 30);
    expect(getMoonPhase(date)).toEqual(getMoonPhase(new Date(date.getTime())));
  });
});