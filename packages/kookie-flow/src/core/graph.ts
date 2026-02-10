/**
 * Graph Engine (Phase 8)
 *
 * Pure functions for graph topology analysis. The store maintains the
 * AdjacencyIndex and calls these functions for queries.
 *
 * Performance invariants:
 * - Pan, zoom, drag, widget change = 0 graph recomputation
 * - Add/remove edge = 3 Map insertions + topologyVersion++
 * - Cached analysis recomputed only when topologyVersion changes
 */

import type { Edge, Entity } from '../types';

// ============================================================================
// Types
// ============================================================================

/** Pre-computed adjacency index for O(1) neighbor lookups */
export interface AdjacencyIndex {
  /** Forward: entityId → socketId → edges leaving this port */
  outgoing: Map<string, Map<string, Edge[]>>;
  /** Reverse: entityId → socketId → edges arriving at this port */
  incoming: Map<string, Map<string, Edge[]>>;
  /** All edges touching an entity (for getConnectedEdges) */
  byEntity: Map<string, Edge[]>;
}

/** Cached graph analysis, invalidated on topology change */
export interface CachedAnalysis {
  /** Version when this analysis was computed */
  topologyVersion: number;
  /** Flat execution order (null if graph has cycles) */
  topologicalOrder: string[] | null;
  /** Entities grouped by execution level (null if graph has cycles) */
  executionLevels: string[][] | null;
  /** Whether the graph contains cycles */
  hasCycles: boolean;
  /** Entity IDs that participate in cycles */
  cycleEntityIds: string[];
  /** Entities with no incoming edges */
  roots: string[];
  /** Entities with no outgoing edges */
  leaves: string[];
}

/** Validation issue found in the graph */
export type GraphValidationIssue =
  | { type: 'cycle'; entityIds: string[] }
  | { type: 'unconnected-required'; entityId: string; portId: string; portName: string }
  | { type: 'type-mismatch'; edgeId: string; sourceType: string; targetType: string };

// ============================================================================
// Adjacency Index
// ============================================================================

const DEFAULT_SOCKET = '__default__';

/** Build adjacency index from edges. O(E). */
export function buildAdjacencyIndex(edges: Edge[]): AdjacencyIndex {
  const outgoing = new Map<string, Map<string, Edge[]>>();
  const incoming = new Map<string, Map<string, Edge[]>>();
  const byEntity = new Map<string, Edge[]>();

  for (const edge of edges) {
    // --- outgoing[source][sourceSocket] ---
    let srcPorts = outgoing.get(edge.source);
    if (!srcPorts) {
      srcPorts = new Map();
      outgoing.set(edge.source, srcPorts);
    }
    const srcSocket = edge.sourceSocket ?? DEFAULT_SOCKET;
    let srcList = srcPorts.get(srcSocket);
    if (!srcList) {
      srcList = [];
      srcPorts.set(srcSocket, srcList);
    }
    srcList.push(edge);

    // --- incoming[target][targetSocket] ---
    let tgtPorts = incoming.get(edge.target);
    if (!tgtPorts) {
      tgtPorts = new Map();
      incoming.set(edge.target, tgtPorts);
    }
    const tgtSocket = edge.targetSocket ?? DEFAULT_SOCKET;
    let tgtList = tgtPorts.get(tgtSocket);
    if (!tgtList) {
      tgtList = [];
      tgtPorts.set(tgtSocket, tgtList);
    }
    tgtList.push(edge);

    // --- byEntity[source] and byEntity[target] ---
    let srcAll = byEntity.get(edge.source);
    if (!srcAll) {
      srcAll = [];
      byEntity.set(edge.source, srcAll);
    }
    srcAll.push(edge);

    if (edge.source !== edge.target) {
      let tgtAll = byEntity.get(edge.target);
      if (!tgtAll) {
        tgtAll = [];
        byEntity.set(edge.target, tgtAll);
      }
      tgtAll.push(edge);
    }
  }

  return { outgoing, incoming, byEntity };
}

// ============================================================================
// Basic Queries — O(1) via adjacency index
// ============================================================================

/** Get entity IDs that directly feed into this entity. O(1) + O(k). */
export function getIncomers(index: AdjacencyIndex, entityId: string): string[] {
  const ports = index.incoming.get(entityId);
  if (!ports) return [];
  const ids = new Set<string>();
  for (const edges of ports.values()) {
    for (const edge of edges) {
      ids.add(edge.source);
    }
  }
  return Array.from(ids);
}

