import { describe, it, expect } from 'vitest';
import {
  layoutSelectPopover,
  layoutColorPopover,
  selectRowAt,
  clampScroll,
  scrollToShow,
  colorPartAt,
  svAt,
  hueAt,
  typeAheadIndex,
  POPOVER_PAD,
  POPOVER_MIN_WIDTH,
  ROW_PAD_X,
  ROW_CHECK_RESERVE,
} from './popover-layout';

const trigger = { x: 100, y: 50, width: 120, height: 28 };
const screen = { width: 1000, height: 800 };
const viewport = { x: 0, y: 0, zoom: 1 };

describe('layoutSelectPopover', () => {
  // v2 opens a select with the chosen row over the trigger, and the row's label on the trigger's
  // own label — so the panel's leading edge sits a gutter to the left of the trigger's text.
  const inset = 14;
  const leading = POPOVER_PAD + ROW_PAD_X + ROW_CHECK_RESERVE;

  it('puts the chosen row over the trigger, with its label on the trigger label', () => {
    // Down the screen, where a panel that holds its chosen row over the trigger still fits.
    const mid = { ...trigger, y: 400 };
    const l = layoutSelectPopover(mid, 10, 40, 30, 6, inset, 5, viewport, screen);
    expect(l.x).toBe(mid.x + inset - leading);
    expect(l.width).toBe(mid.width);
    expect(l.height).toBe(10 * 30 + POPOVER_PAD * 2);
    expect(l.visible).toBe(10);
    expect(l.scroll).toBe(0);
    const rowCentre = l.y + POPOVER_PAD + (5 + 0.5) * 30;
    expect(rowCentre).toBeCloseTo(mid.y + mid.height / 2);
  });

  it('grows to fit a wide option, and never goes under v2 floor', () => {
    const wide = layoutSelectPopover(trigger, 4, 300, 30, 6, inset, 0, viewport, screen);
    expect(wide.width).toBeGreaterThan(300);
    const narrow = layoutSelectPopover({ ...trigger, width: 40 }, 2, 10, 30, 6, inset, 0, viewport, screen);
    // The trigger is narrower than v2's floor, so the floor answers.
    expect(narrow.width).toBe(POPOVER_MIN_WIDTH);
  });

  it('keeps the rows it can show on screen and scrolls the rest', () => {
    // 800px of screen holds 25 rows of 30 with the panel's own padding and margins.
    const l = layoutSelectPopover(trigger, 40, 40, 30, 6, inset, 0, viewport, screen);
    expect(l.rows).toBe(40);
    expect(l.visible).toBeLessThan(40);
    expect(l.height).toBeLessThanOrEqual(screen.height);
    expect(l.visible * 30 + POPOVER_PAD * 2).toBe(l.height);
  });

  it('scrolls to the chosen row, and stays on screen while doing it', () => {
    // The last of forty: the list scrolls to the end, and the panel — too tall to hang that row
    // over a trigger near the top — slides back inside the viewport instead.
    const l = layoutSelectPopover(trigger, 40, 40, 30, 6, inset, 39, viewport, screen);
    expect(l.scroll).toBe(40 - l.visible);
    expect(l.y * viewport.zoom + viewport.y).toBeGreaterThanOrEqual(0);
    expect((l.y + l.height) * viewport.zoom + viewport.y).toBeLessThanOrEqual(screen.height);
    // The chosen row is among the ones on screen, which is what the scroll is for.
    expect(39 - l.scroll).toBeLessThan(l.visible);
  });

  it('slides back on screen rather than hanging off an edge', () => {
    const low = layoutSelectPopover({ ...trigger, y: 760 }, 6, 40, 30, 6, inset, 5, viewport, screen);
    expect((low.y + low.height) * viewport.zoom + viewport.y).toBeLessThanOrEqual(screen.height);
    const right = layoutSelectPopover({ ...trigger, x: 950 }, 3, 200, 30, 6, inset, 0, viewport, screen);
    expect((right.x + right.width) * viewport.zoom + viewport.x).toBeLessThanOrEqual(screen.width);
    const left = layoutSelectPopover({ ...trigger, x: 0 }, 3, 40, 30, 6, inset, 0, viewport, screen);
    expect(left.x * viewport.zoom + viewport.x).toBeGreaterThanOrEqual(0);
  });

  it('measures the screen in SCREEN space, so a zoomed list shows fewer rows', () => {
    const zoomed = { x: 0, y: 0, zoom: 4 };
    const l = layoutSelectPopover(trigger, 40, 40, 30, 6, inset, 0, zoomed, screen);
    expect(l.visible).toBeLessThan(
      layoutSelectPopover(trigger, 40, 40, 30, 6, inset, 0, viewport, screen).visible
    );
  });

  it('grows out of the trigger', () => {
    const l = layoutSelectPopover(trigger, 3, 40, 30, 6, inset, 0, viewport, screen);
    expect(l.anchorX).toBe(trigger.x + trigger.width / 2);
    expect(l.anchorY).toBe(trigger.y + trigger.height / 2);
  });
});

