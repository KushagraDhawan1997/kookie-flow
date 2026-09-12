/**
 * Where a widget's floating panel goes, and what is under a point in it.
 *
 * ONE GEOMETRY, THREE READERS — the rule widget-geometry.ts states, applied to the panels. The GL
 * renderer draws from these rectangles, the pointer handlers press against them, and the keyboard
 * scrolls by them. A panel drawn in one place and pressed in another is the defect the widget box
 * already had to close once.
 *
 * Everything is in WORLD units, so a panel scales with the node it belongs to exactly as the
 * borrowed DOM element used to (it wore `scale(zoom)`). The one place the screen enters is the
 * flip: a list that would run off the bottom of the viewport opens upward instead, and one that
 * would run off the right slides left. Both are decided from the viewport, not from a DOM rect.
 */

import type { Viewport } from '../types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rows a list shows before it scrolls, when nothing else decides.
 *
 * v2 caps a list at the AVAILABLE HEIGHT and scrolls inside it, which is what the layout below
 * computes from the viewport. This is the fallback for a caller with no screen to measure against.
 */
export const POPOVER_MAX_ROWS = 8;
/** Screen px a panel keeps clear of the viewport's edges. */
export const POPOVER_SCREEN_MARGIN = 8;
/** v2's floor for a list's width: `max(112px, trigger width)`. */
export const POPOVER_MIN_WIDTH = 112;
/** World px between the trigger and its panel. */
export const POPOVER_GAP = 4;
/** The panel's own inset around its rows: v2's `--panel-p-2`. */
export const POPOVER_PAD = 12;
/** A row's leading inset, before the tick gutter: v2's select item `padding-left`. */
export const ROW_PAD_X = 10;
/** A row's trailing inset: v2's select item `padding-right`. */
export const ROW_PAD_END = 14;
/** The LEADING gutter the selected tick sits in: a 16px glyph box and the gap after it, as v2 lays
 * a select item out. Every row keeps it, so the text of every option starts at one x. */
export const ROW_CHECK_RESERVE = 25;
/** The tick's centre from the row's leading edge. */
export const ROW_CHECK_X = ROW_PAD_X + 8;
/** The shadow's reach outside the panel; the quad is padded by this on every side. `--shadow-3`
 * reaches 18 + 48/2 - 14 = 28 below, so 40 leaves the blur its tail. */
export const POPOVER_SHADOW_PAD = 40;

export interface SelectPopoverLayout {
  kind: 'select';
  x: number;
  y: number;
  width: number;
  height: number;
  rowHeight: number;
  /** Rows on screen at once. */
  visible: number;
  /** Rows in the list. */
  rows: number;
  /** True when the panel opens above its trigger. */
  flipped: boolean;
  /**
   * The scroll the panel was PLACED for. A select opens with its chosen row over the trigger, so
   * the row's offset inside the panel decides where the panel goes; scrolling afterwards moves the
   * rows and never the panel, which is why this is the opening scroll and not the live one.
   */
  scroll: number;
  /** The point the panel grows out of: the trigger's own centre, as v2 has a panel do. */
  anchorX: number;
  anchorY: number;
  /** The panel's corner: a row's corner plus the panel's inset, as v2's floating rows have it. */
  radius: number;
  /** A row's corner. */
  rowRadius: number;
}

export interface ColorPopoverLayout {
  kind: 'color';
  x: number;
  y: number;
  width: number;
  height: number;
  /** The saturation/value square, in world units, absolute. */
  sv: Rect;
  /** The hue strip. */
  hue: Rect;
  /** Baseline row for the hex readout. */
  hexY: number;
  flipped: boolean;
  anchorX: number;
  anchorY: number;
  radius: number;
}

export type PopoverLayout = SelectPopoverLayout | ColorPopoverLayout;

interface Screen {
  width: number;
  height: number;
}

/** Slide a panel until both its edges are on screen, the leading edge winning if it cannot fit. */
function fitX(x: number, width: number, viewport: Viewport, screen: Screen): number {
  const { zoom } = viewport;
  const right = (x + width) * zoom + viewport.x;
  const leftEdge = (POPOVER_SCREEN_MARGIN - viewport.x) / zoom;
  const shifted = right > screen.width - POPOVER_SCREEN_MARGIN
    ? x - (right - (screen.width - POPOVER_SCREEN_MARGIN)) / zoom
    : x;
  return Math.max(leftEdge, shifted);
}