/** Get entity IDs that this entity directly feeds into. O(1) + O(k). */
export function getOutgoers(index: AdjacencyIndex, entityId: string): string[] {
  const ports = index.outgoing.get(entityId);
  if (!ports) return [];
  const ids = new Set<string>();
  for (const edges of ports.values()) {
    for (const edge of edges) {
      ids.add(edge.target);
    }
  }
  return Array.from(ids);
}

/** Get all edges touching an entity. O(1). */
export function getEntityEdges(index: AdjacencyIndex, entityId: string): Edge[] {
  return index.byEntity.get(entityId) ?? [];
}

/** Get edges arriving at an entity (inputs). O(1) + O(k). */
export function getInputEdges(index: AdjacencyIndex, entityId: string): Edge[] {
  const ports = index.incoming.get(entityId);
  if (!ports) return [];
  const result: Edge[] = [];
  for (const edges of ports.values()) {
    for (const edge of edges) {
      result.push(edge);
    }
  }
  return result;
}

/** Get edges leaving an entity (outputs). O(1) + O(k). */
export function getOutputEdges(index: AdjacencyIndex, entityId: string): Edge[] {
  const ports = index.outgoing.get(entityId);
  if (!ports) return [];
  const result: Edge[] = [];
  for (const edges of ports.values()) {
    for (const edge of edges) {
      result.push(edge);
    }
  }
  return result;
}

/** Get direct edges between two specific entities. O(k). */
export function getEdgesBetween(
  index: AdjacencyIndex,
  entityA: string,
  entityB: string
): Edge[] {
  const aEdges = index.byEntity.get(entityA);
  if (!aEdges) return [];
  return aEdges.filter(
    (e) =>
      (e.source === entityA && e.target === entityB) ||
      (e.source === entityB && e.target === entityA)
  );
}

// ============================================================================
// Traversal — Iterator-based, O(k) where k = reachable nodes
// ============================================================================

/** Walk upstream from an entity, yielding all ancestor entity IDs. */
export function* walkUpstream(
  index: AdjacencyIndex,
  startEntityId: string
): Generator<string> {
  const visited = new Set<string>();
  visited.add(startEntityId);
  const stack: string[] = [];

  // Seed with direct incomers
  const incomers = getIncomers(index, startEntityId);
  for (const id of incomers) {
    if (!visited.has(id)) stack.push(id);
  }

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    yield current;

    const ports = index.incoming.get(current);
    if (ports) {
      for (const edges of ports.values()) {
        for (const edge of edges) {
          if (!visited.has(edge.source)) {
            stack.push(edge.source);
          }
        }
      }
    }
  }
}

/** Walk downstream from an entity, yielding all dependent entity IDs. */
export function* walkDownstream(
  index: AdjacencyIndex,
  startEntityId: string
): Generator<string> {
  const visited = new Set<string>();
  visited.add(startEntityId);
  const stack: string[] = [];

  // Seed with direct outgoers
  const outgoers = getOutgoers(index, startEntityId);
  for (const id of outgoers) {
    if (!visited.has(id)) stack.push(id);
  }

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    yield current;

    const ports = index.outgoing.get(current);
    if (ports) {
      for (const edges of ports.values()) {
        for (const edge of edges) {
          if (!visited.has(edge.target)) {
            stack.push(edge.target);
          }
        }
      }
    }
  }
}

// ============================================================================
// Topological Sort & Execution Levels — Kahn's Algorithm, O(V+E)
// ============================================================================

/**
 * Compute topological sort and execution levels in a single pass.
 * Uses Kahn's algorithm (BFS-based). If not all entities are processed,
 * the remaining entities are in cycles.
 *
 * @param entityIds - All entity IDs that participate in the graph
 * @param index - Pre-built adjacency index
 * @param mutedEntityIds - Entities to skip in execution order (treated as pass-through)
 */
