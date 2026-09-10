import { describe, it, expect } from 'vitest';
import { createFlowStore } from './store';
import { isEntityHidden, wouldCreateCycle, getParentChain, sortByDepth } from '../utils/grouping';
import { topmostEntityId } from '../utils/entity-depth';
import { readWidgetValue } from '../utils/widget-values';
import { getSocketPosition } from '../utils/geometry';
import type { Entity } from '../types';
import type { ResolvedSocketLayout } from '../utils/style-resolver';

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

/**
 * The connected-socket set, and the direction suffix four readers were asking for and the writer
 * never wrote.
 *
 * `rebuildConnectedSockets` produced `entityId:socketId` while `sockets.tsx` (both directions),
 * `widget-hit.ts` and `widgets-gl.tsx` all looked up `entityId:socketId:input|output`. Those four
 * lookups could never match, so every one of them silently answered "not connected" for the life
 * of the package: a connected input kept its widget drawn AND kept accepting presses, and no
 * socket dot ever rendered connected.
 *
 * Nothing caught it because nothing asserted the key format — the only reader with a matching
 * spelling (`isSocketConnected`) is not called anywhere in the library, so the two-part key had
 * no live consumer to disagree with it.
 */
describe('connected sockets are keyed per direction', () => {
  const wired = () =>
    createFlowStore({
      entities: [
        { ...ent('src'), outputs: [{ id: 'out', name: 'Out', type: 'number' }] },
        { ...ent('dst', 400), inputs: [{ id: 'in', name: 'In', type: 'number' }] },
      ],
      edges: [{ id: 'e1', source: 'src', target: 'dst', sourceSocket: 'out', targetSocket: 'in' }],
    });

  it('records both ends of an edge, each with its own direction', () => {
    const keys = [...wired().getState().connectedSockets].sort();
    expect(keys).toEqual(['dst:in:input', 'src:out:output']);
  });

  it('answers the question the renderer and the hit test actually ask', () => {
    // Spelled here exactly as widgets-gl.tsx:425 and widget-hit.ts:46 spell it. If this ever goes
    // back to a two-part key both of those go quietly false again.
    const connected = wired().getState().connectedSockets;
    expect(connected.has('dst:in:input')).toBe(true);
    expect(connected.has('src:out:output')).toBe(true);
  });

  it('does not mark an input connected because an output of the same id is', () => {
    // Socket ids are scoped per direction, so an entity may legally carry both. Under the old
    // two-part key these were one entry and could not be told apart.
    const store = createFlowStore({
      entities: [
        { ...ent('a'), outputs: [{ id: 'value', name: 'Value', type: 'number' }] },
        {
          ...ent('b', 400),
          inputs: [{ id: 'value', name: 'Value', type: 'number' }],
          outputs: [{ id: 'value', name: 'Value', type: 'number' }],
        },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceSocket: 'value', targetSocket: 'value' }],
    });
    const connected = store.getState().connectedSockets;
    expect(connected.has('b:value:input')).toBe(true);
    // b's OUTPUT has no edge leaving it, and must not inherit the input's state.
    expect(connected.has('b:value:output')).toBe(false);
  });
});

/**
 * The two per-entity maps that no rebuild touches, and the paths that forgot them.
 *
 * `stackOrder` and `widgetValues` are mutated in place and never replaced — that is deliberate,
 * because a drag frame and a slider pointermove must not allocate. The cost of that choice is that
 * every path adding or removing an entity owes them an explicit update, and several did not pay
 * it. `applyEntityChanges` maintained `stackOrder` correctly on both add and remove, which is why
 * nothing noticed: every manual test went through the change API, and the batch API — the one the
 * clipboard, insert-on-edge and the subgraph operations use — went through none of it.
 */
