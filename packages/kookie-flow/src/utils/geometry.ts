import type { Node, XYPosition, Viewport } from '../types';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../core/constants';

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
