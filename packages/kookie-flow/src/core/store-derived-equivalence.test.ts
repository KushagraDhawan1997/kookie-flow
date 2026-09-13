import { describe, it, expect } from 'vitest';
import { createFlowStore, type FlowState } from './store';
import type { Entity } from '../types';
import type { ResolvedSocketLayout } from '../utils/style-resolver';

/**
 * A real socket layout, because without one every entity that states no height falls back to a
 * CONSTANT — and that constant is what hid two of these fields from the first draft of this file.
 * With explicit width and height on every fixture, `type` and `preview` change nothing the indices
 * can see, so dropping either from the structural guard produced no failure at all. They are only
 * visible through the COMPUTED height, which needs a layout to compute with.
 */
const LAYOUT: ResolvedSocketLayout = {
  rowHeight: 40,
  widgetHeight: 32,
  /**
   * marginTop MUST differ from padding, or `type` is invisible to this whole file.
   *
   * A headerless type (text, comment, reroute, image, video, mesh) starts its rows at `padding`
   * where every other type starts them at `marginTop`. The first draft copied a fixture layout
   * where the two were equal — a deliberate no-title layout, from a test about something else —
   * so changing an entity's type moved nothing, and dropping `type` from the structural guard
   * produced no failure. A real title band is what makes the field observable.
   */
  marginTop: 44,
  titleBand: 32,
  socketSize: 10,
  padding: 12,
  borderWidth: 1,
  markSize: 20,
  trackHeight: 4,
  listRowHeight: 30,
};

/**
 * THE FAST PATH MUST BE INDISTINGUISHABLE FROM THE SLOW ONE.
 *
 * `setEntities` no longer rebuilds the entityMap and both quadtrees from scratch when the only
 * thing that changed is where some nodes are — it updates them in place instead. That is worth a
 * lot on a drag, where the consumer's own array comes back every frame, and it is exactly the kind
 * of optimisation that goes wrong silently: the indices are built from a short list of fields, and
 * a field left off that list means a stale index. Nothing throws. A node simply stops being
 * clickable, or keeps its sockets at the position it used to have, and the first anyone knows is a
 * bug report about a canvas that "sometimes ignores clicks".
 *
 * Reasoning carefully about which fields matter is what these tests exist to replace. Each one
 * drives a mutation through the real store, then builds the derived state the slow way from the
 * same entities, and asserts the two AGREE — not that they are the same objects, but that they
 * answer every question the same way.
 *
 * Agreement is stated against the QUERIES, deliberately, rather than against the trees' internals.
 * What the rest of the package depends on is what the index ANSWERS: which entity is under this
 * point, which entities fall in this box, which socket is near this one. A structural comparison
 * would both miss real divergence (two differently-shaped trees answering differently) and invent
 * false divergence (two differently-shaped trees answering identically, which is fine).
 */

// A probe grid dense enough to land on and between the entities the fixtures build.
const PROBE_STEP = 60;
const PROBE_MIN = -600;
const PROBE_MAX = 1800;

function entity(id: string, x: number, y: number, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    type: 'default',
    position: { x, y },
    data: {},
    width: 240,
    height: 100,
    inputs: [{ id: 'in', name: 'in', type: 'number' }],
    outputs: [{ id: 'out', name: 'out', type: 'number' }],
    ...extra,
  } as Entity;
}

/**
 * No width, no height — so the box comes from the socket layout, and `type`, `preview` and the
 * socket arrays are all live inputs to it. The sized fixtures above cannot see any of that.
 */
function unsized(id: string, x: number, y: number, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    type: 'default',
    position: { x, y },
    data: {},
    inputs: [{ id: 'in', name: 'in', type: 'number' }],
    outputs: [{ id: 'out', name: 'out', type: 'number' }],
    ...extra,
  } as Entity;
}

function unsizedGrid(count: number): Entity[] {
  const out: Entity[] = [];
  for (let i = 0; i < count; i++) {
    out.push(unsized('u' + i, (i % 5) * 300, Math.floor(i / 5) * 260));
  }
  return out;
}

function grid(count: number): Entity[] {
  const out: Entity[] = [];
  for (let i = 0; i < count; i++) {
    out.push(entity('e' + i, (i % 5) * 300, Math.floor(i / 5) * 200));
  }
  return out;
}

/**
 * Everything the two indices will answer, as a comparable string.
 *
 * Point queries are sorted because neither index promises an order across rebuilds — only that the
 * same ids come back. (The ORDER that does matter, reverse-insertion for the socket hit test, is
 * pinned in spatial.test.ts, where the tree that owns it lives.)
 */
