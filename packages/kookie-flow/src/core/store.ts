import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  Node,
  Edge,
  Viewport,
  NodeChange,
  EdgeChange,
  Connection,
  XYPosition,
  SocketHandle,
  CloneElementsOptions,
  CloneElementsResult,
  ElementsBatch,
  DeleteElementsBatch,
  FlowObject,
  InternalClipboard,
  PasteFromInternalOptions,
  NodeData,
  FitViewOptions,
} from '../types';
import { DEFAULT_VIEWPORT, MIN_ZOOM, MAX_ZOOM, SOCKET_MARGIN_TOP, SOCKET_SPACING } from './constants';
import { Quadtree, SocketQuadtree, getNodeBounds, type SocketEntry } from './spatial';
import {
  getGroupChildren as utilGetGroupChildren,
  getGroupDescendants as utilGetGroupDescendants,
  isNodeHidden,
  calculateGroupBounds as utilCalculateGroupBounds,
  calculateDescendantPositions,
  type Bounds,
} from '../utils/grouping';
import * as graphEngine from './graph';
import type { AdjacencyIndex, CachedAnalysis } from './graph';

// Pre-allocated ID pool for efficient cloning
let idCounter = 0;
const defaultGenerateId = () => `kf-${Date.now()}-${++idCounter}`;

export interface FlowState {
  /** Nodes in the graph */
  nodes: Node[];
  /** Edges in the graph */
  edges: Edge[];
  /** Current viewport */
  viewport: Viewport;
  /** Currently connecting from (legacy) */
  connectionStart: { nodeId: string; socketId: string } | null;
  /** Currently hovered node */
  hoveredNodeId: string | null;
  /** Currently hovered socket */
  hoveredSocketId: SocketHandle | null;
  /** Connection draft while dragging from a socket */
  connectionDraft: {
    source: SocketHandle;
    mouseWorld: XYPosition;
    /** Whether the currently hovered target is valid */
    isValid: boolean;
  } | null;
  /** Box selection in progress */
  selectionBox: { start: XYPosition; end: XYPosition } | null;

  /** Selection state - O(1) lookup */
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;

  /** Node map for O(1) lookup by ID */
  nodeMap: Map<string, Node>;

  /** Quadtree for O(log n) spatial queries */
  quadtree: Quadtree;

  /** Socket quadtree for O(log n) socket hit testing during connection draft */
  socketQuadtree: SocketQuadtree;

  /**
   * Connected sockets cache - O(1) lookup for widget visibility.
   * Format: "nodeId:socketId" for each input socket that has an incoming edge.
   * Rebuilt when edges change.
   */
  connectedSockets: Set<string>;

  /**
   * Position version counter - increments on any position update.
   * Used by components that need to track position changes without
   * relying on nodeMap reference changes (which may be mutated in place).
   */
  positionVersion: number;

  /** Internal clipboard (holds references, no serialization) */
  internalClipboard: InternalClipboard | null;

  // ============================================================================
  // Grouping State (Phase 7C)
  // ============================================================================

  /** Set of collapsed group node IDs (O(1) lookup for visibility checks) */
  collapsedGroupIds: Set<string>;

  /**
   * Pre-computed set of hidden node IDs (nodes inside collapsed groups).
   * Rebuilt when collapsedGroupIds changes. Used for O(1) visibility checks in hot paths.
   */
  hiddenNodeIds: Set<string>;

  // ============================================================================
  // Graph Engine State (Phase 8)
  // ============================================================================

  /** Pre-computed adjacency index for O(1) neighbor lookups. Rebuilt on edge changes. */
  adjacencyIndex: AdjacencyIndex;

  /** Topology version counter. Increments on node/edge add/remove only. */
  topologyVersion: number;

  /** Node IDs excluded from execution (treated as pass-through). */
  mutedNodeIds: Set<string>;

  /** Internal actions */
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setViewport: (viewport: Viewport) => void;
  setHoveredNodeId: (id: string | null) => void;
  setHoveredSocketId: (socket: SocketHandle | null) => void;
  startConnection: (nodeId: string, socketId: string) => void;
  endConnection: () => void;
  setSelectionBox: (box: { start: XYPosition; end: XYPosition } | null) => void;

  /** Connection draft actions */
  startConnectionDraft: (source: SocketHandle, mouseWorld: XYPosition) => void;
  updateConnectionDraft: (mouseWorld: XYPosition, isValid?: boolean) => void;
  cancelConnectionDraft: () => void;

  /** Apply changes */
  applyNodeChanges: (changes: NodeChange[]) => void;
  applyEdgeChanges: (changes: EdgeChange[]) => void;

  /** Selection - O(1) operations */
  selectNode: (id: string, additive?: boolean) => void;
  selectNodes: (ids: string[]) => void;
  selectEdge: (id: string, additive?: boolean) => void;
  selectEdges: (ids: string[]) => void;
  selectAll: () => void;
  deselectAll: () => void;
  isNodeSelected: (id: string) => boolean;
  isEdgeSelected: (id: string) => boolean;

  /** Viewport controls */
  pan: (delta: XYPosition) => void;
  zoom: (delta: number, center?: XYPosition) => void;
  fitView: (options?: FitViewOptions, canvasWidth?: number, canvasHeight?: number) => void;

  /** Efficient batch position update for dragging */
  updateNodePositions: (updates: Array<{ id: string; position: XYPosition }>) => void;

  // ========================================
  // Phase 6: Core Operations
  // ========================================

  /**
   * Clone nodes and edges with new IDs.
   * Single-pass operation with pre-allocated ID pool and edge remapping.
   */
  cloneElements: <T extends NodeData = NodeData>(
    nodes: Node<T>[],
    edges: Edge[],
    options?: CloneElementsOptions<T>
  ) => CloneElementsResult;

  /**
   * Batch add nodes and edges in a single state update.
   * More efficient than multiple applyNodeChanges/applyEdgeChanges calls.
   */
  addElements: (batch: ElementsBatch) => void;

  /**
   * Delete nodes and edges by ID.
   * Automatically removes edges connected to deleted nodes.
   */
  deleteElements: (batch: DeleteElementsBatch) => void;

  /**
   * Delete all currently selected nodes and edges.
   * Convenience wrapper around deleteElements.
   */
  deleteSelected: () => void;

  /**
   * Copy selected nodes and connected edges to internal clipboard.
   * No serialization - just holds references.
   */
  copySelectedToInternal: () => void;

