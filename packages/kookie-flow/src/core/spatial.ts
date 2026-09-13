import type { Entity } from '../types';
import { DEFAULT_ENTITY_WIDTH, DEFAULT_ENTITY_HEIGHT } from './constants';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import type { ResolvedSocketLayout } from '../utils/style-resolver';

/** Axis-aligned bounding box */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Entry stored in the quadtree */
interface QuadtreeEntry {
  id: string;
  bounds: Bounds;
  /**
   * The last query that already collected this entry, for `queryRangeInto`'s dedup.
   *
   * A large entity is inserted into every quadrant it overlaps, so a range query meets it more
   * than once and has to drop the repeats. `queryRange` does that with a `Set<string>` built per
   * call — an allocation plus a hash per candidate, in a function the render layers now call
   * every time the camera escapes their margin. A monotonically increasing stamp answers the same
   * question with one integer compare and no allocation at all. Entries are shared between the
   * quadrants an entity spans (the same object is pushed into each), so stamping one stamps all.
   */
  stamp: number;
}

/**
 * The query counter `QuadtreeEntry.stamp` is compared against. Module-scope so that separate
 * trees cannot hand each other a stale stamp, and never reset: at one query per layer per frame
 * it would take longer than the age of the universe to reach Number.MAX_SAFE_INTEGER.
 */
let queryStamp = 0;

/** Socket entry for socket spatial index */
export interface SocketEntry {
  entityId: string;
  socketId: string;
  isInput: boolean;
  x: number;
  y: number;
}

/** Default quadtree capacity per cell before subdivision */
const DEFAULT_CAPACITY = 8;

/** Maximum depth to prevent infinite subdivision */
const MAX_DEPTH = 10;

/** Default socket quadtree capacity (sockets are smaller, need finer granularity) */
const SOCKET_CAPACITY = 16;

/** Slack left around the content bounding box when the root is (re)sized. */
const BOUNDS_PADDING = 1000;

/**
 * Quadtree for O(log n) spatial queries on entity bounding boxes.
 * Supports point queries (hover/click) and range queries (box selection).
 */
export class Quadtree {
  private bounds: Bounds;
  private capacity: number;
  private entries: QuadtreeEntry[] = [];
  private divided = false;
  private depth: number;

  // Child quadrants (NW, NE, SW, SE)
  private nw: Quadtree | null = null;
  private ne: Quadtree | null = null;
  private sw: Quadtree | null = null;
  private se: Quadtree | null = null;

  // ID to entry mapping for O(1) removal lookups
  private idToEntry: Map<string, QuadtreeEntry> = new Map();

  constructor(bounds: Bounds, capacity = DEFAULT_CAPACITY, depth = 0) {
    this.bounds = bounds;
    this.capacity = capacity;
    this.depth = depth;
  }

  /**
   * Insert an entity into the quadtree.
   */
  insert(id: string, bounds: Bounds): boolean {
    return this.insertEntry({ id, bounds, stamp: 0 });
  }

  /**
   * Insert an entry object, which every quadrant it lands in SHARES.
   *
   * The recursion used to pass `(id, bounds)` down and mint a fresh `{ id, bounds }` in each
   * quadrant it reached, so one entity spanning a boundary left four unrelated objects behind at
   * every level it descended. Two things follow from sharing one instead: inserting is a single
   * allocation whatever the fan-out, and `stamp` becomes a property of the ENTITY rather than of
   * one quadrant's copy of it — which is what lets `queryRangeInto` dedup a multi-quadrant entity
   * with an integer compare instead of a Set.
   */
  private insertEntry(entry: QuadtreeEntry): boolean {
    // Check if bounds intersect with this quadrant
    if (!this.intersects(entry.bounds)) {
      return false;
    }

    // If we have capacity and haven't subdivided, store here
    if (this.entries.length < this.capacity && !this.divided) {
      this.entries.push(entry);
      this.idToEntry.set(entry.id, entry);
      return true;
    }

    // Subdivide if we haven't already and aren't at max depth
    if (!this.divided && this.depth < MAX_DEPTH) {
      this.subdivide();
    }

    // If at max depth, just store here regardless of capacity
    if (this.depth >= MAX_DEPTH) {
      this.entries.push(entry);
      this.idToEntry.set(entry.id, entry);
      return true;
    }

    // Try to insert into children
    // Note: Large entities may be inserted into multiple quadrants
    let inserted = false;
    if (this.nw!.insertEntry(entry)) inserted = true;
    if (this.ne!.insertEntry(entry)) inserted = true;
    if (this.sw!.insertEntry(entry)) inserted = true;
    if (this.se!.insertEntry(entry)) inserted = true;

    if (inserted) {
      this.idToEntry.set(entry.id, entry);
    }

    return inserted;
  }

