import { describe, it, expect } from 'vitest';
import { EDGE_MIN_BEND, bezierControlOffset } from './edge-curve';

describe('how far a wire bends', () => {
  it('a long flat edge reaches half its horizontal gap', () => {
    expect(bezierControlOffset(400, 20)).toBe(200);
  });

  it('a short tall edge still gets room to turn, instead of two corners', () => {
    // The reported case: 21px of curve across, 85px down. The old rule gave 9.5.
    expect(bezierControlOffset(21, 85)).toBe(EDGE_MIN_BEND);
  });

  it('the vertical floor is capped, so a very tall edge does not balloon sideways', () => {
    expect(bezierControlOffset(10, 5000)).toBe(EDGE_MIN_BEND);
  });

  it('a short, nearly level edge stays tight', () => {
    expect(bezierControlOffset(20, 4)).toBe(10);
  });

  it('direction does not matter: a backward edge bends as far as a forward one', () => {
    expect(bezierControlOffset(-300, -60)).toBe(bezierControlOffset(300, 60));
  });
});