export function computeAnalysis(
  entityIds: string[],
  index: AdjacencyIndex,
  mutedEntityIds?: ReadonlySet<string>
): Omit<CachedAnalysis, 'topologyVersion'> {
  const entityIdSet = new Set(entityIds);

  // Count in-degree for each entity (edges from entities within the set)
  const inDegree = new Map<string, number>();
  for (const id of entityIds) {
    inDegree.set(id, 0);
  }

  for (const id of entityIds) {
    const ports = index.incoming.get(id);
    if (ports) {
      for (const edges of ports.values()) {
        for (const edge of edges) {
          if (entityIdSet.has(edge.source)) {
            inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
          }
        }
      }
    }
  }

  // Kahn's BFS — level by level
  let queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  const levels: string[][] = [];
  const roots: string[] = [];
  const leafCandidates = new Set(entityIds);

  while (queue.length > 0) {
    const level: string[] = [];
    const nextQueue: string[] = [];

    for (const id of queue) {
      order.push(id);
      // Skip muted entities in level grouping but still process their edges
      if (!mutedEntityIds?.has(id)) {
        level.push(id);
      }

      // Track roots (no incoming from graph)
      const ports = index.incoming.get(id);
      let hasIncoming = false;
      if (ports) {
        for (const edges of ports.values()) {
          for (const edge of edges) {
            if (entityIdSet.has(edge.source)) {
              hasIncoming = true;
              break;
            }
          }
          if (hasIncoming) break;
        }
      }
      if (!hasIncoming) roots.push(id);

      // Decrement in-degree of outgoing neighbors
      const outPorts = index.outgoing.get(id);
      if (outPorts) {
        for (const edges of outPorts.values()) {
          for (const edge of edges) {
            if (entityIdSet.has(edge.target)) {
              leafCandidates.delete(id); // has outgoing, not a leaf
              const newDegree = (inDegree.get(edge.target) ?? 1) - 1;
              inDegree.set(edge.target, newDegree);
              if (newDegree === 0) {
                nextQueue.push(edge.target);
              }
            }
          }
        }
      }
    }

    if (level.length > 0) {
      levels.push(level);
    }
    queue = nextQueue;
  }

  const hasCycles = order.length < entityIds.length;
  const processedSet = new Set(order);
  const cycleEntityIds = hasCycles
    ? entityIds.filter((id) => !processedSet.has(id))
    : [];

  // Leaves: entities with no outgoing edges within the graph
  const leaves = Array.from(leafCandidates).filter((id) => processedSet.has(id));

  return {
    topologicalOrder: hasCycles ? null : order,
    executionLevels: hasCycles ? null : levels,
    hasCycles,
    cycleEntityIds,
    roots,
    leaves,
  };
}

// ============================================================================
// Cycle Detection — O(k) with early termination
// ============================================================================

/**
 * Would adding an edge from sourceEntityId to targetEntityId create a cycle?
 * DFS from target following outgoing edges, looking for source.
 * Called on every pointer move during connection drag — must be fast.
 *
 * O(k) where k = entities reachable downstream from target. Early termination.
 */
export function wouldCreateCycle(
  index: AdjacencyIndex,
  sourceEntityId: string,
  targetEntityId: string
): boolean {
  if (sourceEntityId === targetEntityId) return true;

  // If adding source→target, cycle exists iff target can reach source
  // via existing edges (target→...→source already exists)
  const visited = new Set<string>();
  const stack: string[] = [targetEntityId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === sourceEntityId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const ports = index.outgoing.get(current);
    if (ports) {
      for (const edges of ports.values()) {
        for (const edge of edges) {
          if (!visited.has(edge.target)) {
            if (edge.target === sourceEntityId) return true; // fast path
            stack.push(edge.target);
          }
        }
      }
    }
  }

  return false;
}

// ============================================================================
// Dirty Propagation
// ============================================================================

/**
 * Get all entities affected by a change to the given entity(s).
 * Returns downstream entities in topological order.
 *
 * @param changedEntityIds - Entity(s) that changed
 * @param index - Adjacency index
 * @param cachedOrder - Cached topological order (for sorting the result)
 * @param mutedEntityIds - Muted entities are treated as pass-through (propagation continues through them)
 */
export function getAffectedEntities(
  changedEntityIds: string | string[],
  index: AdjacencyIndex,
  cachedOrder?: string[] | null,
  mutedEntityIds?: ReadonlySet<string>
): string[] {
  const startIds = typeof changedEntityIds === 'string' ? [changedEntityIds] : changedEntityIds;
  const affected = new Set<string>();

  // Walk downstream from all changed nodes
  for (const startId of startIds) {
    for (const id of walkDownstream(index, startId)) {
      affected.add(id);
    }
  }

  if (affected.size === 0) return [];

  // If we have a cached topo order, sort the result to match execution order
  if (cachedOrder) {
    const orderIndex = new Map<string, number>();
    for (let i = 0; i < cachedOrder.length; i++) {
      orderIndex.set(cachedOrder[i], i);
    }
    return Array.from(affected).sort(
      (a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0)
    );
  }

  return Array.from(affected);
}

