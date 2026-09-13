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
  /** Top of the preview band, from the entity's top edge. 0 when there is no band. */
  previewY: number;
  /** The band's height. 0 when the entity has no preview. */
  previewHeight: number;
}

/** What a preview band takes when the entity names no height of its own. */
export const DEFAULT_PREVIEW_HEIGHT = 160;

// ============================================================================
// Cache Implementation
// ============================================================================

// WeakMap for automatic cleanup when entities are GC'd
const entityLayoutCache = new WeakMap<Entity, EntitySocketLayoutCache>();

// Stable cache key to detect config changes within same entity reference
const entityCacheKeys = new WeakMap<Entity, string>();
/** Generation each WeakMap entry was computed under; a mismatch means the layout moved. */
const entityCacheGen = new WeakMap<Entity, number>();

// ID-based cache for cross-reference reuse (e.g. entity spread during resize).
// When updateEntityDimensions creates { ...existing, width, height }, the new
// object misses the WeakMap but socket arrays are the same references. This cache
// detects that and reuses the layout without calling buildCacheKey (which does
// O(sockets) string concatenation).
const entityIdCache = new Map<string, {
  inputs: Socket[] | undefined;
  outputs: Socket[] | undefined;
  /**
   * The other two things the layout depends on.
   *
   * They are here because this fast path answers on identity alone, and anything it does not
   * compare is a change it cannot see: a preview band appearing, or an entity changing type into
   * a headerless one, both moved every row below them while this returned the previous answer.
   */
  preview: Entity['preview'];
  type: string;
  layout: EntitySocketLayoutCache;
}>();

/**
 * The layout the cached entries were computed WITH.
 *
 * `socketLayout` is a parameter of `getEntitySocketLayout` and was never part of any cache key, so
 * a runtime `size` or density change returned the layout computed under the previous one — socket
 * Y, entity heights, widget rows, outlines and hit boxes all stayed at the old size.
 *
 * Compared BY VALUE, not by reference. `StyleProvider`'s memo lists `entityStyle`, so a caller
 * passing an inline object literal produces a fresh `socketLayout` on every render; a reference
 * compare would clear all three caches every frame and recompute every entity's layout. The five
 * fields are numbers, so this is O(1) and allocation-free.
 */
let activeLayout: ResolvedSocketLayout | null = null;

function sameLayout(a: ResolvedSocketLayout, b: ResolvedSocketLayout): boolean {
  return (
    a.rowHeight === b.rowHeight &&
    a.widgetHeight === b.widgetHeight &&
    a.marginTop === b.marginTop &&
    a.socketSize === b.socketSize &&
    a.padding === b.padding
  );
}

/**
 * Drop every cached layout when the layout parameters actually change.
 *
 * The WeakMaps cannot be cleared, so their entries are invalidated by bumping a generation that
 * the cached value carries. The id map is a real Map and is cleared outright.
 */
let layoutGeneration = 0;

function noteLayout(socketLayout: ResolvedSocketLayout): void {
  if (activeLayout !== null && sameLayout(activeLayout, socketLayout)) return;
  activeLayout = socketLayout;
  layoutGeneration++;
  entityIdCache.clear();
}

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
  // `position` belongs in the key and `fit` does not: where the band sits moves every row below
  // it, while how the picture fills the band is a drawing decision the layout never sees.
  const preview = entity.preview
    ? `${entity.preview.socket}:${entity.preview.height ?? DEFAULT_PREVIEW_HEIGHT}:${entity.preview.position ?? 'bottom'}`
    : '';
  return `${entity.type}|${inputs}|${outputs}|${preview}`;
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

/** Entity types that have no header and should center sockets vertically */
const HEADERLESS_TYPES = new Set(['text', 'comment', 'reroute', 'image', 'video', 'mesh']);

/**
 * Compute the full socket layout for an entity.
 */
