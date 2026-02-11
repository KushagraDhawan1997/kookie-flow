/**
 * Socket layout cache - pre-computes Y positions for all sockets on an entity.
 *
 * Supports variable row heights via socket.layout, socket.rows, and socket.height.
 *
 * Performance characteristics:
 * - O(1) lookup per entity (after initial computation)
 * - O(n) computation where n = total sockets (computed once)
 * - Automatic invalidation when entity reference changes or socket config changes
 * - Zero allocations in hot paths (positions are numbers)
 */

import type { Entity, Socket, SocketLayoutMode } from '../types';
import type { ResolvedSocketLayout } from './style-resolver';
import { STACKED_LABEL_HEIGHT, STACKED_GAP } from '../core/constants';

// ============================================================================
// Types
// ============================================================================

/**
 * Computed layout for a single socket.
 * Pre-calculated to avoid recomputation in hot paths.
 */
export interface ComputedSocketPosition {
  /** Socket index within its array (input or output) */
  index: number;
  /** Y offset from entity top to socket center (world coords) */
  yOffset: number;
  /** Total height this socket row occupies */
  height: number;
  /** Layout mode for this socket */
  layout: SocketLayoutMode;
  /** Y offset from entity top to widget top-left (for DOM positioning) */
  widgetY: number;
  /** Widget height in pixels */
  widgetHeight: number;
  /** Y offset from entity top to label center (for stacked mode) */
  labelY: number;
}

/**
 * Cached socket layout for an entire entity.
 * Computed once when entity config changes, reused during pan/zoom/drag.
 */
export interface EntitySocketLayoutCache {
  /** Output socket positions */
  outputs: ComputedSocketPosition[];
  /** Input socket positions */
  inputs: ComputedSocketPosition[];
  /** Total computed entity height based on socket layout */
  computedHeight: number;
}

// ============================================================================
// Cache Implementation
// ============================================================================

// WeakMap for automatic cleanup when entities are GC'd
const entityLayoutCache = new WeakMap<Entity, EntitySocketLayoutCache>();

// Stable cache key to detect config changes within same entity reference
const entityCacheKeys = new WeakMap<Entity, string>();

// ID-based cache for cross-reference reuse (e.g. entity spread during resize).
// When updateEntityDimensions creates { ...existing, width, height }, the new
// object misses the WeakMap but socket arrays are the same references. This cache
// detects that and reuses the layout without calling buildCacheKey (which does
// O(sockets) string concatenation).
const entityIdCache = new Map<string, {
  inputs: Socket[] | undefined;
  outputs: Socket[] | undefined;
  layout: EntitySocketLayoutCache;
}>();

/**
 * Build a stable cache key from socket configuration.
 * Key includes all properties that affect socket positioning.
 */
function buildCacheKey(entity: Entity): string {
  const inputs = (entity.inputs ?? [])
    .map((s) => `${s.id}:${s.layout ?? 'i'}:${s.rows ?? 1}:${s.height ?? 0}`)
    .join(',');
  const outputs = (entity.outputs ?? [])
    .map((s) => `${s.id}:${s.layout ?? 'i'}:${s.rows ?? 1}:${s.height ?? 0}`)
    .join(',');
  return `${inputs}|${outputs}`;
}

/**
 * Compute the position for a single socket.
 */
function computeSocketPosition(
  socket: Socket,
  index: number,
  startY: number,
  baseLayout: ResolvedSocketLayout
): ComputedSocketPosition {
  const layout = socket.layout ?? 'inline';
  const rows = socket.rows ?? 1;

  // Determine total height for this socket row
  let height: number;
  if (socket.height !== undefined) {
    // Explicit height override takes precedence
    height = socket.height;
  } else if (layout === 'stacked') {
    // Stacked: label height + gap + widget height * rows + bottom padding
    const widgetHeight = baseLayout.widgetHeight * rows;
    height = STACKED_LABEL_HEIGHT + STACKED_GAP + widgetHeight + 8; // +8 for visual balance
  } else {
    // Inline: use row height * rows
    height = baseLayout.rowHeight * rows;
  }

  // Calculate Y positions based on layout mode
  let yOffset: number; // Socket center Y
  let labelY: number; // Label center Y (for stacked mode text positioning)
  let widgetY: number; // Widget top-left Y

  if (layout === 'stacked') {
    // Stacked: socket/label at top, widget below
    labelY = startY + STACKED_LABEL_HEIGHT / 2;
    yOffset = labelY; // Socket aligns with label
    widgetY = startY + STACKED_LABEL_HEIGHT + STACKED_GAP;
  } else {
    // Inline: socket centered vertically, widget centered in row
    yOffset = startY + height / 2;
    labelY = yOffset;
    const widgetHeight = baseLayout.widgetHeight * rows;
    widgetY = startY + (height - widgetHeight) / 2;
  }

  return {
    index,
    yOffset,
    height,
    layout,
    widgetY,
    widgetHeight: baseLayout.widgetHeight * rows,
    labelY,
  };
}

