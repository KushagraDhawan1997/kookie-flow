/**
 * What a widget's value READS AS, and where in its box that reading sits.
 *
 * THE DEFECT THIS CLOSES. `widgets-gl.tsx` says in its own docstring that "a widget's value and a
 * select's current option are contributed to [the text renderer] rather than re-implemented" — and
 * nothing ever contributed them. The seven DOM controls that used to print their own values were
 * deleted with the migration, and the shader that replaced them draws a well, a track, a tick and a
 * chevron and has no glyph path at all. So a text field showed an empty well, a number field an
 * empty well, a select a chevron with no current option, and a slider a bar with no readout: every
 * value on every node in the graph went dark at once.
 *
 * WHY THE ANSWER IS A PURE FUNCTION HERE rather than a branch inside the collect loop. Text is the
 * expensive half of this layer — every character is an instance in the MSDF batch — so which
 * widgets print, what they print and how wide it may be are decisions worth stating once, in
 * something with no React and no THREE in it that a unit test can interrogate directly. The loop in
 * `text-renderer.tsx` then does one thing: turn a placement into an entry.
 *
 * WHAT DELIBERATELY PRINTS NOTHING, because "show the value" is not the same claim for every kind:
 * a checkbox's tick IS its value, a colour swatch's fill IS its value, and a consumer's own widget
 * component prints its own. Each of those is stated at its branch below, with what it costs.
 */

import { MIN_WIDGET_ZOOM } from './widget-hit';
import type { WidgetBox } from './widget-geometry';
import type { ResolvedWidgetConfig } from '../types';

/**
 * The zoom below which a widget's value stops printing, which is HIGHER than the zoom below which
 * the widget itself stops being drawn.
 *
 * The invariant, asserted in widget-text.test.ts: WIDGET_VALUE_MIN_ZOOM >= MIN_WIDGET_ZOOM. Below
 * the chrome floor `widgets-gl.tsx` sets `mesh.count = 0`, so a lower value floor would leave
 * readouts floating over rows with no wells under them.
 *
 * It is 0.5 rather than 0.4 for two reasons that point the same way. A 12px glyph at 0.4 is 4.8
 * device pixels, which is under what the MSDF atlas resolves into anything a person can read. And
 * low zoom is exactly where the most nodes are on screen — the frame where every extra glyph is
 * multiplied by the largest number of visible widgets — so the cheapest place to stop is also the
 * place the text was least worth drawing.
 */
export const WIDGET_VALUE_MIN_ZOOM = 0.5;

/**
 * The inner padding a value is printed at, and the padding the borrowed input takes
 * (widget-edit-overlay.tsx reads this rather than restating it). Opening an edit must not shift
 * the text sideways.
 */
export const PAD = 6;

/**
 * A well's corner radius, in world px. A fixed number rather than `min(borderRadius, h/2)`: the
 * theme's card radius made every well a pill, and a pill is a chip, not a field. It lives here,
 * beside PAD, because the two readers are the shader (widgets-gl.tsx, which re-exports it) and the
 * borrowed input that clips its caret to the same shape — and the input must not pull three.js
 * into its module graph to learn one number.
 */
export const WIDGET_RADIUS = 8;

/**
 * How much of a select's box the chevron owns. The shader draws it centred at `halfSize.x - 10`
 * spanning ±4 (widgets-gl.tsx), so 20 from the trailing edge clears it with a little air.
 */
const CHEVRON_RESERVE = 20;

/** Where a widget's value goes, in world units, before truncation. */
export interface WidgetTextPlacement {
  /** The string to draw. Never empty — a widget with nothing to say returns null instead. */
  text: string;
  /** World x of the anchor edge. */
  x: number;
  anchor: 'left' | 'right';
  /** True when this is a placeholder rather than a value, and takes the secondary ink. */
  muted: boolean;
  /** World width the text may occupy before it has to be truncated. */
  maxWidth: number;
}

/**
 * A number as a widget prints it.
 *
 * The decimals come from `step` where there is one, so a slider stepping by 0.01 reads "0.25" and
 * one stepping by 1 reads "3" — the same rule a person would infer from dragging it. Without that,
 * float arithmetic prints the truth and not the intent: 5 * 0.1 is 0.5000000000000001, and a
 * readout that wide is both wrong-looking and a dozen extra glyphs in the batch.
 *
 * The decimal count is found by multiplying rather than by `String(step).split('.')` — this runs
 * once per numeric widget per dirty frame, and a split allocates two strings and an array to learn
 * one small integer. `Intl.NumberFormat` is not used for the same reason: it allocates a formatter
 * per call unless one is cached per (step, locale) pair, and locale-aware grouping is not wanted on
 * a 60px readout anyway.
 */
