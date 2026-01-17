import type { Node, XYPosition, Viewport, SocketHandle } from '../types';
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  SOCKET_RADIUS,
  SOCKET_SPACING,
  SOCKET_MARGIN_TOP,
  SOCKET_HIT_TOLERANCE,
} from '../core/constants';

/**
 * Convert screen coordinates to world coordinates.
 */
export function screenToWorld(
  screenPos: XYPosition,
  viewport: Viewport
): XYPosition {
  return {
    x: (screenPos.x - viewport.x) / viewport.zoom,
    y: (screenPos.y - viewport.y) / viewport.zoom,
  };
}

/**
 * Convert world coordinates to screen coordinates.
 */
export function worldToScreen(
  worldPos: XYPosition,
  viewport: Viewport
): XYPosition {
  return {
    x: worldPos.x * viewport.zoom + viewport.x,
    y: worldPos.y * viewport.zoom + viewport.y,
  };
}

/**
 * Check if a point is inside a node's bounds.
 */
export function isPointInNode(
  point: XYPosition,
  node: Node
): boolean {
  const width = node.width ?? DEFAULT_NODE_WIDTH;
  const height = node.height ?? DEFAULT_NODE_HEIGHT;

  return (
    point.x >= node.position.x &&
    point.x <= node.position.x + width &&
    point.y >= node.position.y &&
    point.y <= node.position.y + height
  );
}

/**
 * Find the topmost node at a given world position.
 * Returns null if no node is at that position.
 * Nodes later in the array are considered "on top".
 */
export function getNodeAtPosition(
  worldPos: XYPosition,
  nodes: Node[]
): Node | null {
  // Iterate in reverse to find topmost node first
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (isPointInNode(worldPos, nodes[i])) {
      return nodes[i];
    }
  }
  return null;
}

/**
 * Check if two axis-aligned bounding boxes intersect.
 */
export function boxesIntersect(
  box1: { x: number; y: number; width: number; height: number },
  box2: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    box1.x < box2.x + box2.width &&
    box1.x + box1.width > box2.x &&
    box1.y < box2.y + box2.height &&
    box1.y + box1.height > box2.y
  );
}

/**
 * Get all nodes that intersect with a selection box.
 */
export function getNodesInBox(
  start: XYPosition,
  end: XYPosition,
  nodes: Node[]
): Node[] {
  // Normalize the box (handle any drag direction)
  const boxX = Math.min(start.x, end.x);
  const boxY = Math.min(start.y, end.y);
  const boxWidth = Math.abs(end.x - start.x);
  const boxHeight = Math.abs(end.y - start.y);

  const selectionBox = {
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
  };

  return nodes.filter((node) => {
    const nodeBox = {
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? DEFAULT_NODE_WIDTH,
      height: node.height ?? DEFAULT_NODE_HEIGHT,
    };
    return boxesIntersect(selectionBox, nodeBox);
  });
}

/**
 * Calculate world position of a socket on a node.
 * Inputs are on the left edge, outputs on the right edge.
 */
export function getSocketPosition(
  node: Node,
  socketId: string,
  isInput: boolean
): XYPosition | null {
  const sockets = isInput ? node.inputs : node.outputs;
  if (!sockets) return null;

  const index = sockets.findIndex((s) => s.id === socketId);
  if (index === -1) return null;

  const width = node.width ?? DEFAULT_NODE_WIDTH;
  const height = node.height ?? DEFAULT_NODE_HEIGHT;

  // Use socket.position if defined (0-1 range), otherwise calculate from index
  const socket = sockets[index];
  const yOffset =
    socket.position !== undefined
      ? socket.position * height
      : SOCKET_MARGIN_TOP + index * SOCKET_SPACING;

  return {
    x: isInput ? node.position.x : node.position.x + width,
    y: node.position.y + yOffset,
  };
}

/**
 * Find socket at a world position.
 * Uses brute force with viewport culling - performant for typical socket counts.
 */
export function getSocketAtPosition(
  worldPos: XYPosition,
  nodes: Node[],
  viewport: Viewport,
  canvasSize: { width: number; height: number }
): SocketHandle | null {
  const hitRadius = SOCKET_RADIUS + SOCKET_HIT_TOLERANCE;
  const hitRadiusSq = hitRadius * hitRadius;

  // Viewport bounds for culling
  const invZoom = 1 / viewport.zoom;
  const viewLeft = -viewport.x * invZoom;
  const viewRight = (canvasSize.width - viewport.x) * invZoom;
  const viewTop = -viewport.y * invZoom;
  const viewBottom = (canvasSize.height - viewport.y) * invZoom;
  const padding = 50;

  // Iterate in reverse for z-ordering (topmost node first)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const width = node.width ?? DEFAULT_NODE_WIDTH;
    const height = node.height ?? DEFAULT_NODE_HEIGHT;

    // Skip nodes outside viewport
    if (
      node.position.x + width < viewLeft - padding ||
      node.position.x > viewRight + padding ||
      node.position.y + height < viewTop - padding ||
      node.position.y > viewBottom + padding
    ) {
      continue;
    }

    // Check input sockets
    if (node.inputs) {
      for (const socket of node.inputs) {
        const pos = getSocketPosition(node, socket.id, true);
        if (!pos) continue;

        const dx = worldPos.x - pos.x;
        const dy = worldPos.y - pos.y;
        if (dx * dx + dy * dy < hitRadiusSq) {
          return { nodeId: node.id, socketId: socket.id, isInput: true };
        }
      }
    }

    // Check output sockets
    if (node.outputs) {
      for (const socket of node.outputs) {
        const pos = getSocketPosition(node, socket.id, false);
        if (!pos) continue;

        const dx = worldPos.x - pos.x;
        const dy = worldPos.y - pos.y;
        if (dx * dx + dy * dy < hitRadiusSq) {
          return { nodeId: node.id, socketId: socket.id, isInput: false };
        }
      }
    }
  }

  return null;
}