  /**
   * Paste from internal clipboard.
   * Clones the clipboard contents with new IDs.
   */
  pasteFromInternal: <T extends NodeData = NodeData>(
    options?: Omit<CloneElementsOptions<T>, 'generateId'>
  ) => CloneElementsResult | null;

  /**
   * Cut selected nodes and edges to internal clipboard.
   * Copies then deletes.
   */
  cutSelectedToInternal: () => void;

  /**
   * Serialize current flow state to a plain object.
   * For persistence or browser clipboard.
   */
  toObject: () => FlowObject;

  /**
   * Get currently selected nodes.
   */
  getSelectedNodes: () => Node[];

  /**
   * Get edges connected to the given node IDs.
   */
  getConnectedEdges: (nodeIds: string[]) => Edge[];

  // ========================================
  // Phase 7C: Grouping Actions
  // ========================================

  /**
   * Get direct children of a group node.
   */
  getGroupChildren: (groupId: string) => Node[];

  /**
   * Get all descendants of a group node (recursive).
   */
  getGroupDescendants: (groupId: string) => Node[];

  /**
   * Toggle a group's collapsed state.
   * Fires a 'collapse' node change event.
   */
  toggleGroupCollapse: (groupId: string) => void;

  /**
   * Expand a collapsed group.
   */
  expandGroup: (groupId: string) => void;

  /**
   * Collapse an expanded group.
   */
  collapseGroup: (groupId: string) => void;

  /**
   * Check if a group is collapsed.
   */
  isGroupCollapsed: (groupId: string) => boolean;

  /**
   * Get the bounds of a group (calculated from children).
   * Returns null if group has no children.
   */
  getGroupBounds: (groupId: string) => Bounds | null;

  /**
   * Set the parent of a node (for grouping).
   * Validates that the operation doesn't create cycles.
   */
  setNodeParent: (nodeId: string, parentId: string | null) => boolean;

  /**
   * Move a group and all its descendants.
   * Updates positions in a single batch for performance.
   */
  moveGroup: (groupId: string, delta: XYPosition) => void;

  // ============================================================================
  // Graph Engine Queries (Phase 8)
  // ============================================================================

  /** Get node IDs that directly feed into this node. */
  getIncomers: (nodeId: string) => string[];
  /** Get node IDs that this node directly feeds into. */
  getOutgoers: (nodeId: string) => string[];
  /** Get all edges touching a node via adjacency index. */
  getNodeEdges: (nodeId: string) => Edge[];
  /** Get edges arriving at a node (inputs). */
  getInputEdges: (nodeId: string) => Edge[];
  /** Get edges leaving a node (outputs). */
  getOutputEdges: (nodeId: string) => Edge[];
  /** Get direct edges between two nodes. */
  getEdgesBetween: (nodeA: string, nodeB: string) => Edge[];
  /** Walk upstream from a node, yielding all ancestor node IDs. */
  walkUpstream: (startNodeId: string) => Generator<string>;
  /** Walk downstream from a node, yielding all dependent node IDs. */
  walkDownstream: (startNodeId: string) => Generator<string>;
  /** Get cached graph analysis (topo sort, execution levels, cycles, roots, leaves). */
  getAnalysis: () => CachedAnalysis;
  /** Would adding an edge from source to target create a cycle? */
  wouldCreateCycle: (sourceNodeId: string, targetNodeId: string) => boolean;
  /** Get all nodes downstream of changed nodes, in topological order. */
  getAffectedEntities: (changedNodeIds: string | string[]) => string[];
  /** Find connected components. Returns Map<componentId, nodeIds[]>. */
  getConnectedComponents: () => Map<string, string[]>;
  /** Check if two nodes are in the same connected component. */
  areConnected: (nodeA: string, nodeB: string) => boolean;
  /** Get execution order for evaluating a specific node (upstream subgraph). */
  getExecutionOrder: (targetNodeId: string) => string[];
  /** Get nodes ready to execute given completed set. */
  getReadyEntities: (nodeIds: string[], completed: ReadonlySet<string>) => string[];
  /** Insert a node onto an existing edge (A→B becomes A→new→B). */
  insertOnEdge: (edgeId: string, newNode: Node) => void;
  /** Remove a node and reconnect its inputs to outputs. */
  bypassEntity: (nodeId: string) => void;
  /** Mark a node as muted (skipped in execution). */
  muteEntity: (nodeId: string) => void;
  /** Remove muted status from a node. */
  unmuteEntity: (nodeId: string) => void;
  /** Check if a node is muted. */
  isMuted: (nodeId: string) => boolean;

  // ========================================
  // Phase 8: Graph Validation & Subgraph Mutations
  // ========================================

  /** Validate the graph structure. Returns a list of issues. */
  validate: (socketTypes?: Record<string, { compatibleWith?: string[] | '*' }>) => import('./graph').GraphValidationIssue[];
  /** Check if all required input ports are connected. */
  isGraphComplete: () => boolean;
  /** Get compatible ports for a source socket (for connection drag UI). */
  getCompatiblePorts: (
    sourceNodeId: string,
    sourceSocketId: string,
    isSourceInput: boolean,
    socketTypes: Record<string, { compatibleWith?: string[] | '*' }>,
    allowCycles?: boolean
  ) => Array<{ nodeId: string; socketId: string; socketName: string; socketType: string }>;
  /** Collapse a set of nodes into a compound group node. */
  collapseToSubgraph: (nodeIds: string[], groupId: string) => void;
  /** Expand a compound group node back to its children. */
  expandSubgraph: (
    groupId: string,
    childNodes: Node[],
    internalEdges: Edge[],
    portMapping: {
      inputs: Array<{ groupPortId: string; originalNodeId: string; originalSocketId: string }>;
      outputs: Array<{ groupPortId: string; originalNodeId: string; originalSocketId: string }>;
    }
  ) => void;
}

export type FlowStore = ReturnType<typeof createFlowStore>;

// Helper to calculate socket Y offset (without layout param - uses legacy constants)
function getSocketYOffset(node: Node, socketIndex: number, isInput: boolean): number {
  const nodeHeight = node.height ?? 100;
  const outputCount = node.outputs?.length ?? 0;
  // Layout: outputs first, then inputs
  const rowIndex = isInput ? outputCount + socketIndex : socketIndex;
  return SOCKET_MARGIN_TOP + rowIndex * SOCKET_SPACING;
}

// Helper to build collapsedGroupIds set from nodes
function buildCollapsedGroupIds(nodes: Node[]): Set<string> {
  const collapsed = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'group' && node.collapsed) {
      collapsed.add(node.id);
    }
  }
  return collapsed;
}

