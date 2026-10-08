import { describe, expect, it, vi } from 'vitest';

// REDUCED_MOTION is read once at module load, so each case imports a fresh
// module underneath a window.matchMedia set up for it.

async function loadReducedMotion(match) {
  window.matchMedia = vi.fn((query) => ({
    matches: match,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.resetModules();
  const module = await import('../src/utils/motion.js');
  return module.REDUCED_MOTION;
}

describe('REDUCED_MOTION', () => {
  it('is true when the system asks for less motion', async () => {
    expect(await loadReducedMotion(true)).toBe(true);
  });

  it('is false when it does not', async () => {
    expect(await loadReducedMotion(false)).toBe(false);
  });

  it('is false when matchMedia is unavailable (e.g. a non-browser runtime)', async () => {
    delete window.matchMedia;
    vi.resetModules();
    const module = await import('../src/utils/motion.js');
    expect(module.REDUCED_MOTION).toBe(false);
  });
});
