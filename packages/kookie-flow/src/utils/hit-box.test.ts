import { describe, it, expect } from 'vitest';
import { isPointInEntity, getEntityAtPosition, getEntitiesInBox } from './geometry';
import { getEntitySocketLayout } from './socket-layout-cache';
import type { Entity } from '../types';
import type { ResolvedSocketLayout } from './style-resolver';

/**
 * The public hit box is the box that gets drawn.
 *
 * `isPointInEntity`, `getEntityAtPosition` and `getEntitiesInBox` are exported for consumers —
 * `useContextMenu`'s own documentation points at the second one — and all three assumed
 * `DEFAULT_ENTITY_HEIGHT` (100) for an entity that states no height, while the renderer draws it at
 * its computed height. For an ordinary three-socket node that is 144, so the bottom 44px of the
 * visible box was not part of the box these reported.
 *
 * The app itself was never affected: its hit testing goes through the quadtree, and
 * `getEntityBounds` has taken the layout since it was written. This is the published helper being
 * wrong in a way only a consumer would meet, which is the kind of defect that gets reported as
 * "your library's click detection is off" and is hard to believe from inside.
 *
 * These assert against a height derived from the LAYOUT, not against 144, so a legitimate change
 * to the row metrics does not fail them for the wrong reason. What is pinned is the relationship:
 * with the layout the hit box is the drawn box, and without it, it is not.
 */

const LAYOUT: ResolvedSocketLayout = {
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

/** No width, no height — the shape whose drawn size is computed rather than stated. */
function unsized(id = 'e1'): Entity {
  return {
    id,
    type: 'default',
    position: { x: 100, y: 100 },
    data: {},
    inputs: [
      { id: 'in-0', name: 'In 0', type: 'float' },
      { id: 'in-1', name: 'In 1', type: 'float' },
    ],
    outputs: [{ id: 'out-0', name: 'Out 0', type: 'float' }],
  };
}

const drawnHeight = (e: Entity) => getEntitySocketLayout(e, LAYOUT).computedHeight;

describe('the public hit box matches the drawn box', () => {
  it('the fixture is actually taller than the default', () => {
    // Vacuity guard. If the computed height happened to be 100, every assertion below would hold
    // under both the fixed and the broken implementation.
    expect(drawnHeight(unsized())).toBeGreaterThan(100);
  });

  it('a point in the lower part of a drawn entity is inside it', () => {
    const e = unsized();
    // Two thirds of the way down the box a user can see, which was outside the reported box.
    const y = e.position.y + drawnHeight(e) * 0.9;
    expect(isPointInEntity({ x: e.position.x + 50, y }, e, LAYOUT)).toBe(true);
  });

  it('without a layout it still answers the old way', () => {
    // The parameter is optional because omitting it is the published behaviour. Stating that here
    // means a change to the default path fails loudly instead of silently.
    const e = unsized();
    const y = e.position.y + drawnHeight(e) * 0.9;
    expect(isPointInEntity({ x: e.position.x + 50, y }, e)).toBe(false);
  });

  it('a point below the drawn box is still outside it', () => {
    // The guard against over-fixing: a hit box that answers true everywhere would pass the law
    // above.
    const e = unsized();
    const y = e.position.y + drawnHeight(e) + 5;
    expect(isPointInEntity({ x: e.position.x + 50, y }, e, LAYOUT)).toBe(false);
  });

  it('getEntityAtPosition finds an entity by its drawn box', () => {
    const e = unsized();
    const y = e.position.y + drawnHeight(e) * 0.9;
    expect(getEntityAtPosition({ x: e.position.x + 50, y }, [e], LAYOUT)?.id).toBe('e1');
    expect(getEntityAtPosition({ x: e.position.x + 50, y }, [e])).toBeNull();
  });

  it('box selection reaches an entity by its drawn box alone', () => {
    // A marquee dragged across the strip that is drawn but not reported: with the layout it
    // selects, without it, it does not.
    const e = unsized();
    const top = e.position.y + 110;
    const bottom = e.position.y + drawnHeight(e) - 1;
    expect(bottom).toBeGreaterThan(top);
    const start = { x: e.position.x + 10, y: top };
    const end = { x: e.position.x + 60, y: bottom };
    expect(getEntitiesInBox(start, end, [e], LAYOUT).map((x) => x.id)).toEqual(['e1']);
    expect(getEntitiesInBox(start, end, [e])).toEqual([]);
  });
});
