import { describe, it, expect } from 'vitest';
import { createFlowStore } from './store';
import { getSocketPosition, getSocketWorldX, getSocketYOffset } from '../utils/geometry';
import { DEFAULT_ENTITY_WIDTH, SOCKET_OFFSET } from './constants';
import type { Entity, XYPosition } from '../types';
import type { ResolvedSocketLayout } from '../utils/style-resolver';

/**
 * The socket index must hold every socket where the renderer paints it.
 *
 * `getSocketPosition` is what the renderer, the edge endpoints and the connection line all use, so
 * it is the authority on where a socket IS. The store keeps a parallel copy of the same arithmetic
 * inside the socket quadtree, because the quadtree needs coordinates rather than a function call.
 * Two implementations of one fact, and they disagreed twice — both measured in a real browser
 * before this file existed:
 *
 *   - a width-less entity: the index defaulted to 200 where the renderer uses
 *     DEFAULT_ENTITY_WIDTH (240), so the output socket was grabbable 40px to the LEFT of its
 *     paint, over empty canvas. Pressing the painted socket started no connection at all.
 *   - after ANY move: the update path wrote `x + width` where the insert path wrote
 *     `x + width + SOCKET_OFFSET`, so every socket jumped 12px — outputs left, inputs right — the
 *     first time an entity was repositioned, including a reposition to the coordinates it already
 *     had.
 *
 * The repair unified the arithmetic: `getSocketWorldX` and `getSocketYOffset` in utils/geometry.ts
 * are now the only place it is written, and the store's insert, update, resize and addElements
 * paths all call them. THAT CHANGES WHAT THE SWEEP BELOW CAN SEE, and the limit is worth stating
 * because its first draft could not fail at all: an agreement law between two implementations that
 * have become one implementation agrees by construction. Sabotaging geometry.ts moves both sides
 * of the comparison and the sweep stays green — measured, three separate sabotages, all survived.
 *
 * So the file is in two halves, and each half catches what the other cannot:
 *
 *   - the SWEEP catches the store re-growing a private copy, which is literally what the shipped
 *     code did. Falsified: putting `position.x + (entity.width ?? 200)` back into the update path
 *     fails it on two entities.
 *   - the VALUE laws state each fact against the constants directly, so a change to the shared
 *     function fails here rather than propagating silently to every caller at once.
 *
 * Neither half reads the RENDERER, which is the third implementation and the one a user actually
 * sees. That claim needs pixels and lives in harness/behaviors.mjs, where a press on the painted
 * socket has to start a connection.
 *
 * The fixture is deliberately not uniform: an explicit width hides the first defect entirely, and
 * only a MOVE exposes the second, so every entity below is a shape one of the paths gets wrong.
 */

const LAYOUT: ResolvedSocketLayout = {
  rowHeight: 40,
  widgetHeight: 32,
  marginTop: 12,
  socketSize: 10,
  padding: 12,
  borderWidth: 1,
};

function socketed(id: string, x: number, y: number, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    type: 'default',
    position: { x, y },
    data: {},
    inputs: [
      { id: 'in-0', name: 'In 0', type: 'float' },
      { id: 'in-1', name: 'In 1', type: 'string' },
    ],
    outputs: [{ id: 'out-0', name: 'Out 0', type: 'float' }],
    ...extra,
  };
}

/** The shapes where the index and the renderer can disagree. */
const entities = (): Entity[] => [
  // No width: the default-mismatch case. An explicit width makes this entity prove nothing.
  socketed('unsized', 40, 60),
  // A width that is neither default, so a path hardcoding either one is wrong in a visible way.
  socketed('wide', 500, 60, { width: 360, height: 90 }),
  // Explicit socket positions bypass row layout, so the Y arithmetic differs here too.
  socketed('sockpos', 1000, 60, {
    inputs: [
      { id: 'in-0', name: 'Top', type: 'float', position: 0.1 },
      { id: 'in-1', name: 'Bottom', type: 'float', position: 0.9 },
    ],
    outputs: [{ id: 'out-0', name: 'Out 0', type: 'float', position: 0.5 }],
  }),
];

