import { describe, it, expect } from 'vitest';
import { Quadtree, SocketQuadtree, getEntityBounds, type SocketEntry } from './spatial';
import type { Entity } from '../types';

function entity(id: string, x: number, y: number): Entity {
  return { id, type: 'default', position: { x, y }, data: {}, width: 240, height: 100 };
}

/**
 * The entity index must stay TOTAL — every entity the store believes exists has to be findable.
 *
 * `rebuild` replaces the wide fixed root the store constructs (-10000..10000) with the content
 * bounding box plus 1000px of slack. That is a sensible tree shape and a silent trap: once the
 * root has shrunk to fit the graph, `insert` refuses anything outside it on its very first
 * `intersects` check and returns false, and both `update` and `incrementalAdd` threw that return
 * value away. The entity was then absent from the index entirely — not hoverable, not clickable,
 * not draggable, not box-selectable — and stayed absent until some unrelated edit happened to
 * trigger a full `rebuildDerivedState`.
 *
 * These two laws are stated against `queryPoint`, which is what every hit test actually calls, so
 * they cannot be satisfied by an index that merely remembers the id somewhere.
 */
describe('Quadtree keeps the index total after rebuild narrows the root', () => {
  it('finds an entity added far outside the rebuilt bounds', () => {
    const qt = new Quadtree({ x: -10000, y: -10000, width: 20000, height: 20000 });
    const near = entity('near', 0, 0);
    qt.rebuild([near]);

    qt.incrementalAdd([entity('far', 50000, 50000)]);

    expect(qt.queryPoint(50010, 50010)).toContain('far');
    // Re-indexing must not lose what was already there.
    expect(qt.queryPoint(10, 10)).toContain('near');
  });

  it('finds an entity dragged far outside the rebuilt bounds', () => {
    const qt = new Quadtree({ x: -10000, y: -10000, width: 20000, height: 20000 });
    const a = entity('a', 0, 0);
    const b = entity('b', 400, 0);
    qt.rebuild([a, b]);

    qt.update('a', getEntityBounds(entity('a', 50000, 50000)));

    expect(qt.queryPoint(50010, 50010)).toEqual(['a']);
    // The old location must be vacated, and the entity that never moved must survive.
    expect(qt.queryPoint(10, 10)).not.toContain('a');
    expect(qt.queryPoint(410, 10)).toContain('b');
  });
});

/**
 * The socket index's traversal, entry ordering and bookkeeping, pinned while the key strings moved.
 *
 * `getKey` used to be evaluated at every node the recursion touched — including the sibling
 * quadrants that bail out of `remove` one line later — which cost six figures of throwaway strings
 * per drag frame at a thousand selected nodes. Threading one key down through private helpers is
 * meant to be invisible, so these laws state what "invisible" means: membership, the id→entry
 * bookkeeping that `size` reports, and the reverse-insertion order the hit test depends on.
 *
 * The ordering law is also a fence. The obvious next optimisation — mutating `entry.x`/`entry.y` in
 * place instead of remove-then-insert, since a socket moves a few pixels per frame — would break
 * it: `queryPoint` returns entries in reverse insertion order and `getSocketAtPositionFast` takes
 * the first as the topmost, so a dragged socket wins the hit test against sockets it is dropped
 * on top of precisely BECAUSE it is re-appended. In-place mutation keeps its old position in the
 * array and hands the hit test to whatever was already sitting there.
 */
