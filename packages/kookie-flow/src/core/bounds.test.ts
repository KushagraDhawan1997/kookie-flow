import { describe, it, expect } from 'vitest';
import { createFlowStore } from './store';
import { computeCollapseToSubgraph, buildAdjacencyIndex } from './graph';
import { calculateGroupBounds } from '../utils/grouping';
import { getEntityBounds } from './spatial';
import type { Entity } from '../types';
import type { ResolvedSocketLayout } from '../utils/style-resolver';

/**
 * A computed box contains the thing it was computed from.
 *
 * `fitView`, `calculateGroupBounds` and `computeCollapseToSubgraph` each measured a width-less,
 * height-less entity as 200x100. The renderer draws it at `DEFAULT_ENTITY_WIDTH` (240) by its
 * computed height (144 for an ordinary three-socket node). So the camera framed a box smaller than
 * its content, an auto-fitted group frame did not contain its own children, and a collapse frame
 * did not contain what it collapsed — 40px short across, 44px short down.
 *
 * THE EXISTING TEST FOR THIS COULD NOT FAIL. `graph.test.ts` asserts the collapse frame's width
 * and height, and its fixture sets `width: 200, height: 100` on every entity — which is exactly
 * the pair of wrong defaults. An explicit size means no default is ever taken, so the assertion
 * passed on both implementations while reading as if it validated them. This is the degenerate
 * fixture that made `graph.ts` contribute zero of the audit's 143 findings at 100% function
 * coverage.
 *
 * These assert CONTAINMENT rather than a number, so they say what the boxes are for and do not
 * have to move when a row metric is tuned.
 */

const LAYOUT: ResolvedSocketLayout = {
  rowHeight: 40,
  widgetHeight: 32,
  marginTop: 12,
  titleBand: 0, // these fixtures are the no-title layout: marginTop === padding
  socketSize: 10,
  padding: 12,
  borderWidth: 1,
};

function unsized(id: string, x: number, y: number, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    type: 'default',
    position: { x, y },
    data: {},
    inputs: [
      { id: 'in-0', name: 'In 0', type: 'float' },
      { id: 'in-1', name: 'In 1', type: 'float' },
    ],
    outputs: [{ id: 'out-0', name: 'Out 0', type: 'float' }],
    ...extra,
  };
}

const drawn = (e: Entity) => getEntityBounds(e, LAYOUT);

describe('computed boxes contain what they were computed from', () => {
  it('the fixture is bigger than the old assumed size', () => {
    // Vacuity guard, and the whole reason the fixture states no size: at 200x100 every assertion
    // below holds under the broken implementation too.
    const b = drawn(unsized('e', 0, 0));
    expect(b.width).toBeGreaterThan(200);
    expect(b.height).toBeGreaterThan(100);
  });

  it('an auto-fitted group frame contains its children', () => {
    const parent: Entity = {
      id: 'frame',
      type: 'frame',
      position: { x: 0, y: 0 },
      data: {},
      width: 10,
      height: 10,
    };
    const child = unsized('child', 100, 100, { parentId: 'frame' });
    const bounds = calculateGroupBounds([parent, child], 'frame', 0, LAYOUT);
    expect(bounds).not.toBeNull();

    const c = drawn(child);
    expect(bounds!.x + bounds!.width).toBeGreaterThanOrEqual(c.x + c.width);
    expect(bounds!.y + bounds!.height).toBeGreaterThanOrEqual(c.y + c.height);
  });

  it('a collapse frame contains what it collapsed', () => {
    const a = unsized('a', 100, 50);
    const b = unsized('b', 400, 200);
    const entities = [a, b];
    const result = computeCollapseToSubgraph(
      ['a', 'b'],
      'frame',
      entities,
      buildAdjacencyIndex([]),
      LAYOUT
    );

    const frame = result.frameEntity;
    for (const e of entities) {
      const box = drawn(e);
      expect(frame.position.x + frame.width).toBeGreaterThanOrEqual(box.x + box.width);
      expect(frame.position.y + frame.height).toBeGreaterThanOrEqual(box.y + box.height);
    }
  });

  it('fitView frames the whole entity, not a box 40px narrower', () => {
    // The user-visible claim: after fitView the entity's far corner is on screen. Asserted through
    // the viewport, because that is the only thing fitView writes.
    //
    // THE CANVAS IS SMALLER THAN THE ENTITY ON PURPOSE, and the first version of this law could
    // not fail because it was not. At 800x600 the fit zoom comes out above 1, `maxZoom` clamps it
    // back to 1, and the centring then leaves ~300px of slack on either side — so a box measured
    // 40px too narrow still lands comfortably on screen and the assertion passes against the
    // broken implementation. Zoom-to-fit is what fitView is for, and it is only when the zoom is
    // what binds that measuring the content wrongly can show.
    const e = unsized('e', 0, 0);
    const store = createFlowStore({ entities: [e] });
    store.getState().setSocketLayout(LAYOUT);
    store.getState().fitView({ padding: 0, maxZoom: 1 }, 120, 80);

    const { x, y, zoom } = store.getState().viewport;
    const box = drawn(store.getState().entityMap.get('e')!);
    const right = (box.x + box.width) * zoom + x;
    const bottom = (box.y + box.height) * zoom + y;

    expect(right).toBeLessThanOrEqual(120 + 0.5);
    expect(bottom).toBeLessThanOrEqual(80 + 0.5);
    // ...and it did not simply zoom out to nothing.
    expect(right).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(0);
  });
});