/**
 * Where the index thinks a socket is. Queried at the position the renderer PAINTS with a radius
 * of zero: a match means the index agrees to the pixel, and a miss reports what the index holds
 * instead so the failure names the drift rather than merely denying the claim.
 */
function indexedAt(
  store: ReturnType<typeof createFlowStore>,
  entityId: string,
  socketId: string,
  isInput: boolean
): XYPosition | null {
  const { socketQuadtree } = store.getState();
  // A generous sweep radius: this is looking for the entry, not testing hit tolerance.
  const painted = paintedAt(store, entityId, socketId, isInput);
  if (!painted) return null;
  const found = socketQuadtree.queryPoint(painted.x, painted.y, 200, []);
  const hit = found.find((s) => s.entityId === entityId && s.socketId === socketId && s.isInput === isInput);
  return hit ? { x: hit.x, y: hit.y } : null;
}

function paintedAt(
  store: ReturnType<typeof createFlowStore>,
  entityId: string,
  socketId: string,
  isInput: boolean
): XYPosition | null {
  const entity = store.getState().entityMap.get(entityId);
  if (!entity) return null;
  return getSocketPosition(entity, socketId, isInput, LAYOUT);
}

/** Assert agreement for every socket of every entity in the store. */
function expectIndexMatchesPaint(store: ReturnType<typeof createFlowStore>, when: string) {
  const { entities: all } = store.getState();
  let checked = 0;
  for (const entity of all) {
    for (const [sockets, isInput] of [
      [entity.inputs ?? [], true],
      [entity.outputs ?? [], false],
    ] as const) {
      for (const socket of sockets) {
        const painted = paintedAt(store, entity.id, socket.id, isInput);

        /**
         * THE COMPARISON WAS VACUOUS WHENEVER `painted` CAME BACK NULL, which is the same shape
         * this file's own docstring warns about, one level down.
         *
         * `indexedAt` bails to null on exactly the condition `painted` is null — it calls
         * `paintedAt` first and returns null if that is null, never querying the quadtree at all.
         * So null was compared against null, `toEqual` passed, and the sweep reported agreement
         * having compared nothing. `getSocketPosition` returns null on two reachable paths
         * (a missing socket array, and an id that is not found), so any change that made sockets
         * unlocatable by id would turn every one of these five tests green while locating none.
         *
         * And the vacuity guard below could not catch it: `checked` counted LOOP ITERATIONS, so
         * it stayed at 9 and stayed above zero while every comparison was null-to-null.
         *
         * The fixture guarantees every socket exists, so a null here is an INSTRUMENT failure
         * rather than a datum, and it is asserted as one.
         */
        expect(
          painted,
          `${when}: ${entity.id}/${socket.id} has no painted position — the instrument is broken, ` +
            `not the index`
        ).not.toBeNull();

        const indexed = indexedAt(store, entity.id, socket.id, isInput);
        expect(
          { where: `${when}: ${entity.id}/${socket.id}`, indexed },
          `${when}: ${entity.id}/${socket.id} is painted at ${JSON.stringify(painted)}`
        ).toEqual({ where: `${when}: ${entity.id}/${socket.id}`, indexed: painted });
        // Counts real comparisons, not iterations — see above.
        if (painted) checked++;
      }
    }
  }
  // A sweep that checked nothing is a law that cannot fail.
  expect(checked).toBeGreaterThan(0);
  return checked;
}

