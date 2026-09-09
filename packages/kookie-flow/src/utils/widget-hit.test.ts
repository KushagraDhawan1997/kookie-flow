/**
 * The two rules the hit test has to keep, and the two ways it broke them.
 *
 * A widget is pressed where it is painted, and it is pressed with the value it is SHOWING. The
 * first rule the file already stated; the second it did not keep — it read `entity.data.values`
 * and ignored the store's pending local write, which is the map the GL renderer paints from. So
 * the widget on screen and the widget the press path computed from disagreed for exactly as long
 * as the consumer took to echo a change back, which for a consumer that batches, debounces or
 * never echoes at all is forever.
 */

import { describe, it, expect } from 'vitest';
import { getWidgetAt, sliderValueAt, nextSelectValue, type WidgetHit } from './widget-hit';
import { getWidgetBox } from './widget-geometry';
import { widgetKey, type WidgetOverride } from './widget-values';
import type { ResolvedSocketLayout } from './style-resolver';
import type { Entity, ResolvedWidgetConfig, SocketType } from '../types';

const layout: ResolvedSocketLayout = {
  rowHeight: 40,
  widgetHeight: 32,
  marginTop: 12,
  socketSize: 10,
  padding: 12,
};

const socketTypes: Record<string, SocketType> = {
  boolean: { name: 'Boolean', color: '#000', widget: 'checkbox' },
  number: { name: 'Number', color: '#000', widget: 'slider', min: 0, max: 100 },
  choice: { name: 'Choice', color: '#000', widget: 'select' },
};

function node(inputs: Entity['inputs'], values?: Record<string, unknown>): Entity {
  return {
    id: 'n1',
    type: 'default',
    position: { x: 0, y: 0 },
    data: values ? { values } : {},
    width: 240,
    inputs,
  };
}