// Helper to rebuild derived state from nodes
// collapsedGroupIds is used to filter children of collapsed groups from quadtrees
function rebuildDerivedState(nodes: Node[], collapsedGroupIds?: Set<string>) {
  const nodeMap = new Map<string, Node>();
  const quadtree = new Quadtree({ x: -10000, y: -10000, width: 20000, height: 20000 });
  const socketQuadtree = new SocketQuadtree({ x: -10000, y: -10000, width: 20000, height: 20000 });

  // Build nodeMap first (all nodes, for O(1) lookup)
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Build collapsed set if not provided (e.g., during initialization)
  const collapsed = collapsedGroupIds ?? buildCollapsedGroupIds(nodes);

  // Pre-compute hidden node IDs for O(1) lookup in hot paths
  // This is O(n*d) but only runs when nodes/collapsed state changes, not every frame
  const hiddenNodeIds = new Set<string>();
  for (const node of nodes) {
    if (isNodeHidden(node, nodeMap, collapsed)) {
      hiddenNodeIds.add(node.id);
    }
  }

  // Determine which nodes are visible (not inside collapsed groups)
  const visibleNodes: Node[] = [];
  for (const node of nodes) {
    if (!hiddenNodeIds.has(node.id)) {
      visibleNodes.push(node);
    }
  }

  // Only add visible nodes to quadtrees
  for (const node of visibleNodes) {
    // Insert sockets into socket quadtree
    const nodeWidth = node.width ?? 200;
    if (node.inputs) {
      for (let i = 0; i < node.inputs.length; i++) {
        const socket = node.inputs[i];
        const yOffset = getSocketYOffset(node, i, true);
        socketQuadtree.insert({
          nodeId: node.id,
          socketId: socket.id,
          isInput: true,
          x: node.position.x,
          y: node.position.y + yOffset,
        });
      }
    }
    if (node.outputs) {
      for (let i = 0; i < node.outputs.length; i++) {
        const socket = node.outputs[i];
        const yOffset = getSocketYOffset(node, i, false);
        socketQuadtree.insert({
          nodeId: node.id,
          socketId: socket.id,
          isInput: false,
          x: node.position.x + nodeWidth,
          y: node.position.y + yOffset,
        });
      }
    }
  }

  quadtree.rebuild(visibleNodes);

  return { nodeMap, quadtree, socketQuadtree, collapsedGroupIds: collapsed, hiddenNodeIds };
}

// Helper to rebuild connected sockets set from edges
function rebuildConnectedSockets(edges: Edge[]): Set<string> {
  const connected = new Set<string>();
  for (const edge of edges) {
    if (edge.targetSocket) {
      connected.add(`${edge.target}:${edge.targetSocket}`);
    }
  }
  return connected;
}

