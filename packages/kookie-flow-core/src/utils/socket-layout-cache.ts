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

import type { Entity, Socket, SocketLayoutMode } from '../types/index';
import type { ResolvedSocketLayout } from './socket-layout';
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

/** Geometry is immutable between explicit invalidations, like entities in the store. */
interface CachedLayout {
  inputs: Socket[] | undefined;
  outputs: Socket[] | undefined;
  preview: Entity['preview'];
  type: string;
  rowHeight: number;
  widgetHeight: number;
  marginTop: number;
  padding: number;
  layout: EntitySocketLayoutCache;
}

// Weak ownership releases deleted graphs. A small bounded list allows the SAME entity to be
// displayed by several editors at different sizes without either editor evicting the other.
// Sharing by socket-array identity also reuses geometry after a position/size-only entity spread.
let entityLayoutCache = new WeakMap<Entity, CachedLayout[]>();
let socketLayoutCache = new WeakMap<object, CachedLayout[]>();
const EMPTY_SOCKETS = {};
const MAX_LAYOUTS = 8;

function anchor(entity: Entity): object {
  return entity.inputs ?? entity.outputs ?? entity.preview ?? EMPTY_SOCKETS;
}

function matches(c: CachedLayout, entity: Entity, layout: ResolvedSocketLayout): boolean {
  return (
    c.inputs === entity.inputs &&
    c.outputs === entity.outputs &&
    c.preview === entity.preview &&
    c.type === entity.type &&
    c.rowHeight === layout.rowHeight &&
    c.widgetHeight === layout.widgetHeight &&
    c.marginTop === layout.marginTop &&
    c.padding === layout.padding
  );
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
  const marginTop = HEADERLESS_TYPES.has(entity.type) ? baseLayout.padding : baseLayout.marginTop;
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
  const own = entityLayoutCache.get(entity);
  if (own) {
    for (const c of own) if (matches(c, entity, socketLayout)) return c.layout;
  }
  const key = anchor(entity);
  const shared = socketLayoutCache.get(key);
  if (shared) {
    for (const c of shared) {
      if (matches(c, entity, socketLayout)) {
        if (!own) entityLayoutCache.set(entity, [c]);
        else {
          if (own.length === MAX_LAYOUTS) own.shift();
          own.push(c);
        }
        return c.layout;
      }
    }
  }
  const c: CachedLayout = {
    inputs: entity.inputs,
    outputs: entity.outputs,
    preview: entity.preview,
    type: entity.type,
    rowHeight: socketLayout.rowHeight,
    widgetHeight: socketLayout.widgetHeight,
    marginTop: socketLayout.marginTop,
    padding: socketLayout.padding,
    layout: computeEntitySocketLayout(entity, socketLayout),
  };
  if (!own) entityLayoutCache.set(entity, [c]);
  else {
    if (own.length === MAX_LAYOUTS) own.shift();
    own.push(c);
  }
  if (!shared) socketLayoutCache.set(key, [c]);
  else {
    if (shared.length === MAX_LAYOUTS) shared.shift();
    shared.push(c);
  }
  return c.layout;
}

/** Call after deliberately mutating an entity's socket configuration in place. */
export function clearEntityLayoutCache(entity: Entity): void {
  entityLayoutCache.delete(entity);
  socketLayoutCache.delete(anchor(entity));
}

/** Clear every cached layout; normally used only by tests. */
export function resetLayoutGeneration(): void {
  entityLayoutCache = new WeakMap();
  socketLayoutCache = new WeakMap();
}
