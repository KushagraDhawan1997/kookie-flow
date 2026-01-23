import type { Node } from '../types';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from './constants';

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

/** Default quadtree capacity per node before subdivision */
const DEFAULT_CAPACITY = 8;

/** Maximum depth to prevent infinite subdivision */
const MAX_DEPTH = 10;

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
