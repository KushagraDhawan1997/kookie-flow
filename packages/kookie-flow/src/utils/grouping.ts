/**
 * Grouping utilities for Phase 7C
 * Helper functions for node grouping, hierarchy traversal, and bounds calculation.
 */

import type { Node, XYPosition } from '../types';

/** Group padding when calculating bounds from children */
export const GROUP_PADDING = 24;

/** Minimum group dimensions */
export const MIN_GROUP_WIDTH = 100;
export const MIN_GROUP_HEIGHT = 80;

/** Bounds rectangle */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Get direct children of a group node.
 * O(n) where n = total nodes.
 */
export function getGroupChildren(nodes: Node[], groupId: string): Node[] {
  return nodes.filter((node) => node.parentId === groupId);
}

/**
 * Get all descendants of a group node (recursive).
 * O(n) where n = total nodes (single pass with memoization).
 */
export function getGroupDescendants(nodes: Node[], groupId: string): Node[] {
  const descendants: Node[] = [];
  const childIds = new Set<string>();

  // Build parent -> children map for O(1) child lookup
  const childrenMap = new Map<string, Node[]>();
  for (const node of nodes) {
    if (node.parentId) {
      const children = childrenMap.get(node.parentId) ?? [];
      children.push(node);
      childrenMap.set(node.parentId, children);
    }
  }

  // BFS traversal
  const queue = [groupId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = childrenMap.get(currentId) ?? [];
    for (const child of children) {
      if (!childIds.has(child.id)) {
        childIds.add(child.id);
        descendants.push(child);
        queue.push(child.id);
      }
    }
  }

  return descendants;
}

/**
 * Check if a node is inside a collapsed group (and should be hidden).
 * Walks up the parent chain - if any ancestor is collapsed, node is hidden.
 */
export function isNodeHidden(
  node: Node,
  nodeMap: Map<string, Node>,
  collapsedGroupIds: Set<string>
): boolean {
  let currentId = node.parentId;
  while (currentId) {
    if (collapsedGroupIds.has(currentId)) {
      return true;
    }
    const parent = nodeMap.get(currentId);
    currentId = parent?.parentId;
  }
  return false;
}

/**
 * Get visible nodes (filter out nodes inside collapsed groups).
 * O(n) with parent chain walking.
 */
export function getVisibleNodes(
  nodes: Node[],
  nodeMap: Map<string, Node>,
  collapsedGroupIds: Set<string>
): Node[] {
  if (collapsedGroupIds.size === 0) {
    return nodes;
  }
  return nodes.filter((node) => !isNodeHidden(node, nodeMap, collapsedGroupIds));
}

/**
 * Calculate bounds that encompass all child nodes of a group.
 * Returns null if group has no children.
 */
export function calculateGroupBounds(
  nodes: Node[],
  groupId: string,
  padding: number = GROUP_PADDING
): Bounds | null {
  const children = getGroupChildren(nodes, groupId);

  if (children.length === 0) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const child of children) {
    const width = child.width ?? 200;
    const height = child.height ?? 100;

    minX = Math.min(minX, child.position.x);
    minY = Math.min(minY, child.position.y);
    maxX = Math.max(maxX, child.position.x + width);
    maxY = Math.max(maxY, child.position.y + height);
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(maxX - minX + padding * 2, MIN_GROUP_WIDTH),
    height: Math.max(maxY - minY + padding * 2, MIN_GROUP_HEIGHT),
  };
}

/**
 * Get the parent chain from a node up to the root.
 * Returns array from immediate parent to root (empty if no parent).
 */
export function getParentChain(node: Node, nodeMap: Map<string, Node>): Node[] {
  const chain: Node[] = [];
  let currentId = node.parentId;

  while (currentId) {
    const parent = nodeMap.get(currentId);
    if (!parent) break;
    chain.push(parent);
    currentId = parent.parentId;
  }

  return chain;
}

/**
 * Check if nodeA is a descendant of nodeB.
 */
export function isDescendantOf(
  nodeA: Node,
  nodeB: Node,
  nodeMap: Map<string, Node>
): boolean {
  let currentId = nodeA.parentId;
  while (currentId) {
    if (currentId === nodeB.id) {
      return true;
    }
    const parent = nodeMap.get(currentId);
    currentId = parent?.parentId;
  }
  return false;
}

/**
 * Move all descendants when a group is moved.
 * Returns a map of nodeId -> new position.
 */
export function calculateDescendantPositions(
  nodes: Node[],
  groupId: string,
  delta: XYPosition
): Map<string, XYPosition> {
  const descendants = getGroupDescendants(nodes, groupId);
  const positions = new Map<string, XYPosition>();

  for (const node of descendants) {
    positions.set(node.id, {
      x: node.position.x + delta.x,
      y: node.position.y + delta.y,
    });
  }

  return positions;
}

/**
 * Get all groups that are ancestors of any of the given nodes.
 * Useful for determining which groups need visual updates.
 */
export function getAncestorGroups(
  nodes: Node[],
  nodeMap: Map<string, Node>
): Set<string> {
  const ancestors = new Set<string>();

  for (const node of nodes) {
    let currentId = node.parentId;
    while (currentId) {
      ancestors.add(currentId);
      const parent = nodeMap.get(currentId);
      currentId = parent?.parentId;
    }
  }

  return ancestors;
}

/**
 * Validate that adding a parent relationship doesn't create a cycle.
 */
export function wouldCreateCycle(
  nodeId: string,
  proposedParentId: string,
  nodeMap: Map<string, Node>
): boolean {
  // Check if proposedParentId is a descendant of nodeId
  const node = nodeMap.get(nodeId);
  if (!node) return false;

  // Walk up from proposedParent to see if we reach nodeId
  let currentId: string | undefined = proposedParentId;
  while (currentId) {
    if (currentId === nodeId) {
      return true; // Cycle detected
    }
    const parent = nodeMap.get(currentId);
    currentId = parent?.parentId;
  }

  return false;
}

/**
 * Get all top-level nodes (nodes without a parent or whose parent doesn't exist).
 */
export function getTopLevelNodes(nodes: Node[], nodeMap: Map<string, Node>): Node[] {
  return nodes.filter((node) => {
    if (!node.parentId) return true;
    return !nodeMap.has(node.parentId);
  });
}

/**
 * Sort nodes so parents come before children (topological sort by depth).
 * Useful for rendering groups before their children.
 */
export function sortByDepth(nodes: Node[], nodeMap: Map<string, Node>): Node[] {
  const depths = new Map<string, number>();

  function getDepth(node: Node): number {
    const cached = depths.get(node.id);
    if (cached !== undefined) return cached;

    if (!node.parentId) {
      depths.set(node.id, 0);
      return 0;
    }

    const parent = nodeMap.get(node.parentId);
    if (!parent) {
      depths.set(node.id, 0);
      return 0;
    }

    const depth = getDepth(parent) + 1;
    depths.set(node.id, depth);
    return depth;
  }

  // Calculate depths
  for (const node of nodes) {
    getDepth(node);
  }

  // Sort by depth (ascending = parents first)
  return [...nodes].sort((a, b) => {
    return (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0);
  });
}