  /**
   * Remove an entity from the quadtree by ID.
   * For simplicity, we mark as removed rather than restructuring.
   * Call rebuild() periodically for cleanup.
   */
  remove(id: string): boolean {
    if (!this.idToEntry.has(id)) {
      return false;
    }

    // Remove from local entries
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx !== -1) {
      this.entries.splice(idx, 1);
    }

    // Remove from children
    if (this.divided) {
      this.nw!.remove(id);
      this.ne!.remove(id);
      this.sw!.remove(id);
      this.se!.remove(id);
    }

    this.idToEntry.delete(id);
    return true;
  }

  /**
   * Query all entity IDs that contain the given point.
   * Returns IDs in reverse insertion order (topmost first for z-ordering).
   *
   * @param x - X coordinate to query
   * @param y - Y coordinate to query
   * @param results - Optional pre-allocated array to avoid allocations in hot paths
   */
  queryPoint(x: number, y: number, results?: string[]): string[] {
    // Use provided array or create new one (only at top level)
    const output = results ?? [];

    // Check if point is within this quadrant's bounds
    if (!this.containsPoint(x, y)) {
      return output;
    }

    // Check local entries
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (this.pointInBounds(x, y, entry.bounds)) {
        output.push(entry.id);
      }
    }

    // Check children (pass same array to avoid spread allocations)
    if (this.divided) {
      this.nw!.queryPoint(x, y, output);
      this.ne!.queryPoint(x, y, output);
      this.sw!.queryPoint(x, y, output);
      this.se!.queryPoint(x, y, output);
    }

    return output;
  }

  /**
   * Query all entity IDs that intersect with the given range.
   * Used for box selection.
   */
  queryRange(range: Bounds): string[] {
    const results: string[] = [];
    const seen = new Set<string>();

    this.queryRangeInternal(range, results, seen);

    return results;
  }

  /**
   * Every entity intersecting `range`, written into a CALLER-OWNED array.
   *
   * This is what the GL layers cull with, so it is called inside `useFrame` and must not allocate:
   * no results array, no dedup Set, no closure. `out` is written from index 0 and the return value
   * says how much of it is live — the array is never truncated, so it settles at the high-water
   * mark of the busiest frame and stops growing.
   *
   * What it replaces, layer by layer, is `for (const entity of entities)` plus a per-entity box
   * test: O(graph) on every frame the layer was dirty, to find the few hundred entities on screen.
   * Here the tree skips whole quadrants at once, so the cost is proportional to what is visible
   * plus the depth walked to reach it.
   */
  queryRangeInto(range: Bounds, out: string[]): number {
    const stamp = ++queryStamp;
    return this.queryRangeIntoInternal(range, out, 0, stamp);
  }

  private queryRangeIntoInternal(
    range: Bounds,
    out: string[],
    count: number,
    stamp: number
  ): number {
    if (!this.intersects(range)) {
      return count;
    }

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (entry.stamp === stamp) continue;
      if (!this.boundsIntersect(range, entry.bounds)) continue;
      entry.stamp = stamp;
      out[count++] = entry.id;
    }

    if (this.divided) {
      count = this.nw!.queryRangeIntoInternal(range, out, count, stamp);
      count = this.ne!.queryRangeIntoInternal(range, out, count, stamp);
      count = this.sw!.queryRangeIntoInternal(range, out, count, stamp);
      count = this.se!.queryRangeIntoInternal(range, out, count, stamp);
    }

    return count;
  }

  private queryRangeInternal(
    range: Bounds,
    results: string[],
    seen: Set<string>
  ): void {
    // Check if range intersects with this quadrant
    if (!this.intersects(range)) {
      return;
    }

    // Check local entries
    for (const entry of this.entries) {
      if (!seen.has(entry.id) && this.boundsIntersect(range, entry.bounds)) {
        results.push(entry.id);
        seen.add(entry.id);
      }
    }

    // Check children
    if (this.divided) {
      this.nw!.queryRangeInternal(range, results, seen);
      this.ne!.queryRangeInternal(range, results, seen);
      this.sw!.queryRangeInternal(range, results, seen);
      this.se!.queryRangeInternal(range, results, seen);
    }
  }

  /**
   * Clear the quadtree.
   */
  clear(): void {
    this.entries = [];
    this.idToEntry.clear();
    this.divided = false;
    this.nw = null;
    this.ne = null;
    this.sw = null;
    this.se = null;
  }

  /**
   * Rebuild the quadtree from a list of entities.
   * Call this on bulk changes (initial load, paste, etc.)
   */
  rebuild(entities: Entity[], socketLayout?: ResolvedSocketLayout): void {
    this.clear();

    // Compute world bounds from all entities
    if (entities.length === 0) {
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const entity of entities) {
      const b = getEntityBounds(entity, socketLayout);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }

    // Add padding to bounds
    this.bounds = {
      x: minX - BOUNDS_PADDING,
      y: minY - BOUNDS_PADDING,
      width: maxX - minX + BOUNDS_PADDING * 2,
      height: maxY - minY + BOUNDS_PADDING * 2,
    };

    // Insert all entities
    for (const entity of entities) {
      this.insert(entity.id, getEntityBounds(entity, socketLayout));
    }
  }

  /**
   * Update a single entity's position.
   * More efficient than full rebuild for single entity moves.
   */
  update(id: string, bounds: Bounds): void {
    this.remove(id);
    this.insertOrGrow(id, bounds);
  }

  /**
   * Insert, and if the entity falls outside the root, grow the root to cover it and re-index.
   *
   * `rebuild` replaces the wide fixed root the store constructs with the content bounding box plus
   * `BOUNDS_PADDING`. Once narrowed, an entity added or dragged past that padding failed the very
   * first `intersects` check in `insert`, which returned false — and both callers threw the return
   * value away. The entity was then simply absent from the index: it could not be hovered,
   * clicked, dragged or box-selected, and stayed that way until some unrelated change happened to
   * run a full rebuild. Every hit test in the app assumes the index is total, so the index has to
   * be total. Growing costs one O(n) re-index on the rare crossing and nothing at all otherwise.
   */
  private insertOrGrow(id: string, bounds: Bounds): void {
    if (this.insert(id, bounds)) {
      return;
    }

    const existing = Array.from(this.idToEntry.values());
    const minX = Math.min(this.bounds.x, bounds.x - BOUNDS_PADDING);
    const minY = Math.min(this.bounds.y, bounds.y - BOUNDS_PADDING);
    const maxX = Math.max(
      this.bounds.x + this.bounds.width,
      bounds.x + bounds.width + BOUNDS_PADDING
    );
    const maxY = Math.max(
      this.bounds.y + this.bounds.height,
      bounds.y + bounds.height + BOUNDS_PADDING
    );

    this.clear();
    this.bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

    for (const entry of existing) {
      // `update` removes before inserting, so `id` is normally absent here; skipping it defends
      // against a caller that inserts the same id twice, which would otherwise leave a duplicate
      // entry that only one `remove` can reach.
      if (entry.id !== id) {
        // The existing object, not a copy of its fields: a re-index is not a change of identity,
        // and re-using it keeps a grow allocation-free per entity rather than one object each.
        this.insertEntry(entry);
      }
    }
    this.insert(id, bounds);
  }

  /**
   * Batch insert multiple entities.
   * More efficient than individual inserts for bulk operations.
   * O(k log n) where k = number of entities to insert
   */
  batchInsert(entries: Array<{ id: string; bounds: Bounds }>): void {
    for (const { id, bounds } of entries) {
      this.insert(id, bounds);
    }
  }

  /**
   * Batch remove multiple entities.
   * O(k log n) where k = number of entities to remove
   */
  batchRemove(ids: string[]): void {
    for (const id of ids) {
      this.remove(id);
    }
  }

  /**
   * Incrementally add entities without full rebuild.
   * Uses large fixed bounds so expansion is rarely needed.
   * O(k log n) where k = number of entities to add
   */
  incrementalAdd(entities: Entity[], socketLayout?: ResolvedSocketLayout): void {
    if (entities.length === 0) return;

    // The initial bounds are large (-10000 to 10000), so most entities fit without any work;
    // `insertOrGrow` covers the ones that do not, including everything outside the much tighter
    // box a previous `rebuild` left behind.
    for (const entity of entities) {
      this.insertOrGrow(entity.id, getEntityBounds(entity, socketLayout));
    }
  }

  /**
   * Incrementally remove entities without full rebuild.
   * O(k log n) where k = number of entities to remove
   */
  incrementalRemove(entityIds: string[]): void {
    for (const id of entityIds) {
      this.remove(id);
    }
  }

  private subdivide(): void {
    const { x, y, width, height } = this.bounds;
    const halfW = width / 2;
    const halfH = height / 2;

    this.nw = new Quadtree(
      { x, y, width: halfW, height: halfH },
      this.capacity,
      this.depth + 1
    );
    this.ne = new Quadtree(
      { x: x + halfW, y, width: halfW, height: halfH },
      this.capacity,
      this.depth + 1
    );
    this.sw = new Quadtree(
      { x, y: y + halfH, width: halfW, height: halfH },
      this.capacity,
      this.depth + 1
    );
    this.se = new Quadtree(
      { x: x + halfW, y: y + halfH, width: halfW, height: halfH },
      this.capacity,
      this.depth + 1
    );

    this.divided = true;

    // Re-insert existing entries into children
    const oldEntries = this.entries;
    this.entries = [];

    // The SAME entry object into each quadrant it belongs in — see insertEntry.
    for (const entry of oldEntries) {
      this.nw.insertEntry(entry);
      this.ne.insertEntry(entry);
      this.sw.insertEntry(entry);
      this.se.insertEntry(entry);
    }
  }

  private intersects(other: Bounds): boolean {
    return this.boundsIntersect(this.bounds, other);
  }

  private boundsIntersect(a: Bounds, b: Bounds): boolean {
    return !(
      a.x + a.width < b.x ||
      b.x + b.width < a.x ||
      a.y + a.height < b.y ||
      b.y + b.height < a.y
    );
  }

  private containsPoint(x: number, y: number): boolean {
    return (
      x >= this.bounds.x &&
      x < this.bounds.x + this.bounds.width &&
      y >= this.bounds.y &&
      y < this.bounds.y + this.bounds.height
    );
  }

  private pointInBounds(x: number, y: number, bounds: Bounds): boolean {
    return (
      x >= bounds.x &&
      x < bounds.x + bounds.width &&
      y >= bounds.y &&
      y < bounds.y + bounds.height
    );
  }
}