function indexAnswers(state: Pick<FlowState, 'quadtree' | 'socketQuadtree'>): string {
  const lines: string[] = [];
  for (let x = PROBE_MIN; x <= PROBE_MAX; x += PROBE_STEP) {
    for (let y = PROBE_MIN; y <= PROBE_MAX; y += PROBE_STEP) {
      const hits = [...new Set(state.quadtree.queryPoint(x, y))].sort();
      if (hits.length) lines.push(`p ${x},${y} ${hits.join('|')}`);
      const sockets = state.socketQuadtree
        .queryPoint(x, y, 40, [])
        .map((s) => `${s.entityId}:${s.socketId}:${s.isInput ? 'i' : 'o'}@${Math.round(s.x)},${Math.round(s.y)}`)
        .sort();
      if (sockets.length) lines.push(`s ${x},${y} ${sockets.join('|')}`);
    }
  }
  // A few range queries too — box selection reads these, and they walk the tree differently.
  for (const box of [
    { x: -500, y: -500, width: 1200, height: 1200 },
    { x: 200, y: 100, width: 400, height: 400 },
    { x: 900, y: 600, width: 2000, height: 2000 },
  ]) {
    lines.push(`r ${JSON.stringify(box)} ${[...new Set(state.quadtree.queryRange(box))].sort().join('|')}`);
  }
  return lines.join('\n');
}

/** The same questions, asked of a store built fresh from `entities` — i.e. the full rebuild. */
function freshStore(entities: Entity[]) {
  const store = createFlowStore({ entities, edges: [] });
  store.getState().setSocketLayout(LAYOUT);
  return store;
}

function referenceAnswers(entities: Entity[]): string {
  return indexAnswers(freshStore(entities).getState());
}

function mapContents(m: ReadonlyMap<string, Entity>): string {
  return [...m.entries()]
    .map(([id, e]) => `${id}@${e.position.x},${e.position.y} w${e.width} h${e.height} p${e.parentId ?? '-'} c${e.collapsed ?? '-'}`)
    .sort()
    .join('\n');
}

/**
 * Drive `entities` through a live store, then assert every derived answer matches a fresh build.
 * `steps` are applied one after another, as a consumer's echoes would arrive.
 */
function expectEquivalent(initial: Entity[], steps: Array<(prev: Entity[]) => Entity[]>): void {
  const store = freshStore(initial);
  let current = initial;

  for (let i = 0; i < steps.length; i++) {
    current = steps[i](current);
    store.getState().setEntities(current);

    const state = store.getState();
    expect(mapContents(state.entityMap), `entityMap after step ${i}`).toBe(
      mapContents(freshStore(current).getState().entityMap)
    );
    expect([...state.hiddenEntityIds].sort(), `hiddenEntityIds after step ${i}`).toEqual(
      [...freshStore(current).getState().hiddenEntityIds].sort()
    );
    expect([...state.collapsedGroupIds].sort(), `collapsedGroupIds after step ${i}`).toEqual(
      [...freshStore(current).getState().collapsedGroupIds].sort()
    );
    expect(indexAnswers(state), `index answers after step ${i}`).toBe(referenceAnswers(current));
  }
}

/** Replace one entity, preserving every other object's identity — a consumer's immutable update. */
function patch(entities: Entity[], id: string, change: Partial<Entity>): Entity[] {
  return entities.map((e) => (e.id === id ? ({ ...e, ...change } as Entity) : e));
}

