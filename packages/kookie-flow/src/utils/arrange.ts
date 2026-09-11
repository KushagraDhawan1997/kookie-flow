/**
 * Align and distribute: lining a selection up, and spacing it evenly.
 *
 * Both work on the SELECTION'S OWN BOUNDS, the rule every design tool uses. Aligning left moves
 * every rect to the leftmost left edge among them; aligning on a centre line moves every rect's
 * centre to the centre of the bounds. Distributing keeps the two outermost rects where they are
 * and makes every GAP between neighbours equal — equal gaps, not equal centre spacing, because
 * the gaps are what a person sees.
 *
 * Pure: rects in, the offsets to apply out. Only rects that actually move are returned, so an
 * already-aligned selection reports nothing and records no undo step.
 */

import type { AlignEdge, DistributeAxis } from '../types';

export interface ArrangeRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArrangeMove {
  id: string;
  dx: number;
  dy: number;
}

export function alignRects(rects: readonly ArrangeRect[], edge: AlignEdge): ArrangeMove[] {
  if (rects.length < 2) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }

  const moves: ArrangeMove[] = [];
  for (const r of rects) {
    let dx = 0;
    let dy = 0;
    switch (edge) {
      case 'left': dx = minX - r.x; break;
      case 'right': dx = maxX - (r.x + r.width); break;
      case 'center': dx = (minX + maxX) / 2 - (r.x + r.width / 2); break;
      case 'top': dy = minY - r.y; break;
      case 'bottom': dy = maxY - (r.y + r.height); break;
      case 'middle': dy = (minY + maxY) / 2 - (r.y + r.height / 2); break;
    }
    if (dx !== 0 || dy !== 0) moves.push({ id: r.id, dx, dy });
  }
  return moves;
}

export function distributeRects(rects: readonly ArrangeRect[], axis: DistributeAxis): ArrangeMove[] {
  // Two rects have one gap, which is already equal to itself.
  if (rects.length < 3) return [];
  const horizontal = axis === 'horizontal';
  const lead = (r: ArrangeRect) => (horizontal ? r.x : r.y);
  const size = (r: ArrangeRect) => (horizontal ? r.width : r.height);
  // By leading edge, with the id as a tiebreak so two rects on one line always come out in the same
  // order rather than in whatever order the selection set happened to hold them.
  const sorted = [...rects].sort((a, b) => lead(a) - lead(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = lead(first);
  const end = lead(last) + size(last);
  let occupied = 0;
  for (const r of sorted) occupied += size(r);
  // Negative when the rects are wider than the span they sit in: they overlap evenly, which is
  // what a design tool does too, rather than refusing.
  const gap = (end - start - occupied) / (sorted.length - 1);

  const moves: ArrangeMove[] = [];
  let cursor = start;
  for (const r of sorted) {
    const d = cursor - lead(r);
    if (d !== 0) moves.push(horizontal ? { id: r.id, dx: d, dy: 0 } : { id: r.id, dx: 0, dy: d });
    cursor += size(r) + gap;
  }
  return moves;
}
