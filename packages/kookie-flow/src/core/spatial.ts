import type { Node, Socket } from '../types';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, SOCKET_RADIUS } from './constants';

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
}

/** Socket entry for socket spatial index */
export interface SocketEntry {
  nodeId: string;
  socketId: string;
  isInput: boolean;
  x: number;
  y: number;
}

/** Default quadtree capacity per node before subdivision */
const DEFAULT_CAPACITY = 8;

/** Maximum depth to prevent infinite subdivision */
const MAX_DEPTH = 10;

/** Default socket quadtree capacity (sockets are smaller, need finer granularity) */
const SOCKET_CAPACITY = 16;

/**
 * Quadtree for O(log n) spatial queries on node bounding boxes.
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
   * Insert a node into the quadtree.
   */
  insert(id: string, bounds: Bounds): boolean {
    // Check if bounds intersect with this quadrant
    if (!this.intersects(bounds)) {
      return false;
    }

    const entry: QuadtreeEntry = { id, bounds };

    // If we have capacity and haven't subdivided, store here
    if (this.entries.length < this.capacity && !this.divided) {
      this.entries.push(entry);
      this.idToEntry.set(id, entry);
      return true;
    }

    // Subdivide if we haven't already and aren't at max depth
    if (!this.divided && this.depth < MAX_DEPTH) {
      this.subdivide();
    }

    // If at max depth, just store here regardless of capacity
    if (this.depth >= MAX_DEPTH) {
      this.entries.push(entry);
      this.idToEntry.set(id, entry);
      return true;
    }

    // Try to insert into children
    // Note: Large nodes may be inserted into multiple quadrants
    let inserted = false;
    if (this.nw!.insert(id, bounds)) inserted = true;
    if (this.ne!.insert(id, bounds)) inserted = true;
    if (this.sw!.insert(id, bounds)) inserted = true;
    if (this.se!.insert(id, bounds)) inserted = true;

    if (inserted) {
      this.idToEntry.set(id, entry);
    }

    return inserted;
  }

  /**
   * Remove a node from the quadtree by ID.
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
   * Query all node IDs that contain the given point.
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
   * Query all node IDs that intersect with the given range.
   * Used for box selection.
   */
  queryRange(range: Bounds): string[] {
    const results: string[] = [];
    const seen = new Set<string>();

    this.queryRangeInternal(range, results, seen);

    return results;
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
   * Rebuild the quadtree from a list of nodes.
   * Call this on bulk changes (initial load, paste, etc.)
   */
  rebuild(nodes: Node[]): void {
    this.clear();

    // Compute world bounds from all nodes
    if (nodes.length === 0) {
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of nodes) {
      const w = node.width ?? DEFAULT_NODE_WIDTH;
      const h = node.height ?? DEFAULT_NODE_HEIGHT;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + w);
      maxY = Math.max(maxY, node.position.y + h);
    }

    // Add padding to bounds
    const padding = 1000;
    this.bounds = {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    };

    // Insert all nodes
    for (const node of nodes) {
      const bounds = getNodeBounds(node);
      this.insert(node.id, bounds);
    }
  }

  /**
   * Update a single node's position.
   * More efficient than full rebuild for single node moves.
   */
  update(id: string, bounds: Bounds): void {
    this.remove(id);
    this.insert(id, bounds);
  }

  /**
   * Batch insert multiple nodes.
   * More efficient than individual inserts for bulk operations.
   * O(k log n) where k = number of nodes to insert
   */
  batchInsert(entries: Array<{ id: string; bounds: Bounds }>): void {
    for (const { id, bounds } of entries) {
      this.insert(id, bounds);
    }
  }

  /**
   * Batch remove multiple nodes.
   * O(k log n) where k = number of nodes to remove
   */
  batchRemove(ids: string[]): void {
    for (const id of ids) {
      this.remove(id);
    }
  }

  /**
   * Incrementally add nodes without full rebuild.
   * Uses large fixed bounds so expansion is rarely needed.
   * O(k log n) where k = number of nodes to add
   */
  incrementalAdd(nodes: Node[]): void {
    if (nodes.length === 0) return;

    // Fast path: insert new nodes individually
    // Our initial bounds are large (-10000 to 10000) so most nodes will fit
    for (const node of nodes) {
      this.insert(node.id, getNodeBounds(node));
    }
  }

  /**
   * Incrementally remove nodes without full rebuild.
   * O(k log n) where k = number of nodes to remove
   */
  incrementalRemove(nodeIds: string[]): void {
    for (const id of nodeIds) {
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

    for (const entry of oldEntries) {
      this.nw.insert(entry.id, entry.bounds);
      this.ne.insert(entry.id, entry.bounds);
      this.sw.insert(entry.id, entry.bounds);
      this.se.insert(entry.id, entry.bounds);
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
 * Get bounding box for a node.
 */
export function getNodeBounds(node: Node): Bounds {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? DEFAULT_NODE_WIDTH,
    height: node.height ?? DEFAULT_NODE_HEIGHT,
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
  private static getKey(nodeId: string, socketId: string, isInput: boolean): string {
    return `${nodeId}:${socketId}:${isInput ? 'i' : 'o'}`;
  }

  /**
   * Insert a socket into the quadtree.
   */
  insert(entry: SocketEntry): boolean {
    // Check if point is within bounds
    if (!this.containsPoint(entry.x, entry.y)) {
      return false;
    }

    const key = SocketQuadtree.getKey(entry.nodeId, entry.socketId, entry.isInput);

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
    if (this.nw!.insert(entry)) {
      this.keyToEntry.set(key, entry);
      return true;
    }
    if (this.ne!.insert(entry)) {
      this.keyToEntry.set(key, entry);
      return true;
    }
    if (this.sw!.insert(entry)) {
      this.keyToEntry.set(key, entry);
      return true;
    }
    if (this.se!.insert(entry)) {
      this.keyToEntry.set(key, entry);
      return true;
    }

    return false;
  }

  /**
   * Remove a socket from the quadtree.
   */
  remove(nodeId: string, socketId: string, isInput: boolean): boolean {
    const key = SocketQuadtree.getKey(nodeId, socketId, isInput);
    if (!this.keyToEntry.has(key)) {
      return false;
    }

    // Remove from local entries
    const idx = this.entries.findIndex(
      (e) => e.nodeId === nodeId && e.socketId === socketId && e.isInput === isInput
    );
    if (idx !== -1) {
      this.entries.splice(idx, 1);
    }

    // Remove from children
    if (this.divided) {
      this.nw!.remove(nodeId, socketId, isInput);
      this.ne!.remove(nodeId, socketId, isInput);
      this.sw!.remove(nodeId, socketId, isInput);
      this.se!.remove(nodeId, socketId, isInput);
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
  update(nodeId: string, socketId: string, isInput: boolean, x: number, y: number): void {
    this.remove(nodeId, socketId, isInput);
    this.insert({ nodeId, socketId, isInput, x, y });
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
