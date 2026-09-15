/**
 * The value side of the widgets made of parts: a vector's components, a segmented control's
 * options, a seed's roll.
 *
 * Pure numbers, no React and no THREE, for the reason widget-text.ts gives: the press path, the
 * text layer, the renderer, the borrowed input and the accessibility mirror all ask these
 * questions, and five answers to "which component is this" is how a value is drawn in one part
 * and written into another.
 */

import type { ResolvedWidgetConfig } from '../types';

/** The letters a vector's parts wear, in order. */
export const VECTOR_AXES = ['X', 'Y', 'Z', 'W'] as const;

/** A vector's component count: the config's, clamped to 2..4, and 3 when unstated. */
export function vectorDimensions(config: Pick<ResolvedWidgetConfig, 'dimensions'>): number {
  const n = config.dimensions;
  if (n === undefined || !Number.isFinite(n)) return 3;
  return Math.min(4, Math.max(2, Math.round(n)));
}

/**
 * Component `index` of a vector value, or 0.
 *
 * Allocates nothing: the text layer and the renderer read it per part on a dirty frame. A value
 * that is not an array, or a component that is not a finite number, reads as 0 rather than
 * throwing — the same fallback a colour takes for an unparseable hex.
 */
export function vectorComponent(value: unknown, index: number): number {
  if (!Array.isArray(value)) return 0;
  const v: unknown = value[index];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** A fresh array of `n` components, for a write. */
export function vectorComponents(value: unknown, n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = vectorComponent(value, i);
  return out;
}

/** The vector with one component replaced — a new array, since values are compared by content. */
export function withComponent(value: unknown, n: number, index: number, next: number): number[] {
  const out = vectorComponents(value, n);
  if (index >= 0 && index < n) out[index] = next;
  return out;
}

/**
 * How many decimals a step implies, capped at six. The same walk formatWidgetNumber takes, so a
 * scrubbed value prints without float noise.
 */
function decimalsOf(step: number): number {
  let s = step;
  let d = 0;
  while (d < 6 && Math.abs(Math.round(s) - s) > 1e-9) {
    s *= 10;
    d++;
  }
  return d;
}

/**
 * The value a drag of `dxScreen` pixels makes of `start`.
 *
 * SCREEN pixels, not world: a scrub is a gesture in the hand, and zooming out should not make the
 * same flick of the wrist move the number four times as far. One step per pixel, except that a
 * whole-number step takes four — at one per pixel an integer races past what a person meant.
 * Snapped to the step's decimals and clamped to the ordered min/max pair, as sliderValueAt is.
 */
export function scrubValue(
  start: number,
  dxScreen: number,
  step: number | undefined,
  min: number | undefined,
  max: number | undefined
): number {
  const unit = step !== undefined && Number.isFinite(step) && step > 0 ? step : 0.01;
  const pxPerStep = unit >= 1 ? 4 : 1;
  let v = start + Math.round(dxScreen / pxPerStep) * unit;
  v = Number(v.toFixed(decimalsOf(unit)));
  const hasMin = min !== undefined && Number.isFinite(min);
  const hasMax = max !== undefined && Number.isFinite(max);
  if (hasMin && hasMax) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return Math.min(hi, Math.max(lo, v));
  }
  if (hasMin) return Math.max(min, v);
  if (hasMax) return Math.min(max, v);
  return v;
}

/** The largest seed when a config states no max: a signed 32-bit integer, what samplers take. */
export const SEED_MAX = 2147483647;

/** A new seed inside the config's range, inclusive. */
export function randomSeed(min: number | undefined, max: number | undefined, random: () => number = Math.random): number {
  const a = min !== undefined && Number.isFinite(min) ? Math.ceil(min) : 0;
  const b = max !== undefined && Number.isFinite(max) ? Math.floor(max) : SEED_MAX;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo + Math.floor(random() * (hi - lo + 1));
}

/**
 * What an option reads as: its label where the socket gives one, else the value itself. No
 * allocation — a lookup on the record the socket already holds.
 */
export function optionLabel(labels: Record<string, string> | undefined, value: string): string {
  return (labels && Object.prototype.hasOwnProperty.call(labels, value) && labels[value]) || value;
}

/** Which option a segmented value names, or -1. */
export function segmentIndex(options: readonly string[] | undefined, value: unknown): number {
  if (!options || typeof value !== 'string') return -1;
  return options.indexOf(value);
}

/**
 * A vector typed as text — "1, 2.5, 0" — for the accessibility mirror, which has one text input
 * per socket. Commas or whitespace separate; a missing component keeps 0. Null when nothing parses.
 */
export function parseVectorText(text: string, n: number): number[] | null {
  const parts = text.split(/[\s,]+/).filter((p) => p !== '');
  if (parts.length === 0) return null;
  const out = new Array<number>(n).fill(0);
  let any = false;
  for (let i = 0; i < n && i < parts.length; i++) {
    const v = Number(parts[i]);
    if (Number.isFinite(v)) {
      out[i] = v;
      any = true;
    }
  }
  return any ? out : null;
}