describe('selectRowAt', () => {
  const l = layoutSelectPopover(trigger, 12, 40, 28, 6, 14, 0, viewport, screen);

  it('finds a row by its band, offset by the scroll', () => {
    const y0 = l.y + POPOVER_PAD + 1;
    expect(selectRowAt(l, 0, l.x + 10, y0)).toBe(0);
    expect(selectRowAt(l, 0, l.x + 10, y0 + 28)).toBe(1);
    expect(selectRowAt(l, 4, l.x + 10, y0 + 28)).toBe(5);
  });

  it('is -1 in the padding, outside, and past the visible rows', () => {
    expect(selectRowAt(l, 0, l.x + 10, l.y + 1)).toBe(-1);
    expect(selectRowAt(l, 0, l.x - 1, l.y + 10)).toBe(-1);
    // Scrolled to the end, the last band may be past the list.
    expect(selectRowAt(l, 8, l.x + 10, l.y + POPOVER_PAD + 28 * 7 + 1)).toBe(-1);
  });
});

describe('scrolling', () => {
  it('clamps', () => {
    expect(clampScroll(-1, 12, 8)).toBe(0);
    expect(clampScroll(10, 12, 8)).toBe(4);
    expect(clampScroll(2, 3, 8)).toBe(0);
  });

  it('brings an index into view from either side', () => {
    expect(scrollToShow(0, 9, 12, 8)).toBe(2);
    expect(scrollToShow(4, 1, 12, 8)).toBe(1);
    expect(scrollToShow(2, 5, 12, 8)).toBe(2);
  });
});

describe('colour popover', () => {
  const l = layoutColorPopover(trigger, 6, viewport, screen);

  it('lays the square above the strip above the readout, inside the panel', () => {
    expect(l.sv.y).toBeGreaterThan(l.y);
    expect(l.hue.y).toBeGreaterThan(l.sv.y + l.sv.height);
    expect(l.hexY).toBeGreaterThan(l.hue.y + l.hue.height);
    expect(l.hexY).toBeLessThan(l.y + l.height);
  });

  it('names the part under a point', () => {
    expect(colorPartAt(l, l.sv.x + 1, l.sv.y + 1)).toBe('sv');
    expect(colorPartAt(l, l.hue.x + 1, l.hue.y + 1)).toBe('hue');
    expect(colorPartAt(l, l.x + 1, l.y + 1)).toBe('panel');
    expect(colorPartAt(l, l.x - 1, l.y)).toBeNull();
  });

  it('reads saturation across, value up, hue across, all clamped', () => {
    expect(svAt(l, l.sv.x, l.sv.y)).toEqual([0, 1]);
    expect(svAt(l, l.sv.x + l.sv.width, l.sv.y + l.sv.height)).toEqual([1, 0]);
    expect(svAt(l, l.sv.x - 50, l.sv.y - 50)).toEqual([0, 1]);
    expect(hueAt(l, l.hue.x + l.hue.width / 2)).toBeCloseTo(0.5, 6);
    expect(hueAt(l, l.hue.x + l.hue.width * 2)).toBe(1);
  });
});

describe('typeAheadIndex', () => {
  const options = ['CodeFormer', 'GFPGAN', 'RestoreFormer', 'gfpgan-v2'];
  it('finds the next match after the current row, ignoring case, and wraps', () => {
    expect(typeAheadIndex(options, 'g', -1)).toBe(1);
    expect(typeAheadIndex(options, 'g', 1)).toBe(3);
    expect(typeAheadIndex(options, 'g', 3)).toBe(1);
    expect(typeAheadIndex(options, 'res', 0)).toBe(2);
  });
  it('is -1 for no match or no prefix', () => {
    expect(typeAheadIndex(options, 'z', 0)).toBe(-1);
    expect(typeAheadIndex(options, '', 0)).toBe(-1);
  });
});
