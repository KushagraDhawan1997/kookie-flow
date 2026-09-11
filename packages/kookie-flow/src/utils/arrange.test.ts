import { describe, it, expect } from 'vitest';
import { alignRects, distributeRects, type ArrangeRect } from './arrange';

const rect = (id: string, x: number, y: number, width = 100, height = 50): ArrangeRect => ({ id, x, y, width, height });
const apply = (rects: ArrangeRect[], moves: { id: string; dx: number; dy: number }[]) =>
  rects.map((r) => {
    const m = moves.find((mv) => mv.id === r.id);
    return m ? { ...r, x: r.x + m.dx, y: r.y + m.dy } : r;
  });

describe('alignRects', () => {
  const rects = [rect('a', 0, 0, 100, 40), rect('b', 50, 100, 200, 80), rect('c', 20, 300, 60, 20)];

  it('left, right and centre line up on the bounds of the selection itself', () => {
    expect(apply(rects, alignRects(rects, 'left')).map((r) => r.x)).toEqual([0, 0, 0]);
    // Rightmost right edge is b's, at 250.
    expect(apply(rects, alignRects(rects, 'right')).map((r) => r.x + r.width)).toEqual([250, 250, 250]);
    expect(apply(rects, alignRects(rects, 'center')).map((r) => r.x + r.width / 2)).toEqual([125, 125, 125]);
  });

  it('top, bottom and middle do the same on the other axis, and never move x', () => {
    const top = apply(rects, alignRects(rects, 'top'));
    expect(top.map((r) => r.y)).toEqual([0, 0, 0]);
    expect(top.map((r) => r.x)).toEqual([0, 50, 20]);
    expect(apply(rects, alignRects(rects, 'bottom')).map((r) => r.y + r.height)).toEqual([320, 320, 320]);
    expect(apply(rects, alignRects(rects, 'middle')).map((r) => r.y + r.height / 2)).toEqual([160, 160, 160]);
  });

  it('reports only what moves, so an aligned selection is not an undo step', () => {
    const lined = [rect('a', 0, 0), rect('b', 0, 100)];
    expect(alignRects(lined, 'left')).toEqual([]);
    expect(alignRects(rects, 'left').map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('needs two: one rect has nothing to line up with', () => {
    expect(alignRects([rect('a', 5, 5)], 'left')).toEqual([]);
  });
});

describe('distributeRects', () => {
  it('makes every gap equal, the outermost two staying where they are', () => {
    // Widths 100, 50, 100 across 0..400: 150 of space, 250 occupied, 150 left over two gaps = 75.
    const rects = [rect('a', 0, 0, 100), rect('b', 120, 0, 50), rect('c', 300, 0, 100)];
    const out = apply(rects, distributeRects(rects, 'horizontal'));
    expect(out.map((r) => r.x)).toEqual([0, 175, 300]);
    const gaps = [out[1].x - (out[0].x + out[0].width), out[2].x - (out[1].x + out[1].width)];
    expect(gaps).toEqual([75, 75]);
  });

  it('orders by position, not by the order the selection arrived in', () => {
    const rects = [rect('c', 300, 0, 100), rect('a', 0, 0, 100), rect('b', 20, 0, 50)];
    const out = apply(rects, distributeRects(rects, 'horizontal'));
    expect(out.find((r) => r.id === 'b')?.x).toBe(175);
    expect(out.find((r) => r.id === 'a')?.x).toBe(0);
    expect(out.find((r) => r.id === 'c')?.x).toBe(300);
  });

  it('works vertically and leaves x alone', () => {
    const rects = [rect('a', 9, 0, 10, 10), rect('b', 3, 90, 10, 10), rect('c', 7, 100, 10, 10)];
    const out = apply(rects, distributeRects(rects, 'vertical'));
    expect(out.map((r) => r.y)).toEqual([0, 50, 100]);
    expect(out.map((r) => r.x)).toEqual([9, 3, 7]);
  });

  it('needs three: two rects have one gap, already equal to itself', () => {
    expect(distributeRects([rect('a', 0, 0), rect('b', 500, 0)], 'horizontal')).toEqual([]);
  });
});