describe('setEntities derived state: the in-place path answers what a full rebuild would', () => {
  it('a single node moved — the case a drag produces sixty times a second', () => {
    expectEquivalent(grid(12), [
      (prev) => patch(prev, 'e4', { position: { x: 137, y: 42 } }),
      (prev) => patch(prev, 'e4', { position: { x: 900, y: 700 } }),
      (prev) => patch(prev, 'e4', { position: { x: -400, y: -300 } }),
    ]);
  });

  it('many nodes moved at once — a select-all drag, or auto-layout', () => {
    expectEquivalent(grid(12), [
      (prev) => prev.map((e) => ({ ...e, position: { x: e.position.x + 220, y: e.position.y - 130 } })),
      (prev) => prev.map((e) => ({ ...e, position: { x: e.position.x * 1.5, y: e.position.y + 40 } })),
    ]);
  });

  it('a node moved far enough to overhang the index root', () => {
    expectEquivalent(grid(8), [(prev) => patch(prev, 'e2', { position: { x: 40000, y: -25000 } })]);
  });

  /**
   * Everything below leaves the fast path. Each is a field the indices are built from, and the
   * point of testing them here is that a future edit adding one to the allowed list, or forgetting
   * to compare it, produces divergence this catches rather than a stale index nobody notices.
   */
  it('a resize', () => {
    expectEquivalent(grid(10), [
      (prev) => patch(prev, 'e3', { width: 600 }),
      (prev) => patch(prev, 'e3', { height: 400 }),
      // Width moves the output socket column; height moves nothing but the box.
      (prev) => patch(prev, 'e3', { width: 120, height: 60 }),
    ]);
  });

  it('sockets added and removed', () => {
    expectEquivalent(grid(8), [
      (prev) =>
        patch(prev, 'e1', {
          inputs: [
            { id: 'in', name: 'in', type: 'number' },
            { id: 'in2', name: 'in2', type: 'number' },
            { id: 'in3', name: 'in3', type: 'number' },
          ],
        }),
      (prev) => patch(prev, 'e1', { outputs: [] }),
      (prev) => patch(prev, 'e1', { inputs: undefined, outputs: undefined }),
    ]);
  });

  it('a node added, then removed', () => {
    expectEquivalent(grid(6), [
      (prev) => [...prev, entity('added', 700, 500)],
      (prev) => prev.filter((e) => e.id !== 'e2'),
      (prev) => prev.filter((e) => e.id !== 'added'),
    ]);
  });

  it('a frame collapsing and expanding, which hides and shows its children', () => {
    const base: Entity[] = [
      entity('frame', 0, 0, { type: 'frame', width: 900, height: 700 }),
      entity('child1', 100, 100, { parentId: 'frame' }),
      entity('child2', 100, 300, { parentId: 'frame' }),
      entity('outside', 1200, 100),
    ];
    expectEquivalent(base, [
      (prev) => patch(prev, 'frame', { collapsed: true }),
      // Moving a hidden child must not put it back into either index.
      (prev) => patch(prev, 'child1', { position: { x: 150, y: 150 } }),
      (prev) => patch(prev, 'frame', { collapsed: false }),
    ]);
  });

  it('a node reparented into and out of a collapsed frame', () => {
    const base: Entity[] = [
      entity('frame', 0, 0, { type: 'frame', width: 900, height: 700, collapsed: true }),
      entity('child', 100, 100, { parentId: 'frame' }),
      entity('loose', 1200, 100),
    ];
    expectEquivalent(base, [
      (prev) => patch(prev, 'loose', { parentId: 'frame' }),
      (prev) => patch(prev, 'loose', { parentId: undefined }),
    ]);
  });

  it('a type change, which changes both the collapsed set and the computed height', () => {
    expectEquivalent(grid(6), [
      (prev) => patch(prev, 'e1', { type: 'frame' }),
      (prev) => patch(prev, 'e1', { collapsed: true }),
    ]);
  });

  /**
   * THE COMPUTED-HEIGHT PATH, which the sized fixtures above cannot reach.
   *
   * An entity that states no height is as tall as its socket layout makes it, so `type`, `preview`
   * and the socket arrays all move its box — and therefore what the index answers. Without these,
   * dropping `type` or `preview` from the structural guard is invisible to this whole file.
   */
  it('a type change on an unsized entity, which moves its computed height', () => {
    expectEquivalent(unsizedGrid(8), [
      (prev) => patch(prev, 'u2', { type: 'frame' }),
      (prev) => patch(prev, 'u2', { type: 'default' }),
      (prev) => patch(prev, 'u3', { type: 'text' }),
    ]);
  });

  it('a preview band appearing and disappearing on an unsized entity', () => {
    expectEquivalent(unsizedGrid(8), [
      (prev) => patch(prev, 'u1', { preview: { socket: 'out' } } as Partial<Entity>),
      (prev) => patch(prev, 'u1', { preview: { socket: 'out', height: 320 } } as Partial<Entity>),
      (prev) => patch(prev, 'u1', { preview: { socket: 'out', height: 320, position: 'top' } } as Partial<Entity>),
      (prev) => patch(prev, 'u1', { preview: undefined }),
    ]);
  });

  it('sockets added to an unsized entity, which grows the box they are measured into', () => {
    expectEquivalent(unsizedGrid(6), [
      (prev) =>
        patch(prev, 'u0', {
          inputs: Array.from({ length: 6 }, (_, i) => ({ id: 'in' + i, name: 'in' + i, type: 'number' })),
        }),
      (prev) => patch(prev, 'u0', { inputs: [] }),
    ]);
  });

  it('an unsized entity moving stays on the fast path and still agrees', () => {
    expectEquivalent(unsizedGrid(8), [
      (prev) => patch(prev, 'u4', { position: { x: 133, y: 47 } }),
      (prev) => prev.map((e) => ({ ...e, position: { x: e.position.x + 90, y: e.position.y + 90 } })),
    ]);
  });

  /**
   * The mixed sequence is the one that matters most: real use interleaves moves with structural
   * edits, and the fast path has to hand over cleanly in both directions.
   */
  it('moves interleaved with structural edits', () => {
    const base: Entity[] = [
      entity('frame', 0, 0, { type: 'frame', width: 900, height: 700 }),
      entity('a', 100, 100, { parentId: 'frame' }),
      entity('b', 500, 300),
      entity('c', 900, 100),
    ];
    expectEquivalent(base, [
      (prev) => patch(prev, 'b', { position: { x: 520, y: 320 } }),
      (prev) => patch(prev, 'frame', { collapsed: true }),
      (prev) => patch(prev, 'b', { position: { x: 540, y: 340 } }),
      (prev) => [...prev, entity('d', 1400, 600)],
      (prev) => patch(prev, 'd', { position: { x: 1420, y: 620 } }),
      (prev) => patch(prev, 'frame', { collapsed: false }),
      (prev) => patch(prev, 'a', { position: { x: 160, y: 160 } }),
      (prev) => prev.filter((e) => e.id !== 'c'),
      (prev) => patch(prev, 'b', { width: 400 }),
      (prev) => patch(prev, 'b', { position: { x: 560, y: 360 } }),
    ]);
  });

  /**
   * A data-only change must stay ON the fast path (nothing derived reads `data`) and still leave
   * the entityMap holding the NEW object — otherwise a widget value read through the map is the
   * one from before the edit.
   */
  it('a data-only change keeps the map current without a rebuild', () => {
    const store = freshStore(grid(6));
    const next = patch(grid(6), 'e2', { data: { values: { in: 7 } } });
    store.getState().setEntities(next);

    const held = store.getState().entityMap.get('e2');
    expect((held?.data as { values?: Record<string, unknown> })?.values?.in).toBe(7);
    expect(indexAnswers(store.getState())).toBe(referenceAnswers(next));
  });
});

