import { describe, it, expect } from 'vitest';
import {
  buildStrokeRibbon,
  isPointOnStroke,
  simplifyStroke,
  strokeBounds,
  strokeIndices,
} from './stroke-geometry';

/**
 * A stroke: what is kept of it, what it looks like, and what counts as touching it.
 */

const line = (n: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i, 0);
  return out;
};

describe('what is kept of a stroke', () => {
  it('a straight run collapses to its two ends', () => {
    expect(simplifyStroke(line(50))).toEqual([0, 0, 49, 0]);
  });

  it('but a corner is kept, because that is the shape', () => {
    const corner = [0, 0, 10, 0, 20, 0, 20, 10, 20, 20];
    const out = simplifyStroke(corner);
    expect(out).toContain(20);
    expect(out.length / 2).toBe(3);
  });

  it('two points are already as simple as a stroke gets', () => {
    expect(simplifyStroke([0, 0, 5, 5])).toEqual([0, 0, 5, 5]);
  });

  it('a dot survives', () => {
    expect(simplifyStroke([3, 4])).toEqual([3, 4]);
  });

  it('a wobble smaller than the tolerance is not a shape', () => {
    const wobbly = [0, 0, 10, 0.4, 20, -0.3, 30, 0.2, 40, 0];
    expect(simplifyStroke(wobbly).length / 2).toBe(2);
  });

  it('and a bigger tolerance keeps less', () => {
    const zigzag = [0, 0, 10, 6, 20, 0, 30, 6, 40, 0];
    expect(simplifyStroke(zigzag, 1).length).toBeGreaterThan(simplifyStroke(zigzag, 20).length);
  });

  it('thousands of points do not blow the stack', () => {
    expect(() => simplifyStroke(line(20000))).not.toThrow();
  });
});

describe('the box it occupies', () => {
  it('covers the points, plus the ink either side of them', () => {
    const box = strokeBounds([10, 10, 30, 50], 8);
    expect(box).toEqual({ x: 6, y: 6, width: 28, height: 48 });
  });

  it('and an empty stroke has no box rather than an infinite one', () => {
    expect(strokeBounds([], 4)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('the ribbon it becomes', () => {
  it('two vertices per point', () => {
    const { count } = buildStrokeRibbon([0, 0, 10, 0, 20, 0], 4);
    expect(count).toBe(6);
  });

  it('offset either side of the line by half its width', () => {
    const { vertices } = buildStrokeRibbon([0, 0, 10, 0], 4);
    // A horizontal line offsets vertically: the pair at the first point is y = ±2.
    expect(Math.abs(vertices[1] - vertices[4])).toBeCloseTo(4, 5);
    expect(vertices[0]).toBeCloseTo(0, 5);
  });

  it('a corner does not grow a spike', () => {
    // A hard reversal is where a naive mitre shoots off to infinity.
    const { vertices, count } = buildStrokeRibbon([0, 0, 10, 0, 0, 0.001], 6);
    for (let i = 0; i < count * 3; i++) {
      expect(Number.isFinite(vertices[i])).toBe(true);
      expect(Math.abs(vertices[i])).toBeLessThan(1000);
    }
  });

  it('a single tap is still ink — a square, not half a quad that draws nothing', () => {
    const { count } = buildStrokeRibbon([5, 5], 4);
    expect(count).toBe(4);
    expect(strokeIndices(count).length).toBe(6);
  });

  it('every segment becomes two triangles', () => {
    // Three points is two segments: four triangles, twelve indices.
    expect(strokeIndices(6).length).toBe(12);
  });

  it('and a stroke with nothing to join has no triangles rather than broken ones', () => {
    expect(strokeIndices(0).length).toBe(0);
    expect(strokeIndices(2).length).toBe(0);
  });

  it('and a buffer that is big enough is reused rather than replaced', () => {
    const buffer = new Float32Array(64);
    const { vertices } = buildStrokeRibbon([0, 0, 1, 1], 2, buffer);
    expect(vertices).toBe(buffer);
  });

  it('while one that is too small is not written past', () => {
    const small = new Float32Array(2);
    const { vertices } = buildStrokeRibbon([0, 0, 1, 1, 2, 2], 2, small);
    expect(vertices).not.toBe(small);
    expect(vertices.length).toBeGreaterThanOrEqual(18);
  });
});

describe('what counts as touching a stroke', () => {
  it('a point on the ink', () => {
    expect(isPointOnStroke([0, 0, 100, 0], 6, 50, 1)).toBe(true);
  });

  it('a point in the box but not on the ink', () => {
    // The diagonal's bounding box is mostly empty; its corner belongs to whatever is behind it.
    expect(isPointOnStroke([0, 0, 100, 100], 6, 5, 95)).toBe(false);
  });

  it('a point past the end is not on it', () => {
    expect(isPointOnStroke([0, 0, 100, 0], 6, 140, 0)).toBe(false);
  });

  it('and a dot can be hit', () => {
    expect(isPointOnStroke([10, 10], 10, 12, 12)).toBe(true);
    expect(isPointOnStroke([10, 10], 10, 40, 40)).toBe(false);
  });
});