// ============================================================================
// Structural Queries
// ============================================================================

/**
 * Find connected components using Union-Find. O(V+E).
 * Returns a Map from component ID (smallest entity ID in component) to array of entity IDs.
 */
export function getConnectedComponents(
  entityIds: string[],
  index: AdjacencyIndex
): Map<string, string[]> {
  // Union-Find with path compression and union by rank
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();

  for (const id of entityIds) {
    parent.set(id, id);
    rank.set(id, 0);
  }

  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // Path compression
    let current = x;
    while (current !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const rankA = rank.get(rootA) ?? 0;
    const rankB = rank.get(rootB) ?? 0;
    if (rankA < rankB) {
      parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      parent.set(rootB, rootA);
    } else {
      parent.set(rootB, rootA);
      rank.set(rootA, rankA + 1);
    }
  }

  // Union entities connected by edges
  const entityIdSet = new Set(entityIds);
  for (const id of entityIds) {
    const edges = index.byEntity.get(id);
    if (edges) {
      for (const edge of edges) {
        if (entityIdSet.has(edge.source) && entityIdSet.has(edge.target)) {
          union(edge.source, edge.target);
        }
      }
    }
  }

  // Group by component
  const components = new Map<string, string[]>();
  for (const id of entityIds) {
    const root = find(id);
    let group = components.get(root);
    if (!group) {
      group = [];
      components.set(root, group);
    }
    group.push(id);
  }

  return components;
}

/** Check if two entities are in the same connected component. O(alpha(n)) ~ O(1). */
export function areConnected(
  index: AdjacencyIndex,
  entityA: string,
  entityB: string
): boolean {
  // Simple BFS from A looking for B (undirected via byEntity)
  const visited = new Set<string>();
  const stack: string[] = [entityA];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === entityB) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const edges = index.byEntity.get(current);
    if (edges) {
      for (const edge of edges) {
        const neighbor = edge.source === current ? edge.target : edge.source;
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }
  }

  return false;
}

// ============================================================================
// Subgraph Execution Order
// ============================================================================

/**
 * Get execution order for evaluating a specific entity.
 * Returns only the subgraph needed (upstream dependencies + the entity itself).
 */
export function getExecutionOrder(
  index: AdjacencyIndex,
  targetEntityId: string
): string[] {
  // Collect all upstream entities
  const needed = new Set<string>();
  needed.add(targetEntityId);
  for (const id of walkUpstream(index, targetEntityId)) {
    needed.add(id);
  }

  // Topo sort just this subgraph
  const subgraphEntities = Array.from(needed);
  const result = computeAnalysis(subgraphEntities, index);
  return result.topologicalOrder ?? subgraphEntities; // fallback if cycles
}

/**
 * Get entities ready to execute given a set of already-completed entities.
 * An entity is "ready" if all its incomers are in the completed set.
 * O(k) where k = number of candidates.
 */
export function getReadyEntities(
  entityIds: string[],
  index: AdjacencyIndex,
  completed: ReadonlySet<string>
): string[] {
  const entityIdSet = new Set(entityIds);
  const ready: string[] = [];

  for (const id of entityIds) {
    if (completed.has(id)) continue;

    // Check if all incomers are completed
    let allReady = true;
    const ports = index.incoming.get(id);
    if (ports) {
      outer: for (const edges of ports.values()) {
        for (const edge of edges) {
          if (entityIdSet.has(edge.source) && !completed.has(edge.source)) {
            allReady = false;
            break outer;
          }
        }
      }
    }

    if (allReady) ready.push(id);
  }

  return ready;
}

// ============================================================================
// Graph Mutations
// ============================================================================

/**
 * Compute the edges and entity position needed to insert an entity on an existing edge.
 * Returns the changes to apply — does NOT mutate state.
 *
 * A→B becomes A→newEntity→B
 */
