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

import type { Edge, Node } from '../types';

// ============================================================================
// Types
// ============================================================================

/** Pre-computed adjacency index for O(1) neighbor lookups */
export interface AdjacencyIndex {
  /** Forward: nodeId → socketId → edges leaving this port */
  outgoing: Map<string, Map<string, Edge[]>>;
  /** Reverse: nodeId → socketId → edges arriving at this port */
  incoming: Map<string, Map<string, Edge[]>>;
  /** All edges touching a node (for getConnectedEdges) */
  byNode: Map<string, Edge[]>;
}

/** Cached graph analysis, invalidated on topology change */
export interface CachedAnalysis {
  /** Version when this analysis was computed */
  topologyVersion: number;
  /** Flat execution order (null if graph has cycles) */
  topologicalOrder: string[] | null;
  /** Nodes grouped by execution level (null if graph has cycles) */
  executionLevels: string[][] | null;
  /** Whether the graph contains cycles */
  hasCycles: boolean;
  /** Node IDs that participate in cycles */
  cycleNodeIds: string[];
  /** Nodes with no incoming edges */
  roots: string[];
  /** Nodes with no outgoing edges */
  leaves: string[];
}

/** Validation issue found in the graph */
export type GraphValidationIssue =
  | { type: 'cycle'; nodeIds: string[] }
  | { type: 'unconnected-required'; nodeId: string; portId: string; portName: string }
  | { type: 'type-mismatch'; edgeId: string; sourceType: string; targetType: string };

// ============================================================================
// Adjacency Index
// ============================================================================

const DEFAULT_SOCKET = '__default__';

/** Build adjacency index from edges. O(E). */
export function buildAdjacencyIndex(edges: Edge[]): AdjacencyIndex {
  const outgoing = new Map<string, Map<string, Edge[]>>();
  const incoming = new Map<string, Map<string, Edge[]>>();
  const byNode = new Map<string, Edge[]>();

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

    // --- byNode[source] and byNode[target] ---
    let srcAll = byNode.get(edge.source);
    if (!srcAll) {
      srcAll = [];
      byNode.set(edge.source, srcAll);
    }
    srcAll.push(edge);

    if (edge.source !== edge.target) {
      let tgtAll = byNode.get(edge.target);
      if (!tgtAll) {
        tgtAll = [];
        byNode.set(edge.target, tgtAll);
      }
      tgtAll.push(edge);
    }
  }

  return { outgoing, incoming, byNode };
}

// ============================================================================
// Basic Queries — O(1) via adjacency index
// ============================================================================

/** Get node IDs that directly feed into this node. O(1) + O(k). */
export function getIncomers(index: AdjacencyIndex, nodeId: string): string[] {
  const ports = index.incoming.get(nodeId);
  if (!ports) return [];
  const ids = new Set<string>();
  for (const edges of ports.values()) {
    for (const edge of edges) {
      ids.add(edge.source);
    }
  }
  return Array.from(ids);
}

/** Get node IDs that this node directly feeds into. O(1) + O(k). */
export function getOutgoers(index: AdjacencyIndex, nodeId: string): string[] {
  const ports = index.outgoing.get(nodeId);
  if (!ports) return [];
  const ids = new Set<string>();
  for (const edges of ports.values()) {
    for (const edge of edges) {
      ids.add(edge.target);
    }
  }
  return Array.from(ids);
}

/** Get all edges touching a node. O(1). */
export function getNodeEdges(index: AdjacencyIndex, nodeId: string): Edge[] {
  return index.byNode.get(nodeId) ?? [];
}

/** Get edges arriving at a node (inputs). O(1) + O(k). */
export function getInputEdges(index: AdjacencyIndex, nodeId: string): Edge[] {
  const ports = index.incoming.get(nodeId);
  if (!ports) return [];
  const result: Edge[] = [];
  for (const edges of ports.values()) {
    for (const edge of edges) {
      result.push(edge);
    }
  }
  return result;
}

/** Get edges leaving a node (outputs). O(1) + O(k). */
export function getOutputEdges(index: AdjacencyIndex, nodeId: string): Edge[] {
  const ports = index.outgoing.get(nodeId);
  if (!ports) return [];
  const result: Edge[] = [];
  for (const edges of ports.values()) {
    for (const edge of edges) {
      result.push(edge);
    }
  }
  return result;
}