export function formatWidgetNumber(v: number, step?: number): string {
  if (step !== undefined && Number.isFinite(step) && step > 0) {
    let decimals = 0;
    let s = step;
    // Four is the cap: past it the readout is wider than any widget box, and a step that fine is
    // being dragged, not read.
    while (decimals < 4 && Math.abs(Math.round(s) - s) > 1e-9) {
      s *= 10;
      decimals++;
    }
    return v.toFixed(decimals);
  }
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/**
 * A value that can be printed as-is, or null.
 *
 * Widget values are primitives by contract (utils/widget-values.ts says why), but `data.values` is
 * a consumer's own bag and nothing stops an object landing in it. `String({})` is "[object
 * Object]", which is thirteen glyphs of noise printed with complete confidence — so anything that
 * is not a string, a finite number or a boolean prints nothing at all.
 */
function printable(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return String(value);
  return null;
}

/**
 * Where this widget's value should print inside its box, or null if it should not print at all.
 *
 * `box` is the same rectangle `widgets-gl.tsx` draws the chrome into and `widget-hit.ts` presses —
 * one `getWidgetBox`, three readers, which is the rule widget-geometry.ts exists to keep.
 */
export function widgetValueText(
  config: ResolvedWidgetConfig,
  value: unknown,
  box: WidgetBox
): WidgetTextPlacement | null {
  // A consumer's own component is still mounted as real DOM over this box (widgets-layer.tsx) and
  // prints whatever it prints. Drawing glyphs underneath it double-prints the value, at a font and
  // a position the consumer did not choose.
  if (config.customComponent) return null;

  const inner = box.width - PAD * 2;
  if (inner <= 0) return null;

  switch (config.type) {
    // The tick IS the value. The DOM checkbox printed 'True'/'False' beside its 16px box, and that
    // parity is deliberately given up: the readout says nothing the tick does not, and it costs
    // four or five glyphs on every checkbox on every visible node.
    case 'checkbox':
      return null;

    // The swatch IS the value, and it fills the WHOLE box here — the GL widget paints `vTint`
    // across it, where the DOM widget had a 32px swatch with room for a hex string beside it.
    // Printing over an arbitrary user hue would also need per-instance luminance-picked ink to
    // guarantee any contrast at all, which the MSDF batch has no notion of.
    case 'color':
      return null;

    case 'slider': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return null;
      // RIGHT-ALIGNED at the box's inner edge, and constant. The socket's name owns the gutter to
      // the LEFT of the box, so the trailing end is the only free space in the row; the track is
      // at most 4px tall, so a 12px glyph sits mostly on the node body rather than on the bar; and
      // a fixed side means the readout does not jump as the value crosses the middle. It does
      // overlap the grip near a full fill — and that overlap is the most legible pairing in the
      // palette, neutral-12 over the neutral-1 thumb, so it reads rather than smears.
      return {
        text: formatWidgetNumber(n, config.step),
        x: box.x + box.width - PAD,
        anchor: 'right',
        muted: false,
        // Half the box: a readout that could grow across the whole track would cover the fill it
        // is describing.
        maxWidth: box.width * 0.5,
      };
    }

    case 'select': {
      const chosen = typeof value === 'string' && value !== '' ? value : null;
      const text = chosen ?? config.placeholder ?? 'Select…';
      return {
        text,
        x: box.x + PAD,
        anchor: 'left',
        muted: chosen === null,
        maxWidth: Math.max(0, inner - CHEVRON_RESERVE),
      };
    }

    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (value === '' || value === null || value === undefined || !Number.isFinite(n)) {
        return config.placeholder
          ? { text: config.placeholder, x: box.x + PAD, anchor: 'left', muted: true, maxWidth: inner }
          : null;
      }
      return {
        text: formatWidgetNumber(n, config.step),
        x: box.x + PAD,
        anchor: 'left',
        muted: false,
        maxWidth: inner,
      };
    }

    // text, textarea, and the 'text' fallback type resolveWidgetConfig gives an inline component
    // (already returned above, since that config carries a customComponent).
    default: {
      const printed = printable(value);
      if (printed === null || printed === '') {
        // An empty field with no placeholder prints nothing, which is the right cost: zero glyphs
        // for a widget whose whole content is the well the shader already drew.
        return config.placeholder
          ? { text: config.placeholder, x: box.x + PAD, anchor: 'left', muted: true, maxWidth: inner }
          : null;
      }
      // ONE LINE ONLY. `layoutText` has no newline handling — it skips glyphs it cannot find in
      // the atlas — so a textarea's second line would be laid out straight along the first, on
      // top of it. Cut at the break and say so with an ellipsis instead.
      const brk = printed.indexOf('\n');
      const text = brk >= 0 ? `${printed.slice(0, brk)}…` : printed;
      return { text, x: box.x + PAD, anchor: 'left', muted: false, maxWidth: inner };
    }
  }
}

/**
 * Re-exported so a reader of this file can see both floors at once, and so the test that pins
 * their ordering imports them from one place.
 */
export { MIN_WIDGET_ZOOM };