export function computeInsertOnEdge(
  edgeToSplit: Edge,
  newEntity: { id: string; type: string; inputs?: { id: string }[]; outputs?: { id: string }[] },
  sourceEntity: Entity | undefined,
  targetEntity: Entity | undefined
): {
  removeEdgeId: string;
  newEdges: [Edge, Edge];
  entityPosition: { x: number; y: number };
} {
  // Position at midpoint of the two connected entities
  const sx = sourceEntity?.position.x ?? 0;
  const sy = sourceEntity?.position.y ?? 0;
  const tx = targetEntity?.position.x ?? 0;
  const ty = targetEntity?.position.y ?? 0;
  const entityPosition = { x: (sx + tx) / 2, y: (sy + ty) / 2 };

  // Pick input/output sockets on the new entity
  const newInputSocket = newEntity.inputs?.[0]?.id;
  const newOutputSocket = newEntity.outputs?.[0]?.id;

  const edgeA: Edge = {
    id: `${edgeToSplit.id}-a`,
    source: edgeToSplit.source,
    sourceSocket: edgeToSplit.sourceSocket,
    target: newEntity.id,
    targetSocket: newInputSocket,
  };

  const edgeB: Edge = {
    id: `${edgeToSplit.id}-b`,
    source: newEntity.id,
    sourceSocket: newOutputSocket,
    target: edgeToSplit.target,
    targetSocket: edgeToSplit.targetSocket,
  };

  return {
    removeEdgeId: edgeToSplit.id,
    newEdges: [edgeA, edgeB],
    entityPosition,
  };
}

/**
 * Compute the edge changes needed to bypass (remove) an entity and reconnect.
 * A→entity→B becomes A→B.
 * Matches first input to first output (or all if counts match).
 */
export function computeBypass(
  entityId: string,
  index: AdjacencyIndex
): {
  removeEdgeIds: string[];
  removeEntityId: string;
  newEdges: Edge[];
} {
  const inputEdges = getInputEdges(index, entityId);
  const outputEdges = getOutputEdges(index, entityId);
  const removeEdgeIds = [...inputEdges, ...outputEdges].map((e) => e.id);

  // Reconnect: pair input edges with output edges
  const newEdges: Edge[] = [];
  const pairCount = Math.min(inputEdges.length, outputEdges.length);
  for (let i = 0; i < pairCount; i++) {
    newEdges.push({
      id: `bypass-${entityId}-${i}`,
      source: inputEdges[i].source,
      sourceSocket: inputEdges[i].sourceSocket,
      target: outputEdges[i].target,
      targetSocket: outputEdges[i].targetSocket,
    });
  }

  return { removeEdgeIds, removeEntityId: entityId, newEdges };
}

// ============================================================================
// Graph Validation
// ============================================================================

/**
 * Validate the graph structure. Returns a list of issues found.
 *
 * Checks:
 * - Cycles (if the graph has them)
 * - Unconnected required input ports (inputs with no incoming edge and no default value)
 * - Type mismatches on edges (source/target socket types incompatible)
 *
 * @param entities - All entities in the graph
 * @param edges - All edges in the graph
 * @param index - Adjacency index
 * @param socketTypes - Socket type definitions for compatibility checking
 * @param isTypeCompatible - Optional custom type compatibility function
 */
export function validate(
  entities: Entity[],
  edges: Edge[],
  index: AdjacencyIndex,
  socketTypes?: Record<string, { compatibleWith?: string[] | '*' }>,
  isTypeCompatible?: (typeA: string, typeB: string) => boolean
): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const entityIds = entities.map((n) => n.id);

  // Check for cycles
  const analysis = computeAnalysis(entityIds, index);
  if (analysis.hasCycles) {
    issues.push({ type: 'cycle', entityIds: analysis.cycleEntityIds });
  }

  // Check for unconnected required inputs
  const entityMap = new Map(entities.map((n) => [n.id, n]));
  for (const entity of entities) {
    if (!entity.inputs) continue;
    for (const input of entity.inputs) {
      // Check if this input has any incoming edge
      const ports = index.incoming.get(entity.id);
      let hasConnection = false;
      if (ports) {
        const socketEdges = ports.get(input.id);
        if (socketEdges && socketEdges.length > 0) {
          hasConnection = true;
        }
        // Also check default socket
        if (!hasConnection) {
          const defaultEdges = ports.get(DEFAULT_SOCKET);
          if (defaultEdges && defaultEdges.length > 0) {
            hasConnection = true;
          }
        }
      }

      if (!hasConnection && input.defaultValue === undefined) {
        issues.push({
          type: 'unconnected-required',
          entityId: entity.id,
          portId: input.id,
          portName: input.name,
        });
      }
    }
  }

  // Check for type mismatches on edges
  if (socketTypes || isTypeCompatible) {
    for (const edge of edges) {
      const sourceEntity = entityMap.get(edge.source);
      const targetEntity = entityMap.get(edge.target);
      if (!sourceEntity || !targetEntity) continue;

      const sourceSocket = sourceEntity.outputs?.find(
        (s) => s.id === (edge.sourceSocket ?? DEFAULT_SOCKET)
      );
      const targetSocket = targetEntity.inputs?.find(
        (s) => s.id === (edge.targetSocket ?? DEFAULT_SOCKET)
      );
      if (!sourceSocket || !targetSocket) continue;

      let compatible = true;
      if (isTypeCompatible) {
        compatible = isTypeCompatible(sourceSocket.type, targetSocket.type);
      } else if (socketTypes) {
        compatible = defaultTypeCompatible(
          sourceSocket.type,
          targetSocket.type,
          socketTypes
        );
      }

      if (!compatible) {
        issues.push({
          type: 'type-mismatch',
          edgeId: edge.id,
          sourceType: sourceSocket.type,
          targetType: targetSocket.type,
        });
      }
    }
  }

  return issues;
}

