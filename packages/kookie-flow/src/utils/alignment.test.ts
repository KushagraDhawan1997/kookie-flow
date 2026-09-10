import { describe, it, expect } from 'vitest';
import { ALIGN_TOLERANCE_PX, findAlignment, sameGuides, type AlignRect } from './alignment';

/**
 * The lines that appear while you drag. What matters is when they DO NOT appear: a guide that
 * shows up for things that are not really aligned is worse than none, because the snap moves the
 * node somewhere the person did not ask for.
 */

const rect = (id: string, x: number, y: number, width = 100, height = 50): AlignRect =>
  ({ id, x, y, width, height });

const run = (moving: AlignRect, others: AlignRect[], zoom = 1) => {
  const v: number[] = [];
  const h: number[] = [];
  const result = findAlignment(moving, others, zoom, v, h);
  return { ...result, v, h };
};

describe('when a guide appears', () => {
  it('left edges nearly meeting snap together', () => {
    const out = run(rect('a', 103, 200), [rect('b', 100, 400)]);
    expect(out.dx).toBe(-3);
    expect(out.v).toContain(100);
  });

  it('centres nearly meeting snap too', () => {
    // b's centre is at 150; a is 100 wide, so a.x = 100 puts its centre there.
    const out = run(rect('a', 96, 200), [rect('b', 100, 400)]);
    expect(out.dx).toBe(4);
  });

  it('and so do top edges, on the other axis', () => {
    const out = run(rect('a', 500, 202), [rect('b', 100, 200)]);
    expect(out.dy).toBe(-2);
    expect(out.h).toContain(200);
  });

  it('both axes at once, from different neighbours', () => {
    const out = run(rect('a', 102, 302), [rect('b', 100, 900), rect('c', 900, 300)]);
    expect(out.dx).toBe(-2);
    expect(out.dy).toBe(-2);
  });
});

describe('when no guide appears', () => {
  it('things that are not nearly aligned', () => {
    const out = run(rect('a', 400, 400), [rect('b', 100, 100)]);
    expect(out).toMatchObject({ dx: 0, dy: 0 });
    expect(out.v).toHaveLength(0);
    expect(out.h).toHaveLength(0);
  });

  it('the rect being dragged never aligns to itself', () => {
    const a = rect('a', 100, 100);
    const out = run(a, [a]);
    expect(out.v).toHaveLength(0);
  });

  it('and an empty board has nothing to align to', () => {
    const out = run(rect('a', 100, 100), []);
    expect(out).toMatchObject({ dx: 0, dy: 0 });
  });
});

describe('zoom', () => {
  it('the tolerance is in screen pixels, so zooming out does not snap the whole board', () => {
    // 20 world px apart: inside the tolerance at 0.2 zoom (100 world px), outside it at 1.
    const far = run(rect('a', 120, 500), [rect('b', 100, 900)], 1);
    expect(far.dx).toBe(0);
    const zoomedOut = run(rect('a', 120, 500), [rect('b', 100, 900)], 0.2);
    expect(zoomedOut.dx).toBe(-20);
  });

  it('and zoomed IN, only things that really are close snap', () => {
    const out = run(rect('a', 100 + ALIGN_TOLERANCE_PX, 500), [rect('b', 100, 900)], 4);
    expect(out.dx).toBe(0);
  });
});

describe('one snap per axis', () => {
  it('the closest candidate wins, so a node is never pulled two ways', () => {
    const out = run(rect('a', 104, 500), [rect('b', 100, 900), rect('c', 105, 900)]);
    expect(out.dx).toBe(1); // c at 105 is one away; b at 100 is four
  });
});

describe('what the guides say', () => {
  it('a line is drawn for every neighbour that really is on it', () => {
    const out = run(rect('a', 101, 500), [rect('b', 100, 900), rect('c', 100, 1200)]);
    expect(out.v).toEqual([100]);
  });

  it('and comparing two sets is by value, so an unchanged frame wakes nobody', () => {
    expect(sameGuides([1, 2], [1, 2])).toBe(true);
    expect(sameGuides([1, 2], [1, 3])).toBe(false);
    expect(sameGuides([1], [1, 2])).toBe(false);
  });
});