/** Get direct edges between two specific nodes. O(k). */
export function getEdgesBetween(
  index: AdjacencyIndex,
  nodeA: string,
  nodeB: string
): Edge[] {
  const aEdges = index.byNode.get(nodeA);
  if (!aEdges) return [];
  return aEdges.filter(
    (e) =>
      (e.source === nodeA && e.target === nodeB) ||
      (e.source === nodeB && e.target === nodeA)
  );
}

// ============================================================================
// Traversal — Iterator-based, O(k) where k = reachable nodes
// ============================================================================

/** Walk upstream from a node, yielding all ancestor node IDs. */
export function* walkUpstream(
  index: AdjacencyIndex,
  startNodeId: string
): Generator<string> {
  const visited = new Set<string>();
  visited.add(startNodeId);
  const stack: string[] = [];

  // Seed with direct incomers
  const incomers = getIncomers(index, startNodeId);
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

/** Walk downstream from a node, yielding all dependent node IDs. */
export function* walkDownstream(
  index: AdjacencyIndex,
  startNodeId: string
): Generator<string> {
  const visited = new Set<string>();
  visited.add(startNodeId);
  const stack: string[] = [];

  // Seed with direct outgoers
  const outgoers = getOutgoers(index, startNodeId);
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
 * Uses Kahn's algorithm (BFS-based). If not all nodes are processed,
 * the remaining nodes are in cycles.
 *
 * @param nodeIds - All node IDs that participate in the graph
 * @param index - Pre-built adjacency index
 * @param mutedNodeIds - Nodes to skip in execution order (treated as pass-through)
 */
export function computeAnalysis(
  nodeIds: string[],
  index: AdjacencyIndex,
  mutedNodeIds?: ReadonlySet<string>
): Omit<CachedAnalysis, 'topologyVersion'> {
  const nodeIdSet = new Set(nodeIds);

  // Count in-degree for each node (edges from nodes within the set)
  const inDegree = new Map<string, number>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
  }

  for (const id of nodeIds) {
    const ports = index.incoming.get(id);
    if (ports) {
      for (const edges of ports.values()) {
        for (const edge of edges) {
          if (nodeIdSet.has(edge.source)) {
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
  const leafCandidates = new Set(nodeIds);

  while (queue.length > 0) {
    const level: string[] = [];
    const nextQueue: string[] = [];

    for (const id of queue) {
      order.push(id);
      // Skip muted nodes in level grouping but still process their edges
      if (!mutedNodeIds?.has(id)) {
        level.push(id);
      }

      // Track roots (no incoming from graph)
      const ports = index.incoming.get(id);
      let hasIncoming = false;
      if (ports) {
        for (const edges of ports.values()) {
          for (const edge of edges) {
            if (nodeIdSet.has(edge.source)) {
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
            if (nodeIdSet.has(edge.target)) {
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

  const hasCycles = order.length < nodeIds.length;
  const processedSet = new Set(order);
  const cycleNodeIds = hasCycles
    ? nodeIds.filter((id) => !processedSet.has(id))
    : [];

  // Leaves: nodes with no outgoing edges within the graph
  const leaves = Array.from(leafCandidates).filter((id) => processedSet.has(id));

  return {
    topologicalOrder: hasCycles ? null : order,
    executionLevels: hasCycles ? null : levels,
    hasCycles,
    cycleNodeIds,
    roots,
    leaves,
  };
}

// ============================================================================
// Cycle Detection — O(k) with early termination
// ============================================================================

/**
 * Would adding an edge from sourceNodeId to targetNodeId create a cycle?
 * DFS from target following outgoing edges, looking for source.
 * Called on every pointer move during connection drag — must be fast.
 *
 * O(k) where k = nodes reachable downstream from target. Early termination.
 */
export function wouldCreateCycle(
  index: AdjacencyIndex,
  sourceNodeId: string,
  targetNodeId: string
): boolean {
  if (sourceNodeId === targetNodeId) return true;

  // If adding source→target, cycle exists iff target can reach source
  // via existing edges (target→...→source already exists)
  const visited = new Set<string>();
  const stack: string[] = [targetNodeId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === sourceNodeId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const ports = index.outgoing.get(current);
    if (ports) {
      for (const edges of ports.values()) {
        for (const edge of edges) {
          if (!visited.has(edge.target)) {
            if (edge.target === sourceNodeId) return true; // fast path
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
 * Get all nodes affected by a change to the given node(s).
 * Returns downstream nodes in topological order.
 *
 * @param changedNodeIds - Node(s) that changed
 * @param index - Adjacency index
 * @param cachedOrder - Cached topological order (for sorting the result)
 * @param mutedNodeIds - Muted nodes are treated as pass-through (propagation continues through them)
 */
export function getAffectedEntities(
  changedNodeIds: string | string[],
  index: AdjacencyIndex,
  cachedOrder?: string[] | null,
  mutedNodeIds?: ReadonlySet<string>
): string[] {
  const startIds = typeof changedNodeIds === 'string' ? [changedNodeIds] : changedNodeIds;
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
 * Returns a Map from component ID (smallest node ID in component) to array of node IDs.
 */
export function getConnectedComponents(
  nodeIds: string[],
  index: AdjacencyIndex
): Map<string, string[]> {
  // Union-Find with path compression and union by rank
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();

  for (const id of nodeIds) {
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

  // Union nodes connected by edges
  const nodeIdSet = new Set(nodeIds);
  for (const id of nodeIds) {
    const edges = index.byNode.get(id);
    if (edges) {
      for (const edge of edges) {
        if (nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target)) {
          union(edge.source, edge.target);
        }
      }
    }
  }

  // Group by component
  const components = new Map<string, string[]>();
  for (const id of nodeIds) {
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

/** Check if two nodes are in the same connected component. O(α(n)) ≈ O(1). */
export function areConnected(
  index: AdjacencyIndex,
  nodeA: string,
  nodeB: string
): boolean {
  // Simple BFS from A looking for B (undirected via byNode)
  const visited = new Set<string>();
  const stack: string[] = [nodeA];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === nodeB) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const edges = index.byNode.get(current);
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
 * Get execution order for evaluating a specific node.
 * Returns only the subgraph needed (upstream dependencies + the node itself).
 */
export function getExecutionOrder(
  index: AdjacencyIndex,
  targetNodeId: string
): string[] {
  // Collect all upstream nodes
  const needed = new Set<string>();
  needed.add(targetNodeId);
  for (const id of walkUpstream(index, targetNodeId)) {
    needed.add(id);
  }

  // Topo sort just this subgraph
  const subgraphNodes = Array.from(needed);
  const result = computeAnalysis(subgraphNodes, index);
  return result.topologicalOrder ?? subgraphNodes; // fallback if cycles
}

/**
 * Get nodes ready to execute given a set of already-completed nodes.
 * A node is "ready" if all its incomers are in the completed set.
 * O(k) where k = number of candidates.
 */
export function getReadyEntities(
  nodeIds: string[],
  index: AdjacencyIndex,
  completed: ReadonlySet<string>
): string[] {
  const nodeIdSet = new Set(nodeIds);
  const ready: string[] = [];

  for (const id of nodeIds) {
    if (completed.has(id)) continue;

    // Check if all incomers are completed
    let allReady = true;
    const ports = index.incoming.get(id);
    if (ports) {
      outer: for (const edges of ports.values()) {
        for (const edge of edges) {
          if (nodeIdSet.has(edge.source) && !completed.has(edge.source)) {
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
 * Compute the edges and node position needed to insert a node on an existing edge.
 * Returns the changes to apply — does NOT mutate state.
 *
 * A→B becomes A→newNode→B
 */
export function computeInsertOnEdge(
  edgeToSplit: Edge,
  newNode: { id: string; type: string; inputs?: { id: string }[]; outputs?: { id: string }[] },
  sourceNode: Node | undefined,
  targetNode: Node | undefined
): {
  removeEdgeId: string;
  newEdges: [Edge, Edge];
  nodePosition: { x: number; y: number };
} {
  // Position at midpoint of the two connected nodes
  const sx = sourceNode?.position.x ?? 0;
  const sy = sourceNode?.position.y ?? 0;
  const tx = targetNode?.position.x ?? 0;
  const ty = targetNode?.position.y ?? 0;
  const nodePosition = { x: (sx + tx) / 2, y: (sy + ty) / 2 };

  // Pick input/output sockets on the new node
  const newInputSocket = newNode.inputs?.[0]?.id;
  const newOutputSocket = newNode.outputs?.[0]?.id;

  const edgeA: Edge = {
    id: `${edgeToSplit.id}-a`,
    source: edgeToSplit.source,
    sourceSocket: edgeToSplit.sourceSocket,
    target: newNode.id,
    targetSocket: newInputSocket,
  };

  const edgeB: Edge = {
    id: `${edgeToSplit.id}-b`,
    source: newNode.id,
    sourceSocket: newOutputSocket,
    target: edgeToSplit.target,
    targetSocket: edgeToSplit.targetSocket,
  };

  return {
    removeEdgeId: edgeToSplit.id,
    newEdges: [edgeA, edgeB],
    nodePosition,
  };
}

/**
 * Compute the edge changes needed to bypass (remove) a node and reconnect.
 * A→node→B becomes A→B.
 * Matches first input to first output (or all if counts match).
 */
export function computeBypass(
  nodeId: string,
  index: AdjacencyIndex
): {
  removeEdgeIds: string[];
  removeNodeId: string;
  newEdges: Edge[];
} {
  const inputEdges = getInputEdges(index, nodeId);
  const outputEdges = getOutputEdges(index, nodeId);
  const removeEdgeIds = [...inputEdges, ...outputEdges].map((e) => e.id);

  // Reconnect: pair input edges with output edges
  const newEdges: Edge[] = [];
  const pairCount = Math.min(inputEdges.length, outputEdges.length);
  for (let i = 0; i < pairCount; i++) {
    newEdges.push({
      id: `bypass-${nodeId}-${i}`,
      source: inputEdges[i].source,
      sourceSocket: inputEdges[i].sourceSocket,
      target: outputEdges[i].target,
      targetSocket: outputEdges[i].targetSocket,
    });
  }

  return { removeEdgeIds, removeNodeId: nodeId, newEdges };
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
 * @param nodes - All nodes in the graph
 * @param edges - All edges in the graph
 * @param index - Adjacency index
 * @param socketTypes - Socket type definitions for compatibility checking
 * @param isTypeCompatible - Optional custom type compatibility function
 */
export function validate(
  nodes: Node[],
  edges: Edge[],
  index: AdjacencyIndex,
  socketTypes?: Record<string, { compatibleWith?: string[] | '*' }>,
  isTypeCompatible?: (typeA: string, typeB: string) => boolean
): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const nodeIds = nodes.map((n) => n.id);

  // Check for cycles
  const analysis = computeAnalysis(nodeIds, index);
  if (analysis.hasCycles) {
    issues.push({ type: 'cycle', nodeIds: analysis.cycleNodeIds });
  }

  // Check for unconnected required inputs
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    if (!node.inputs) continue;
    for (const input of node.inputs) {
      // Check if this input has any incoming edge
      const ports = index.incoming.get(node.id);
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
          nodeId: node.id,
          portId: input.id,
          portName: input.name,
        });
      }
    }
  }

  // Check for type mismatches on edges
  if (socketTypes || isTypeCompatible) {
    for (const edge of edges) {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!sourceNode || !targetNode) continue;

      const sourceSocket = sourceNode.outputs?.find(
        (s) => s.id === (edge.sourceSocket ?? DEFAULT_SOCKET)
      );
      const targetSocket = targetNode.inputs?.find(
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
  nodes: Node[],
  index: AdjacencyIndex
): boolean {
  for (const node of nodes) {
    if (!node.inputs) continue;
    for (const input of node.inputs) {
      if (input.defaultValue !== undefined) continue;

      const ports = index.incoming.get(node.id);
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
 * @param sourceNodeId - The node where the drag started
 * @param sourceSocketId - The socket where the drag started
 * @param isSourceInput - Whether the source socket is an input
 * @param nodes - All nodes
 * @param socketTypes - Socket type definitions
 * @param index - Adjacency index (for cycle checking)
 * @param allowCycles - Whether cycles are permitted
 */
export function getCompatiblePorts(
  sourceNodeId: string,
  sourceSocketId: string,
  isSourceInput: boolean,
  nodes: Node[],
  socketTypes: Record<string, { compatibleWith?: string[] | '*' }>,
  index?: AdjacencyIndex,
  allowCycles?: boolean
): Array<{ nodeId: string; socketId: string; socketName: string; socketType: string }> {
  // Find source socket type
  const sourceNode = nodes.find((n) => n.id === sourceNodeId);
  if (!sourceNode) return [];

  const sourceSockets = isSourceInput ? sourceNode.inputs : sourceNode.outputs;
  const sourceSocket = sourceSockets?.find((s) => s.id === sourceSocketId);
  if (!sourceSocket) return [];

  const result: Array<{ nodeId: string; socketId: string; socketName: string; socketType: string }> = [];

  for (const node of nodes) {
    if (node.id === sourceNodeId) continue; // Can't connect to self

    // If source is output, look at target inputs; if source is input, look at target outputs
    const targetSockets = isSourceInput ? node.outputs : node.inputs;
    if (!targetSockets) continue;

    // Check cycle prevention
    if (!allowCycles && index) {
      if (isSourceInput) {
        // Source is input, target is output → edge goes target→source
        if (wouldCreateCycle(index, node.id, sourceNodeId)) continue;
      } else {
        // Source is output, target is input → edge goes source→target
        if (wouldCreateCycle(index, sourceNodeId, node.id)) continue;
      }
    }

    for (const socket of targetSockets) {
      if (defaultTypeCompatible(sourceSocket.type, socket.type, socketTypes)) {
        result.push({
          nodeId: node.id,
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
 * Compute the changes needed to collapse a set of nodes into a single compound/group node.
 *
 * Creates a group node that replaces the selected nodes. External edges (edges
 * crossing the boundary) are reconnected to the group node's auto-generated ports.
 *
 * @param nodeIds - Nodes to collapse into a group
 * @param groupId - ID for the new group node
 * @param nodes - All nodes
 * @param index - Adjacency index
 */
export function computeCollapseToSubgraph(
  nodeIds: string[],
  groupId: string,
  nodes: Node[],
  index: AdjacencyIndex
): {
  groupNode: {
    id: string;
    position: { x: number; y: number };
    width: number;
    height: number;
    childIds: string[];
  };
  /** Edges to remove (internal edges + boundary edges) */
  removeEdgeIds: string[];
  /** New edges reconnecting external connections to the group */
  newEdges: Edge[];
  /** Port definitions for the group node */
  groupInputs: Array<{ id: string; name: string; type: string; originalNodeId: string; originalSocketId: string }>;
  groupOutputs: Array<{ id: string; name: string; type: string; originalNodeId: string; originalSocketId: string }>;
} {
  const nodeIdSet = new Set(nodeIds);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Calculate group bounds from contained nodes
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of nodeIds) {
    const node = nodeMap.get(id);
    if (!node) continue;
    const w = node.width ?? 200;
    const h = node.height ?? 100;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + w);
    maxY = Math.max(maxY, node.position.y + h);
  }

  const padding = 40;
  const groupPosition = { x: minX - padding, y: minY - padding };
  const groupWidth = maxX - minX + padding * 2;
  const groupHeight = maxY - minY + padding * 2;

  // Categorize edges
  const removeEdgeIds: string[] = [];
  const boundaryIncoming: Edge[] = []; // external → inside
  const boundaryOutgoing: Edge[] = []; // inside → external

  for (const id of nodeIds) {
    const edges = index.byNode.get(id);
    if (!edges) continue;
    for (const edge of edges) {
      const srcInside = nodeIdSet.has(edge.source);
      const tgtInside = nodeIdSet.has(edge.target);
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

  // Generate group ports from boundary edges
  const groupInputs: Array<{ id: string; name: string; type: string; originalNodeId: string; originalSocketId: string }> = [];
  const groupOutputs: Array<{ id: string; name: string; type: string; originalNodeId: string; originalSocketId: string }> = [];
  const newEdges: Edge[] = [];

  // Create group input ports for boundary incoming edges
  const seenInputs = new Map<string, string>(); // "nodeId:socketId" → groupPortId
  for (const edge of boundaryIncoming) {
    const key = `${edge.target}:${edge.targetSocket ?? DEFAULT_SOCKET}`;
    let groupPortId = seenInputs.get(key);
    if (!groupPortId) {
      groupPortId = `gin-${groupInputs.length}`;
      const targetNode = nodeMap.get(edge.target);
      const targetSocket = targetNode?.inputs?.find((s) => s.id === (edge.targetSocket ?? DEFAULT_SOCKET));
      groupInputs.push({
        id: groupPortId,
        name: targetSocket?.name ?? `Input ${groupInputs.length}`,
        type: targetSocket?.type ?? 'any',
        originalNodeId: edge.target,
        originalSocketId: edge.targetSocket ?? DEFAULT_SOCKET,
      });
      seenInputs.set(key, groupPortId);
    }
    // Reconnect: external source → group input
    newEdges.push({
      id: `${groupId}-in-${newEdges.length}`,
      source: edge.source,
      sourceSocket: edge.sourceSocket,
      target: groupId,
      targetSocket: groupPortId,
    });
  }

  // Create group output ports for boundary outgoing edges
  const seenOutputs = new Map<string, string>(); // "nodeId:socketId" → groupPortId
  for (const edge of boundaryOutgoing) {
    const key = `${edge.source}:${edge.sourceSocket ?? DEFAULT_SOCKET}`;
    let groupPortId = seenOutputs.get(key);
    if (!groupPortId) {
      groupPortId = `gout-${groupOutputs.length}`;
      const sourceNode = nodeMap.get(edge.source);
      const sourceSocket = sourceNode?.outputs?.find((s) => s.id === (edge.sourceSocket ?? DEFAULT_SOCKET));
      groupOutputs.push({
        id: groupPortId,
        name: sourceSocket?.name ?? `Output ${groupOutputs.length}`,
        type: sourceSocket?.type ?? 'any',
        originalNodeId: edge.source,
        originalSocketId: edge.sourceSocket ?? DEFAULT_SOCKET,
      });
      seenOutputs.set(key, groupPortId);
    }
    // Reconnect: group output → external target
    newEdges.push({
      id: `${groupId}-out-${newEdges.length}`,
      source: groupId,
      sourceSocket: groupPortId,
      target: edge.target,
      targetSocket: edge.targetSocket,
    });
  }

  return {
    groupNode: {
      id: groupId,
      position: groupPosition,
      width: groupWidth,
      height: groupHeight,
      childIds: nodeIds,
    },
    removeEdgeIds: Array.from(removeEdgeIdSet),
    newEdges,
    groupInputs,
    groupOutputs,
  };
}

/**
 * Compute the changes needed to expand a compound/group node back to its children.
 * Inverse of collapseToSubgraph.
 *
 * @param groupId - The group node to expand
 * @param childNodes - The nodes inside the group (restored from storage)
 * @param internalEdges - Edges between children (restored from storage)
 * @param nodes - All current nodes
 * @param index - Current adjacency index
 */
export function computeExpandSubgraph(
  groupId: string,
  childNodes: Node[],
  internalEdges: Edge[],
  nodes: Node[],
  index: AdjacencyIndex,
  portMapping: {
    inputs: Array<{ groupPortId: string; originalNodeId: string; originalSocketId: string }>;
    outputs: Array<{ groupPortId: string; originalNodeId: string; originalSocketId: string }>;
  }
): {
  removeNodeId: string;
  removeEdgeIds: string[];
  restoreNodes: Node[];
  restoreEdges: Edge[];
  reconnectEdges: Edge[];
} {
  // Edges connected to the group node
  const groupEdges = getNodeEdges(index, groupId);
  const removeEdgeIds = groupEdges.map((e) => e.id);

  // Build port mapping lookups
  const inputMap = new Map(portMapping.inputs.map((p) => [p.groupPortId, p]));
  const outputMap = new Map(portMapping.outputs.map((p) => [p.groupPortId, p]));

  // Reconnect external edges to original internal nodes
  const reconnectEdges: Edge[] = [];

  for (const edge of groupEdges) {
    if (edge.target === groupId) {
      // Incoming edge → reconnect to original internal input
      const mapping = inputMap.get(edge.targetSocket ?? DEFAULT_SOCKET);
      if (mapping) {
        reconnectEdges.push({
          id: `expand-${groupId}-${reconnectEdges.length}`,
          source: edge.source,
          sourceSocket: edge.sourceSocket,
          target: mapping.originalNodeId,
          targetSocket: mapping.originalSocketId,
        });
      }
    } else if (edge.source === groupId) {
      // Outgoing edge → reconnect from original internal output
      const mapping = outputMap.get(edge.sourceSocket ?? DEFAULT_SOCKET);
      if (mapping) {
        reconnectEdges.push({
          id: `expand-${groupId}-${reconnectEdges.length}`,
          source: mapping.originalNodeId,
          sourceSocket: mapping.originalSocketId,
          target: edge.target,
          targetSocket: edge.targetSocket,
        });
      }
    }
  }

  return {
    removeNodeId: groupId,
    removeEdgeIds,
    restoreNodes: childNodes,
    restoreEdges: internalEdges,
    reconnectEdges,
  };
}