/** Default type compatibility check (same type, 'any', or explicit compatibleWith). */
function defaultTypeCompatible(
  typeA: string,
  typeB: string,
  socketTypes: Record<string, { compatibleWith?: string[] | '*' }>
): boolean {
  if (typeA === typeB) return true;
  if (typeA === 'any' || typeB === 'any') return true;

  const configA = socketTypes[typeA];
  const configB = socketTypes[typeB];

  if (configA?.compatibleWith === '*' || configB?.compatibleWith === '*') return true;
  if (Array.isArray(configA?.compatibleWith) && configA.compatibleWith.includes(typeB)) return true;
  if (Array.isArray(configB?.compatibleWith) && configB.compatibleWith.includes(typeA)) return true;

  return false;
}

/**
 * Check if the graph is "complete" — all input ports that have no default value are connected.
 * Simpler boolean version of validate().
 */
export function isGraphComplete(
  entities: Entity[],
  index: AdjacencyIndex
): boolean {
  for (const entity of entities) {
    if (!entity.inputs) continue;
    for (const input of entity.inputs) {
      if (input.defaultValue !== undefined) continue;

      const ports = index.incoming.get(entity.id);
      let hasConnection = false;
      if (ports) {
        const socketEdges = ports.get(input.id);
        if (socketEdges && socketEdges.length > 0) {
          hasConnection = true;
        }
        if (!hasConnection) {
          const defaultEdges = ports.get(DEFAULT_SOCKET);
          if (defaultEdges && defaultEdges.length > 0) {
            hasConnection = true;
          }
        }
      }

      if (!hasConnection) return false;
    }
  }
  return true;
}

/**
 * Get compatible target ports for a given source socket during connection drag.
 * Returns port entries that the source can connect to based on type compatibility.
 *
 * @param sourceEntityId - The entity where the drag started
 * @param sourceSocketId - The socket where the drag started
 * @param isSourceInput - Whether the source socket is an input
 * @param entities - All entities
 * @param socketTypes - Socket type definitions
 * @param index - Adjacency index (for cycle checking)
 * @param allowCycles - Whether cycles are permitted
 */
export function getCompatiblePorts(
  sourceEntityId: string,
  sourceSocketId: string,
  isSourceInput: boolean,
  entities: Entity[],
  socketTypes: Record<string, { compatibleWith?: string[] | '*' }>,
  index?: AdjacencyIndex,
  allowCycles?: boolean
): Array<{ entityId: string; socketId: string; socketName: string; socketType: string }> {
  // Find source socket type
  const sourceEntity = entities.find((n) => n.id === sourceEntityId);
  if (!sourceEntity) return [];

  const sourceSockets = isSourceInput ? sourceEntity.inputs : sourceEntity.outputs;
  const sourceSocket = sourceSockets?.find((s) => s.id === sourceSocketId);
  if (!sourceSocket) return [];

  const result: Array<{ entityId: string; socketId: string; socketName: string; socketType: string }> = [];

  for (const entity of entities) {
    if (entity.id === sourceEntityId) continue; // Can't connect to self

    // If source is output, look at target inputs; if source is input, look at target outputs
    const targetSockets = isSourceInput ? entity.outputs : entity.inputs;
    if (!targetSockets) continue;

    // Check cycle prevention
    if (!allowCycles && index) {
      if (isSourceInput) {
        // Source is input, target is output → edge goes target→source
        if (wouldCreateCycle(index, entity.id, sourceEntityId)) continue;
      } else {
        // Source is output, target is input → edge goes source→target
        if (wouldCreateCycle(index, sourceEntityId, entity.id)) continue;
      }
    }

    for (const socket of targetSockets) {
      if (defaultTypeCompatible(sourceSocket.type, socket.type, socketTypes)) {
        result.push({
          entityId: entity.id,
          socketId: socket.id,
          socketName: socket.name,
          socketType: socket.type,
        });
      }
    }
  }

  return result;
}

