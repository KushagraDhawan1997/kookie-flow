import { describe, it, expect } from 'vitest';
import {
  formatWidgetNumber,
  widgetValueText,
  WIDGET_VALUE_MIN_ZOOM,
  MIN_WIDGET_ZOOM,
  PAD,
} from './widget-text';
import type { WidgetBox } from './widget-geometry';
import type { ResolvedWidgetConfig, WidgetType } from '../types';

/**
 * The whole of "what does a widget print" lives in one pure function, so this is where the
 * decisions are pinned: which kinds print nothing and why, where a value sits in its box, and what
 * a number reads as. Every case here is one the GL layer cannot check — it has no glyph the DOM
 * can see — and several of them are the difference between a readable field and '[object Object]'
 * or '0.5000000000000001' painted across a 120px well.
 */

const BOX: WidgetBox = { x: 100, y: 50, width: 120, height: 32 };
// Imported, never restated: a private copy of the number this file exists to protect would keep
// passing after the real one moved. The inset is theme-resolved now (`--control-px-pill-N`) and
// `widgetValueText` defaults to this when a caller has no theme.

function config(type: WidgetType, extra: Partial<ResolvedWidgetConfig> = {}): ResolvedWidgetConfig {
  return { type, ...extra };
}

describe('formatWidgetNumber', () => {
  it('takes its decimals from the step, so float arithmetic does not leak into the readout', () => {
    // 5 * 0.1 is 0.5000000000000001. Printed raw that is nineteen glyphs of noise in a batch
    // whose whole cost is glyph count, and it is not what the slider is doing.
    expect(formatWidgetNumber(5 * 0.1, 0.1)).toBe('0.5');
    expect(formatWidgetNumber(0.30000000000000004, 0.01)).toBe('0.30');
  });

  it('prints an integer step without a decimal point', () => {
    expect(formatWidgetNumber(3, 1)).toBe('3');
    expect(formatWidgetNumber(3.4, 1)).toBe('3');
  });

  it('follows the step down to three decimals', () => {
    expect(formatWidgetNumber(0.125, 0.001)).toBe('0.125');
  });

  it('stops at four decimals, however fine the step', () => {
    // A step this small is being dragged, not read, and a wider readout does not fit any box.
    expect(formatWidgetNumber(0.123456789, 0.0000001)).toBe('0.1235');
  });

  it('with no step, prints integers whole and everything else at two decimals', () => {
    expect(formatWidgetNumber(3)).toBe('3');
    expect(formatWidgetNumber(1 / 3)).toBe('0.33');
  });

  it('ignores a step that cannot describe decimals', () => {
    expect(formatWidgetNumber(2.5, 0)).toBe('2.50');
    expect(formatWidgetNumber(2.5, Number.NaN)).toBe('2.50');
    expect(formatWidgetNumber(2.5, -1)).toBe('2.50');
  });
});

describe('widgetValueText: what prints nothing', () => {
  it('prints nothing for a checkbox — the tick is the value', () => {
    expect(widgetValueText(config('checkbox'), true, BOX)).toBeNull();
    expect(widgetValueText(config('checkbox'), false, BOX)).toBeNull();
  });

  it('prints nothing for a colour — the swatch fills the whole box', () => {
    expect(widgetValueText(config('color'), '#8e4ec6', BOX)).toBeNull();
  });

  it('prints nothing when the consumer supplied the component, whatever its type', () => {
    // The consumer's own control is mounted as real DOM over this box and prints its own value.
    // Glyphs underneath would double-print it, in a font and a place they did not choose.
    const custom = config('text', { customComponent: () => null });
    expect(widgetValueText(custom, 'hello', BOX)).toBeNull();
  });

  it('prints nothing for an empty field with no placeholder', () => {
    expect(widgetValueText(config('text'), '', BOX)).toBeNull();
    expect(widgetValueText(config('text'), undefined, BOX)).toBeNull();
    expect(widgetValueText(config('text'), null, BOX)).toBeNull();
  });

  it('prints nothing rather than [object Object] when a value is not a primitive', () => {
    expect(widgetValueText(config('text'), { a: 1 }, BOX)).toBeNull();
    expect(widgetValueText(config('text'), [1, 2], BOX)).toBeNull();
  });

  it('prints nothing for a slider whose value is not a number', () => {
    // 'NaN' painted on a track is worse than an unlabelled track.
    expect(widgetValueText(config('slider'), 'nonsense', BOX)).toBeNull();
    expect(widgetValueText(config('slider'), undefined, BOX)).toBeNull();
  });
});

