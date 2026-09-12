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
import { getWidgetAt, getWidgetSocketIdAt, sliderValueAt, type WidgetHit } from './widget-hit';
import { SLIDER_READOUT_RESERVE } from './widget-geometry';
import { getWidgetBox } from './widget-geometry';
import { widgetKey, type WidgetOverride } from './widget-values';
import type { ResolvedSocketLayout } from './style-resolver';
import type { Entity, ResolvedWidgetConfig, SocketType } from '../types';

const layout: ResolvedSocketLayout = {
  rowHeight: 40,
  widgetHeight: 32,
  marginTop: 12,
  titleBand: 0, // these fixtures are the no-title layout: marginTop === padding
  socketSize: 10,
  padding: 12,
  borderWidth: 1,
  markSize: 20,
  trackHeight: 4,
  listRowHeight: 30,
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

  it('hands a select the pending option, not the stale one', () => {
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
    // This used to be asserted through `nextSelectValue`, which no longer exists — a press now
    // opens a list rather than advancing one step, so the hit's own value is what the borrowed
    // `<select>` is seeded from. Reading the entity here gave 'a', so the list would have opened
    // with the wrong option showing as chosen for as long as the consumer took to echo.
    expect(hit?.value).toBe('b');
    expect(hit?.config.options).toEqual(['a', 'b', 'c']);
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
    socketName: 'S',
    index: 0,
    // The TRACK is 100 wide; the box also holds the readout's reserve past it.
    box: { x: 0, y: 0, width: 100 + SLIDER_READOUT_RESERVE, height: 32 },
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

/**
 * The hover test and the press test are ONE arithmetic, and this is what says so.
 *
 * `getWidgetSocketIdAt` exists because the press path's `getWidgetAt` allocates — a box per
 * candidate socket and a hit object per answer — and the hover path runs on every pointermove. The
 * cheap version therefore reads the box through `readWidgetBoxInto`, the scratch spelling of the
 * same function `getWidgetAt` calls. Two spellings of one rectangle is exactly the shape that put
 * a socket dot 40px from anything that would answer a press, so the agreement is pinned here
 * rather than left to whoever edits one of them next.
 *
 * A grid, not three chosen points: the interesting failures are at the edges — the gap between two
 * widget rows, the label gutter to the left of a box, the padding at the right — and a law that
 * sampled centres would agree in exactly the places where nothing can go wrong.
 */
describe('the hover test and the press test agree everywhere', () => {
  const mixed = () =>
    node([
      { id: 'label', name: 'Label', type: 'string' },
      { id: 'amount', name: 'Amount', type: 'number' },
      { id: 'on', name: 'On', type: 'boolean' },
    ]);
  const types: Record<string, SocketType> = {
    ...socketTypes,
    string: { name: 'String', color: '#000', widget: 'text' },
  };

  it('answers the same socket at every point on a grid across the node', () => {
    const entity = mixed();
    let insideCount = 0;
    let outsideCount = 0;
    for (let x = -20; x <= 280; x += 7) {
      for (let y = -20; y <= 200; y += 5) {
        const hit = getWidgetAt(entity, x, y, types, layout, new Set(), new Map());
        const id = getWidgetSocketIdAt(entity, x, y, types, layout, new Set());
        expect(id).toBe(hit?.socketId ?? null);
        if (id === null) outsideCount++;
        else insideCount++;
      }
    }
    // Vacuity guard: a grid that never landed on a widget, or never landed off one, would agree
    // trivially. Both sides of the boundary have to be sampled for the agreement to mean anything.
    expect(insideCount).toBeGreaterThan(50);
    expect(outsideCount).toBeGreaterThan(50);
  });

  it('reports every one of the three sockets somewhere on that grid', () => {
    // The other half of the vacuity guard: agreement on a fixture where only the first widget is
    // ever reachable would say nothing about the loop that walks the rest.
    const entity = mixed();
    const seen = new Set<string>();
    for (let x = -20; x <= 280; x += 7) {
      for (let y = -20; y <= 200; y += 5) {
        const id = getWidgetSocketIdAt(entity, x, y, types, layout, new Set());
        if (id) seen.add(id);
      }
    }
    expect([...seen].sort()).toEqual(['amount', 'label', 'on']);
  });

  it('skips a connected input, exactly as the press path does', () => {
    // A connected socket has no widget — its value comes down the edge — so hovering one must not
    // light a control that a press would refuse to answer.
    const entity = mixed();
    const p = insideWidget(entity, 1);
    const connected = new Set(['n1:amount:input']);
    expect(getWidgetSocketIdAt(entity, p.x, p.y, types, layout, connected)).toBeNull();
    expect(getWidgetSocketIdAt(entity, p.x, p.y, types, layout, new Set())).toBe('amount');
  });

  it('skips a socket whose type resolves no widget', () => {
    const entity = node([{ id: 'passthrough', name: 'Pass', type: 'opaque' }]);
    const p = insideWidget(entity, 0);
    // `opaque` is not in the map, so nothing resolves a widget for it.
    expect(getWidgetSocketIdAt(entity, p.x, p.y, types, layout, new Set())).toBeNull();
    // And the fixture is otherwise a hit: the same point on a socket that DOES resolve one answers.
    const withWidget = node([{ id: 'passthrough', name: 'Pass', type: 'string' }]);
    expect(getWidgetSocketIdAt(withWidget, p.x, p.y, types, layout, new Set())).toBe('passthrough');
  });

  it('answers null for an entity with no inputs at all', () => {
    expect(getWidgetSocketIdAt(node(undefined), 50, 50, types, layout, new Set())).toBeNull();
  });
});

describe('a hit carries the socket name the GL layer paints', () => {
  it('reports socket.name, not socket.id', () => {
    // The borrowed DOM input names itself from this. It used to name itself `socketId` — the
    // consumer's internal key — so a screen reader announced 'amt' where the screen said 'Amount'.
    const entity = node([{ id: 'amt', name: 'Amount', type: 'number' }], { amt: 5 });
    const p = insideWidget(entity, 0);
    const hit = getWidgetAt(entity, p.x, p.y, socketTypes, layout, new Set(), new Map());
    expect(hit?.socketName).toBe('Amount');
    expect(hit?.socketId).toBe('amt');
  });
});