// ============================================================================
// Subgraph Mutations
// ============================================================================

/**
 * Compute the changes needed to collapse a set of entities into a single compound/frame entity.
 *
 * Creates a frame entity that replaces the selected entities. External edges (edges
 * crossing the boundary) are reconnected to the frame entity's auto-generated ports.
 *
 * @param entityIds - Entities to collapse into a frame
 * @param frameId - ID for the new frame entity
 * @param entities - All entities
 * @param index - Adjacency index
 */
export function computeCollapseToSubgraph(
  entityIds: string[],
  frameId: string,
  entities: Entity[],
  index: AdjacencyIndex
): {
  frameEntity: {
    id: string;
    position: { x: number; y: number };
    width: number;
    height: number;
    childIds: string[];
  };
  /** Edges to remove (internal edges + boundary edges) */
  removeEdgeIds: string[];
  /** New edges reconnecting external connections to the frame */
  newEdges: Edge[];
  /** Port definitions for the frame entity */
  frameInputs: Array<{ id: string; name: string; type: string; originalEntityId: string; originalSocketId: string }>;
  frameOutputs: Array<{ id: string; name: string; type: string; originalEntityId: string; originalSocketId: string }>;
} {
  const entityIdSet = new Set(entityIds);
  const entityMap = new Map(entities.map((n) => [n.id, n]));

  // Calculate frame bounds from contained entities
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of entityIds) {
    const entity = entityMap.get(id);
    if (!entity) continue;
    const w = entity.width ?? 200;
    const h = entity.height ?? 100;
    minX = Math.min(minX, entity.position.x);
    minY = Math.min(minY, entity.position.y);
    maxX = Math.max(maxX, entity.position.x + w);
    maxY = Math.max(maxY, entity.position.y + h);
  }

  const padding = 40;
  const framePosition = { x: minX - padding, y: minY - padding };
  const frameWidth = maxX - minX + padding * 2;
  const frameHeight = maxY - minY + padding * 2;

  // Categorize edges
  const removeEdgeIds: string[] = [];
  const boundaryIncoming: Edge[] = []; // external → inside
  const boundaryOutgoing: Edge[] = []; // inside → external

  for (const id of entityIds) {
    const edges = index.byEntity.get(id);
    if (!edges) continue;
    for (const edge of edges) {
      const srcInside = entityIdSet.has(edge.source);
      const tgtInside = entityIdSet.has(edge.target);
      if (srcInside && tgtInside) {
        // Fully internal
        removeEdgeIds.push(edge.id);
      } else if (!srcInside && tgtInside) {
        // Boundary incoming
        boundaryIncoming.push(edge);
        removeEdgeIds.push(edge.id);
      } else if (srcInside && !tgtInside) {
        // Boundary outgoing
        boundaryOutgoing.push(edge);
        removeEdgeIds.push(edge.id);
      }
    }
  }

  // Deduplicate edge IDs
  const removeEdgeIdSet = new Set(removeEdgeIds);

  // Generate frame ports from boundary edges
  const frameInputs: Array<{ id: string; name: string; type: string; originalEntityId: string; originalSocketId: string }> = [];
  const frameOutputs: Array<{ id: string; name: string; type: string; originalEntityId: string; originalSocketId: string }> = [];
  const newEdges: Edge[] = [];

  // Create frame input ports for boundary incoming edges
  const seenInputs = new Map<string, string>(); // "entityId:socketId" → framePortId
  for (const edge of boundaryIncoming) {
    const key = `${edge.target}:${edge.targetSocket ?? DEFAULT_SOCKET}`;
    let framePortId = seenInputs.get(key);
    if (!framePortId) {
      framePortId = `gin-${frameInputs.length}`;
      const targetEntity = entityMap.get(edge.target);
      const targetSocket = targetEntity?.inputs?.find((s) => s.id === (edge.targetSocket ?? DEFAULT_SOCKET));
      frameInputs.push({
        id: framePortId,
        name: targetSocket?.name ?? `Input ${frameInputs.length}`,
        type: targetSocket?.type ?? 'any',
        originalEntityId: edge.target,
        originalSocketId: edge.targetSocket ?? DEFAULT_SOCKET,
      });
      seenInputs.set(key, framePortId);
    }
    // Reconnect: external source → frame input
    newEdges.push({
      id: `${frameId}-in-${newEdges.length}`,
      source: edge.source,
      sourceSocket: edge.sourceSocket,
      target: frameId,
      targetSocket: framePortId,
    });
  }

  // Create frame output ports for boundary outgoing edges
  const seenOutputs = new Map<string, string>(); // "entityId:socketId" → framePortId
  for (const edge of boundaryOutgoing) {
    const key = `${edge.source}:${edge.sourceSocket ?? DEFAULT_SOCKET}`;
    let framePortId = seenOutputs.get(key);
    if (!framePortId) {
      framePortId = `gout-${frameOutputs.length}`;
      const sourceEntity = entityMap.get(edge.source);
      const sourceSocket = sourceEntity?.outputs?.find((s) => s.id === (edge.sourceSocket ?? DEFAULT_SOCKET));
      frameOutputs.push({
        id: framePortId,
        name: sourceSocket?.name ?? `Output ${frameOutputs.length}`,
        type: sourceSocket?.type ?? 'any',
        originalEntityId: edge.source,
        originalSocketId: edge.sourceSocket ?? DEFAULT_SOCKET,
      });
      seenOutputs.set(key, framePortId);
    }
    // Reconnect: frame output → external target
    newEdges.push({
      id: `${frameId}-out-${newEdges.length}`,
      source: frameId,
      sourceSocket: framePortId,
      target: edge.target,
      targetSocket: edge.targetSocket,
    });
  }

  return {
    frameEntity: {
      id: frameId,
      position: framePosition,
      width: frameWidth,
      height: frameHeight,
      childIds: entityIds,
    },
    removeEdgeIds: Array.from(removeEdgeIdSet),
    newEdges,
    frameInputs,
    frameOutputs,
  };
}

