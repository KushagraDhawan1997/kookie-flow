import { describe, it, expect } from 'vitest';
import { edt1d, edt2d, signedDistanceField } from './runtime-atlas';

/**
 * The maths behind a runtime atlas. The canvas half needs a browser and is pinned by a law; this
 * is the part that decides whether the letters have edges.
 */

describe('the distance transform', () => {
  it('a row with one zero measures away from it', () => {
    const INF = 1e20;
    const f = Float64Array.from([INF, INF, 0, INF, INF]);
    const out = new Float64Array(5);
    edt1d(f, 5, out);
    expect(Array.from(out)).toEqual([4, 1, 0, 1, 4]); // squared distances
  });

  it('a row that is all zero is all zero', () => {
    const f = new Float64Array(4);
    const out = new Float64Array(4);
    edt1d(f, 4, out);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });

  it('and a grid is exact in two dimensions, not merely along the axes', () => {
    // One seed in a corner: the far corner of a 4x4 grid is (3,3) away — 9 + 9 = 18 squared.
    const INF = 1e20;
    const grid = new Float64Array(16).fill(INF);
    grid[0] = 0;
    edt2d(grid, 4, 4);
    expect(grid[15]).toBeCloseTo(18, 6);
    expect(grid[5]).toBeCloseTo(2, 6); // the diagonal neighbour
  });
});

describe('the field it makes', () => {
  const square = (size: number, from: number, to: number) => {
    const mask = new Uint8Array(size * size);
    for (let y = from; y < to; y++) {
      for (let x = from; x < to; x++) mask[y * size + x] = 255;
    }
    return mask;
  };

  it('is above the middle inside the shape and below it outside', () => {
    const size = 16;
    const field = signedDistanceField(square(size, 4, 12), size, size, 4);
    expect(field[8 * size + 8]).toBeGreaterThan(128); // the centre
    expect(field[0]).toBeLessThan(128); // a corner, well outside
  });

  it('crosses the middle AT the edge, which is what the shader looks for', () => {
    const size = 16;
    const field = signedDistanceField(square(size, 4, 12), size, size, 4);
    // The first row inside the shape is within half a pixel of the edge either way.
    expect(Math.abs(field[8 * size + 4] - 128)).toBeLessThan(24);
  });

  it('and it saturates rather than wrapping, however far from an edge a pixel is', () => {
    const size = 32;
    const field = signedDistanceField(square(size, 12, 20), size, size, 2);
    for (const value of field) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }
  });

  it('an empty mask is entirely outside', () => {
    const field = signedDistanceField(new Uint8Array(64), 8, 8, 4);
    for (const value of field) expect(value).toBeLessThan(128);
  });

  it('and a full mask is entirely inside', () => {
    const field = signedDistanceField(new Uint8Array(64).fill(255), 8, 8, 4);
    for (const value of field) expect(value).toBeGreaterThan(128);
  });

  it('a wider range makes a softer ramp, which is the whole quality knob', () => {
    const size = 24;
    const mask = square(size, 8, 16);
    const tight = signedDistanceField(mask, size, size, 2);
    const wide = signedDistanceField(mask, size, size, 8);
    // Two pixels outside the edge: with a wide range it is nearer the middle than with a tight one.
    const at = 6 * size + 12;
    expect(Math.abs(wide[at] - 128)).toBeLessThan(Math.abs(tight[at] - 128));
  });
});
