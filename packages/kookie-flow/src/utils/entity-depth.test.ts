import { describe, it, expect } from 'vitest';
import {
  entityDepth,
  topmostEntityId,
  DEPTH_LAYER,
  DEPTH_QUANTUM,
  STACK_STEP,
  STACK_COMPACT_AT,
} from './entity-depth';

const none = new Set<string>();

describe('entityDepth', () => {
  it('a later stack index is nearer the camera', () => {
    const order = new Map([['back', 1], ['front', 2]]);
    expect(entityDepth('front', order, none)).toBeGreaterThan(entityDepth('back', order, none));
  });

  it('every part of an entity sits inside its own slice, never in the next entity\'s', () => {
    // A back node's LABEL (its highest part) must still be behind a front node's BODY.
    const order = new Map([['back', 1], ['front', 2]]);
    const backLabel = entityDepth('back', order, none) + DEPTH_LAYER.label;
    const frontBody = entityDepth('front', order, none) + DEPTH_LAYER.body;
    expect(backLabel).toBeLessThan(frontBody);
    expect(DEPTH_LAYER.label).toBeLessThan(STACK_STEP);
  });

  it('parts paint in order: body, widget, socket, label', () => {
    expect(DEPTH_LAYER.body).toBeLessThan(DEPTH_LAYER.widget);
    expect(DEPTH_LAYER.widget).toBeLessThan(DEPTH_LAYER.socket);
    expect(DEPTH_LAYER.socket).toBeLessThan(DEPTH_LAYER.label);
  });

  it('every distinct depth is separable on a 16-bit buffer', () => {
    // WebGL guarantees 16 bits; `depth: true` asks, it does not promise. The first draft of these
    // numbers put the entire ladder inside ONE quantum — STACK_STEP 0.01 against a 0.0153 tick,
    // and layer offsets of 0.002/0.004/0.006 — so on 16-bit hardware a body, its widgets, its
    // sockets and its labels all rounded to the same depth and everything this file separates
    // would have re-interleaved. Two quanta of margin, not one, because the rounding can land
    // either way.
    const steps = [DEPTH_LAYER.body, DEPTH_LAYER.widget, DEPTH_LAYER.socket, DEPTH_LAYER.label];
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i] - steps[i - 1]).toBeGreaterThan(DEPTH_QUANTUM * 2);
    }
    // And one entity's topmost part to the next entity's body.
    expect(STACK_STEP - DEPTH_LAYER.label).toBeGreaterThan(DEPTH_QUANTUM * 2);
  });

  it('a selected entity is above every unselected one, whatever their stack indices', () => {
    // The worst case: the lowest possible selected index against the highest unselected one
    // the counter can reach before compaction. The boost has to clear the whole span.
    const order = new Map([['sel', 1], ['top', STACK_COMPACT_AT]]);
    expect(entityDepth('sel', order, new Set(['sel']))).toBeGreaterThan(
      entityDepth('top', order, none) + DEPTH_LAYER.label
    );
  });

  it('stays inside the camera range for a graph of any size', () => {
    // Compaction renumbers to 1..n, so a graph of n entities holds index n. At 3000 the old ladder
    // put the selected top entity past the near plane, and the node just clicked vanished.
    for (const n of [2000, 2500, 3000, 5000, 20000]) {
      const order = new Map<string, number>();
      for (let i = 1; i <= n; i++) order.set(`e${i}`, i);
      const top = `e${n}`;
      expect(entityDepth(top, order, new Set([top]), DEPTH_LAYER.label)).toBeLessThan(99.9);
      expect(entityDepth('e1', order, none)).toBeGreaterThan(-900);
      // Selected still clears everything unselected, and the stack still orders.
      expect(entityDepth('e1', order, new Set(['e1']))).toBeGreaterThan(entityDepth(top, order, none, DEPTH_LAYER.label));
      expect(entityDepth(top, order, none)).toBeGreaterThan(entityDepth(`e${n - 1}`, order, none, DEPTH_LAYER.label));
    }
  });

  it('is unchanged below the compaction point', () => {
    const order = new Map([['a', 3]]);
    expect(entityDepth('a', order, none, DEPTH_LAYER.widget)).toBeCloseTo(-850 + 3 * STACK_STEP + DEPTH_LAYER.widget);
  });

  it('stays inside the camera range up to the compaction point', () => {
    // Orthographic camera at z=100, near 0.1: anything at or past 99.9 is clipped.
    const order = new Map([['e', STACK_COMPACT_AT]]);
    expect(entityDepth('e', order, new Set(['e'])) + DEPTH_LAYER.label).toBeLessThan(99.9);
    expect(entityDepth('e', new Map([['e', 0]]), none)).toBeGreaterThan(-900);
  });
});

describe('topmostEntityId', () => {
  it('picks the entity nearest the camera, not the first candidate', () => {
    // The quadtree's order is reverse insertion: 'under' was added later, so it came first.
    const order = new Map([['over', 7], ['under', 3]]);
    expect(topmostEntityId(['under', 'over'], order)).toBe('over');
  });

  it('is null for no candidates', () => {
    expect(topmostEntityId([], new Map())).toBeNull();
  });

  it('an entity with no recorded index sits at the bottom', () => {
    expect(topmostEntityId(['unknown', 'known'], new Map([['known', 1]]))).toBe('known');
  });
});