describe('the socket index holds every socket where it is painted', () => {
  it('on mount', () => {
    const store = createFlowStore({ entities: entities() });
    store.getState().setSocketLayout?.(LAYOUT);
    expect(expectIndexMatchesPaint(store, 'on mount')).toBe(9);
  });

  it('after a move', () => {
    // The insert path and the update path are different code. A drag is what swaps one for the
    // other, and it used to shift every socket by SOCKET_OFFSET when it did.
    const store = createFlowStore({ entities: entities() });
    store.getState().setSocketLayout?.(LAYOUT);
    store.getState().updateEntityPositions([{ id: 'unsized', position: { x: 140, y: 200 } }]);
    expectIndexMatchesPaint(store, 'after a move');
  });

  it('after a move to the position it already had', () => {
    // The degenerate move: nothing about the entity changes, so any drift here is the update path
    // disagreeing with the insert path and nothing else.
    const store = createFlowStore({ entities: entities() });
    store.getState().setSocketLayout?.(LAYOUT);
    store.getState().updateEntityPositions([{ id: 'unsized', position: { x: 40, y: 60 } }]);
    expectIndexMatchesPaint(store, 'after a no-op move');
  });

  it('after a resize', () => {
    // updateEntityDimensions is a third copy of the same arithmetic, and a width change is the one
    // edit that moves an output socket without moving the entity.
    const store = createFlowStore({ entities: entities() });
    store.getState().setSocketLayout?.(LAYOUT);
    store.getState().updateEntityDimensions('unsized', 300, 180);
    expectIndexMatchesPaint(store, 'after a resize');
  });

  it('after adding entities to a live graph', () => {
    // addElements inserts incrementally rather than rebuilding, which is a fourth copy.
    const store = createFlowStore({ entities: [socketed('seed', 0, 0)] });
    store.getState().setSocketLayout?.(LAYOUT);
    store.getState().addElements({ entities: entities() });
    expectIndexMatchesPaint(store, 'after addElements');
  });
});

describe('the shared arithmetic itself', () => {
  // The sweep above cannot see these: both sides of it call these functions, so a change here
  // moves the expectation with the answer. Stated against the constants instead.

  it('a width-less entity is DEFAULT_ENTITY_WIDTH wide, not 200', () => {
    const e = socketed('e', 40, 60);
    // The renderer has used DEFAULT_ENTITY_WIDTH since it was introduced; the index used a bare
    // 200, and 240 !== 200 is the whole of the first defect.
    expect(DEFAULT_ENTITY_WIDTH).not.toBe(200);
    expect(getSocketWorldX(e, false)).toBe(40 + DEFAULT_ENTITY_WIDTH + SOCKET_OFFSET);
  });

  it('sockets sit OUTSIDE the body on both sides', () => {
    // The update path wrote the body edge rather than the socket centre, which put outputs 12px
    // inside their paint and inputs 12px outside it — opposite directions, one missing term.
    const e = socketed('e', 40, 60, { width: 300 });
    expect(getSocketWorldX(e, true)).toBe(40 - SOCKET_OFFSET);
    expect(getSocketWorldX(e, false)).toBe(40 + 300 + SOCKET_OFFSET);
  });

  it('an explicit socket position is a fraction of the entity height', () => {
    // Stated with an explicit height so the expected number owes nothing to the layout cache.
    const e = socketed('e', 0, 0, {
      height: 200,
      inputs: [{ id: 'in-0', name: 'In 0', type: 'float', position: 0.25 }],
    });
    expect(getSocketYOffset(e, 0, true, LAYOUT)).toBe(50);
  });

  it('a socket with no position falls back to row layout', () => {
    // The vacuity guard for the law above: if `position` were being ignored the two would agree.
    const withPos = socketed('e', 0, 0, {
      height: 200,
      inputs: [{ id: 'in-0', name: 'In 0', type: 'float', position: 0.25 }],
    });
    const without = socketed('e', 0, 0, {
      height: 200,
      inputs: [{ id: 'in-0', name: 'In 0', type: 'float' }],
    });
    expect(getSocketYOffset(without, 0, true, LAYOUT)).not.toBe(
      getSocketYOffset(withPos, 0, true, LAYOUT)
    );
  });
});
