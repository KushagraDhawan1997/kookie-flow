import { describe, it, expect } from 'vitest';
import { createFlowStore } from './store';
import { isEntityHidden, wouldCreateCycle, getParentChain, sortByDepth } from '../utils/grouping';
import type { Entity } from '../types';

/**
 * Regression tests for the three critical store/grouping defects found in the Phase-1 audit.
 *
 * Every one of them survived 149 green unit tests, because until now the only tested file was
 * graph.ts — and graph.ts contributed zero of the audit's 143 findings. These are the cases that
 * would have caught them.
 */

function ent(id: string, x = 0, y = 0): Entity {
  return { id, type: 'default', position: { x, y }, data: {}, width: 200, height: 120 };
}

describe('store reentrancy', () => {
  it('a second store does not break dragging in the first', () => {
    // The drag index and the moved-id channel used to be MODULE-level, and createFlowStore
    // cleared the shared map on construction — so mounting a second <KookieFlow> stopped the
    // first from dragging. Measured before the fix: the first store's entity did not move.
    const a = createFlowStore({ entities: [ent('a1', 10, 10), ent('a2', 300, 10)] });

    // Constructing the second store is the whole hazard.
    const b = createFlowStore({ entities: [ent('b1', 0, 0)] });

    a.getState().updateEntityPositions([{ id: 'a1', position: { x: 55, y: 66 } }]);

    const moved = a.getState().entities.find((e) => e.id === 'a1');
    expect(moved?.position).toEqual({ x: 55, y: 66 });

    // ...and the two stores' moved-id channels are independent.
    expect(Array.from(a.getState().getMovedEntityIds())).toEqual(['a1']);
    expect(Array.from(b.getState().getMovedEntityIds())).toEqual([]);
  });

  it('each store keeps its own moved-id channel across interleaved drags', () => {
    const a = createFlowStore({ entities: [ent('a1')] });
    const b = createFlowStore({ entities: [ent('b1')] });

    a.getState().updateEntityPositions([{ id: 'a1', position: { x: 1, y: 1 } }]);
    b.getState().updateEntityPositions([{ id: 'b1', position: { x: 2, y: 2 } }]);

    expect(Array.from(a.getState().getMovedEntityIds())).toEqual(['a1']);
    expect(Array.from(b.getState().getMovedEntityIds())).toEqual(['b1']);
  });
});

describe('the id index survives every mutation', () => {
  it('deleting then dragging does not fabricate an entity with id undefined', () => {
    // The index was rebuilt only at construction, setEntities and applyEntityChanges. After a
    // delete it pointed past the end of the array, so the drag path spread `undefined` and
    // APPENDED an entity with id === undefined to state.entities.
    const store = createFlowStore({
      entities: [ent('n0'), ent('n1', 300), ent('n2', 600), ent('n3', 900)],
    });

    store.getState().deleteElements({ entityIds: ['n0', 'n1'] });
    store.getState().updateEntityPositions([{ id: 'n3', position: { x: 42, y: 42 } }]);

    const entities = store.getState().entities;
    expect(entities.every((e) => e && typeof e.id === 'string')).toBe(true);
    expect(entities).toHaveLength(2);
    expect(entities.find((e) => e.id === 'n3')?.position).toEqual({ x: 42, y: 42 });
    // The entity that was NOT dragged must not have moved — a stale in-bounds index writes to the
    // wrong slot, which this catches and a length check would not.
    expect(entities.find((e) => e.id === 'n2')?.position).toEqual({ x: 600, y: 0 });
  });

  it('adding then dragging moves the right entity', () => {
    const store = createFlowStore({ entities: [ent('n0'), ent('n1', 300)] });
    store.getState().addElements({ entities: [ent('n2', 600)], edges: [] });
    store.getState().updateEntityPositions([{ id: 'n0', position: { x: 7, y: 8 } }]);

    const entities = store.getState().entities;
    expect(entities).toHaveLength(3);
    expect(entities.find((e) => e.id === 'n0')?.position).toEqual({ x: 7, y: 8 });
    expect(entities.find((e) => e.id === 'n1')?.position).toEqual({ x: 300, y: 0 });
    expect(entities.find((e) => e.id === 'n2')?.position).toEqual({ x: 600, y: 0 });
  });

  it('dimension updates after a delete land on the right entity', () => {
    const store = createFlowStore({ entities: [ent('n0'), ent('n1', 300), ent('n2', 600)] });
    store.getState().deleteElements({ entityIds: ['n0'] });
    store.getState().updateEntityDimensions('n2', 321, 123);

    const n2 = store.getState().entities.find((e) => e.id === 'n2');
    const n1 = store.getState().entities.find((e) => e.id === 'n1');
    expect(n2?.width).toBe(321);
    expect(n1?.width).toBe(200);
  });
});

describe('parent-chain walks terminate on a cycle', () => {
  // A cycle can be set through the public setEntities / applyEntityChanges({type:'parent'}),
  // neither of which guards. Every walker used an unbounded while loop, so one bad document
  // hung the tab — isEntityHidden runs for every entity inside rebuildDerivedState, which runs
  // on every entity change. These tests hang (not fail) against the pre-fix code.
  const cyclic = () => {
    const a = { ...ent('a'), parentId: 'b' };
    const b = { ...ent('b'), parentId: 'c' };
    const c = { ...ent('c'), parentId: 'a' };
    const map = new Map<string, Entity>([
      ['a', a],
      ['b', b],
      ['c', c],
    ]);
    return { a, b, c, map };
  };

  it('isEntityHidden returns instead of spinning', () => {
    const { a, map } = cyclic();
    expect(isEntityHidden(a, map, new Set())).toBe(false);
    expect(isEntityHidden(a, map, new Set(['c']))).toBe(true);
  });

  it('wouldCreateCycle terminates on a PRE-EXISTING cycle', () => {
    const { map } = cyclic();
    // The old guard only detected a cycle it was about to create; it hung on one already there.
    expect(wouldCreateCycle('zz', 'a', map)).toBe(false);
    expect(wouldCreateCycle('a', 'b', map)).toBe(true);
  });

  it('getParentChain stops rather than growing forever', () => {
    const { a, map } = cyclic();
    const chain = getParentChain(a, map);
    expect(chain.length).toBeLessThanOrEqual(3);
    expect(new Set(chain.map((e) => e.id)).size).toBe(chain.length);
  });

  it('sortByDepth does not blow the stack on a cycle', () => {
    const { a, b, c, map } = cyclic();
    const sorted = sortByDepth([a, b, c], map);
    expect(sorted).toHaveLength(3);
  });

  it('a store built from a cyclic document still constructs', () => {
    // rebuildDerivedState calls isEntityHidden for every entity, so this is the real-world shape.
    const store = createFlowStore({
      entities: [
        { ...ent('a'), parentId: 'b' },
        { ...ent('b'), parentId: 'a' },
      ],
    });
    expect(store.getState().entities).toHaveLength(2);
  });
});
