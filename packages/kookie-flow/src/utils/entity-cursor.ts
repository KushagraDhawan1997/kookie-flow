/**
 * Where the keyboard cursor goes next.
 *
 * The graph's whole keyboard entry point is one tab stop on the canvas container, which only pays
 * for itself if the arrow keys can actually reach every node from there. This answers "the next
 * node" in READING ORDER — top to bottom, then left to right — rather than in the order the
 * consumer happened to put entities in their array. Insertion order is whatever a consumer's data
 * source produced and can be visually arbitrary: a cursor that jumped from the top-left node to
 * one three screens away and back again would be technically complete and unusable.
 *
 * NO SORT, AND NO CACHE. The obvious spelling sorts the entities and indexes into the result,
 * which is O(n log n) per keypress AND needs invalidating every time anything moves — a cache
 * whose staleness nobody would notice until a cursor started skipping a node. This walks the
 * array twice instead, once to find the current node and the extremes and once to find the
 * nearest node in the direction asked for, which is O(n) with no allocation and cannot go stale
 * because it reads positions at the moment of the keypress. A keypress is not a frame; the same
 * bound `getWidgetAt` accepts by design.
 *
 * The order is TOTAL — y, then x, then id — so "the next one" is never ambiguous even in the grid
 * fixtures where a whole row shares a y. Without the id tiebreak two nodes at the same point would
 * each be "before" the other and the cursor could sit between them forever.
 */

import type { Entity } from '../types';

/** Is `a` earlier than `b` in reading order? */
function isBefore(a: Entity, b: Entity): boolean {
  if (a.position.y !== b.position.y) return a.position.y < b.position.y;
  if (a.position.x !== b.position.x) return a.position.x < b.position.x;
  return a.id < b.id;
}

/**
 * The id the cursor moves to, or null when there is nowhere to go.
 *
 * `direction` is 1 for forward and -1 for back. A cursor that is nowhere — or on an entity that
 * has since been removed, which is how a stale id heals — lands on the first or last node
 * depending on the direction. Running off either end WRAPS, so holding an arrow walks the whole
 * graph and comes back rather than stopping dead at a node that looks no different from any other.
 */
export function stepEntityCursor(
  entities: readonly Entity[],
  currentId: string | null,
  direction: 1 | -1,
  isSkipped?: (id: string) => boolean
): string | null {
  let current: Entity | null = null;
  let first: Entity | null = null;
  let last: Entity | null = null;
  for (const e of entities) {
    if (isSkipped?.(e.id)) continue;
    if (e.id === currentId) current = e;
    if (first === null || isBefore(e, first)) first = e;
    if (last === null || isBefore(last, e)) last = e;
  }
  if (first === null || last === null) return null;
  if (current === null) return direction === 1 ? first.id : last.id;

  let best: Entity | null = null;
  for (const e of entities) {
    if (isSkipped?.(e.id)) continue;
    if (e.id === current.id) continue;
    // Keep only what lies in the direction asked for.
    if (direction === 1 ? !isBefore(current, e) : isBefore(current, e)) continue;
    if (best === null || (direction === 1 ? isBefore(e, best) : isBefore(best, e))) best = e;
  }
  if (best !== null) return best.id;
  return direction === 1 ? first.id : last.id;
}