describe('widgetValueText: where the value sits', () => {
  it('puts a field value at the box padding, in content ink, with the full inner width', () => {
    const placed = widgetValueText(config('text'), 'hello', BOX);
    expect(placed).toEqual({
      text: 'hello',
      x: BOX.x + PAD,
      anchor: 'left',
      muted: false,
      maxWidth: BOX.width - PAD * 2,
    });
  });

  it('falls back to the placeholder, muted, when a field is empty', () => {
    const placed = widgetValueText(config('text', { placeholder: 'Name' }), '', BOX);
    expect(placed?.text).toBe('Name');
    expect(placed?.muted).toBe(true);
  });

  it('prints a select right of the chevron the shader draws', () => {
    const c = config('select', { options: ['one', 'two'] });
    const placed = widgetValueText(c, 'two', BOX);
    expect(placed?.text).toBe('two');
    expect(placed?.muted).toBe(false);
    // Twenty world units of the trailing edge belong to the chevron; text that ran under it would
    // read as the option name with a stray arrow through its last letter.
    expect(placed?.maxWidth).toBe(BOX.width - PAD * 2 - 20);
  });

  it('shows a select with nothing chosen as its placeholder, muted', () => {
    const c = config('select', { options: ['one'], placeholder: 'Pick one' });
    expect(widgetValueText(c, '', BOX)?.text).toBe('Pick one');
    expect(widgetValueText(c, '', BOX)?.muted).toBe(true);
    expect(widgetValueText(c, undefined, BOX)?.muted).toBe(true);
    // With no placeholder configured it still says something: a chevron over an empty well says
    // nothing at all about there being options behind it.
    expect(widgetValueText(config('select'), undefined, BOX)?.text).toBe('Select…');
  });

  it('right-aligns a slider readout at the inner trailing edge', () => {
    // The socket's name owns the gutter left of the box, so the trailing end is the only free
    // space in the row — and a fixed side means the number does not jump as the fill crosses it.
    const placed = widgetValueText(config('slider', { min: 0, max: 1, step: 0.01 }), 0.25, BOX);
    expect(placed).toEqual({
      text: '0.25',
      x: BOX.x + BOX.width - PAD,
      anchor: 'right',
      muted: false,
      maxWidth: BOX.width * 0.5,
    });
  });

  it('formats a number widget by its own step', () => {
    expect(widgetValueText(config('number', { step: 1 }), 7, BOX)?.text).toBe('7');
    expect(widgetValueText(config('number', { step: 0.5 }), 7, BOX)?.text).toBe('7.0');
  });

  it('reads a numeric string, which is what a borrowed input hands back', () => {
    expect(widgetValueText(config('number', { step: 1 }), '42', BOX)?.text).toBe('42');
    expect(widgetValueText(config('slider', { step: 0.1 }), '0.5', BOX)?.text).toBe('0.5');
  });

  it('cuts a textarea at its first line break', () => {
    // `layoutText` has no newline handling: it skips the glyph it cannot find and lays the second
    // line straight along the first, on top of it.
    const placed = widgetValueText(config('textarea'), 'line one\nline two', BOX);
    expect(placed?.text).toBe('line one…');
  });

  it('prints nothing when the box has no room inside its padding', () => {
    // A widget squeezed by a narrow entity: twelve units of padding and nothing between them.
    const narrow: WidgetBox = { x: 0, y: 0, width: 10, height: 32 };
    expect(widgetValueText(config('text'), 'hello', narrow)).toBeNull();
  });
});

describe('the two zoom floors', () => {
  it('never lets a value print below the zoom its chrome stops drawing at', () => {
    // Below MIN_WIDGET_ZOOM widgets-gl sets mesh.count = 0. A lower value floor would leave
    // readouts floating over rows with no wells under them.
    expect(WIDGET_VALUE_MIN_ZOOM).toBeGreaterThanOrEqual(MIN_WIDGET_ZOOM);
  });
});
