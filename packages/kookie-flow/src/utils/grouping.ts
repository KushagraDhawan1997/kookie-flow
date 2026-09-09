/**
 * Grouping utilities for Phase 7C
 * Helper functions for entity grouping, hierarchy traversal, and bounds calculation.
 */

import type { Entity, XYPosition } from '../types';

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
 * Get direct children of a group entity.
 * O(n) where n = total entities.
 */
export function getGroupChildren(entities: Entity[], groupId: string): Entity[] {
  return entities.filter((entity) => entity.parentId === groupId);
}

/**
 * Get all descendants of a group entity (recursive).
 * O(n) where n = total entities (single pass with memoization).
 */
export function getGroupDescendants(entities: Entity[], groupId: string): Entity[] {
  const descendants: Entity[] = [];
  const childIds = new Set<string>();

  // Build parent -> children map for O(1) child lookup
  const childrenMap = new Map<string, Entity[]>();
  for (const entity of entities) {
    if (entity.parentId) {
      const children = childrenMap.get(entity.parentId) ?? [];
      children.push(entity);
      childrenMap.set(entity.parentId, children);
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
 * Check if an entity is inside a collapsed group (and should be hidden).
 * Walks up the parent chain - if any ancestor is collapsed, entity is hidden.
 */
/**
 * Walk an entity's parent chain, stopping if it revisits an id.
 *
 * Every chain walk in this file was previously unbounded, and a cycle in `parentId` hangs the tab
 * rather than throwing. `setEntityParent` guards against CREATING one, but `setEntities` and
 * `applyEntityChanges({type:'parent'})` are public and do not — and `isEntityHidden` is called for
 * every entity inside `rebuildDerivedState`, which runs on every entity change, so one bad
 * document freezes the page on the next render.
 *
 * `wouldCreateCycle` needed this too: it detects a cycle it would create, and hangs on one that
 * already exists.
 *
 * Yields each ancestor id in order. A repeated id ends the walk.
 */
function* walkParents(
  startId: string | undefined,
  entityMap: Map<string, Entity>
): Generator<string> {
  const seen = new Set<string>();
  let currentId = startId;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    yield currentId;
    currentId = entityMap.get(currentId)?.parentId;
  }
}

export function isEntityHidden(
  entity: Entity,
  entityMap: Map<string, Entity>,
  collapsedGroupIds: Set<string>
): boolean {
  for (const ancestorId of walkParents(entity.parentId, entityMap)) {
    if (collapsedGroupIds.has(ancestorId)) {
      return true;
    }
  }
  return false;
}

/**
 * Get visible entities (filter out entities inside collapsed groups).
 * O(n) with parent chain walking.
 */
export function getVisibleEntities(
  entities: Entity[],
  entityMap: Map<string, Entity>,
  collapsedGroupIds: Set<string>
): Entity[] {
  if (collapsedGroupIds.size === 0) {
    return entities;
  }
  return entities.filter((entity) => !isEntityHidden(entity, entityMap, collapsedGroupIds));
}

/**
 * Calculate bounds that encompass all child entities of a group.
 * Returns null if group has no children.
 */
export function calculateGroupBounds(
  entities: Entity[],
  groupId: string,
  padding: number = GROUP_PADDING
): Bounds | null {
  const children = getGroupChildren(entities, groupId);

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
 * Get the parent chain from an entity up to the root.
 * Returns array from immediate parent to root (empty if no parent).
 */
export function getParentChain(entity: Entity, entityMap: Map<string, Entity>): Entity[] {
  const chain: Entity[] = [];

  for (const ancestorId of walkParents(entity.parentId, entityMap)) {
    const parent = entityMap.get(ancestorId);
    if (!parent) break;
    chain.push(parent);
  }

  return chain;
}

/**
 * Check if entityA is a descendant of entityB.
 */
export function isDescendantOf(
  entityA: Entity,
  entityB: Entity,
  entityMap: Map<string, Entity>
): boolean {
  for (const ancestorId of walkParents(entityA.parentId, entityMap)) {
    if (ancestorId === entityB.id) {
      return true;
    }
  }
  return false;
}

/**
 * Move all descendants when a group is moved.
 * Returns a map of entityId -> new position.
 */
export function calculateDescendantPositions(
  entities: Entity[],
  groupId: string,
  delta: XYPosition
): Map<string, XYPosition> {
  const descendants = getGroupDescendants(entities, groupId);
  const positions = new Map<string, XYPosition>();

  for (const entity of descendants) {
    positions.set(entity.id, {
      x: entity.position.x + delta.x,
      y: entity.position.y + delta.y,
    });
  }

  return positions;
}

/**
 * Get all groups that are ancestors of any of the given entities.
 * Useful for determining which groups need visual updates.
 */
export function getAncestorGroups(
  entities: Entity[],
  entityMap: Map<string, Entity>
): Set<string> {
  const ancestors = new Set<string>();

  for (const entity of entities) {
    for (const ancestorId of walkParents(entity.parentId, entityMap)) {
      ancestors.add(ancestorId);
    }
  }

  return ancestors;
}

/**
 * Validate that adding a parent relationship doesn't create a cycle.
 */
export function wouldCreateCycle(
  entityId: string,
  proposedParentId: string,
  entityMap: Map<string, Entity>
): boolean {
  // Check if proposedParentId is a descendant of entityId
  const entity = entityMap.get(entityId);
  if (!entity) return false;

  // Walk up from proposedParent to see if we reach entityId.
  // walkParents also terminates on a PRE-EXISTING cycle, which the old unbounded loop did not.
  for (const ancestorId of walkParents(proposedParentId, entityMap)) {
    if (ancestorId === entityId) {
      return true; // Cycle detected
    }
  }

  return false;
}

/**
 * Get all top-level entities (entities without a parent or whose parent doesn't exist).
 */
export function getTopLevelEntities(entities: Entity[], entityMap: Map<string, Entity>): Entity[] {
  return entities.filter((entity) => {
    if (!entity.parentId) return true;
    return !entityMap.has(entity.parentId);
  });
}

/**
 * Sort entities so parents come before children (topological sort by depth).
 * Useful for rendering groups before their children.
 */
export function sortByDepth(entities: Entity[], entityMap: Map<string, Entity>): Entity[] {
  const depths = new Map<string, number>();

  function getDepth(entity: Entity): number {
    const cached = depths.get(entity.id);
    if (cached !== undefined) return cached;

    // Written BEFORE the recursive call: a cycle would otherwise recurse until the stack blows,
    // because the memo was only filled on the way back out.
    depths.set(entity.id, 0);

    if (!entity.parentId) {
      depths.set(entity.id, 0);
      return 0;
    }

    const parent = entityMap.get(entity.parentId);
    if (!parent) {
      depths.set(entity.id, 0);
      return 0;
    }

    const depth = getDepth(parent) + 1;
    depths.set(entity.id, depth);
    return depth;
  }

  // Calculate depths
  for (const entity of entities) {
    getDepth(entity);
  }

  // Sort by depth (ascending = parents first)
  return [...entities].sort((a, b) => {
    return (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0);
  });
}