describe('stack order survives the batch APIs', () => {
  const stackOf = (store: ReturnType<typeof createFlowStore>, id: string) =>
    store.getState().stackOrder.get(id);

  it('a pasted entity lands above the entity it was copied from', () => {
    // addElements assigned no index at all, so entity-depth read `stackOrder.get(id) ?? 0` and put
    // the paste at the BOTTOM of the graph: at the default {50,50} paste offset it painted behind
    // the original it overlaps, and topmostEntityId handed a press on the overlap to the original.
    const store = createFlowStore({ entities: [ent('orig', 0, 0)] });
    store.getState().addElements({ entities: [ent('pasted', 50, 50)], edges: [] });

    const original = stackOf(store, 'orig');
    const pasted = stackOf(store, 'pasted');
    expect(original).toBeGreaterThan(0);
    expect(pasted).toBeGreaterThan(original ?? 0);
    expect(topmostEntityId(['orig', 'pasted'], store.getState().stackOrder)).toBe('pasted');
  });

  it('bumps stackVersion so the depth buffers know to rewrite', () => {
    const store = createFlowStore({ entities: [ent('orig')] });
    const before = store.getState().stackVersion;
    store.getState().addElements({ entities: [ent('pasted', 50, 50)], edges: [] });
    expect(store.getState().stackVersion).toBeGreaterThan(before);
  });

  it('deleteElements forgets the entities it deleted', () => {
    // The map grew for the life of the session, and the compaction in bringToFront then renumbered
    // the dead ids too, so they held indices ahead of entities still on screen.
    const store = createFlowStore({ entities: [ent('a'), ent('b', 300), ent('c', 600)] });
    expect(store.getState().stackOrder.size).toBe(3);

    store.getState().deleteElements({ entityIds: ['a', 'b'] });

    expect(store.getState().stackOrder.size).toBe(1);
    expect(stackOf(store, 'a')).toBeUndefined();
    expect(stackOf(store, 'c')).toBeDefined();
  });

  it('a deleted id that comes back does not keep its old place in the stack', () => {
    const store = createFlowStore({ entities: [ent('a'), ent('b', 300)] });
    store.getState().deleteElements({ entityIds: ['a'] });
    // 'a' returns with the same id, the way an undo restores one.
    store.getState().addElements({ entities: [ent('a')], edges: [] });

    // It is the newest thing in the graph, so it is on top — not sitting on the index it had
    // before it was deleted, which is what a surviving entry would have given it.
    expect(topmostEntityId(['a', 'b'], store.getState().stackOrder)).toBe('a');
  });
});

describe('widget overrides are forgotten with their entity', () => {
  const withWidget = (id: string, x = 0): Entity => ({
    ...ent(id, x),
    inputs: [{ id: 'amount', name: 'Amount', type: 'number' }],
    data: { values: { amount: 0.25 } },
  });

  it('deleteElements clears the pending value', () => {
    const store = createFlowStore({ entities: [withWidget('a')] });
    store.getState().setWidgetValue('a', 'amount', 0.8);
    expect(store.getState().widgetValues.get('a:amount')?.value).toBe(0.8);

    store.getState().deleteElements({ entityIds: ['a'] });

    expect(store.getState().widgetValues.has('a:amount')).toBe(false);
  });

  it('a restored entity shows its own value, not the one left behind by the deleted id', () => {
    const store = createFlowStore({ entities: [withWidget('a')] });
    store.getState().setWidgetValue('a', 'amount', 0.8);
    store.getState().deleteElements({ entityIds: ['a'] });
    // Undo: the snapshot restores ids verbatim.
    store.getState().addElements({ entities: [withWidget('a')], edges: [] });

    const restored = store.getState().entityMap.get('a');
    const values = restored?.data.values;
    const incoming =
      typeof values === 'object' && values !== null && !Array.isArray(values)
        ? (values as Record<string, unknown>).amount
        : undefined;
    expect(readWidgetValue(store.getState().widgetValues, 'a:amount', incoming)).toBe(0.25);
  });

  it('applyEntityChanges remove clears it too', () => {
    const store = createFlowStore({ entities: [withWidget('a')] });
    store.getState().setWidgetValue('a', 'amount', 0.8);
    const before = store.getState().widgetValuesVersion;

    store.getState().applyEntityChanges([{ type: 'remove', id: 'a' }]);

    expect(store.getState().widgetValues.has('a:amount')).toBe(false);
    expect(store.getState().widgetValuesVersion).toBeGreaterThan(before);
  });

  it('setEntities reconciles away overrides for entities the new array does not contain', () => {
    const store = createFlowStore({ entities: [withWidget('a'), withWidget('b', 300)] });
    store.getState().setWidgetValue('a', 'amount', 0.8);
    store.getState().setWidgetValue('b', 'amount', 0.9);

    store.getState().setEntities([withWidget('b', 300)]);

    expect(store.getState().widgetValues.has('a:amount')).toBe(false);
    // 'b' is still here, so its in-flight value must survive — a reconcile that clears everything
    // would break every consumer that batches its echo.
    expect(store.getState().widgetValues.get('b:amount')?.value).toBe(0.9);
  });

  it('toObject saves what the canvas is showing', () => {
    // In an uncontrolled graph nothing echoes, so the local value is the only copy there is.
    // toObject read `entities` alone, so the save carried 0.25 while the slider showed 0.8.
    const store = createFlowStore({ entities: [withWidget('a'), ent('plain', 300)] });
    store.getState().setWidgetValue('a', 'amount', 0.8);

    const saved = store.getState().toObject();
    const savedA = saved.entities.find((e) => e.id === 'a');
    expect((savedA?.data.values as Record<string, unknown>).amount).toBe(0.8);
    // The store itself is untouched: a save reads, and retiring the local record is the paint's
    // job (readWidgetValue), not this one's.
    expect(store.getState().widgetValues.get('a:amount')?.value).toBe(0.8);
    // An entity with nothing pending is handed back by reference, not copied.
    expect(saved.entities.find((e) => e.id === 'plain')).toBe(
      store.getState().entities.find((e) => e.id === 'plain')
    );
  });
});