/**
 * Get bounding box for an entity.
 * When socketLayout is provided, uses the computed height from socket layout cache
 * instead of DEFAULT_ENTITY_HEIGHT. This ensures hit testing bounds match rendered bounds.
 */
export function getEntityBounds(entity: Entity, socketLayout?: ResolvedSocketLayout): Bounds {
  let height = entity.height;
  if (height == null) {
    height = socketLayout
      ? getEntitySocketLayout(entity, socketLayout).computedHeight
      : DEFAULT_ENTITY_HEIGHT;
  }
  return {
    x: entity.position.x,
    y: entity.position.y,
    width: entity.width ?? DEFAULT_ENTITY_WIDTH,
    height,
  };
}

/**
 * Create a bounds object from two corner points.
 */
export function boundsFromCorners(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Bounds {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * SocketQuadtree for O(log n) socket hit testing.
 * Optimized for point queries on small circular sockets.
 */
export class SocketQuadtree {
  private bounds: Bounds;
  private capacity: number;
  private entries: SocketEntry[] = [];
  private divided = false;
  private depth: number;

  // Child quadrants
  private nw: SocketQuadtree | null = null;
  private ne: SocketQuadtree | null = null;
  private sw: SocketQuadtree | null = null;
  private se: SocketQuadtree | null = null;

  // Key to entry mapping for O(1) removal
  private keyToEntry: Map<string, SocketEntry> = new Map();

  constructor(bounds: Bounds, capacity = SOCKET_CAPACITY, depth = 0) {
    this.bounds = bounds;
    this.capacity = capacity;
    this.depth = depth;
  }

  /**
   * Generate a unique key for a socket.
   */
  private static getKey(entityId: string, socketId: string, isInput: boolean): string {
    return `${entityId}:${socketId}:${isInput ? 'i' : 'o'}`;
  }

  /**
   * Insert a socket into the quadtree.
   */
  insert(entry: SocketEntry): boolean {
    return this.insertWithKey(
      entry,
      SocketQuadtree.getKey(entry.entityId, entry.socketId, entry.isInput)
    );
  }

  /**
   * Remove a socket from the quadtree.
   */
  remove(entityId: string, socketId: string, isInput: boolean): boolean {
    return this.removeWithKey(
      entityId,
      socketId,
      isInput,
      SocketQuadtree.getKey(entityId, socketId, isInput)
    );
  }

  /**
   * The recursion carries the key instead of rebuilding it.
   *
   * `getKey` is a template literal, and it used to be evaluated at every node the recursion
   * touched — in `remove`, that includes the three sibling quadrants that immediately bail out one
   * line later, so a single socket move allocated roughly twenty throwaway strings. `update` is
   * called once per socket of every moved entity on every pointermove (see `updateEntityPositions`
   * in the store), so at a thousand selected nodes that was six figures of garbage per drag frame,
   * and it dominated the drag profile. Threading the key down leaves the traversal, the entry
   * ordering and the return values exactly as they were; only the string construction moved out of
   * the recursion and into the two public entry points.
   */
  private insertWithKey(entry: SocketEntry, key: string): boolean {
    // Check if point is within bounds
    if (!this.containsPoint(entry.x, entry.y)) {
      return false;
    }

    // If we have capacity and haven't subdivided, store here
    if (this.entries.length < this.capacity && !this.divided) {
      this.entries.push(entry);
      this.keyToEntry.set(key, entry);
      return true;
    }

    // Subdivide if we haven't already and aren't at max depth
    if (!this.divided && this.depth < MAX_DEPTH) {
      this.subdivide();
    }

    // If at max depth, just store here
    if (this.depth >= MAX_DEPTH) {
      this.entries.push(entry);
      this.keyToEntry.set(key, entry);
      return true;
    }

    // Insert into appropriate child
    if (this.nw!.insertWithKey(entry, key)) {
      this.keyToEntry.set(key, entry);
      return true;
    }
    if (this.ne!.insertWithKey(entry, key)) {
      this.keyToEntry.set(key, entry);
      return true;
    }
    if (this.sw!.insertWithKey(entry, key)) {
      this.keyToEntry.set(key, entry);
      return true;
    }
    if (this.se!.insertWithKey(entry, key)) {
      this.keyToEntry.set(key, entry);
      return true;
    }

    return false;
  }

  private removeWithKey(
    entityId: string,
    socketId: string,
    isInput: boolean,
    key: string
  ): boolean {
    if (!this.keyToEntry.has(key)) {
      return false;
    }

    // Remove from local entries. An index loop rather than `findIndex`, because the predicate
    // closure was another per-node allocation on the same drag-frame path as the key strings.
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.entityId === entityId && e.socketId === socketId && e.isInput === isInput) {
        this.entries.splice(i, 1);
        break;
      }
    }

    // Remove from children
    if (this.divided) {
      this.nw!.removeWithKey(entityId, socketId, isInput, key);
      this.ne!.removeWithKey(entityId, socketId, isInput, key);
      this.sw!.removeWithKey(entityId, socketId, isInput, key);
      this.se!.removeWithKey(entityId, socketId, isInput, key);
    }

    this.keyToEntry.delete(key);
    return true;
  }

  /**
   * Query sockets near a point within a given radius.
   * Returns sockets in reverse insertion order (topmost first).
   *
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param radius - Search radius
   * @param results - Optional pre-allocated array
   */
  queryPoint(x: number, y: number, radius: number, results?: SocketEntry[]): SocketEntry[] {
    const output = results ?? [];

    // Check if query circle could intersect this quadrant
    if (!this.circleIntersectsBounds(x, y, radius)) {
      return output;
    }

    // Check local entries (reverse order for z-ordering)
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      const dx = x - entry.x;
      const dy = y - entry.y;
      if (dx * dx + dy * dy <= radius * radius) {
        output.push(entry);
      }
    }

    // Check children
    if (this.divided) {
      this.nw!.queryPoint(x, y, radius, output);
      this.ne!.queryPoint(x, y, radius, output);
      this.sw!.queryPoint(x, y, radius, output);
      this.se!.queryPoint(x, y, radius, output);
    }

    return output;
  }

  /**
   * Update a socket's position.
   */
  update(entityId: string, socketId: string, isInput: boolean, x: number, y: number): void {
    const key = SocketQuadtree.getKey(entityId, socketId, isInput);
    /**
     * The entry object is REUSED, its coordinates rewritten, and then re-inserted.
     *
     * Still remove-then-insert, because the reverse-insertion order is load-bearing: a dragged
     * socket wins the hit test against whatever it is dropped on precisely because it is
     * re-appended (spatial.test.ts fences this). What goes is the fresh record per call — and
     * this is called once per socket of every entity that moves, on every frame of a drag, so at
     * a thousand selected nodes it was thousands of throwaway objects a frame.
     */
    const existing = this.keyToEntry.get(key);
    this.removeWithKey(entityId, socketId, isInput, key);
    if (existing) {
      existing.x = x;
      existing.y = y;
      this.insertWithKey(existing, key);
      return;
    }
    this.insertWithKey({ entityId, socketId, isInput, x, y }, key);
  }

  /**
   * Clear the quadtree.
   */
  clear(): void {
    this.entries = [];
    this.keyToEntry.clear();
    this.divided = false;
    this.nw = null;
    this.ne = null;
    this.sw = null;
    this.se = null;
  }

  /**
   * Get total socket count.
   */
  get size(): number {
    return this.keyToEntry.size;
  }

  private subdivide(): void {
    const { x, y, width, height } = this.bounds;
    const halfW = width / 2;
    const halfH = height / 2;

    this.nw = new SocketQuadtree({ x, y, width: halfW, height: halfH }, this.capacity, this.depth + 1);
    this.ne = new SocketQuadtree({ x: x + halfW, y, width: halfW, height: halfH }, this.capacity, this.depth + 1);
    this.sw = new SocketQuadtree({ x, y: y + halfH, width: halfW, height: halfH }, this.capacity, this.depth + 1);
    this.se = new SocketQuadtree({ x: x + halfW, y: y + halfH, width: halfW, height: halfH }, this.capacity, this.depth + 1);

    this.divided = true;

    // Re-insert existing entries into children
    const oldEntries = this.entries;
    this.entries = [];

    for (const entry of oldEntries) {
      this.nw.insert(entry) ||
        this.ne.insert(entry) ||
        this.sw.insert(entry) ||
        this.se.insert(entry);
    }
  }

  private containsPoint(x: number, y: number): boolean {
    return (
      x >= this.bounds.x &&
      x < this.bounds.x + this.bounds.width &&
      y >= this.bounds.y &&
      y < this.bounds.y + this.bounds.height
    );
  }

  private circleIntersectsBounds(cx: number, cy: number, r: number): boolean {
    // Find closest point on bounds to circle center
    const closestX = Math.max(this.bounds.x, Math.min(cx, this.bounds.x + this.bounds.width));
    const closestY = Math.max(this.bounds.y, Math.min(cy, this.bounds.y + this.bounds.height));

    const dx = cx - closestX;
    const dy = cy - closestY;

    return dx * dx + dy * dy <= r * r;
  }
}
