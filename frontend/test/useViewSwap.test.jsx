import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SWAP_MS, useViewSwap } from '../src/hooks/useViewSwap.js';

// The handover runs on real timers (one beat out, one beat in), so these
// drive them with fake ones.

afterEach(() => {
  vi.useRealTimers();
});

function setup(initialWant) {
  return renderHook(({ want }) => useViewSwap(want), { initialProps: { want: initialWant } });
}

describe('useViewSwap', () => {
  it('starts on the view it was asked for, with no transition', () => {
    vi.useFakeTimers();
    const { result } = setup('calendar');
    expect(result.current).toEqual({ view: 'calendar', phase: 'idle' });
  });

  it('swaps out then in, one beat at a time', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup('calendar');

    rerender({ want: 'weather' });
    expect(result.current).toEqual({ view: 'calendar', phase: 'leaving' });

    act(() => vi.advanceTimersByTime(SWAP_MS));
    expect(result.current).toEqual({ view: 'weather', phase: 'entering' });
  });

  it('leaves the incoming view in "entering" so its fade-in can finish', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup('calendar');
    rerender({ want: 'weather' });
    act(() => vi.advanceTimersByTime(SWAP_MS));

    // Re-asking for the view already on screen must not clear 'entering' --
    // that would cut the fade-in off halfway.
    rerender({ want: 'weather' });
    expect(result.current).toEqual({ view: 'weather', phase: 'entering' });
  });

  it('recovers a swap that was called off while the old view was leaving', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup('calendar');

    rerender({ want: 'weather' });
    expect(result.current.phase).toBe('leaving');

    // Back to the view that is still (partway) on screen: it has faded to
    // nothing and would never come back without this.
    rerender({ want: 'calendar' });
    expect(result.current).toEqual({ view: 'calendar', phase: 'idle' });
  });

  it('hands over without a fade when the system asks for less motion', async () => {
    window.matchMedia = vi.fn((query) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.resetModules(); // motion.js reads the preference at module load
    const { useViewSwap: freshUseViewSwap } = await import('../src/hooks/useViewSwap.js');

    const { result, rerender } = renderHook(({ want }) => freshUseViewSwap(want), {
      initialProps: { want: 'calendar' },
    });
    rerender({ want: 'weather' });

    expect(result.current).toEqual({ view: 'weather', phase: 'idle' });
  });
});