/**
 * `fitEntityToContent` is a resize, and it has to finish like one.
 *
 * It set `entities` and updated the entity quadtree, then stopped: the socket index still held the
 * sockets where the old width had put them, and `positionVersion` did not move, so the edges layer
 * — which watches that counter and the entity count and nothing else — never redrew.
 */
describe('fitEntityToContent finishes the resize', () => {
  const LAYOUT: ResolvedSocketLayout = {
    rowHeight: 40,
    widgetHeight: 32,
    marginTop: 12,
    socketSize: 10,
    padding: 12,
    borderWidth: 1,
  };

  const sized = (): Entity => ({
    ...ent('n', 100, 100),
    width: 600,
    height: 300,
    inputs: [{ id: 'in', name: 'In', type: 'number' }],
    outputs: [{ id: 'out', name: 'Out', type: 'number' }],
  });

  /** Where the index thinks a socket is, found by sweeping wide enough to catch a stale entry. */
  const indexedX = (store: ReturnType<typeof createFlowStore>, isInput: boolean): number | null => {
    const entity = store.getState().entityMap.get('n');
    if (!entity) return null;
    const painted = getSocketPosition(entity, isInput ? 'in' : 'out', isInput, LAYOUT);
    if (!painted) return null;
    const hit = store
      .getState()
      .socketQuadtree.queryPoint(painted.x, painted.y, 2000, [])
      .find((s) => s.entityId === 'n' && s.isInput === isInput);
    return hit ? hit.x : null;
  };

  it('moves the output socket to where the fitted width paints it', () => {
    const store = createFlowStore({ entities: [sized()], socketLayout: LAYOUT });
    const wideOutputX = indexedX(store, false);

    store.getState().fitEntityToContent('n');

    const fitted = store.getState().entityMap.get('n');
    expect(fitted?.width).toBeUndefined();
    const painted = fitted ? getSocketPosition(fitted, 'out', false, LAYOUT) : null;
    expect(painted).not.toBeNull();
    // The fit shrank the entity, so the output moved left. If the index had not been updated it
    // would still be at the 600-wide x, which this compares against explicitly.
    expect(indexedX(store, false)).toBe(painted?.x);
    expect(indexedX(store, false)).not.toBe(wideOutputX);
  });

  it('bumps positionVersion so the edges layer redraws', () => {
    const store = createFlowStore({ entities: [sized()], socketLayout: LAYOUT });
    const before = store.getState().positionVersion;
    store.getState().fitEntityToContent('n');
    expect(store.getState().positionVersion).toBeGreaterThan(before);
  });
});

/**
 * The socket layout the store is built with.
 *
 * `createFlowStore` built both quadtrees from default row heights, then the mount effect in
 * kookie-flow.tsx called `setSocketLayout`, which saw `socketLayout === null`, could not take its
 * value-equality skip, and built them both again — the first pass' every socket offset and every
 * entity bound thrown away, having been computed from the wrong numbers.
 */
