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

  /** Selection */
  selectNode: (id: string, additive?: boolean) => void;
  selectNodes: (ids: string[]) => void;
  selectAll: () => void;
  deselectAll: () => void;

  /** Viewport controls */
  pan: (delta: XYPosition) => void;
  zoom: (delta: number, center?: XYPosition) => void;
  fitView: (padding?: number) => void;
}

export type FlowStore = ReturnType<typeof createFlowStore>;

export const createFlowStore = (initialState?: Partial<FlowState>) =>
  create<FlowState>()(
    subscribeWithSelector((set, get) => ({
      // Initial state
      nodes: [],
      edges: [],
      viewport: DEFAULT_VIEWPORT,
      connectionStart: null,
      hoveredNodeId: null,
      selectionBox: null,
      ...initialState,

      // Setters
      setNodes: (nodes) => set({ nodes }),
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

      // Selection
      selectNode: (id, additive = false) => {
        const { nodes } = get();
        set({
          nodes: nodes.map((n) => ({
            ...n,
            selected: n.id === id ? true : additive ? n.selected : false,
          })),
        });
      },

      selectNodes: (ids) => {
        const { nodes } = get();
        const idSet = new Set(ids);
        set({
          nodes: nodes.map((n) => ({
            ...n,
            selected: idSet.has(n.id),
          })),
        });
      },

      selectAll: () => {
        const { nodes } = get();
        set({
          nodes: nodes.map((n) => ({ ...n, selected: true })),
        });
      },

      deselectAll: () => {
        const { nodes, edges } = get();
        set({
          nodes: nodes.map((n) => ({ ...n, selected: false })),
          edges: edges.map((e) => ({ ...e, selected: false })),
        });
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

      fitView: (padding = 50) => {
        const { nodes } = get();
        if (nodes.length === 0) return;

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

        // Calculate zoom to fit
        // This is simplified - in real implementation would need canvas dimensions
        const width = maxX - minX;
        const height = maxY - minY;
        const zoom = Math.min(1, Math.min(800 / width, 600 / height));

        set({
          viewport: {
            x: -minX * zoom,
            y: -minY * zoom,
            zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)),
          },
        });
      },
    }))
  );
