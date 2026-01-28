/**
 * Socket layout cache - pre-computes Y positions for all sockets on a node.
 *
 * Supports variable row heights via socket.layout, socket.rows, and socket.height.
 *
 * Performance characteristics:
 * - O(1) lookup per node (after initial computation)
 * - O(n) computation where n = total sockets (computed once)
 * - Automatic invalidation when node reference changes or socket config changes
 * - Zero allocations in hot paths (positions are numbers)
 */

import type { Node, Socket, SocketLayoutMode } from '../types';
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
  /** Y offset from node top to socket center (world coords) */
  yOffset: number;
  /** Total height this socket row occupies */
  height: number;
  /** Layout mode for this socket */
  layout: SocketLayoutMode;
  /** Y offset from node top to widget top-left (for DOM positioning) */
  widgetY: number;
  /** Widget height in pixels */
  widgetHeight: number;
  /** Y offset from node top to label center (for stacked mode) */
  labelY: number;
}

/**
 * Cached socket layout for an entire node.
 * Computed once when node config changes, reused during pan/zoom/drag.
 */
export interface NodeSocketLayoutCache {
  /** Output socket positions */
  outputs: ComputedSocketPosition[];
  /** Input socket positions */
  inputs: ComputedSocketPosition[];
  /** Total computed node height based on socket layout */
  computedHeight: number;
}

// ============================================================================
// Cache Implementation
// ============================================================================

// WeakMap for automatic cleanup when nodes are GC'd
const nodeLayoutCache = new WeakMap<Node, NodeSocketLayoutCache>();

// Stable cache key to detect config changes within same node reference
const nodeCacheKeys = new WeakMap<Node, string>();

/**
 * Build a stable cache key from socket configuration.
 * Key includes all properties that affect socket positioning.
 */
function buildCacheKey(node: Node): string {
  const inputs = (node.inputs ?? [])
    .map((s) => `${s.id}:${s.layout ?? 'i'}:${s.rows ?? 1}:${s.height ?? 0}`)
    .join(',');
  const outputs = (node.outputs ?? [])
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
 * Compute the full socket layout for a node.
 */
function computeNodeSocketLayout(
  node: Node,
  baseLayout: ResolvedSocketLayout
): NodeSocketLayoutCache {
  const outputs: ComputedSocketPosition[] = [];
  const inputs: ComputedSocketPosition[] = [];

  let currentY = baseLayout.marginTop;

  // Process outputs first (they come before inputs in layout order)
  const outputSockets = node.outputs ?? [];
  for (let i = 0; i < outputSockets.length; i++) {
    const socket = outputSockets[i];
    const computed = computeSocketPosition(socket, i, currentY, baseLayout);
    outputs.push(computed);
    currentY += computed.height;
  }

  // Process inputs
  const inputSockets = node.inputs ?? [];
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
 * Get the cached socket layout for a node.
 * Automatically computes and caches if not already cached or if config changed.
 *
 * @param node - The node to get layout for
 * @param socketLayout - Base socket layout from style context
 * @returns Cached socket positions and computed height
 */
export function getNodeSocketLayout(
  node: Node,
  socketLayout: ResolvedSocketLayout
): NodeSocketLayoutCache {
  const existingKey = nodeCacheKeys.get(node);
  const currentKey = buildCacheKey(node);

  // Return cached if key matches
  if (existingKey === currentKey) {
    const cached = nodeLayoutCache.get(node);
    if (cached) return cached;
  }

  // Compute new layout
  const layout = computeNodeSocketLayout(node, socketLayout);
  nodeLayoutCache.set(node, layout);
  nodeCacheKeys.set(node, currentKey);

  return layout;
}

/**
 * Clear the cache for a specific node (for testing or manual invalidation).
 */
export function clearNodeLayoutCache(node: Node): void {
  nodeLayoutCache.delete(node);
  nodeCacheKeys.delete(node);
}
