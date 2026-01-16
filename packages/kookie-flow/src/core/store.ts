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
} from '../types';
import { DEFAULT_VIEWPORT, MIN_ZOOM, MAX_ZOOM } from './constants';
import { Quadtree, getNodeBounds } from './spatial';

export interface FlowState {
  /** Nodes in the graph */
  nodes: Node[];
  /** Edges in the graph */
  edges: Edge[];
  /** Current viewport */
  viewport: Viewport;
  /** Currently connecting from */
  connectionStart: { nodeId: string; socketId: string } | null;
  /** Currently hovered node */
  hoveredNodeId: string | null;
  /** Box selection in progress */
  selectionBox: { start: XYPosition; end: XYPosition } | null;

  /** Selection state - O(1) lookup */
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;

  /** Node map for O(1) lookup by ID */
  nodeMap: Map<string, Node>;

  /** Quadtree for O(log n) spatial queries */
  quadtree: Quadtree;

  /** Internal actions */
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setViewport: (viewport: Viewport) => void;
  setHoveredNodeId: (id: string | null) => void;
  startConnection: (nodeId: string, socketId: string) => void;
  endConnection: () => void;
  setSelectionBox: (box: { start: XYPosition; end: XYPosition } | null) => void;

  /** Apply changes */
  applyNodeChanges: (changes: NodeChange[]) => void;
  applyEdgeChanges: (changes: EdgeChange[]) => void;

  /** Selection - O(1) operations */
  selectNode: (id: string, additive?: boolean) => void;
  selectNodes: (ids: string[]) => void;
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

export const createFlowStore = (initialState?: Partial<FlowState>) => {
  // Initialize derived state from initial nodes
  const initialNodes = initialState?.nodes ?? [];
  const { nodeMap, quadtree } = rebuildDerivedState(initialNodes);

  return create<FlowState>()(
    subscribeWithSelector((set, get) => ({
      // Initial state
      nodes: initialNodes,
      edges: [],
      viewport: DEFAULT_VIEWPORT,
      connectionStart: null,
      hoveredNodeId: null,
      selectionBox: null,

      // Selection state
      selectedNodeIds: new Set<string>(),
      selectedEdgeIds: new Set<string>(),

      // Derived state for O(1) lookups
      nodeMap,
      quadtree,

      ...initialState,

      // Setters - rebuild derived state when nodes change
      setNodes: (nodes) => {
        const { nodeMap, quadtree } = rebuildDerivedState(nodes);
        set({ nodes, nodeMap, quadtree });
      },
      setEdges: (edges) => set({ edges }),
      setViewport: (viewport) => set({ viewport }),
      setHoveredNodeId: (hoveredNodeId) => set({ hoveredNodeId }),
      startConnection: (nodeId, socketId) =>
        set({ connectionStart: { nodeId, socketId } }),
      endConnection: () => set({ connectionStart: null }),
      setSelectionBox: (selectionBox) => set({ selectionBox }),

      // Apply changes
      applyNodeChanges: (changes) => {
        const { nodes } = get();
        const nextNodes = [...nodes];

        for (const change of changes) {
          switch (change.type) {
            case 'position': {
              const index = nextNodes.findIndex((n) => n.id === change.id);
              if (index !== -1) {
                nextNodes[index] = { ...nextNodes[index], position: change.position };
              }
              break;
            }
            case 'select': {
              const index = nextNodes.findIndex((n) => n.id === change.id);
              if (index !== -1) {
                nextNodes[index] = { ...nextNodes[index], selected: change.selected };
              }
              break;
            }
            case 'remove': {
              const index = nextNodes.findIndex((n) => n.id === change.id);
              if (index !== -1) {
                nextNodes.splice(index, 1);
              }
              break;
            }
            case 'add': {
              nextNodes.push(change.node);
              break;
            }
            case 'dimensions': {
              const index = nextNodes.findIndex((n) => n.id === change.id);
              if (index !== -1) {
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

        set({ nodes: nextNodes });
      },

      applyEdgeChanges: (changes) => {
        const { edges } = get();
        const nextEdges = [...edges];

        for (const change of changes) {
          switch (change.type) {
            case 'select': {
              const index = nextEdges.findIndex((e) => e.id === change.id);
              if (index !== -1) {
                nextEdges[index] = { ...nextEdges[index], selected: change.selected };
              }
              break;
            }
            case 'remove': {
              const index = nextEdges.findIndex((e) => e.id === change.id);
              if (index !== -1) {
                nextEdges.splice(index, 1);
              }
              break;
            }
            case 'add': {
              nextEdges.push(change.edge);
              break;
            }
          }
        }

        set({ edges: nextEdges });
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
          // Replace selection
          set({ selectedNodeIds: new Set([id]) });
        }
      },

      selectNodes: (ids) => {
        set({ selectedNodeIds: new Set(ids) });
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
      updateNodePositions: (updates) => {
        const { nodes, nodeMap, quadtree } = get();
        const nextNodes = [...nodes];

        for (const { id, position } of updates) {
          const index = nextNodes.findIndex((n) => n.id === id);
          if (index !== -1) {
            const node = { ...nextNodes[index], position };
            nextNodes[index] = node;
            nodeMap.set(id, node);
            quadtree.update(id, getNodeBounds(node));
          }
        }

        set({ nodes: nextNodes });
      },
    }))
  );
};