/** A point inside the widget box of input `index`, so the hit test cannot miss for geometry. */
function insideWidget(entity: Entity, index: number): { x: number; y: number } {
  const box = getWidgetBox(entity, index, layout);
  if (!box) throw new Error('no widget box — the fixture is wrong, not the code under test');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

describe('getWidgetAt reads the value the renderer paints', () => {
  const checkbox = () =>
    node([{ id: 'on', name: 'On', type: 'boolean', defaultValue: false }], { on: false });

  it('prefers a pending local write over the entity value', () => {
    const entity = checkbox();
    const p = insideWidget(entity, 0);
    // What `emitWidgetChange` records the moment the person presses: the store gets the new value
    // before the consumer has had a chance to echo it into the entity.
    // The baseline is what the entity said when the press happened — `false` here — which is
    // how the override knows the consumer has not answered yet.
    const widgetValues = new Map<string, WidgetOverride>([
      [widgetKey('n1', 'on'), { value: true, baseline: false }],
    ]);

    const hit = getWidgetAt(entity, p.x, p.y, socketTypes, layout, new Set(), widgetValues);
    expect(hit).not.toBeNull();
    expect(hit?.value).toBe(true);
  });

  it('so a second press toggles instead of re-emitting the first value', () => {
    const entity = checkbox();
    const p = insideWidget(entity, 0);
    const widgetValues = new Map<string, WidgetOverride>();
    // What `setWidgetValue` records: the new value, plus what the entity said at that moment.
    const baseline = (entity.data as { values?: Record<string, unknown> }).values?.on;
    const emit = (v: unknown) => widgetValues.set(widgetKey('n1', 'on'), { value: v, baseline });

    // Press once. The consumer does not echo — entity.data.values.on stays false.
    const first = getWidgetAt(entity, p.x, p.y, socketTypes, layout, new Set(), widgetValues);
    emit(!first?.value);
    expect(widgetValues.get(widgetKey('n1', 'on'))?.value).toBe(true);

    // Press again. Reading the entity here gave `false` a second time and emitted `true` again,
    // and the box never unchecked.
    const second = getWidgetAt(entity, p.x, p.y, socketTypes, layout, new Set(), widgetValues);
    emit(!second?.value);
    expect(widgetValues.get(widgetKey('n1', 'on'))?.value).toBe(false);
  });

  it('falls back to the entity value, and retires the local record, once it round-trips', () => {
    // The consumer has now echoed: the entity has moved off the baseline the local write
    // recorded, so the local record is spent whatever it was echoed as.
    const entity = node([{ id: 'on', name: 'On', type: 'boolean' }], { on: true });
    const p = insideWidget(entity, 0);
    const key = widgetKey('n1', 'on');
    const widgetValues = new Map<string, WidgetOverride>([
      [key, { value: true, baseline: false }],
    ]);

    const hit = getWidgetAt(entity, p.x, p.y, socketTypes, layout, new Set(), widgetValues);
    expect(hit?.value).toBe(true);
    expect(widgetValues.has(key)).toBe(false);
  });

  it('advances a select from the pending value, not the stale one', () => {
    const entity = node(
      [{ id: 'mode', name: 'Mode', type: 'choice', options: ['a', 'b', 'c'] }],
      { mode: 'a' }
    );
    const p = insideWidget(entity, 0);
    const widgetValues = new Map<string, WidgetOverride>([
      [widgetKey('n1', 'mode'), { value: 'b', baseline: 'a' }],
    ]);

    const hit = getWidgetAt(entity, p.x, p.y, socketTypes, layout, new Set(), widgetValues);
    expect(hit).not.toBeNull();
    // Reading the entity gave 'a' and this answered 'b' a second time — one option, forever.
    expect(hit && nextSelectValue(hit)).toBe('c');
  });

  it('still answers nothing for a connected input', () => {
    const entity = checkbox();
    const p = insideWidget(entity, 0);
    const connected = new Set(['n1:on:input']);
    expect(
      getWidgetAt(entity, p.x, p.y, socketTypes, layout, connected, new Map())
    ).toBeNull();
  });
});

/** A hit is only a box and a config as far as the slider maths is concerned. */
function sliderHit(config: Partial<ResolvedWidgetConfig>): WidgetHit {
  return {
    entityId: 'n1',
    socketId: 's',
    index: 0,
    box: { x: 0, y: 0, width: 100, height: 32 },
    config: { type: 'slider', ...config },
    value: 0,
  };
}

describe('sliderValueAt clamps to the ordered range', () => {
  it('snaps within an ordinary range', () => {
    const hit = sliderHit({ min: 0, max: 100, step: 10 });
    expect(sliderValueAt(hit, 0)).toBe(0);
    expect(sliderValueAt(hit, 44)).toBe(40);
    expect(sliderValueAt(hit, 100)).toBe(100);
  });

  it('does not freeze a descending range at one value', () => {
    // min above max: the clamp read `Math.min(max, Math.max(min, snapped))`, and since min exceeds
    // everything in range the inner call answered `min` and the outer one `max`, for every pointer
    // position on the track. The grip never moved.
    const hit = sliderHit({ min: 10, max: 0, step: 1 });
    const left = sliderValueAt(hit, 0);
    const middle = sliderValueAt(hit, 50);
    const right = sliderValueAt(hit, 100);
    expect(left).toBe(10);
    expect(middle).toBe(5);
    expect(right).toBe(0);
    expect(new Set([left, middle, right]).size).toBe(3);
  });

  it('keeps every stepped value inside the stated pair, whichever way round it is', () => {
    const hit = sliderHit({ min: 10, max: 0, step: 3 });
    for (let x = 0; x <= 100; x += 5) {
      const v = sliderValueAt(hit, x);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it('snaps relative to min rather than to zero', () => {
    const hit = sliderHit({ min: 1, max: 10, step: 3 });
    expect([1, 4, 7, 10]).toContain(sliderValueAt(hit, 50));
  });
});