/** The same, down the screen: a panel aligned to its trigger still stays inside the viewport. */
function fitY(y: number, height: number, viewport: Viewport, screen: Screen): number {
  const { zoom } = viewport;
  const topEdge = (POPOVER_SCREEN_MARGIN - viewport.y) / zoom;
  const bottom = (y + height) * zoom + viewport.y;
  const shifted = bottom > screen.height - POPOVER_SCREEN_MARGIN
    ? y - (bottom - (screen.height - POPOVER_SCREEN_MARGIN)) / zoom
    : y;
  return Math.max(topEdge, shifted);
}

/** Below the trigger if it fits, else above it if THAT fits, else below anyway. */
function placeY(
  trigger: Rect,
  height: number,
  viewport: Viewport,
  screen: Screen
): { y: number; flipped: boolean } {
  const below = trigger.y + trigger.height + POPOVER_GAP;
  const bottom = (below + height) * viewport.zoom + viewport.y;
  if (bottom <= screen.height) return { y: below, flipped: false };
  const above = trigger.y - POPOVER_GAP - height;
  const top = above * viewport.zoom + viewport.y;
  if (top >= 0) return { y: above, flipped: true };
  return { y: below, flipped: false };
}

/**
 * A select's list, placed the way v2 places one: the CHOSEN ROW OVER THE TRIGGER, with the row's
 * label on the trigger's own label, so picking the value that is already set costs no eye travel.
 * A list too tall for the viewport keeps its rows and scrolls inside; one that would leave the
 * screen slides back in, which is v2's fallback when a trigger is near an edge.
 *
 * @param widest the widest option's text width in world units at the row font size, so the panel
 *   can be wider than its trigger when an option needs it.
 * @param radius the ROW's corner — the control radius, which at v2's `full` level is half a row.
 *   The panel's own corner is that plus its inset, exactly as `.kui-floating-rows` computes it.
 * @param textInset the trigger's own text inset, which the row's label is aligned to.
 * @param selected the index of the chosen option, or -1 when the trigger rests on a placeholder.
 */
export function layoutSelectPopover(
  trigger: Rect,
  rows: number,
  widest: number,
  rowHeight: number,
  radius: number,
  textInset: number,
  selected: number,
  viewport: Viewport,
  screen: Screen
): SelectPopoverLayout {
  // What fits on screen, in world units: v2 caps a list at the available height, not at a count.
  const available = (screen.height - 2 * POPOVER_SCREEN_MARGIN) / viewport.zoom - 2 * POPOVER_PAD;
  const visible = Math.max(1, Math.min(rows, Math.floor(available / rowHeight)));
  const index = selected < 0 ? 0 : selected;
  const scroll = scrollToShow(0, index, rows, visible);
  const width = Math.max(
    POPOVER_MIN_WIDTH,
    trigger.width,
    widest + ROW_PAD_X + ROW_CHECK_RESERVE + ROW_PAD_END + POPOVER_PAD * 2
  );
  const height = visible * rowHeight + POPOVER_PAD * 2;
  const x = fitX(
    trigger.x + textInset - (POPOVER_PAD + ROW_PAD_X + ROW_CHECK_RESERVE),
    width,
    viewport,
    screen
  );
  const rowCentre = POPOVER_PAD + (index - scroll + 0.5) * rowHeight;
  const y = fitY(trigger.y + trigger.height / 2 - rowCentre, height, viewport, screen);
  const rowRadius = Math.min(radius, rowHeight / 2);
  return {
    kind: 'select',
    x,
    y,
    width,
    height,
    rowHeight,
    visible,
    rows,
    scroll,
    flipped: false,
    anchorX: trigger.x + trigger.width / 2,
    anchorY: trigger.y + trigger.height / 2,
    radius: rowRadius + POPOVER_PAD,
    rowRadius,
  };
}

export const COLOR_PANEL_WIDTH = 208;
export const COLOR_PANEL_PAD = 12;
export const COLOR_SV_HEIGHT = 128;
export const COLOR_HUE_HEIGHT = 12;
export const COLOR_HEX_ROW = 20;