/**
 * Compute the changes needed to expand a compound/frame entity back to its children.
 * Inverse of collapseToSubgraph.
 *
 * @param frameId - The frame entity to expand
 * @param childEntities - The entities inside the frame (restored from storage)
 * @param internalEdges - Edges between children (restored from storage)
 * @param entities - All current entities
 * @param index - Current adjacency index
 */
export function computeExpandSubgraph(
  frameId: string,
  childEntities: Entity[],
  internalEdges: Edge[],
  entities: Entity[],
  index: AdjacencyIndex,
  portMapping: {
    inputs: Array<{ framePortId: string; originalEntityId: string; originalSocketId: string }>;
    outputs: Array<{ framePortId: string; originalEntityId: string; originalSocketId: string }>;
  }
): {
  removeEntityId: string;
  removeEdgeIds: string[];
  restoreEntities: Entity[];
  restoreEdges: Edge[];
  reconnectEdges: Edge[];
} {
  // Edges connected to the frame entity
  const frameEdges = getEntityEdges(index, frameId);
  const removeEdgeIds = frameEdges.map((e) => e.id);

  // Build port mapping lookups
  const inputMap = new Map(portMapping.inputs.map((p) => [p.framePortId, p]));
  const outputMap = new Map(portMapping.outputs.map((p) => [p.framePortId, p]));

  // Reconnect external edges to original internal entities
  const reconnectEdges: Edge[] = [];

  for (const edge of frameEdges) {
    if (edge.target === frameId) {
      // Incoming edge → reconnect to original internal input
      const mapping = inputMap.get(edge.targetSocket ?? DEFAULT_SOCKET);
      if (mapping) {
        reconnectEdges.push({
          id: `expand-${frameId}-${reconnectEdges.length}`,
          source: edge.source,
          sourceSocket: edge.sourceSocket,
          target: mapping.originalEntityId,
          targetSocket: mapping.originalSocketId,
        });
      }
    } else if (edge.source === frameId) {
      // Outgoing edge → reconnect from original internal output
      const mapping = outputMap.get(edge.sourceSocket ?? DEFAULT_SOCKET);
      if (mapping) {
        reconnectEdges.push({
          id: `expand-${frameId}-${reconnectEdges.length}`,
          source: mapping.originalEntityId,
          sourceSocket: mapping.originalSocketId,
          target: edge.target,
          targetSocket: edge.targetSocket,
        });
      }
    }
  }

  return {
    removeEntityId: frameId,
    removeEdgeIds,
    restoreEntities: childEntities,
    restoreEdges: internalEdges,
    reconnectEdges,
  };
}
