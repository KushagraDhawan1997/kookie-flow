/**
 * A sticky note's colours, mixed from one hue against the theme.
 *
 * A note used to be a hardcoded Material yellow (#FFF9C4) with grey ink: right on a white page, a
 * glaring pastel slab on a dark one, and the same pastel whatever the theme said. v2 ships no full
 * hue scales to borrow — there is no --yellow-3 to ask for — but every hue keeps a frozen step 9,
 * and step 9 is drawn the same in light and dark. So the hue is the one fixed input and the THEME
 * does the appearance: the fill is the hue sunk into --color-page, the ink the hue sunk into
 * --color-text, both resolved by the browser. A theme flip repaints every note with no work here.
 *
 * Shared by the WebGL note renderer and the note colour control (toolbar.tsx), so a
 * swatch in the control is the colour the note is actually drawn in.
 */

import { frozenHue } from '../core/palette';
import type { AccentColor } from '../types/index';

/** A sticky note is yellow unless it says otherwise. */
export const DEFAULT_NOTE_HUE: AccentColor = 'yellow';

/** The hues the note colour control offers, in the order it lists them. */
export const NOTE_HUES: readonly { hue: AccentColor; label: string }[] = [
  { hue: 'yellow', label: 'Yellow' },
  { hue: 'orange', label: 'Orange' },
  { hue: 'red', label: 'Red' },
  { hue: 'pink', label: 'Pink' },
  { hue: 'violet', label: 'Violet' },
  { hue: 'blue', label: 'Blue' },
  { hue: 'cyan', label: 'Cyan' },
  { hue: 'green', label: 'Green' },
  { hue: 'gray', label: 'Grey' },
];

/** A note's ink for one hue, as CSS strings. */
export interface NoteInk {
  fill: string;
  edge: string;
  text: string;
}

const NOTE_INK = new Map<string, NoteInk>();

/**
 * The fill, hairline and text for a hue. Built once per hue and cached: the note paint path runs
 * on every frame of a pan, and a template string there would allocate per note per frame.
 */
export function noteInk(hue: string): NoteInk {
  const cached = NOTE_INK.get(hue);
  if (cached) return cached;
  // Grey has no frozen step: v2 ships its neutral scale, so that one is a live token.
  const base =
    hue === 'gray'
      ? 'var(--neutral-9)'
      : (frozenHue(`--${hue}-9`, 'light') ??
        frozenHue(`--${DEFAULT_NOTE_HUE}-9`, 'light') ??
        '#ffe629');
  const ink: NoteInk = {
    fill: `color-mix(in oklab, ${base} 22%, var(--color-page, #ffffff))`,
    edge: `color-mix(in oklab, ${base} 40%, transparent)`,
    text: `color-mix(in oklab, ${base} 18%, var(--color-text, #1e1f20))`,
  };
  NOTE_INK.set(hue, ink);
  return ink;
}

/** The hue a note is drawn in: its own, else its entity's, else yellow. */
export function noteHue(dataColor: string | undefined, entityColor: string | undefined): string {
  return dataColor ?? entityColor ?? DEFAULT_NOTE_HUE;
}