describe('the store can be built with the socket layout it will use', () => {
  const LAYOUT: ResolvedSocketLayout = {
    rowHeight: 40,
    widgetHeight: 32,
    marginTop: 12,
    socketSize: 10,
    padding: 12,
    borderWidth: 1,
  };

  const socketed = (): Entity => ({
    ...ent('n', 0, 0),
    width: undefined,
    height: undefined,
    inputs: [
      { id: 'in-0', name: 'A', type: 'number' },
      { id: 'in-1', name: 'B', type: 'number' },
    ],
    outputs: [{ id: 'out', name: 'Out', type: 'number' }],
  });

  it('the first build already uses it, so the mount sync has nothing to redo', () => {
    const store = createFlowStore({ entities: [socketed()], socketLayout: LAYOUT });
    const { quadtree, socketQuadtree } = store.getState();

    // The same layout arriving from the mount effect is a no-op: the derived state it would have
    // produced is the derived state already there, so the identical objects survive.
    store.getState().setSocketLayout(LAYOUT);

    expect(store.getState().quadtree).toBe(quadtree);
    expect(store.getState().socketQuadtree).toBe(socketQuadtree);
  });

  it('a genuinely different layout still rebuilds', () => {
    // The skip must be by value, not "we already have one" — otherwise a theme change would never
    // reach the quadtrees.
    const store = createFlowStore({ entities: [socketed()], socketLayout: LAYOUT });
    const before = store.getState().socketQuadtree;

    store.getState().setSocketLayout({ ...LAYOUT, rowHeight: 64 });

    expect(store.getState().socketQuadtree).not.toBe(before);
  });

  it('the seeded build holds sockets where the layout paints them', () => {
    // Sabotaging the seed (dropping it back to undefined) puts the index on default row heights
    // while getSocketPosition uses LAYOUT, and these two y values come apart.
    const store = createFlowStore({ entities: [socketed()], socketLayout: LAYOUT });
    const entity = store.getState().entityMap.get('n');
    expect(entity).toBeDefined();
    for (const [socketId, isInput] of [
      ['in-0', true],
      ['in-1', true],
      ['out', false],
    ] as const) {
      const painted = entity ? getSocketPosition(entity, socketId, isInput, LAYOUT) : null;
      expect(painted).not.toBeNull();
      const hit = store
        .getState()
        .socketQuadtree.queryPoint(painted?.x ?? 0, painted?.y ?? 0, 2000, [])
        .find((s) => s.entityId === 'n' && s.socketId === socketId && s.isInput === isInput);
      expect({ socketId, y: hit?.y }).toEqual({ socketId, y: painted?.y });
    }
  });

  it('still builds a usable index when no layout is supplied', () => {
    // FlowProvider is a public export and can be mounted with no style context above it. The
    // quadtrees must be usable the moment the store exists, so the seed is an optimisation and
    // never a precondition.
    const store = createFlowStore({ entities: [socketed()] });
    expect(store.getState().socketQuadtree.queryPoint(0, 0, 100000, []).length).toBe(3);
    expect(store.getState().quadtree.queryRange({ x: -1000, y: -1000, width: 2000, height: 2000 })).toEqual(['n']);
  });
});

/**
 * The keyboard cursor is a single value, and selection cannot become one.
 *
 * The accessibility mirror mounts real DOM controls for the entity under `focusedEntityId`, and
 * its entire claim to being affordable is that the id is single-valued. Keying it on selection
 * was the obvious alternative and is the one that blows up: `selectAll` puts every entity in
 * `selectedEntityIds`, so Ctrl+A on a thousand-node graph would commit a thousand nodes' worth of
 * hidden inputs in one render. The second test here is what fails if anyone ever "simplifies" the
 * two into one field.
 */
describe('the keyboard cursor', () => {
  it('sets and clears', () => {
    const store = createFlowStore({ entities: [ent('a'), ent('b')] });
    expect(store.getState().focusedEntityId).toBeNull();
    store.getState().setFocusedEntityId('b');
    expect(store.getState().focusedEntityId).toBe('b');
    store.getState().setFocusedEntityId(null);
    expect(store.getState().focusedEntityId).toBeNull();
  });

  it('does not move when everything is selected', () => {
    const store = createFlowStore({ entities: [ent('a'), ent('b'), ent('c')] });
    store.getState().setFocusedEntityId('a');
    store.getState().selectAll();
    expect(store.getState().selectedEntityIds.size).toBe(3);
    expect(store.getState().focusedEntityId).toBe('a');
  });

  it('does not re-publish when it is set to where it already is', () => {
    // A press calls this on every pointerdown. Publishing an unchanged value would re-render the
    // mirror and rebuild real DOM controls out from under a focused one.
    const store = createFlowStore({ entities: [ent('a')] });
    store.getState().setFocusedEntityId('a');
    let moves = 0;
    const unsub = store.subscribe((s) => s.focusedEntityId, () => { moves++; });
    store.getState().setFocusedEntityId('a');
    store.getState().setFocusedEntityId('a');
    expect(moves).toBe(0);
    store.getState().setFocusedEntityId('b');
    expect(moves).toBe(1);
    unsub();
  });
});
