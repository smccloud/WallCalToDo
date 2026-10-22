import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import LunchMenuPreview, { usePreviewDrift } from '../src/components/LunchMenuPreview.jsx';

const api = vi.hoisted(() => vi.fn());
vi.mock('../src/api.js', () => ({ api }));

// The cache keys days as 'YYYY-MM-DD' (the same key the wall's dateKey()
// produces), so the fixtures here are built from today's date.
function dayKey(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const TODAY = dayKey(0);
const TOMORROW = dayKey(1);

const MENU = {
  provider: 'nutrislice',
  schoolName: 'Lincoln Elementary',
  meals: {
    breakfast: { [TODAY]: [{ title: 'Morning', items: ['Bagel', 'Fruit'] }] },
    lunch: { [TODAY]: [{ title: 'Entrees', items: ['Pizza', 'Garden salad'] }] },
  },
  fetchedAt: '2026-10-21T12:00:00.000Z',
};

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue(MENU);
});

describe('LunchMenuPreview', () => {
  it('draws the cached menu, the meal the wall would pick', async () => {
    render(<LunchMenuPreview speed={16} showTomorrow={false} />);

    // The wall shows lunch whenever the day serves it, so the preview does
    // too -- breakfast is in the cache as well.
    expect(await screen.findByText('Pizza')).toBeDefined();
    expect(screen.queryByText('Bagel')).toBeNull();
    expect(screen.getByText('Lunch')).toBeDefined();
    expect(screen.getByText('Entrees')).toBeDefined();
  });

  it('shows tomorrow’s menu when the wall is set to read tomorrow’s', async () => {
    api.mockResolvedValue({
      ...MENU,
      meals: {
        lunch: {
          [TODAY]: [{ title: 'Entrees', items: ['Pizza'] }],
          [TOMORROW]: [{ title: 'Entrees', items: ['Tacos'] }],
        },
      },
    });

    render(<LunchMenuPreview speed={16} showTomorrow />);

    expect(await screen.findByText('Tacos')).toBeDefined();
    expect(screen.queryByText('Pizza')).toBeNull();
    expect(screen.getByText("Tomorrow's Lunch")).toBeDefined();
  });

  it('falls back to the nearest day that has a menu', async () => {
    api.mockResolvedValue({
      ...MENU,
      meals: { lunch: { [dayKey(-2)]: [{ title: 'Entrees', items: ['Leftovers'] }] } },
    });

    render(<LunchMenuPreview speed={16} showTomorrow={false} />);

    expect(await screen.findByText('Leftovers')).toBeDefined();
    expect(screen.getByText(/Showing /)).toBeDefined();
  });

  it('says so when no menu is cached', async () => {
    api.mockResolvedValue(null);

    render(<LunchMenuPreview speed={16} showTomorrow={false} />);

    expect(await screen.findByText(/No menu cached yet/)).toBeDefined();
  });

  it('surfaces a failed fetch', async () => {
    api.mockRejectedValue(new Error('Request failed (502)'));

    render(<LunchMenuPreview speed={16} showTomorrow={false} />);

    expect(await screen.findByText(/Couldn’t load the cached menu/)).toBeDefined();
  });

    it('starts drifting once the menu arrives', async () => {
    // The list isn't on the page until the menu has been fetched, so the
    // drift can only start once the preview has something to scroll.
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});

    render(<LunchMenuPreview speed={16} showTomorrow={false} />);
    await screen.findByText('Pizza');

    expect(frames.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

});

// The preview's drift, driven frame by frame: it has to be exactly
// predictable for the rests at either end to be testable at all.
describe('usePreviewDrift', () => {
  // A panel 100px tall holding 400px of menu. jsdom does no layout of its
  // own, so its height and the height of the content in it are fixed here;
  // its scrollTop rounds to the nearest pixel on the way in, the way a
  // browser's does.
  function panel({ clientHeight, scrollHeight }) {
    const el = document.createElement('div');
    let scrollTop = 0;
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(el, 'scrollTop', {
      get: () => scrollTop,
      set: (value) => {
        scrollTop = Math.round(value);
      },
      configurable: true,
    });
    document.body.appendChild(el);
    return el;
  }

  let frames = new Map();
  let nextFrameId = 1;
  let clock = 0;

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    clock = 0;
    // A real requestAnimationFrame: frames are handed out by id and can be
    // cancelled, so a restarted loop really does leave nothing behind.
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // One frame, the given number of milliseconds later than the last.
  function frame(ms = 1000) {
    clock += ms;
    const [id] = frames.keys();
    if (id === undefined) return;
    const cb = frames.get(id);
    frames.delete(id);
    act(() => cb(clock));
  }

  const OVERFLOWS = { clientHeight: 100, scrollHeight: 400 };

  function setup(el, speed, key = 'menu') {
    return renderHook(
      ({ s, k }) => {
        const ref = useRef(el);
        usePreviewDrift(ref, s, k);
      },
      { initialProps: { s: speed, k: key } }
    );
  }

  it('drifts the preview at the wall’s speed, scaled to its smaller text', () => {
    const el = panel(OVERFLOWS);
    setup(el, 16);

    frame(0);
    frame(1000);

    // The preview's text is 13px where the wall's is 22px, so the same
    // setting moves it at the same visual rate rather than at the same
    // number of pixels: 16 * 13/22 is about 9.45px a second.
    expect(el.scrollTop).toBe(9);
  });

  it('stands still at a speed of zero', () => {
    const el = panel(OVERFLOWS);
    setup(el, 0);

    frame(0);
    frame(1000);
    frame(1000);

    expect(el.scrollTop).toBe(0);
  });

  it('takes a new speed on without starting the drift over', () => {
    const el = panel(OVERFLOWS);
    const { rerender } = setup(el, 16);

    frame(0);
    frame(1000);
    expect(el.scrollTop).toBe(9);

    rerender({ s: 44, k: 'menu' });
    expect(el.scrollTop).toBe(9);

    frame(1000);
    // 44 * 13/22 is 26px a second, on top of the 9 already travelled.
    expect(el.scrollTop).toBe(35);
  });

  it('goes back to the top of the menu when the drift is switched off', () => {
    const el = panel(OVERFLOWS);
    const { rerender } = setup(el, 16);

    frame(0);
    frame(1000);
    expect(el.scrollTop).toBe(9);

    // The preview can't be scrolled back to the start of the menu by hand
    // either, so switching the drift off leaves it at the top.
    rerender({ s: 0, k: 'menu' });
    expect(el.scrollTop).toBe(0);
  });
});