export function layoutColorPopover(
  trigger: Rect,
  radius: number,
  viewport: Viewport,
  screen: Screen
): ColorPopoverLayout {
  const inner = COLOR_PANEL_WIDTH - COLOR_PANEL_PAD * 2;
  const height =
    COLOR_PANEL_PAD + COLOR_SV_HEIGHT + COLOR_PANEL_PAD + COLOR_HUE_HEIGHT + COLOR_PANEL_PAD + COLOR_HEX_ROW + COLOR_PANEL_PAD;
  const { y, flipped } = placeY(trigger, height, viewport, screen);
  const x = fitX(trigger.x, COLOR_PANEL_WIDTH, viewport, screen);
  const sv: Rect = { x: x + COLOR_PANEL_PAD, y: y + COLOR_PANEL_PAD, width: inner, height: COLOR_SV_HEIGHT };
  const hue: Rect = {
    x: x + COLOR_PANEL_PAD,
    y: sv.y + sv.height + COLOR_PANEL_PAD,
    width: inner,
    height: COLOR_HUE_HEIGHT,
  };
  const hexY = hue.y + hue.height + COLOR_PANEL_PAD + COLOR_HEX_ROW / 2;
  return {
    kind: 'color',
    x, y,
    width: COLOR_PANEL_WIDTH,
    height,
    sv, hue, hexY, flipped,
    anchorX: trigger.x + trigger.width / 2,
    anchorY: trigger.y + trigger.height / 2,
    radius: radius + COLOR_PANEL_PAD,
  };
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

export function popoverContains(l: PopoverLayout, x: number, y: number): boolean {
  return rectContains(l, x, y);
}

/**
 * The row under a world point, given the first visible row; -1 when the point is not on a row
 * (in the padding, or outside the panel altogether).
 */
export function selectRowAt(l: SelectPopoverLayout, scroll: number, x: number, y: number): number {
  if (!rectContains(l, x, y)) return -1;
  const localY = y - l.y - POPOVER_PAD;
  if (localY < 0) return -1;
  const i = Math.floor(localY / l.rowHeight);
  if (i >= l.visible) return -1;
  const row = scroll + i;
  return row < l.rows ? row : -1;
}

export function clampScroll(scroll: number, rows: number, visible: number): number {
  return Math.max(0, Math.min(scroll, Math.max(0, rows - visible)));
}

/** The smallest scroll that puts `index` on screen. */
export function scrollToShow(scroll: number, index: number, rows: number, visible: number): number {
  if (index < scroll) return clampScroll(index, rows, visible);
  if (index >= scroll + visible) return clampScroll(index - visible + 1, rows, visible);
  return clampScroll(scroll, rows, visible);
}

export type ColorPart = 'sv' | 'hue' | 'panel' | null;

export function colorPartAt(l: ColorPopoverLayout, x: number, y: number): ColorPart {
  if (rectContains(l.sv, x, y)) return 'sv';
  if (rectContains(l.hue, x, y)) return 'hue';
  if (rectContains(l, x, y)) return 'panel';
  return null;
}

/** Saturation and value from a point, clamped — a drag leaves the square, the value does not. */
export function svAt(l: ColorPopoverLayout, x: number, y: number): [number, number] {
  const s = Math.min(1, Math.max(0, (x - l.sv.x) / l.sv.width));
  const v = 1 - Math.min(1, Math.max(0, (y - l.sv.y) / l.sv.height));
  return [s, v];
}

export function hueAt(l: ColorPopoverLayout, x: number): number {
  return Math.min(1, Math.max(0, (x - l.hue.x) / l.hue.width));
}

/**
 * Which option a typed prefix lands on, starting after `from` and wrapping, or -1.
 * Case-insensitive, the way every platform list matches type-ahead.
 */
export function typeAheadIndex(options: readonly string[], prefix: string, from: number): number {
  if (options.length === 0 || prefix === '') return -1;
  const p = prefix.toLowerCase();
  for (let step = 1; step <= options.length; step++) {
    const i = (from + step) % options.length;
    if (options[i].toLowerCase().startsWith(p)) return i;
  }
  return -1;
}

/** A row's corner is capped at v2's `--radius-3` for the large level; `full` clamps to half a row. */
export const POPOVER_MAX_RADIUS = 12;

/**
 * The one layout call both the renderer and the pointer handlers make, so a panel is pressed
 * exactly where it is drawn. `rowHeight` is the socket layout's widget height; `radius` the
 * control radius (a row is a control), which the layout clamps to half a row.
 */
export function popoverLayoutFor(
  popover: {
    kind: 'select' | 'color';
    box: Rect;
    options: readonly string[];
    value: string;
    widest: number;
  },
  rowHeight: number,
  radius: number,
  textInset: number,
  viewport: Viewport,
  screen: Screen
): PopoverLayout {
  const r = Math.min(radius, rowHeight / 2, POPOVER_MAX_RADIUS + rowHeight);
  return popover.kind === 'select'
    ? layoutSelectPopover(
        popover.box,
        popover.options.length,
        popover.widest,
        rowHeight,
        r,
        textInset,
        popover.options.indexOf(popover.value),
        viewport,
        screen
      )
    : layoutColorPopover(popover.box, Math.min(r, POPOVER_MAX_RADIUS), viewport, screen);
}
