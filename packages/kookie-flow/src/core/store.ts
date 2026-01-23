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
} from '../types';
import { DEFAULT_VIEWPORT, MIN_ZOOM, MAX_ZOOM } from './constants';
import { Quadtree, getNodeBounds } from './spatial';

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
  fitView: (padding?: number) => void;

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
}

export type FlowStore = ReturnType<typeof createFlowStore>;

// Helper to rebuild derived state from nodes
function rebuildDerivedState(nodes: Node[]) {
  const nodeMap = new Map<string, Node>();
  const quadtree = new Quadtree({ x: -10000, y: -10000, width: 20000, height: 20000 });

  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  quadtree.rebuild(nodes);

  return { nodeMap, quadtree };
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
  const { nodeMap, quadtree } = rebuildDerivedState(initialNodes);
  const connectedSockets = rebuildConnectedSockets(initialEdges);

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
      connectedSockets,

      // Position version for tracking position changes
      positionVersion: 0,

      // Internal clipboard
      internalClipboard: null,

      // Setters - rebuild derived state when nodes change
      setNodes: (nodes) => {
        const { nodeMap, quadtree } = rebuildDerivedState(nodes);
        set({ nodes, nodeMap, quadtree });
      },
      setEdges: (edges) => set({ edges, connectedSockets: rebuildConnectedSockets(edges) }),
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
        const { nodes } = get();
        const nextNodes = [...nodes];

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
                // Update indices for subsequent removals (shift down)
                idToIndex.delete(change.id);
                for (let i = index; i < nextNodes.length; i++) {
                  idToIndex.set(nextNodes[i].id, i);
                }
              }
              break;
            }
            case 'add': {
              idToIndex.set(change.node.id, nextNodes.length);
              nextNodes.push(change.node);
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
          }
        }

        // Rebuild derived state (nodeMap, quadtree) to stay in sync
        const { nodeMap, quadtree } = rebuildDerivedState(nextNodes);
        set({ nodes: nextNodes, nodeMap, quadtree });
      },

      applyEdgeChanges: (changes) => {
        const { edges } = get();
        const nextEdges = [...edges];

        // Build id->index map once for O(1) lookups: O(e)
        const idToIndex = new Map<string, number>();
        for (let i = 0; i < nextEdges.length; i++) {
          idToIndex.set(nextEdges[i].id, i);
        }

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
              idToIndex.set(change.edge.id, nextEdges.length);
              nextEdges.push(change.edge);
              break;
            }
          }
        }

        set({ edges: nextEdges, connectedSockets: rebuildConnectedSockets(nextEdges) });
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

      fitView: (padding = 50, canvasWidth?: number, canvasHeight?: number) => {
        const { nodes } = get();
        if (nodes.length === 0) return;

        // Use provided dimensions or fallback to window size
        const containerWidth = canvasWidth ?? window.innerWidth;
        const containerHeight = canvasHeight ?? window.innerHeight;

        // Calculate bounds
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;

        for (const node of nodes) {
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
        const zoom = Math.min(1, Math.min(containerWidth / contentWidth, containerHeight / contentHeight));

        // Center the content
        const scaledWidth = contentWidth * zoom;
        const scaledHeight = contentHeight * zoom;
        const offsetX = (containerWidth - scaledWidth) / 2 - minX * zoom;
        const offsetY = (containerHeight - scaledHeight) / 2 - minY * zoom;

        set({
          viewport: {
            x: offsetX,
            y: offsetY,
            zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)),
          },
        });
      },

      // Efficient batch position update for dragging
      // Updates positions and quadtree incrementally without full rebuild
      // O(n+k) where n=nodes, k=updates (builds index map once, then O(1) per update)
      updateNodePositions: (updates) => {
        const { nodes, nodeMap, quadtree, positionVersion } = get();
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
        const { nodes: currentNodes, edges: currentEdges } = get();
        const { nodes: newNodes = [], edges: newEdges = [] } = batch;

        if (newNodes.length === 0 && newEdges.length === 0) return;

        // Single state update with all new elements
        const nextNodes = [...currentNodes, ...newNodes];
        const nextEdges = [...currentEdges, ...newEdges];

        // Rebuild derived state once
        const { nodeMap, quadtree } = rebuildDerivedState(nextNodes);
        set({
          nodes: nextNodes,
          edges: nextEdges,
          nodeMap,
          quadtree,
          connectedSockets: rebuildConnectedSockets(nextEdges),
        });
      },

      deleteElements: (batch) => {
        const { nodes, edges, selectedNodeIds, selectedEdgeIds } = get();
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

        // Rebuild derived state
        const { nodeMap, quadtree } = rebuildDerivedState(nextNodes);
        set({
          nodes: nextNodes,
          edges: nextEdges,
          nodeMap,
          quadtree,
          connectedSockets: rebuildConnectedSockets(nextEdges),
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
        const { edges } = get();
        if (nodeIds.length === 0) return [];

        const nodeIdSet = new Set(nodeIds);
        return edges.filter((e) => nodeIdSet.has(e.source) || nodeIdSet.has(e.target));
      },
    }))
  );
};
