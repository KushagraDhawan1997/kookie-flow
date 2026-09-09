import { describe, it, expect, beforeEach } from 'vitest';
import { getEntitySocketLayout, resetLayoutGeneration } from './socket-layout-cache';
import type { ResolvedSocketLayout } from './style-resolver';
import type { Entity } from '../types';

/**
 * `socketLayout` is a parameter of `getEntitySocketLayout` and was never part of any cache key, so
 * a runtime size or density change returned the layout computed under the PREVIOUS one. Socket Y,
 * entity height, widget rows, outlines and hit boxes all stayed at the old size.
 *
 * This is the law that returned the size-2 answer when asked for size 4.
 */

const SIZE_2: ResolvedSocketLayout = {
  rowHeight: 40,
  widgetHeight: 32,
  marginTop: 12,
  socketSize: 10,
  padding: 12,
};

const SIZE_4: ResolvedSocketLayout = {
  rowHeight: 56,
  widgetHeight: 44,
  marginTop: 20,
  socketSize: 14,
  padding: 20,
};

function entity(id = 'e1'): Entity {
  return {
    id,
    type: 'default',
    position: { x: 0, y: 0 },
    data: {},
    inputs: [
      { id: 'in-0', name: 'In 0', type: 'float' },
      { id: 'in-1', name: 'In 1', type: 'float' },
    ],
    outputs: [{ id: 'out-0', name: 'Out 0', type: 'float' }],
  };
}

beforeEach(() => {
  resetLayoutGeneration();
});

describe('the layout cache is keyed on the layout it was built with', () => {
  it('a bigger socket layout produces a bigger entity', () => {
    const e = entity();
    const small = getEntitySocketLayout(e, SIZE_2);
    const big = getEntitySocketLayout(e, SIZE_4);
    expect(big.computedHeight).toBeGreaterThan(small.computedHeight);
  });

  it('socket Y positions move with the layout', () => {
    const e = entity();
    const small = getEntitySocketLayout(e, SIZE_2);
    const smallY = small.inputs.map((s) => s.yOffset);

    const big = getEntitySocketLayout(e, SIZE_4);
    const bigY = big.inputs.map((s) => s.yOffset);

    expect(bigY).not.toEqual(smallY);
    // Every row is taller, so every socket after the first sits lower.
    expect(bigY[1]! - bigY[0]!).toBeGreaterThan(smallY[1]! - smallY[0]!);
  });

  it('going back to the first layout returns the first answer', () => {
    // Round trip: the guard must invalidate in both directions, not just forward.
    const e = entity();
    const first = getEntitySocketLayout(e, SIZE_2);
    getEntitySocketLayout(e, SIZE_4);
    const back = getEntitySocketLayout(e, SIZE_2);
    expect(back.computedHeight).toBe(first.computedHeight);
    expect(back.inputs.map((s) => s.yOffset)).toEqual(first.inputs.map((s) => s.yOffset));
  });

  it('an identical layout object by VALUE does not invalidate', () => {
    // StyleProvider's memo lists `entityStyle`, so a caller passing an inline literal produces a
    // fresh socketLayout object every render. A reference compare would recompute every entity's
    // layout every frame; comparing by value must not.
    const e = entity();
    const a = getEntitySocketLayout(e, { ...SIZE_2 });
    const b = getEntitySocketLayout(e, { ...SIZE_2 });
    // Same cached object identity means the cache was reused rather than recomputed.
    expect(b).toBe(a);
  });

  it('a second entity is not poisoned by the first entity\'s layout', () => {
    const a = entity('a');
    const b = entity('b');
    getEntitySocketLayout(a, SIZE_2);
    const bBig = getEntitySocketLayout(b, SIZE_4);
    const aBig = getEntitySocketLayout(a, SIZE_4);
    expect(aBig.computedHeight).toBe(bBig.computedHeight);
  });
});