describe('SocketQuadtree', () => {
  const bounds = { x: -10000, y: -10000, width: 20000, height: 20000 };

  function fill(sq: SocketQuadtree, count: number): void {
    for (let i = 0; i < count; i++) {
      sq.insert({
        entityId: `n${i}`,
        socketId: 's0',
        isInput: i % 2 === 0,
        x: (i % 20) * 300,
        y: Math.floor(i / 20) * 300,
      });
    }
  }

  it('moves a socket across a subdivided tree without leaving a ghost or leaking bookkeeping', () => {
    const sq = new SocketQuadtree(bounds);
    fill(sq, 200);
    expect(sq.size).toBe(200);

    sq.update('n7', 's0', false, -4000, -4000);

    expect(sq.size).toBe(200);
    expect(sq.queryPoint(-4000, -4000, 10).map((e) => e.entityId)).toEqual(['n7']);
    // (i % 20) * 300 === 2100, Math.floor(7 / 20) * 300 === 0 — where n7 used to be.
    expect(sq.queryPoint(2100, 0, 10)).toEqual([]);
  });

  it('returns the most recently inserted overlapping socket first', () => {
    const sq = new SocketQuadtree(bounds);
    const stationary: SocketEntry = {
      entityId: 'stationary',
      socketId: 'in',
      isInput: true,
      x: 100,
      y: 100,
    };
    sq.insert(stationary);
    sq.insert({ entityId: 'mover', socketId: 'out', isInput: false, x: 5000, y: 5000 });

    sq.update('mover', 'out', false, 100, 100);

    expect(sq.queryPoint(100, 100, 8).map((e) => e.entityId)).toEqual(['mover', 'stationary']);
  });

  it('removes a socket from every level it was indexed at', () => {
    const sq = new SocketQuadtree(bounds);
    fill(sq, 200);

    expect(sq.remove('n7', 's0', false)).toBe(true);
    expect(sq.size).toBe(199);
    expect(sq.queryPoint(2100, 0, 10)).toEqual([]);
    // A second removal has nothing left to find.
    expect(sq.remove('n7', 's0', false)).toBe(false);
  });
});

/**
 * `queryRangeInto` is what every GL layer now culls with, so the laws it has to satisfy are the
 * ones a render loop silently depends on: the same answer as the allocating `queryRange` it
 * replaces, each entity ONCE however many quadrants it spans, and a caller-owned array that is
 * written from zero and never read past the returned count.
 *
 * The dedup law is the one with teeth. The stamp lives on the entry object, which only works
 * because a multi-quadrant entity is stored as ONE object shared between quadrants; reintroduce
 * the per-quadrant copy and an entity straddling a boundary is drawn twice, which on the instanced
 * layers means a wasted slot and, at capacity, a node that does not appear at all.
 */
describe('Quadtree.queryRangeInto', () => {
  const bounds = { x: -10000, y: -10000, width: 20000, height: 20000 };

  function grid(n: number): Entity[] {
    const out: Entity[] = [];
    for (let i = 0; i < n; i++) {
      out.push(entity(`e${i}`, (i % 40) * 300, Math.floor(i / 40) * 200));
    }
    return out;
  }

  it('agrees with queryRange', () => {
    const qt = new Quadtree(bounds);
    qt.rebuild(grid(400));
    const range = { x: 500, y: 400, width: 1200, height: 900 };

    const out: string[] = [];
    const count = qt.queryRangeInto(range, out);

    expect(out.slice(0, count).sort()).toEqual(qt.queryRange(range).sort());
  });

  it('reports an entity spanning several quadrants exactly once', () => {
    const qt = new Quadtree(bounds);
    // Enough neighbours to force subdivision, plus one entity wide enough to straddle the splits.
    const entities = grid(200);
    entities.push({
      id: 'wide',
      type: 'default',
      position: { x: -4000, y: -4000 },
      data: {},
      width: 9000,
      height: 9000,
    });
    qt.rebuild(entities);

    const out: string[] = [];
    const count = qt.queryRangeInto({ x: -5000, y: -5000, width: 11000, height: 11000 }, out);
    const seen = out.slice(0, count).filter((id) => id === 'wide');

    expect(seen).toEqual(['wide']);
  });

  it('reuses the caller array and never reads past the count', () => {
    const qt = new Quadtree(bounds);
    qt.rebuild(grid(400));

    const out: string[] = [];
    const wide = qt.queryRangeInto({ x: 0, y: 0, width: 12000, height: 12000 }, out);
    const narrow = qt.queryRangeInto({ x: 0, y: 0, width: 100, height: 100 }, out);

    expect(narrow).toBeLessThan(wide);
    // The array keeps its high-water length; only `count` is authoritative.
    expect(out.length).toBe(wide);
    expect(out.slice(0, narrow)).toEqual(['e0']);
  });

  it('starts each query from a clean slate', () => {
    const qt = new Quadtree(bounds);
    qt.rebuild(grid(400));
    const range = { x: 500, y: 400, width: 1200, height: 900 };

    const out: string[] = [];
    const first = qt.queryRangeInto(range, out);
    const second = qt.queryRangeInto(range, out);

    // A stamp that was not advanced between queries would report zero the second time.
    expect(second).toBe(first);
    expect(first).toBeGreaterThan(0);
  });
});