/**
 * Compute the full socket layout for an entity.
 */
function computeEntitySocketLayout(
  entity: Entity,
  baseLayout: ResolvedSocketLayout
): EntitySocketLayoutCache {
  const outputs: ComputedSocketPosition[] = [];
  const inputs: ComputedSocketPosition[] = [];

  let currentY = baseLayout.marginTop;

  // Process outputs first (they come before inputs in layout order)
  const outputSockets = entity.outputs ?? [];
  for (let i = 0; i < outputSockets.length; i++) {
    const socket = outputSockets[i];
    const computed = computeSocketPosition(socket, i, currentY, baseLayout);
    outputs.push(computed);
    currentY += computed.height;
  }

  // Process inputs
  const inputSockets = entity.inputs ?? [];
  for (let i = 0; i < inputSockets.length; i++) {
    const socket = inputSockets[i];
    const computed = computeSocketPosition(socket, i, currentY, baseLayout);
    inputs.push(computed);
    currentY += computed.height;
  }

  // Ensure minimum height even if no sockets
  if (outputs.length === 0 && inputs.length === 0) {
    currentY += baseLayout.rowHeight;
  }

  const computedHeight = currentY + baseLayout.padding;

  return { outputs, inputs, computedHeight };
}

/**
 * Get the cached socket layout for an entity.
 * Automatically computes and caches if not already cached or if config changed.
 *
 * @param entity - The entity to get layout for
 * @param socketLayout - Base socket layout from style context
 * @returns Cached socket positions and computed height
 */
export function getEntitySocketLayout(
  entity: Entity,
  socketLayout: ResolvedSocketLayout
): EntitySocketLayoutCache {
  // Fast path 1: WeakMap hit (same entity reference, e.g. during pan/zoom)
  const existingKey = entityCacheKeys.get(entity);
  if (existingKey) {
    const cached = entityLayoutCache.get(entity);
    if (cached) return cached;
  }

  // Fast path 2: ID-based reference check (entity spread during resize).
  // Socket arrays keep same references when only width/height/position change,
  // so reference equality is an O(1) check that avoids buildCacheKey's O(sockets)
  // string concatenation.
  const idCached = entityIdCache.get(entity.id);
  if (idCached &&
      idCached.inputs === entity.inputs &&
      idCached.outputs === entity.outputs) {
    // Socket config unchanged — reuse layout, update WeakMap for future hits
    entityLayoutCache.set(entity, idCached.layout);
    // Use '_' sentinel (truthy) so WeakMap fast path 1 fires on subsequent same-ref lookups
    entityCacheKeys.set(entity, existingKey ?? '_');
    return idCached.layout;
  }

  // Slow path: compute key and layout
  const currentKey = buildCacheKey(entity);

  // Check if key matches a previous computation for this entity ref
  // (handles the case where WeakMap entry existed but cache was cleared)
  if (existingKey === currentKey) {
    const cached = entityLayoutCache.get(entity);
    if (cached) return cached;
  }

  const layout = computeEntitySocketLayout(entity, socketLayout);
  entityLayoutCache.set(entity, layout);
  entityCacheKeys.set(entity, currentKey);

  // Prevent unbounded growth from deleted entities (Map doesn't auto-GC like WeakMap).
  // Entries are tiny (~100 bytes each), but clear if unreasonably large. Entries for
  // active entities are lazily re-added on next access.
  if (entityIdCache.size > 5000) {
    entityIdCache.clear();
  }
  entityIdCache.set(entity.id, {
    inputs: entity.inputs,
    outputs: entity.outputs,
    layout,
  });

  return layout;
}

/**
 * Clear the cache for a specific entity (for testing or manual invalidation).
 */
export function clearEntityLayoutCache(entity: Entity): void {
  entityLayoutCache.delete(entity);
  entityCacheKeys.delete(entity);
  entityIdCache.delete(entity.id);
}