/**
 * A pseudo-random sweep over the same mutation kinds, so the cases above are a floor rather than
 * the whole test. Seeded and deterministic — a failure is reproducible from the seed in its name.
 */
describe('setEntities derived state: randomised agreement', () => {
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  for (const seed of [1, 7, 13, 42, 99]) {
    it(`agrees across 40 random mutations (seed ${seed})`, () => {
      const rand = rng(seed);
      const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

      // Sized AND unsized, so the computed-height inputs are in the sweep too.
      let entities: Entity[] = [
        entity('frame', 0, 0, { type: 'frame', width: 900, height: 700 }),
        ...grid(5),
        ...unsizedGrid(5),
      ];
      const store = freshStore(entities);
      let nextId = 0;

      for (let step = 0; step < 40; step++) {
        const ids = entities.map((e) => e.id);
        const target = pick(ids);
        const kind = Math.floor(rand() * 10);

        if (kind === 0 && entities.length > 2) {
          entities = entities.filter((e) => e.id !== target);
        } else if (kind === 1) {
          entities = [...entities, entity('new' + nextId++, rand() * 1600 - 300, rand() * 1600 - 300)];
        } else if (kind === 2) {
          entities = patch(entities, target, {
            position: { x: Math.round(rand() * 1600 - 300), y: Math.round(rand() * 1600 - 300) },
          });
        } else if (kind === 3) {
          entities = patch(entities, target, { width: Math.round(80 + rand() * 500) });
        } else if (kind === 4) {
          entities = patch(entities, target, { height: Math.round(40 + rand() * 400) });
        } else if (kind === 5) {
          entities = patch(entities, target, { collapsed: rand() < 0.5 });
        } else if (kind === 6) {
          const parent = pick([...ids, undefined as unknown as string]);
          if (parent !== target) entities = patch(entities, target, { parentId: parent });
        } else if (kind === 7) {
          const n = Math.floor(rand() * 3);
          entities = patch(entities, target, {
            inputs: Array.from({ length: n }, (_, i) => ({ id: 'in' + i, name: 'in' + i, type: 'number' })),
          });
        } else if (kind === 8) {
          entities = patch(entities, target, { type: pick(['default', 'frame', 'text']) });
        } else {
          entities = patch(entities, target, {
            preview: rand() < 0.5 ? undefined : ({ socket: 'out', height: Math.round(100 + rand() * 300) } as Entity['preview']),
          });
        }

        store.getState().setEntities(entities);

        expect(mapContents(store.getState().entityMap), `seed ${seed} step ${step} entityMap`).toBe(
          mapContents(freshStore(entities).getState().entityMap)
        );
        expect(indexAnswers(store.getState()), `seed ${seed} step ${step} indices`).toBe(
          referenceAnswers(entities)
        );
      }
    });
  }
});