function computeEntitySocketLayout(
  entity: Entity,
  baseLayout: ResolvedSocketLayout
): EntitySocketLayoutCache {
  const outputs: ComputedSocketPosition[] = [];
  const inputs: ComputedSocketPosition[] = [];

  // Headerless entity types use padding-only marginTop (no header row)
  const marginTop = HEADERLESS_TYPES.has(entity.type)
    ? baseLayout.padding
    : baseLayout.marginTop;
  let currentY = marginTop;

  // The band's height is settled before anything is placed, because it may come FIRST.
  const previewHeight = entity.preview
    ? Math.max(0, entity.preview.height ?? DEFAULT_PREVIEW_HEIGHT)
    : 0;
  const previewAtTop = entity.preview?.position === 'top';
  let previewY = 0;
  if (entity.preview && previewAtTop) {
    /**
     * A LEADING BAND OWES ITSELF THE SAME MARGIN IT HAS EITHER SIDE.
     *
     * `marginTop` is `padding + titleBand`, and the title band is the line box plus the row's own
     * inset — so content begins flush against the bottom of the title's air. A socket row hides
     * that, because its label is centred inside a tall row and the space arrives for free. A
     * picture has no such inside: its pixels start on that edge, and the title sits on the frame.
     * The band is already inset by `padding` left and right, so it takes the same above, and the
     * picture ends up in an even margin on three sides.
     */
    currentY += baseLayout.padding;
    previewY = currentY;
    currentY += previewHeight;
  }

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
  if (outputs.length === 0 && inputs.length === 0 && !entity.preview) {
    currentY += baseLayout.rowHeight;
  }

  /**
   * The preview band goes UNDER the sockets unless it asked to lead.
   *
   * Under by default, so that adding one to an existing node moves nothing: every socket keeps
   * the row it had and the card simply grows downwards. A node whose picture is its whole point
   * says `position: 'top'` and was placed above, before the outputs. Either way it is inset by
   * the body's padding on each side, like everything else drawn in the body.
   */
  if (entity.preview && !previewAtTop) {
    previewY = currentY;
    currentY += previewHeight;
  }

  const computedHeight = currentY + baseLayout.padding;

  return { outputs, inputs, computedHeight, previewY, previewHeight };
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
  // If the layout parameters moved (a runtime size or density change), every cached entry was
  // computed under the old ones and must not be reused.
  noteLayout(socketLayout);

  // Fast path 1: WeakMap hit (same entity reference, e.g. during pan/zoom)
  const existingKey = entityCacheKeys.get(entity);
  if (existingKey && entityCacheGen.get(entity) === layoutGeneration) {
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
      idCached.outputs === entity.outputs &&
      idCached.preview === entity.preview &&
      idCached.type === entity.type) {
    // Socket config unchanged — reuse layout, update WeakMap for future hits
    entityLayoutCache.set(entity, idCached.layout);
    // Use '_' sentinel (truthy) so WeakMap fast path 1 fires on subsequent same-ref lookups
    entityCacheKeys.set(entity, existingKey ?? '_');
    entityCacheGen.set(entity, layoutGeneration);
    return idCached.layout;
  }

  // Slow path: compute key and layout
  const currentKey = buildCacheKey(entity);

  // Check if key matches a previous computation for this entity ref
  // (handles the case where WeakMap entry existed but cache was cleared)
  if (existingKey === currentKey && entityCacheGen.get(entity) === layoutGeneration) {
    const cached = entityLayoutCache.get(entity);
    if (cached) return cached;
  }

  const layout = computeEntitySocketLayout(entity, socketLayout);
  entityLayoutCache.set(entity, layout);
  entityCacheKeys.set(entity, currentKey);
  entityCacheGen.set(entity, layoutGeneration);

  // Prevent unbounded growth from deleted entities (Map doesn't auto-GC like WeakMap).
  // Entries are tiny (~100 bytes each), but clear if unreasonably large. Entries for
  // active entities are lazily re-added on next access.
  if (entityIdCache.size > 5000) {
    entityIdCache.clear();
  }
  entityIdCache.set(entity.id, {
    inputs: entity.inputs,
    outputs: entity.outputs,
    preview: entity.preview,
    type: entity.type,
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
  entityCacheGen.delete(entity);
  entityIdCache.delete(entity.id);
}

/** Test seam: forget which layout the caches were built with. */
export function resetLayoutGeneration(): void {
  activeLayout = null;
  entityIdCache.clear();
}