export const createFlowStore = (initialState?: Partial<FlowState>) => {
  // Initialize derived state from initial nodes and edges
  const initialNodes = initialState?.nodes ?? [];
  const initialEdges = initialState?.edges ?? [];
  const { nodeMap, quadtree, socketQuadtree, collapsedGroupIds, hiddenNodeIds } = rebuildDerivedState(initialNodes);
  const connectedSockets = rebuildConnectedSockets(initialEdges);
  const initialAdjacencyIndex = graphEngine.buildAdjacencyIndex(initialEdges);

  // Lazy cached analysis — closure-scoped, not in Zustand state (avoids re-render on compute)
  let cachedAnalysis: CachedAnalysis | null = null;

  return create<FlowState>()(
    subscribeWithSelector((set, get) => ({
      // Initial state - use extracted values to ensure they're set correctly
      nodes: initialNodes,
      edges: initialEdges,
      viewport: initialState?.viewport ?? DEFAULT_VIEWPORT,
      connectionStart: null,
      hoveredNodeId: null,
      hoveredSocketId: null,
      connectionDraft: null,
      selectionBox: null,

      // Selection state
      selectedNodeIds: new Set<string>(),
      selectedEdgeIds: new Set<string>(),

      // Derived state for O(1) lookups
      nodeMap,
      quadtree,
      socketQuadtree,
      connectedSockets,

      // Position version for tracking position changes
      positionVersion: 0,

      // Internal clipboard
      internalClipboard: null,

      // Grouping state (Phase 7C)
      collapsedGroupIds,
      hiddenNodeIds,

      // Graph engine state (Phase 8)
      adjacencyIndex: initialAdjacencyIndex,
      topologyVersion: 0,
      mutedNodeIds: new Set<string>(),

      // Setters - rebuild derived state when nodes change
      setNodes: (nodes) => {
        const derived = rebuildDerivedState(nodes);
        cachedAnalysis = null;
        set({ nodes, ...derived, topologyVersion: get().topologyVersion + 1 });
      },
      setEdges: (edges) => {
        cachedAnalysis = null;
        set({
          edges,
          connectedSockets: rebuildConnectedSockets(edges),
          adjacencyIndex: graphEngine.buildAdjacencyIndex(edges),
          topologyVersion: get().topologyVersion + 1,
        });
      },
      setViewport: (viewport) => set({ viewport }),
      setHoveredNodeId: (hoveredNodeId) => set({ hoveredNodeId }),
      setHoveredSocketId: (hoveredSocketId) => set({ hoveredSocketId }),
      startConnection: (nodeId, socketId) =>
        set({ connectionStart: { nodeId, socketId } }),
      endConnection: () => set({ connectionStart: null }),
      setSelectionBox: (selectionBox) => set({ selectionBox }),

      // Connection draft actions
      startConnectionDraft: (source, mouseWorld) => {
        set({
          connectionDraft: { source, mouseWorld, isValid: true },
        });
      },
      updateConnectionDraft: (mouseWorld, isValid) => {
        const { connectionDraft } = get();
        if (connectionDraft) {
          set({
            connectionDraft: {
              ...connectionDraft,
              mouseWorld,
              isValid: isValid ?? connectionDraft.isValid,
            },
          });
        }
      },
      cancelConnectionDraft: () => {
        set({ connectionDraft: null, hoveredSocketId: null });
      },

      // Apply changes
      applyNodeChanges: (changes) => {
        const { nodes, collapsedGroupIds: currentCollapsed } = get();
        const nextNodes = [...nodes];
        let collapsedChanged = false;
        let topologyChanged = false;
        const nextCollapsed = new Set(currentCollapsed);

        // Build id->index map once for O(1) lookups: O(n)
        const idToIndex = new Map<string, number>();
        for (let i = 0; i < nextNodes.length; i++) {
          idToIndex.set(nextNodes[i].id, i);
        }

        for (const change of changes) {
          switch (change.type) {
            case 'position': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextNodes[index] = { ...nextNodes[index], position: change.position };
              }
              break;
            }
            case 'select': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextNodes[index] = { ...nextNodes[index], selected: change.selected };
              }
              break;
            }
            case 'remove': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextNodes.splice(index, 1);
                topologyChanged = true;
                // Update indices for subsequent removals (shift down)
                idToIndex.delete(change.id);
                for (let i = index; i < nextNodes.length; i++) {
                  idToIndex.set(nextNodes[i].id, i);
                }
                // Also remove from collapsed set if it was a group
                if (nextCollapsed.has(change.id)) {
                  nextCollapsed.delete(change.id);
                  collapsedChanged = true;
                }
              }
              break;
            }
            case 'add': {
              idToIndex.set(change.node.id, nextNodes.length);
              nextNodes.push(change.node);
              topologyChanged = true;
              // If adding a collapsed group, add to collapsed set
              if (change.node.type === 'group' && change.node.collapsed) {
                nextCollapsed.add(change.node.id);
                collapsedChanged = true;
              }
              break;
            }
            case 'dimensions': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextNodes[index] = {
                  ...nextNodes[index],
                  width: change.dimensions.width,
                  height: change.dimensions.height,
                };
              }
              break;
            }
            case 'collapse': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextNodes[index] = { ...nextNodes[index], collapsed: change.collapsed };
                if (change.collapsed) {
                  nextCollapsed.add(change.id);
                } else {
                  nextCollapsed.delete(change.id);
                }
                collapsedChanged = true;
              }
              break;
            }
            case 'parent': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextNodes[index] = {
                  ...nextNodes[index],
                  parentId: change.parentId ?? undefined,
                };
              }
              break;
            }
          }
        }

        // Rebuild derived state (nodeMap, quadtree, socketQuadtree) to stay in sync
        const finalCollapsed = collapsedChanged ? nextCollapsed : currentCollapsed;
        const derived = rebuildDerivedState(nextNodes, finalCollapsed);
        if (topologyChanged) cachedAnalysis = null;
        set({
          nodes: nextNodes,
          ...derived,
          ...(topologyChanged ? { topologyVersion: get().topologyVersion + 1 } : {}),
        });
      },

      applyEdgeChanges: (changes) => {
        const { edges } = get();
        const nextEdges = [...edges];

        // Build id->index map once for O(1) lookups: O(e)
        const idToIndex = new Map<string, number>();
        for (let i = 0; i < nextEdges.length; i++) {
          idToIndex.set(nextEdges[i].id, i);
        }

        let topologyChanged = false;
        for (const change of changes) {
          switch (change.type) {
            case 'select': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextEdges[index] = { ...nextEdges[index], selected: change.selected };
              }
              break;
            }
            case 'remove': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                topologyChanged = true;
                nextEdges.splice(index, 1);
                // Update indices for subsequent removals (shift down)
                idToIndex.delete(change.id);
                for (let i = index; i < nextEdges.length; i++) {
                  idToIndex.set(nextEdges[i].id, i);
                }
              }
              break;
            }
            case 'add': {
              topologyChanged = true;
              idToIndex.set(change.edge.id, nextEdges.length);
              nextEdges.push(change.edge);
              break;
            }
          }
        }

        if (topologyChanged) cachedAnalysis = null;
        set({
          edges: nextEdges,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          ...(topologyChanged ? {
            adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
            topologyVersion: get().topologyVersion + 1,
          } : {}),
        });
      },

      // Selection - O(1) operations using Sets
      selectNode: (id, additive = false) => {
        const { selectedNodeIds } = get();
        if (additive) {
          // Add to existing selection
          const newSet = new Set(selectedNodeIds);
          newSet.add(id);
          set({ selectedNodeIds: newSet });
        } else {
          // Replace selection (clear edges too for unified selection)
          set({
            selectedNodeIds: new Set([id]),
            selectedEdgeIds: new Set<string>(),
          });
        }
      },

      selectNodes: (ids) => {
        set({ selectedNodeIds: new Set(ids) });
      },

      selectEdge: (id, additive = false) => {
        const { selectedEdgeIds, selectedNodeIds } = get();
        if (additive) {
          // Add to existing selection
          const newSet = new Set(selectedEdgeIds);
          newSet.add(id);
          set({ selectedEdgeIds: newSet });
        } else {
          // Replace selection (clear nodes too for unified selection)
          set({
            selectedEdgeIds: new Set([id]),
            selectedNodeIds: new Set<string>(),
          });
        }
      },

      selectEdges: (ids) => {
        set({ selectedEdgeIds: new Set(ids) });
      },

      selectAll: () => {
        const { nodes } = get();
        set({ selectedNodeIds: new Set(nodes.map((n) => n.id)) });
      },

      deselectAll: () => {
        set({
          selectedNodeIds: new Set<string>(),
          selectedEdgeIds: new Set<string>(),
        });
      },

      isNodeSelected: (id) => {
        return get().selectedNodeIds.has(id);
      },

      isEdgeSelected: (id) => {
        return get().selectedEdgeIds.has(id);
      },

      // Viewport
      pan: (delta) => {
        const { viewport } = get();
        set({
          viewport: {
            ...viewport,
            x: viewport.x + delta.x,
            y: viewport.y + delta.y,
          },
        });
      },

      zoom: (delta, center) => {
        const { viewport } = get();
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewport.zoom + delta));

        if (center) {
          // Zoom towards center point
          const scale = newZoom / viewport.zoom;
          set({
            viewport: {
              x: center.x - (center.x - viewport.x) * scale,
              y: center.y - (center.y - viewport.y) * scale,
              zoom: newZoom,
            },
          });
        } else {
          set({
            viewport: { ...viewport, zoom: newZoom },
          });
        }
      },

      fitView: (options: FitViewOptions = {}, canvasWidth?: number, canvasHeight?: number) => {
        const { nodes: allNodes } = get();

        const {
          padding = 50,
          // includeHiddenNodes - reserved for future use when hidden nodes are supported
          minZoom: optMinZoom = MIN_ZOOM,
          maxZoom: optMaxZoom = 1, // Default: don't zoom in past 100%
          nodes: nodeIds,
          // duration - reserved for future animation support
        } = options;

        // Determine which nodes to fit
        let nodesToFit: Node[];
        if (nodeIds && nodeIds.length > 0) {
          // Fit specific nodes by ID
          const nodeIdSet = new Set(nodeIds);
          nodesToFit = allNodes.filter(n => nodeIdSet.has(n.id));
        } else {
          // Fit all nodes
          nodesToFit = allNodes;
        }

        if (nodesToFit.length === 0) return;

        // Use provided dimensions or fallback to window size
        const containerWidth = canvasWidth ?? window.innerWidth;
        const containerHeight = canvasHeight ?? window.innerHeight;

        // Calculate bounds
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;

        for (const node of nodesToFit) {
          minX = Math.min(minX, node.position.x);
          minY = Math.min(minY, node.position.y);
          maxX = Math.max(maxX, node.position.x + (node.width ?? 200));
          maxY = Math.max(maxY, node.position.y + (node.height ?? 100));
        }

        // Add padding
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        // Calculate zoom to fit content in container
        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        // Clamp zoom between optMinZoom and optMaxZoom, then also clamp to global limits
        const rawZoom = Math.min(containerWidth / contentWidth, containerHeight / contentHeight);
        const clampedZoom = Math.max(optMinZoom, Math.min(optMaxZoom, rawZoom));
        const finalZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, clampedZoom));

        // Center the content
        const scaledWidth = contentWidth * finalZoom;
        const scaledHeight = contentHeight * finalZoom;
        const offsetX = (containerWidth - scaledWidth) / 2 - minX * finalZoom;
        const offsetY = (containerHeight - scaledHeight) / 2 - minY * finalZoom;

        set({
          viewport: {
            x: offsetX,
            y: offsetY,
            zoom: finalZoom,
          },
        });
      },

      // Efficient batch position update for dragging
      // Updates positions and quadtree incrementally without full rebuild
      // O(n+k) where n=nodes, k=updates (builds index map once, then O(1) per update)
      updateNodePositions: (updates) => {
        const { nodes, nodeMap, quadtree, socketQuadtree, positionVersion } = get();
        const nextNodes = [...nodes];

        // Build id->index map once: O(n)
        const idToIndex = new Map<string, number>();
        for (let i = 0; i < nodes.length; i++) {
          idToIndex.set(nodes[i].id, i);
        }

        // Update each node: O(k)
        for (const { id, position } of updates) {
          const index = idToIndex.get(id);
          if (index !== undefined) {
            const node = { ...nextNodes[index], position };
            nextNodes[index] = node;
            nodeMap.set(id, node);
            quadtree.update(id, getNodeBounds(node));

            // Update socket positions in socketQuadtree
            const nodeWidth = node.width ?? 200;
            if (node.inputs) {
              for (let i = 0; i < node.inputs.length; i++) {
                const socket = node.inputs[i];
                const yOffset = getSocketYOffset(node, i, true);
                socketQuadtree.update(id, socket.id, true, position.x, position.y + yOffset);
              }
            }
            if (node.outputs) {
              for (let i = 0; i < node.outputs.length; i++) {
                const socket = node.outputs[i];
                const yOffset = getSocketYOffset(node, i, false);
                socketQuadtree.update(id, socket.id, false, position.x + nodeWidth, position.y + yOffset);
              }
            }
          }
        }

        // Increment positionVersion so subscribers know positions changed
        set({ nodes: nextNodes, positionVersion: positionVersion + 1 });
      },

      // ========================================
      // Phase 6: Core Operations Implementation
      // ========================================

      cloneElements: <T extends NodeData = NodeData>(
        nodesToClone: Node<T>[],
        edgesToClone: Edge[],
        options?: CloneElementsOptions<T>
      ): CloneElementsResult => {
        const {
          offset = { x: 50, y: 50 },
          transformData,
          generateId = defaultGenerateId,
          preserveExternalConnections = false,
        } = options ?? {};

        // Build ID map in single pass
        const idMap = new Map<string, string>();
        for (const node of nodesToClone) {
          idMap.set(node.id, generateId());
        }

        // Clone nodes with new IDs and offset positions
        const clonedNodes: Node[] = nodesToClone.map((node) => {
          const newId = idMap.get(node.id)!;
          const newData = transformData ? transformData(node.data as T) : { ...node.data };
          return {
            ...node,
            id: newId,
            position: {
              x: node.position.x + offset.x,
              y: node.position.y + offset.y,
            },
            data: newData,
            selected: false,
          };
        });

        // Build set of cloned node IDs for fast lookup
        const clonedNodeIdSet = new Set(nodesToClone.map((n) => n.id));

        // Clone edges, remapping source/target
        const clonedEdges: Edge[] = [];
        for (const edge of edgesToClone) {
          const sourceInCloned = clonedNodeIdSet.has(edge.source);
          const targetInCloned = clonedNodeIdSet.has(edge.target);

          if (sourceInCloned && targetInCloned) {
            // Internal edge: remap both endpoints
            const newSource = idMap.get(edge.source)!;
            const newTarget = idMap.get(edge.target)!;
            clonedEdges.push({
              ...edge,
              id: generateId(),
              source: newSource,
              target: newTarget,
              selected: false,
            });
          } else if (preserveExternalConnections) {
            // External edge: remap only the cloned endpoint, keep external reference
            if (sourceInCloned) {
              // Source is cloned, target is external
              clonedEdges.push({
                ...edge,
                id: generateId(),
                source: idMap.get(edge.source)!,
                target: edge.target, // Keep original external target
                selected: false,
              });
            } else if (targetInCloned) {
              // Target is cloned, source is external
              clonedEdges.push({
                ...edge,
                id: generateId(),
                source: edge.source, // Keep original external source
                target: idMap.get(edge.target)!,
                selected: false,
              });
            }
          }
          // If not preserveExternalConnections and edge is external, skip it
        }

        return { nodes: clonedNodes, edges: clonedEdges, idMap };
      },

      addElements: (batch) => {
        const { nodes: currentNodes, edges: currentEdges, nodeMap, quadtree, socketQuadtree } = get();
        const { nodes: newNodes = [], edges: newEdges = [] } = batch;

        if (newNodes.length === 0 && newEdges.length === 0) return;

        // Single state update with all new elements
        const nextNodes = [...currentNodes, ...newNodes];
        const nextEdges = [...currentEdges, ...newEdges];

        // Incremental update: add new nodes to existing data structures
        // O(k log n) instead of O(n log n) full rebuild
        for (const node of newNodes) {
          nodeMap.set(node.id, node);
        }
        quadtree.incrementalAdd(newNodes);

        // Add new sockets to socket quadtree
        for (const node of newNodes) {
          const nodeWidth = node.width ?? 200;
          if (node.inputs) {
            for (let i = 0; i < node.inputs.length; i++) {
              const socket = node.inputs[i];
              const yOffset = getSocketYOffset(node, i, true);
              socketQuadtree.insert({
                nodeId: node.id,
                socketId: socket.id,
                isInput: true,
                x: node.position.x,
                y: node.position.y + yOffset,
              });
            }
          }
          if (node.outputs) {
            for (let i = 0; i < node.outputs.length; i++) {
              const socket = node.outputs[i];
              const yOffset = getSocketYOffset(node, i, false);
              socketQuadtree.insert({
                nodeId: node.id,
                socketId: socket.id,
                isInput: false,
                x: node.position.x + nodeWidth,
                y: node.position.y + yOffset,
              });
            }
          }
        }

        cachedAnalysis = null;
        set({
          nodes: nextNodes,
          edges: nextEdges,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: get().topologyVersion + 1,
        });
      },

      deleteElements: (batch) => {
        const { nodes, edges, selectedNodeIds, selectedEdgeIds, nodeMap, quadtree, socketQuadtree } = get();
        const { nodeIds = [], edgeIds = [] } = batch;

        if (nodeIds.length === 0 && edgeIds.length === 0) return;

        // Build sets for O(1) lookup
        const nodeIdsToDelete = new Set(nodeIds);
        const edgeIdsToDelete = new Set(edgeIds);

        // Also delete edges connected to deleted nodes
        for (const edge of edges) {
          if (nodeIdsToDelete.has(edge.source) || nodeIdsToDelete.has(edge.target)) {
            edgeIdsToDelete.add(edge.id);
          }
        }

        // Incremental removal from spatial structures O(k log n)
        // Remove sockets first, then nodes
        for (const nodeId of nodeIdsToDelete) {
          const node = nodeMap.get(nodeId);
          if (node) {
            if (node.inputs) {
              for (const socket of node.inputs) {
                socketQuadtree.remove(nodeId, socket.id, true);
              }
            }
            if (node.outputs) {
              for (const socket of node.outputs) {
                socketQuadtree.remove(nodeId, socket.id, false);
              }
            }
          }
          nodeMap.delete(nodeId);
        }
        quadtree.incrementalRemove(Array.from(nodeIdsToDelete));

        // Filter out deleted elements
        const nextNodes = nodes.filter((n) => !nodeIdsToDelete.has(n.id));
        const nextEdges = edges.filter((e) => !edgeIdsToDelete.has(e.id));

        // Update selection - remove deleted items
        const nextSelectedNodeIds = new Set(selectedNodeIds);
        const nextSelectedEdgeIds = new Set(selectedEdgeIds);
        for (const id of nodeIdsToDelete) {
          nextSelectedNodeIds.delete(id);
        }
        for (const id of edgeIdsToDelete) {
          nextSelectedEdgeIds.delete(id);
        }

        cachedAnalysis = null;
        set({
          nodes: nextNodes,
          edges: nextEdges,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: get().topologyVersion + 1,
          selectedNodeIds: nextSelectedNodeIds,
          selectedEdgeIds: nextSelectedEdgeIds,
        });
      },

      deleteSelected: () => {
        const { selectedNodeIds, selectedEdgeIds, deleteElements } = get();
        deleteElements({
          nodeIds: Array.from(selectedNodeIds),
          edgeIds: Array.from(selectedEdgeIds),
        });
      },

      copySelectedToInternal: () => {
        const { getSelectedNodes, getConnectedEdges, selectedNodeIds } = get();
        const selectedNodes = getSelectedNodes();

        if (selectedNodes.length === 0) return;

        // Get ALL edges connected to selected nodes (both internal and external)
        // Filtering to internal-only or preserving external happens at paste time
        const nodeIds = Array.from(selectedNodeIds);
        const connectedEdges = getConnectedEdges(nodeIds);

        set({
          internalClipboard: {
            nodes: selectedNodes,
            edges: connectedEdges,
          },
        });
      },

      pasteFromInternal: <T extends NodeData = NodeData>(
        options?: PasteFromInternalOptions<T>
      ): CloneElementsResult | null => {
        const { internalClipboard, cloneElements, addElements, selectNodes, selectEdges } = get();

        if (!internalClipboard || internalClipboard.nodes.length === 0) {
          return null;
        }

        const { preserveExternalConnections = false } = options ?? {};
        const clipboardNodeIds = new Set(internalClipboard.nodes.map((n) => n.id));

        // Filter edges based on preserveExternalConnections option
        // - false (default): only edges where BOTH endpoints are in clipboard (internal edges)
        // - true: all edges where AT LEAST ONE endpoint is in clipboard (reconnect to existing nodes)
        const edgesToClone = preserveExternalConnections
          ? internalClipboard.edges
          : internalClipboard.edges.filter(
              (e) => clipboardNodeIds.has(e.source) && clipboardNodeIds.has(e.target)
            );

        // Clone with default offset
        const result = cloneElements(
          internalClipboard.nodes as Node<T>[],
          edgesToClone,
          {
            offset: options?.offset ?? { x: 50, y: 50 },
            transformData: options?.transformData,
            // For external connections, we need to preserve the original external node references
            preserveExternalConnections,
          }
        );

        // Add to graph
        addElements({ nodes: result.nodes, edges: result.edges });

        // Select pasted elements
        selectNodes(result.nodes.map((n) => n.id));
        selectEdges(result.edges.map((e) => e.id));

        return result;
      },

      cutSelectedToInternal: () => {
        const { copySelectedToInternal, deleteSelected } = get();
        copySelectedToInternal();
        deleteSelected();
      },

      toObject: (): FlowObject => {
        const { nodes, edges, viewport } = get();
        return { nodes, edges, viewport };
      },

      getSelectedNodes: (): Node[] => {
        const { nodes, selectedNodeIds } = get();
        if (selectedNodeIds.size === 0) return [];
        return nodes.filter((n) => selectedNodeIds.has(n.id));
      },

      getConnectedEdges: (nodeIds: string[]): Edge[] => {
        if (nodeIds.length === 0) return [];
        const { adjacencyIndex } = get();
        const seen = new Set<string>();
        const result: Edge[] = [];
        for (const nodeId of nodeIds) {
          const edges = adjacencyIndex.byNode.get(nodeId);
          if (edges) {
            for (const edge of edges) {
              if (!seen.has(edge.id)) {
                seen.add(edge.id);
                result.push(edge);
              }
            }
          }
        }
        return result;
      },

      // ========================================
      // Phase 7C: Grouping Actions Implementation
      // ========================================

      getGroupChildren: (groupId: string): Node[] => {
        const { nodes } = get();
        return utilGetGroupChildren(nodes, groupId);
      },

      getGroupDescendants: (groupId: string): Node[] => {
        const { nodes } = get();
        return utilGetGroupDescendants(nodes, groupId);
      },

      toggleGroupCollapse: (groupId: string): void => {
        const { nodeMap, collapsedGroupIds, applyNodeChanges } = get();
        const group = nodeMap.get(groupId);
        if (!group || group.type !== 'group') return;

        const newCollapsed = !collapsedGroupIds.has(groupId);
        applyNodeChanges([{ type: 'collapse', id: groupId, collapsed: newCollapsed }]);
      },

      expandGroup: (groupId: string): void => {
        const { collapsedGroupIds, applyNodeChanges } = get();
        if (collapsedGroupIds.has(groupId)) {
          applyNodeChanges([{ type: 'collapse', id: groupId, collapsed: false }]);
        }
      },

      collapseGroup: (groupId: string): void => {
        const { collapsedGroupIds, applyNodeChanges } = get();
        if (!collapsedGroupIds.has(groupId)) {
          applyNodeChanges([{ type: 'collapse', id: groupId, collapsed: true }]);
        }
      },

      isGroupCollapsed: (groupId: string): boolean => {
        const { collapsedGroupIds } = get();
        return collapsedGroupIds.has(groupId);
      },

      getGroupBounds: (groupId: string): Bounds | null => {
        const { nodes } = get();
        return utilCalculateGroupBounds(nodes, groupId);
      },

      setNodeParent: (nodeId: string, parentId: string | null): boolean => {
        const { nodeMap, applyNodeChanges } = get();
        const node = nodeMap.get(nodeId);
        if (!node) return false;

        // Validate: can't parent to self
        if (parentId === nodeId) return false;

        // Validate: can't create cycle (if proposedParent is a descendant of node)
        if (parentId) {
          const parent = nodeMap.get(parentId);
          if (!parent) return false;

          // Check if parentId is a descendant of nodeId
          let current: string | undefined = parent.parentId;
          while (current) {
            if (current === nodeId) return false; // Would create cycle
            const currentNode = nodeMap.get(current);
            current = currentNode?.parentId;
          }
        }

        applyNodeChanges([{ type: 'parent', id: nodeId, parentId }]);
        return true;
      },

      moveGroup: (groupId: string, delta: XYPosition): void => {
        const { nodes, nodeMap, updateNodePositions } = get();
        const group = nodeMap.get(groupId);
        if (!group) return;

        // Get positions for group and all descendants
        const descendantPositions = calculateDescendantPositions(nodes, groupId, delta);

        // Build updates array
        const updates: Array<{ id: string; position: XYPosition }> = [
          { id: groupId, position: { x: group.position.x + delta.x, y: group.position.y + delta.y } },
        ];

        for (const [id, position] of descendantPositions) {
          updates.push({ id, position });
        }

        updateNodePositions(updates);
      },

      // ========================================
      // Phase 8: Graph Engine Implementation
      // ========================================

      getIncomers: (nodeId: string): string[] => {
        return graphEngine.getIncomers(get().adjacencyIndex, nodeId);
      },

      getOutgoers: (nodeId: string): string[] => {
        return graphEngine.getOutgoers(get().adjacencyIndex, nodeId);
      },

      getNodeEdges: (nodeId: string): Edge[] => {
        return graphEngine.getNodeEdges(get().adjacencyIndex, nodeId);
      },

      getInputEdges: (nodeId: string): Edge[] => {
        return graphEngine.getInputEdges(get().adjacencyIndex, nodeId);
      },

      getOutputEdges: (nodeId: string): Edge[] => {
        return graphEngine.getOutputEdges(get().adjacencyIndex, nodeId);
      },

      getEdgesBetween: (nodeA: string, nodeB: string): Edge[] => {
        return graphEngine.getEdgesBetween(get().adjacencyIndex, nodeA, nodeB);
      },

      walkUpstream: (startNodeId: string): Generator<string> => {
        return graphEngine.walkUpstream(get().adjacencyIndex, startNodeId);
      },

      walkDownstream: (startNodeId: string): Generator<string> => {
        return graphEngine.walkDownstream(get().adjacencyIndex, startNodeId);
      },

      getAnalysis: (): CachedAnalysis => {
        const { nodes, adjacencyIndex, topologyVersion, mutedNodeIds } = get();
        if (cachedAnalysis && cachedAnalysis.topologyVersion === topologyVersion) {
          return cachedAnalysis;
        }
        const nodeIds = nodes.map((n) => n.id);
        const result = graphEngine.computeAnalysis(nodeIds, adjacencyIndex, mutedNodeIds);
        cachedAnalysis = { ...result, topologyVersion };
        return cachedAnalysis;
      },

      wouldCreateCycle: (sourceNodeId: string, targetNodeId: string): boolean => {
        return graphEngine.wouldCreateCycle(get().adjacencyIndex, sourceNodeId, targetNodeId);
      },

      getAffectedEntities: (changedNodeIds: string | string[]): string[] => {
        const { adjacencyIndex, mutedNodeIds } = get();
        const analysis = get().getAnalysis();
        return graphEngine.getAffectedEntities(
          changedNodeIds,
          adjacencyIndex,
          analysis.topologicalOrder,
          mutedNodeIds
        );
      },

      getConnectedComponents: (): Map<string, string[]> => {
        const { nodes, adjacencyIndex } = get();
        return graphEngine.getConnectedComponents(
          nodes.map((n) => n.id),
          adjacencyIndex
        );
      },

      areConnected: (nodeA: string, nodeB: string): boolean => {
        return graphEngine.areConnected(get().adjacencyIndex, nodeA, nodeB);
      },

      getExecutionOrder: (targetNodeId: string): string[] => {
        return graphEngine.getExecutionOrder(get().adjacencyIndex, targetNodeId);
      },

      getReadyEntities: (nodeIds: string[], completed: ReadonlySet<string>): string[] => {
        return graphEngine.getReadyEntities(nodeIds, get().adjacencyIndex, completed);
      },

      insertOnEdge: (edgeId: string, newNode: Node): void => {
        const state = get();
        const edge = state.edges.find((e) => e.id === edgeId);
        if (!edge) return;

        const changes = graphEngine.computeInsertOnEdge(
          edge,
          newNode,
          state.nodeMap.get(edge.source),
          state.nodeMap.get(edge.target)
        );

        const positionedNode = { ...newNode, position: changes.nodePosition };
        const nextNodes = [...state.nodes, positionedNode];
        const nextEdges = state.edges
          .filter((e) => e.id !== changes.removeEdgeId)
          .concat(changes.newEdges);

        const derived = rebuildDerivedState(nextNodes, state.collapsedGroupIds);
        cachedAnalysis = null;
        set({
          nodes: nextNodes,
          edges: nextEdges,
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: state.topologyVersion + 1,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          ...derived,
        });
      },

      bypassEntity: (nodeId: string): void => {
        const state = get();
        const changes = graphEngine.computeBypass(nodeId, state.adjacencyIndex);

        const removeEdgeIdSet = new Set(changes.removeEdgeIds);
        const nextEdges = state.edges
          .filter((e) => !removeEdgeIdSet.has(e.id))
          .concat(changes.newEdges);
        const nextNodes = state.nodes.filter((n) => n.id !== changes.removeNodeId);

        const derived = rebuildDerivedState(nextNodes, state.collapsedGroupIds);
        cachedAnalysis = null;

        // Update selection
        const nextSelectedNodeIds = new Set(state.selectedNodeIds);
        nextSelectedNodeIds.delete(nodeId);
        const nextSelectedEdgeIds = new Set(state.selectedEdgeIds);
        for (const id of removeEdgeIdSet) nextSelectedEdgeIds.delete(id);

        set({
          nodes: nextNodes,
          edges: nextEdges,
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: state.topologyVersion + 1,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          selectedNodeIds: nextSelectedNodeIds,
          selectedEdgeIds: nextSelectedEdgeIds,
          ...derived,
        });
      },

      muteEntity: (nodeId: string): void => {
        const { mutedNodeIds, topologyVersion } = get();
        if (mutedNodeIds.has(nodeId)) return;
        const next = new Set(mutedNodeIds);
        next.add(nodeId);
        cachedAnalysis = null;
        set({ mutedNodeIds: next, topologyVersion: topologyVersion + 1 });
      },

      unmuteEntity: (nodeId: string): void => {
        const { mutedNodeIds, topologyVersion } = get();
        if (!mutedNodeIds.has(nodeId)) return;
        const next = new Set(mutedNodeIds);
        next.delete(nodeId);
        cachedAnalysis = null;
        set({ mutedNodeIds: next, topologyVersion: topologyVersion + 1 });
      },

      isMuted: (nodeId: string): boolean => {
        return get().mutedNodeIds.has(nodeId);
      },

      // ========================================
      // Phase 8: Graph Validation & Subgraph Mutations
      // ========================================

      validate: (socketTypes) => {
        const { nodes, edges, adjacencyIndex } = get();
        return graphEngine.validate(nodes, edges, adjacencyIndex, socketTypes);
      },

      isGraphComplete: () => {
        const { nodes, adjacencyIndex } = get();
        return graphEngine.isGraphComplete(nodes, adjacencyIndex);
      },

      getCompatiblePorts: (sourceNodeId, sourceSocketId, isSourceInput, socketTypes, allowCycles) => {
        const { nodes, adjacencyIndex } = get();
        return graphEngine.getCompatiblePorts(
          sourceNodeId,
          sourceSocketId,
          isSourceInput,
          nodes,
          socketTypes,
          adjacencyIndex,
          allowCycles
        );
      },

      collapseToSubgraph: (nodeIds: string[], groupId: string): void => {
        const state = get();
        const result = graphEngine.computeCollapseToSubgraph(
          nodeIds,
          groupId,
          state.nodes,
          state.adjacencyIndex
        );

        // Create the group node
        const groupNode: Node = {
          id: result.groupNode.id,
          type: 'group',
          position: result.groupNode.position,
          width: result.groupNode.width,
          height: result.groupNode.height,
          data: { label: 'Group' },
          inputs: result.groupInputs.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type,
          })),
          outputs: result.groupOutputs.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type,
          })),
        };

        // Set children's parentId to the group
        const childIdSet = new Set(nodeIds);
        const removeEdgeIdSet = new Set(result.removeEdgeIds);
        const nextNodes = state.nodes
          .map((n) => (childIdSet.has(n.id) ? { ...n, parentId: groupId } : n))
          .concat(groupNode);
        const nextEdges = state.edges
          .filter((e) => !removeEdgeIdSet.has(e.id))
          .concat(result.newEdges);

        const derived = rebuildDerivedState(nextNodes, state.collapsedGroupIds);
        cachedAnalysis = null;
        set({
          nodes: nextNodes,
          edges: nextEdges,
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: state.topologyVersion + 1,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          ...derived,
        });
      },

      expandSubgraph: (groupId, childNodes, internalEdges, portMapping): void => {
        const state = get();
        const result = graphEngine.computeExpandSubgraph(
          groupId,
          childNodes,
          internalEdges,
          state.nodes,
          state.adjacencyIndex,
          portMapping
        );

        const removeEdgeIdSet = new Set(result.removeEdgeIds);
        // Remove group node, restore children (clear parentId), add reconnect edges
        const nextNodes = state.nodes
          .filter((n) => n.id !== result.removeNodeId)
          .map((n) => (n.parentId === groupId ? { ...n, parentId: undefined } : n))
          .concat(result.restoreNodes.map((n) => ({ ...n, parentId: undefined })));
        const nextEdges = state.edges
          .filter((e) => !removeEdgeIdSet.has(e.id))
          .concat(result.restoreEdges)
          .concat(result.reconnectEdges);

        const derived = rebuildDerivedState(nextNodes, state.collapsedGroupIds);
        cachedAnalysis = null;

        // Update selection
        const nextSelectedNodeIds = new Set(state.selectedNodeIds);
        nextSelectedNodeIds.delete(groupId);
        const nextSelectedEdgeIds = new Set(state.selectedEdgeIds);
        for (const id of removeEdgeIdSet) nextSelectedEdgeIds.delete(id);

        set({
          nodes: nextNodes,
          edges: nextEdges,
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: state.topologyVersion + 1,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          selectedNodeIds: nextSelectedNodeIds,
          selectedEdgeIds: nextSelectedEdgeIds,
          ...derived,
        });
      },
    }))
  );
};
