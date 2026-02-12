import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  Entity,
  Edge,
  Viewport,
  EntityChange,
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
  EntityData,
  FitViewOptions,
} from '../types';
import { DEFAULT_VIEWPORT, MIN_ZOOM, MAX_ZOOM, SOCKET_MARGIN_TOP, SOCKET_SPACING, SOCKET_OFFSET } from './constants';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { Quadtree, SocketQuadtree, getEntityBounds, type SocketEntry } from './spatial';
import {
  getGroupChildren as utilGetGroupChildren,
  getGroupDescendants as utilGetGroupDescendants,
  isEntityHidden,
  calculateGroupBounds as utilCalculateGroupBounds,
  calculateDescendantPositions,
  type Bounds,
} from '../utils/grouping';
import * as graphEngine from './graph';
import type { AdjacencyIndex, CachedAnalysis } from './graph';
import type { ResolvedSocketLayout } from '../utils/style-resolver';

// Pre-allocated ID pool for efficient cloning
let idCounter = 0;
const defaultGenerateId = () => `kf-${Date.now()}-${++idCounter}`;

/**
 * Side-channel for communicating moved entity IDs to renderers.
 * Avoids adding to Zustand state (no GC from new Set per frame).
 * Set by updateEntityPositions, read by Edges/Sockets useFrame.
 */
const _movedEntityIds = new Set<string>();
export function getMovedEntityIds(): ReadonlySet<string> {
  return _movedEntityIds;
}

export interface FlowState {
  /** Entities in the graph */
  entities: Entity[];
  /** Edges in the graph */
  edges: Edge[];
  /** Current viewport */
  viewport: Viewport;
  /** Currently connecting from (legacy) */
  connectionStart: { entityId: string; socketId: string } | null;
  /** Currently hovered entity */
  hoveredEntityId: string | null;
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
  selectedEntityIds: Set<string>;
  selectedEdgeIds: Set<string>;

  /** Entity map for O(1) lookup by ID */
  entityMap: Map<string, Entity>;

  /** Quadtree for O(log n) spatial queries */
  quadtree: Quadtree;

  /** Socket quadtree for O(log n) socket hit testing during connection draft */
  socketQuadtree: SocketQuadtree;

  /**
   * Connected sockets cache - O(1) lookup for widget visibility.
   * Format: "entityId:socketId" for each input socket that has an incoming edge.
   * Rebuilt when edges change.
   */
  connectedSockets: Set<string>;

  /**
   * Position version counter - increments on any position update.
   * Used by components that need to track position changes without
   * relying on entityMap reference changes (which may be mutated in place).
   */
  positionVersion: number;

  /** Internal clipboard (holds references, no serialization) */
  internalClipboard: InternalClipboard | null;

  /** ID of the text entity currently being edited, or null if not editing */
  editingEntityId: string | null;

  /** Live text content while editing (null = not editing) */
  editingContent: string | null;

  /** Cursor/selection character offsets while editing (null = not editing) */
  editingCursor: { start: number; end: number } | null;

  // ============================================================================
  // Grouping State (Phase 7C)
  // ============================================================================

  /** Set of collapsed group entity IDs (O(1) lookup for visibility checks) */
  collapsedGroupIds: Set<string>;

  /**
   * Pre-computed set of hidden entity IDs (entities inside collapsed groups).
   * Rebuilt when collapsedGroupIds changes. Used for O(1) visibility checks in hot paths.
   */
  hiddenEntityIds: Set<string>;

  // ============================================================================
  // Graph Engine State (Phase 8)
  // ============================================================================

  /** Pre-computed adjacency index for O(1) neighbor lookups. Rebuilt on edge changes. */
  adjacencyIndex: AdjacencyIndex;

  /** Topology version counter. Increments on entity/edge add/remove only. */
  topologyVersion: number;

  /** Entity IDs excluded from execution (treated as pass-through). */
  mutedEntityIds: Set<string>;

  /** Resolved socket layout from style context — used for correct entity height in quadtree bounds */
  socketLayout: ResolvedSocketLayout | null;

  /** Internal actions */
  setEntities: (entities: Entity[]) => void;
  setEdges: (edges: Edge[]) => void;
  setViewport: (viewport: Viewport) => void;
  setSocketLayout: (layout: ResolvedSocketLayout) => void;
  setHoveredEntityId: (id: string | null) => void;
  setHoveredSocketId: (socket: SocketHandle | null) => void;
  startConnection: (entityId: string, socketId: string) => void;
  endConnection: () => void;
  setSelectionBox: (box: { start: XYPosition; end: XYPosition } | null) => void;
  setEditingEntityId: (id: string | null) => void;
  setEditingContent: (content: string) => void;
  setEditingCursor: (start: number, end: number) => void;
  startEditing: (entityId: string) => void;
  stopEditing: () => void;

  /** Connection draft actions */
  startConnectionDraft: (source: SocketHandle, mouseWorld: XYPosition) => void;
  updateConnectionDraft: (mouseWorld: XYPosition, isValid?: boolean) => void;
  cancelConnectionDraft: () => void;

  /** Apply changes */
  applyEntityChanges: (changes: EntityChange[]) => void;
  applyEdgeChanges: (changes: EdgeChange[]) => void;

  /** Selection - O(1) operations */
  selectEntity: (id: string, additive?: boolean) => void;
  selectEntities: (ids: string[]) => void;
  selectEdge: (id: string, additive?: boolean) => void;
  selectEdges: (ids: string[]) => void;
  selectAll: () => void;
  deselectAll: () => void;
  isEntitySelected: (id: string) => boolean;
  isEdgeSelected: (id: string) => boolean;

  /** Viewport controls */
  pan: (delta: XYPosition) => void;
  zoom: (delta: number, center?: XYPosition) => void;
  fitView: (options?: FitViewOptions, canvasWidth?: number, canvasHeight?: number) => void;

  /** Efficient batch position update for dragging */
  updateEntityPositions: (updates: Array<{ id: string; position: XYPosition }>) => void;

  /** Efficient dimension update for resizing (avoids full applyEntityChanges rebuild) */
  updateEntityDimensions: (id: string, width: number, height: number, position?: XYPosition) => void;

  /** Clear explicit width/height to revert to computed minimum from socket layout */
  fitEntityToContent: (id: string) => void;

  // ========================================
  // Phase 6: Core Operations
  // ========================================

  /**
   * Clone entities and edges with new IDs.
   * Single-pass operation with pre-allocated ID pool and edge remapping.
   */
  cloneElements: <T extends EntityData = EntityData>(
    entities: Entity<T>[],
    edges: Edge[],
    options?: CloneElementsOptions<T>
  ) => CloneElementsResult;

  /**
   * Batch add entities and edges in a single state update.
   * More efficient than multiple applyEntityChanges/applyEdgeChanges calls.
   */
  addElements: (batch: ElementsBatch) => void;

  /**
   * Delete entities and edges by ID.
   * Automatically removes edges connected to deleted entities.
   */
  deleteElements: (batch: DeleteElementsBatch) => void;

  /**
   * Delete all currently selected entities and edges.
   * Convenience wrapper around deleteElements.
   */
  deleteSelected: () => void;

  /**
   * Copy selected entities and connected edges to internal clipboard.
   * No serialization - just holds references.
   */
  copySelectedToInternal: () => void;

  /**
   * Paste from internal clipboard.
   * Clones the clipboard contents with new IDs.
   */
  pasteFromInternal: <T extends EntityData = EntityData>(
    options?: Omit<CloneElementsOptions<T>, 'generateId'>
  ) => CloneElementsResult | null;

  /**
   * Cut selected entities and edges to internal clipboard.
   * Copies then deletes.
   */
  cutSelectedToInternal: () => void;

  /**
   * Serialize current flow state to a plain object.
   * For persistence or browser clipboard.
   */
  toObject: () => FlowObject;

  /**
   * Get currently selected entities.
   */
  getSelectedEntities: () => Entity[];

  /**
   * Get edges connected to the given entity IDs.
   */
  getConnectedEdges: (entityIds: string[]) => Edge[];

  // ========================================
  // Phase 7C: Grouping Actions
  // ========================================

  /**
   * Get direct children of a group entity.
   */
  getGroupChildren: (groupId: string) => Entity[];

  /**
   * Get all descendants of a group entity (recursive).
   */
  getGroupDescendants: (groupId: string) => Entity[];

  /**
   * Toggle a group's collapsed state.
   * Fires a 'collapse' entity change event.
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
   * Set the parent of an entity (for grouping).
   * Validates that the operation doesn't create cycles.
   */
  setEntityParent: (entityId: string, parentId: string | null) => boolean;

  /**
   * Move a group and all its descendants.
   * Updates positions in a single batch for performance.
   */
  moveGroup: (groupId: string, delta: XYPosition) => void;

  // ============================================================================
  // Graph Engine Queries (Phase 8)
  // ============================================================================

  /** Get entity IDs that directly feed into this entity. */
  getIncomers: (entityId: string) => string[];
  /** Get entity IDs that this entity directly feeds into. */
  getOutgoers: (entityId: string) => string[];
  /** Get all edges touching an entity via adjacency index. */
  getEntityEdges: (entityId: string) => Edge[];
  /** Get edges arriving at an entity (inputs). */
  getInputEdges: (entityId: string) => Edge[];
  /** Get edges leaving an entity (outputs). */
  getOutputEdges: (entityId: string) => Edge[];
  /** Get direct edges between two entities. */
  getEdgesBetween: (entityA: string, entityB: string) => Edge[];
  /** Walk upstream from an entity, yielding all ancestor entity IDs. */
  walkUpstream: (startEntityId: string) => Generator<string>;
  /** Walk downstream from an entity, yielding all dependent entity IDs. */
  walkDownstream: (startEntityId: string) => Generator<string>;
  /** Get cached graph analysis (topo sort, execution levels, cycles, roots, leaves). */
  getAnalysis: () => CachedAnalysis;
  /** Would adding an edge from source to target create a cycle? */
  wouldCreateCycle: (sourceEntityId: string, targetEntityId: string) => boolean;
  /** Get all entities downstream of changed entities, in topological order. */
  getAffectedEntities: (changedEntityIds: string | string[]) => string[];
  /** Find connected components. Returns Map<componentId, entityIds[]>. */
  getConnectedComponents: () => Map<string, string[]>;
  /** Check if two entities are in the same connected component. */
  areConnected: (entityA: string, entityB: string) => boolean;
  /** Get execution order for evaluating a specific entity (upstream subgraph). */
  getExecutionOrder: (targetEntityId: string) => string[];
  /** Get entities ready to execute given completed set. */
  getReadyEntities: (entityIds: string[], completed: ReadonlySet<string>) => string[];
  /** Insert an entity onto an existing edge (A→B becomes A→new→B). */
  insertOnEdge: (edgeId: string, newEntity: Entity) => void;
  /** Remove an entity and reconnect its inputs to outputs. */
  bypassEntity: (entityId: string) => void;
  /** Mark an entity as muted (skipped in execution). */
  muteEntity: (entityId: string) => void;
  /** Remove muted status from an entity. */
  unmuteEntity: (entityId: string) => void;
  /** Check if an entity is muted. */
  isMuted: (entityId: string) => boolean;

  // ========================================
  // Phase 8: Graph Validation & Subgraph Mutations
  // ========================================

  /** Validate the graph structure. Returns a list of issues. */
  validate: (socketTypes?: Record<string, { compatibleWith?: string[] | '*' }>) => import('./graph').GraphValidationIssue[];
  /** Check if all required input ports are connected. */
  isGraphComplete: () => boolean;
  /** Get compatible ports for a source socket (for connection drag UI). */
  getCompatiblePorts: (
    sourceEntityId: string,
    sourceSocketId: string,
    isSourceInput: boolean,
    socketTypes: Record<string, { compatibleWith?: string[] | '*' }>,
    allowCycles?: boolean
  ) => Array<{ entityId: string; socketId: string; socketName: string; socketType: string }>;
  /** Collapse a set of entities into a compound group entity. */
  collapseToSubgraph: (entityIds: string[], groupId: string) => void;
  /** Expand a compound group entity back to its children. */
  expandSubgraph: (
    groupId: string,
    childEntities: Entity[],
    internalEdges: Edge[],
    portMapping: {
      inputs: Array<{ framePortId: string; originalEntityId: string; originalSocketId: string }>;
      outputs: Array<{ framePortId: string; originalEntityId: string; originalSocketId: string }>;
    }
  ) => void;
}

export type FlowStore = ReturnType<typeof createFlowStore>;

// Helper to calculate socket Y offset using theme-aware layout (matches visual rendering)
function getSocketYOffset(
  entity: Entity,
  socketIndex: number,
  isInput: boolean,
  socketLayout?: ResolvedSocketLayout | null
): number {
  if (socketLayout) {
    const entityLayout = getEntitySocketLayout(entity, socketLayout);
    const height = entity.height ?? entityLayout.computedHeight;
    const centerOffset = (height - entityLayout.computedHeight) / 2;
    const positions = isInput ? entityLayout.inputs : entityLayout.outputs;
    const cachedPos = positions[socketIndex];
    if (cachedPos) {
      return cachedPos.yOffset + centerOffset;
    }
  }
  // Legacy fallback (before socketLayout is synced from React context)
  const outputCount = entity.outputs?.length ?? 0;
  const rowIndex = isInput ? outputCount + socketIndex : socketIndex;
  return SOCKET_MARGIN_TOP + rowIndex * SOCKET_SPACING;
}

// Helper to build collapsedGroupIds set from entities
function buildCollapsedGroupIds(entities: Entity[]): Set<string> {
  const collapsed = new Set<string>();
  for (const entity of entities) {
    if (entity.type === 'frame' && entity.collapsed) {
      collapsed.add(entity.id);
    }
  }
  return collapsed;
}

// Helper to rebuild derived state from entities
// collapsedGroupIds is used to filter children of collapsed groups from quadtrees
// socketLayout is used for correct entity height in quadtree bounds
function rebuildDerivedState(entities: Entity[], collapsedGroupIds?: Set<string>, socketLayout?: ResolvedSocketLayout | null) {
  const entityMap = new Map<string, Entity>();
  const quadtree = new Quadtree({ x: -10000, y: -10000, width: 20000, height: 20000 });
  const socketQuadtree = new SocketQuadtree({ x: -10000, y: -10000, width: 20000, height: 20000 });

  // Build entityMap first (all entities, for O(1) lookup)
  for (const entity of entities) {
    entityMap.set(entity.id, entity);
  }

  // Build collapsed set if not provided (e.g., during initialization)
  const collapsed = collapsedGroupIds ?? buildCollapsedGroupIds(entities);

  // Pre-compute hidden entity IDs for O(1) lookup in hot paths
  // This is O(n*d) but only runs when entities/collapsed state changes, not every frame
  const hiddenEntityIds = new Set<string>();
  for (const entity of entities) {
    if (isEntityHidden(entity, entityMap, collapsed)) {
      hiddenEntityIds.add(entity.id);
    }
  }

  // Determine which entities are visible (not inside collapsed groups)
  const visibleEntities: Entity[] = [];
  for (const entity of entities) {
    if (!hiddenEntityIds.has(entity.id)) {
      visibleEntities.push(entity);
    }
  }

  // Only add visible entities to quadtrees
  for (const entity of visibleEntities) {
    // Insert sockets into socket quadtree (positioned outside entity body)
    const entityWidth = entity.width ?? 200;
    if (entity.inputs) {
      for (let i = 0; i < entity.inputs.length; i++) {
        const socket = entity.inputs[i];
        const yOffset = getSocketYOffset(entity, i, true, socketLayout);
        socketQuadtree.insert({
          entityId: entity.id,
          socketId: socket.id,
          isInput: true,
          x: entity.position.x - SOCKET_OFFSET,
          y: entity.position.y + yOffset,
        });
      }
    }
    if (entity.outputs) {
      for (let i = 0; i < entity.outputs.length; i++) {
        const socket = entity.outputs[i];
        const yOffset = getSocketYOffset(entity, i, false, socketLayout);
        socketQuadtree.insert({
          entityId: entity.id,
          socketId: socket.id,
          isInput: false,
          x: entity.position.x + entityWidth + SOCKET_OFFSET,
          y: entity.position.y + yOffset,
        });
      }
    }
  }

  quadtree.rebuild(visibleEntities, socketLayout ?? undefined);

  return { entityMap, quadtree, socketQuadtree, collapsedGroupIds: collapsed, hiddenEntityIds };
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
  // Initialize derived state from initial entities and edges
  const initialEntities = initialState?.entities ?? [];
  const initialEdges = initialState?.edges ?? [];
  const { entityMap, quadtree, socketQuadtree, collapsedGroupIds, hiddenEntityIds } = rebuildDerivedState(initialEntities);
  const connectedSockets = rebuildConnectedSockets(initialEdges);
  const initialAdjacencyIndex = graphEngine.buildAdjacencyIndex(initialEdges);

  // Lazy cached analysis — closure-scoped, not in Zustand state (avoids re-render on compute)
  let cachedAnalysis: CachedAnalysis | null = null;

  return create<FlowState>()(
    subscribeWithSelector((set, get) => ({
      // Initial state - use extracted values to ensure they're set correctly
      entities: initialEntities,
      edges: initialEdges,
      viewport: initialState?.viewport ?? DEFAULT_VIEWPORT,
      connectionStart: null,
      hoveredEntityId: null,
      hoveredSocketId: null,
      connectionDraft: null,
      selectionBox: null,

      // Selection state
      selectedEntityIds: new Set<string>(),
      selectedEdgeIds: new Set<string>(),

      // Derived state for O(1) lookups
      entityMap,
      quadtree,
      socketQuadtree,
      connectedSockets,

      // Position version for tracking position changes
      positionVersion: 0,

      // Internal clipboard
      internalClipboard: null,

      // Text editing state (Phase 10)
      editingEntityId: null,
      editingContent: null,
      editingCursor: null,

      // Grouping state (Phase 7C)
      collapsedGroupIds,
      hiddenEntityIds,

      // Graph engine state (Phase 8)
      adjacencyIndex: initialAdjacencyIndex,
      topologyVersion: 0,
      mutedEntityIds: new Set<string>(),

      // Socket layout (synced from React context for correct quadtree bounds)
      socketLayout: null,

      // Setters - rebuild derived state when entities change
      setEntities: (entities) => {
        const derived = rebuildDerivedState(entities, undefined, get().socketLayout);
        cachedAnalysis = null;
        // Bump both topologyVersion and positionVersion so ALL downstream
        // renderers (edges, sockets, widgets) detect the full replacement
        const state = get();
        set({ entities, ...derived, topologyVersion: state.topologyVersion + 1, positionVersion: state.positionVersion + 1 });
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
      setSocketLayout: (layout) => {
        const prev = get().socketLayout;
        // Skip if layout values haven't changed (avoids unnecessary quadtree rebuilds)
        if (prev && prev.rowHeight === layout.rowHeight && prev.marginTop === layout.marginTop &&
            prev.padding === layout.padding && prev.widgetHeight === layout.widgetHeight &&
            prev.socketSize === layout.socketSize) {
          return;
        }
        // Rebuild quadtree with correct entity heights
        const { entities, collapsedGroupIds } = get();
        const derived = rebuildDerivedState(entities, collapsedGroupIds, layout);
        set({ socketLayout: layout, ...derived });
      },
      setViewport: (viewport) => set({ viewport }),
      setHoveredEntityId: (hoveredEntityId) => set({ hoveredEntityId }),
      setHoveredSocketId: (hoveredSocketId) => set({ hoveredSocketId }),
      startConnection: (entityId, socketId) =>
        set({ connectionStart: { entityId, socketId } }),
      endConnection: () => set({ connectionStart: null }),
      setSelectionBox: (selectionBox) => set({ selectionBox }),
      setEditingEntityId: (editingEntityId) => set({ editingEntityId }),
      setEditingContent: (editingContent) => set({ editingContent }),
      setEditingCursor: (start, end) => set({ editingCursor: { start, end } }),
      startEditing: (entityId) => {
        const entity = get().entityMap.get(entityId);
        if (!entity || entity.type !== 'text') return;
        const data = entity.data as { content?: string };
        const content = data.content ?? '';
        set({
          editingEntityId: entityId,
          editingContent: content,
          editingCursor: { start: content.length, end: content.length },
        });
      },
      stopEditing: () => {
        set({
          editingEntityId: null,
          editingContent: null,
          editingCursor: null,
        });
      },

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
      applyEntityChanges: (changes) => {
        const { entities, collapsedGroupIds: currentCollapsed } = get();
        const nextEntities = [...entities];
        let collapsedChanged = false;
        let topologyChanged = false;
        const nextCollapsed = new Set(currentCollapsed);

        // Build id->index map once for O(1) lookups: O(n)
        const idToIndex = new Map<string, number>();
        for (let i = 0; i < nextEntities.length; i++) {
          idToIndex.set(nextEntities[i].id, i);
        }

        for (const change of changes) {
          switch (change.type) {
            case 'position': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextEntities[index] = { ...nextEntities[index], position: change.position };
              }
              break;
            }
            case 'select': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextEntities[index] = { ...nextEntities[index], selected: change.selected };
              }
              break;
            }
            case 'remove': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextEntities.splice(index, 1);
                topologyChanged = true;
                // Update indices for subsequent removals (shift down)
                idToIndex.delete(change.id);
                for (let i = index; i < nextEntities.length; i++) {
                  idToIndex.set(nextEntities[i].id, i);
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
              idToIndex.set(change.entity.id, nextEntities.length);
              nextEntities.push(change.entity);
              topologyChanged = true;
              // If adding a collapsed group, add to collapsed set
              if (change.entity.type === 'frame' && change.entity.collapsed) {
                nextCollapsed.add(change.entity.id);
                collapsedChanged = true;
              }
              break;
            }
            case 'dimensions': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextEntities[index] = {
                  ...nextEntities[index],
                  width: change.dimensions.width,
                  height: change.dimensions.height,
                };
              }
              break;
            }
            case 'collapse': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextEntities[index] = { ...nextEntities[index], collapsed: change.collapsed };
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
                nextEntities[index] = {
                  ...nextEntities[index],
                  parentId: change.parentId ?? undefined,
                };
              }
              break;
            }
            case 'data': {
              const index = idToIndex.get(change.id);
              if (index !== undefined) {
                nextEntities[index] = {
                  ...nextEntities[index],
                  data: { ...nextEntities[index].data, ...change.data },
                };
              }
              break;
            }
          }
        }

        // Rebuild derived state (entityMap, quadtree, socketQuadtree) to stay in sync
        const finalCollapsed = collapsedChanged ? nextCollapsed : currentCollapsed;
        const derived = rebuildDerivedState(nextEntities, finalCollapsed, get().socketLayout);
        if (topologyChanged) cachedAnalysis = null;
        set({
          entities: nextEntities,
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
      selectEntity: (id, additive = false) => {
        const { selectedEntityIds } = get();
        if (additive) {
          // Add to existing selection
          const newSet = new Set(selectedEntityIds);
          newSet.add(id);
          set({ selectedEntityIds: newSet });
        } else {
          // Replace selection (clear edges too for unified selection)
          set({
            selectedEntityIds: new Set([id]),
            selectedEdgeIds: new Set<string>(),
          });
        }
      },

      selectEntities: (ids) => {
        set({ selectedEntityIds: new Set(ids) });
      },

      selectEdge: (id, additive = false) => {
        const { selectedEdgeIds, selectedEntityIds } = get();
        if (additive) {
          // Add to existing selection
          const newSet = new Set(selectedEdgeIds);
          newSet.add(id);
          set({ selectedEdgeIds: newSet });
        } else {
          // Replace selection (clear entities too for unified selection)
          set({
            selectedEdgeIds: new Set([id]),
            selectedEntityIds: new Set<string>(),
          });
        }
      },

      selectEdges: (ids) => {
        set({ selectedEdgeIds: new Set(ids) });
      },

      selectAll: () => {
        const { entities } = get();
        set({ selectedEntityIds: new Set(entities.map((n) => n.id)) });
      },

      deselectAll: () => {
        set({
          selectedEntityIds: new Set<string>(),
          selectedEdgeIds: new Set<string>(),
        });
      },

      isEntitySelected: (id) => {
        return get().selectedEntityIds.has(id);
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
        const { entities: allEntities } = get();

        const {
          padding = 50,
          // includeHiddenEntities - reserved for future use when hidden entities are supported
          minZoom: optMinZoom = MIN_ZOOM,
          maxZoom: optMaxZoom = 1, // Default: don't zoom in past 100%
          entities: entityIds,
          // duration - reserved for future animation support
        } = options;

        // Determine which entities to fit
        let entitiesToFit: Entity[];
        if (entityIds && entityIds.length > 0) {
          // Fit specific entities by ID
          const entityIdSet = new Set(entityIds);
          entitiesToFit = allEntities.filter(n => entityIdSet.has(n.id));
        } else {
          // Fit all entities
          entitiesToFit = allEntities;
        }

        if (entitiesToFit.length === 0) return;

        // Use provided dimensions or fallback to window size
        const containerWidth = canvasWidth ?? window.innerWidth;
        const containerHeight = canvasHeight ?? window.innerHeight;

        // Calculate bounds
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;

        for (const entity of entitiesToFit) {
          minX = Math.min(minX, entity.position.x);
          minY = Math.min(minY, entity.position.y);
          maxX = Math.max(maxX, entity.position.x + (entity.width ?? 200));
          maxY = Math.max(maxY, entity.position.y + (entity.height ?? 100));
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
      // O(n+k) where n=entities, k=updates (builds index map once, then O(1) per update)
      updateEntityPositions: (updates) => {
        const { entities, entityMap, quadtree, socketQuadtree, positionVersion, socketLayout } = get();
        const nextEntities = [...entities];

        // Build id->index map once: O(n)
        const idToIndex = new Map<string, number>();
        for (let i = 0; i < entities.length; i++) {
          idToIndex.set(entities[i].id, i);
        }

        // Populate moved entity IDs side-channel for renderers
        _movedEntityIds.clear();
        for (const { id } of updates) {
          _movedEntityIds.add(id);
        }

        // Update each entity: O(k)
        for (const { id, position } of updates) {
          const index = idToIndex.get(id);
          if (index !== undefined) {
            const entity = { ...nextEntities[index], position };
            nextEntities[index] = entity;
            entityMap.set(id, entity);
            quadtree.update(id, getEntityBounds(entity, socketLayout ?? undefined));

            // Update socket positions in socketQuadtree
            const entityWidth = entity.width ?? 200;
            if (entity.inputs) {
              for (let i = 0; i < entity.inputs.length; i++) {
                const socket = entity.inputs[i];
                const yOffset = getSocketYOffset(entity, i, true, socketLayout);
                socketQuadtree.update(id, socket.id, true, position.x, position.y + yOffset);
              }
            }
            if (entity.outputs) {
              for (let i = 0; i < entity.outputs.length; i++) {
                const socket = entity.outputs[i];
                const yOffset = getSocketYOffset(entity, i, false, socketLayout);
                socketQuadtree.update(id, socket.id, false, position.x + entityWidth, position.y + yOffset);
              }
            }
          }
        }

        // Increment positionVersion so subscribers know positions changed
        set({ entities: nextEntities, positionVersion: positionVersion + 1 });
      },

      updateEntityDimensions: (id, width, height, position) => {
        const { entities, entityMap, quadtree, socketQuadtree, positionVersion, socketLayout } = get();

        // O(1) existence check via entityMap
        const existing = entityMap.get(id);
        if (!existing) return;

        // Find index via id comparison (avoids reference equality issues after spread)
        let index = -1;
        for (let i = 0; i < entities.length; i++) {
          if (entities[i].id === id) { index = i; break; }
        }
        if (index === -1) return;

        const nextEntities = [...entities];

        const entity = {
          ...existing,
          width,
          height,
          ...(position ? { position } : {}),
        };
        nextEntities[index] = entity;
        entityMap.set(id, entity);
        quadtree.update(id, getEntityBounds(entity, socketLayout ?? undefined));

        // Accumulate (don't clear) moved entity IDs so that multiple
        // updateEntityDimensions calls in the same frame (e.g. TextEntities
        // auto-sizing two text nodes) all appear in the fast-path set.
        // The set is cleared by updateEntityPositions on the next drag.
        _movedEntityIds.add(id);

        // Always update socket quadtree — width changes move output sockets,
        // position changes move all sockets
        const pos = entity.position;
        const entityWidth = entity.width ?? 200;
        if (entity.inputs) {
          for (let i = 0; i < entity.inputs.length; i++) {
            const socket = entity.inputs[i];
            const yOffset = getSocketYOffset(entity, i, true, socketLayout);
            socketQuadtree.update(id, socket.id, true, pos.x, pos.y + yOffset);
          }
        }
        if (entity.outputs) {
          for (let i = 0; i < entity.outputs.length; i++) {
            const socket = entity.outputs[i];
            const yOffset = getSocketYOffset(entity, i, false, socketLayout);
            socketQuadtree.update(id, socket.id, false, pos.x + entityWidth, pos.y + yOffset);
          }
        }

        // Bump positionVersion so sockets, edges, and widgets detect the change
        set({ entities: nextEntities, positionVersion: positionVersion + 1 });
      },

      fitEntityToContent: (id) => {
        const { entities, entityMap, quadtree, socketLayout } = get();
        const existing = entityMap.get(id);
        if (!existing) return;

        let index = -1;
        for (let i = 0; i < entities.length; i++) {
          if (entities[i].id === id) { index = i; break; }
        }
        if (index === -1) return;

        const nextEntities = [...entities];
        // Clear explicit dimensions to revert to computed minimum
        const { width: _w, height: _h, ...rest } = existing;
        const entity = rest as Entity;
        nextEntities[index] = entity;
        entityMap.set(id, entity);
        quadtree.update(id, getEntityBounds(entity, socketLayout ?? undefined));

        set({ entities: nextEntities });
      },

      // ========================================
      // Phase 6: Core Operations Implementation
      // ========================================

      cloneElements: <T extends EntityData = EntityData>(
        entitiesToClone: Entity<T>[],
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
        for (const entity of entitiesToClone) {
          idMap.set(entity.id, generateId());
        }

        // Clone entities with new IDs and offset positions
        const clonedEntities: Entity[] = entitiesToClone.map((entity) => {
          const newId = idMap.get(entity.id)!;
          const newData = transformData ? transformData(entity.data as T) : { ...entity.data };
          return {
            ...entity,
            id: newId,
            position: {
              x: entity.position.x + offset.x,
              y: entity.position.y + offset.y,
            },
            data: newData,
            selected: false,
          };
        });

        // Build set of cloned entity IDs for fast lookup
        const clonedEntityIdSet = new Set(entitiesToClone.map((n) => n.id));

        // Clone edges, remapping source/target
        const clonedEdges: Edge[] = [];
        for (const edge of edgesToClone) {
          const sourceInCloned = clonedEntityIdSet.has(edge.source);
          const targetInCloned = clonedEntityIdSet.has(edge.target);

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

        return { entities: clonedEntities, edges: clonedEdges, idMap };
      },

      addElements: (batch) => {
        const { entities: currentEntities, edges: currentEdges, entityMap, quadtree, socketQuadtree, socketLayout } = get();
        const { entities: newEntities = [], edges: newEdges = [] } = batch;

        if (newEntities.length === 0 && newEdges.length === 0) return;

        // Single state update with all new elements
        const nextEntities = [...currentEntities, ...newEntities];
        const nextEdges = [...currentEdges, ...newEdges];

        // Incremental update: add new entities to existing data structures
        // O(k log n) instead of O(n log n) full rebuild
        for (const entity of newEntities) {
          entityMap.set(entity.id, entity);
        }
        quadtree.incrementalAdd(newEntities, socketLayout ?? undefined);

        // Add new sockets to socket quadtree (positioned outside entity body)
        for (const entity of newEntities) {
          const entityWidth = entity.width ?? 200;
          if (entity.inputs) {
            for (let i = 0; i < entity.inputs.length; i++) {
              const socket = entity.inputs[i];
              const yOffset = getSocketYOffset(entity, i, true, socketLayout);
              socketQuadtree.insert({
                entityId: entity.id,
                socketId: socket.id,
                isInput: true,
                x: entity.position.x - SOCKET_OFFSET,
                y: entity.position.y + yOffset,
              });
            }
          }
          if (entity.outputs) {
            for (let i = 0; i < entity.outputs.length; i++) {
              const socket = entity.outputs[i];
              const yOffset = getSocketYOffset(entity, i, false, socketLayout);
              socketQuadtree.insert({
                entityId: entity.id,
                socketId: socket.id,
                isInput: false,
                x: entity.position.x + entityWidth + SOCKET_OFFSET,
                y: entity.position.y + yOffset,
              });
            }
          }
        }

        cachedAnalysis = null;
        set({
          entities: nextEntities,
          edges: nextEdges,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: get().topologyVersion + 1,
        });
      },

      deleteElements: (batch) => {
        const { entities, edges, selectedEntityIds, selectedEdgeIds, entityMap, quadtree, socketQuadtree } = get();
        const { entityIds = [], edgeIds = [] } = batch;

        if (entityIds.length === 0 && edgeIds.length === 0) return;

        // Build sets for O(1) lookup
        const entityIdsToDelete = new Set(entityIds);
        const edgeIdsToDelete = new Set(edgeIds);

        // Also delete edges connected to deleted entities
        for (const edge of edges) {
          if (entityIdsToDelete.has(edge.source) || entityIdsToDelete.has(edge.target)) {
            edgeIdsToDelete.add(edge.id);
          }
        }

        // Incremental removal from spatial structures O(k log n)
        // Remove sockets first, then entities
        for (const entityId of entityIdsToDelete) {
          const entity = entityMap.get(entityId);
          if (entity) {
            if (entity.inputs) {
              for (const socket of entity.inputs) {
                socketQuadtree.remove(entityId, socket.id, true);
              }
            }
            if (entity.outputs) {
              for (const socket of entity.outputs) {
                socketQuadtree.remove(entityId, socket.id, false);
              }
            }
          }
          entityMap.delete(entityId);
        }
        quadtree.incrementalRemove(Array.from(entityIdsToDelete));

        // Filter out deleted elements
        const nextEntities = entities.filter((n) => !entityIdsToDelete.has(n.id));
        const nextEdges = edges.filter((e) => !edgeIdsToDelete.has(e.id));

        // Update selection - remove deleted items
        const nextSelectedEntityIds = new Set(selectedEntityIds);
        const nextSelectedEdgeIds = new Set(selectedEdgeIds);
        for (const id of entityIdsToDelete) {
          nextSelectedEntityIds.delete(id);
        }
        for (const id of edgeIdsToDelete) {
          nextSelectedEdgeIds.delete(id);
        }

        cachedAnalysis = null;
        set({
          entities: nextEntities,
          edges: nextEdges,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: get().topologyVersion + 1,
          selectedEntityIds: nextSelectedEntityIds,
          selectedEdgeIds: nextSelectedEdgeIds,
        });
      },

      deleteSelected: () => {
        const { selectedEntityIds, selectedEdgeIds, deleteElements } = get();
        deleteElements({
          entityIds: Array.from(selectedEntityIds),
          edgeIds: Array.from(selectedEdgeIds),
        });
      },

      copySelectedToInternal: () => {
        const { getSelectedEntities, getConnectedEdges, selectedEntityIds } = get();
        const selectedEntities = getSelectedEntities();

        if (selectedEntities.length === 0) return;

        // Get ALL edges connected to selected entities (both internal and external)
        // Filtering to internal-only or preserving external happens at paste time
        const entityIds = Array.from(selectedEntityIds);
        const connectedEdges = getConnectedEdges(entityIds);

        set({
          internalClipboard: {
            entities: selectedEntities,
            edges: connectedEdges,
          },
        });
      },

      pasteFromInternal: <T extends EntityData = EntityData>(
        options?: PasteFromInternalOptions<T>
      ): CloneElementsResult | null => {
        const { internalClipboard, cloneElements, addElements, selectEntities, selectEdges } = get();

        if (!internalClipboard || internalClipboard.entities.length === 0) {
          return null;
        }

        const { preserveExternalConnections = false } = options ?? {};
        const clipboardEntityIds = new Set(internalClipboard.entities.map((n) => n.id));

        // Filter edges based on preserveExternalConnections option
        // - false (default): only edges where BOTH endpoints are in clipboard (internal edges)
        // - true: all edges where AT LEAST ONE endpoint is in clipboard (reconnect to existing entities)
        const edgesToClone = preserveExternalConnections
          ? internalClipboard.edges
          : internalClipboard.edges.filter(
              (e) => clipboardEntityIds.has(e.source) && clipboardEntityIds.has(e.target)
            );

        // Clone with default offset
        const result = cloneElements(
          internalClipboard.entities as Entity<T>[],
          edgesToClone,
          {
            offset: options?.offset ?? { x: 50, y: 50 },
            transformData: options?.transformData,
            // For external connections, we need to preserve the original external entity references
            preserveExternalConnections,
          }
        );

        // Add to graph
        addElements({ entities: result.entities, edges: result.edges });

        // Select pasted elements
        selectEntities(result.entities.map((n) => n.id));
        selectEdges(result.edges.map((e) => e.id));

        return result;
      },

      cutSelectedToInternal: () => {
        const { copySelectedToInternal, deleteSelected } = get();
        copySelectedToInternal();
        deleteSelected();
      },

      toObject: (): FlowObject => {
        const { entities, edges, viewport } = get();
        return { entities, edges, viewport };
      },

      getSelectedEntities: (): Entity[] => {
        const { entities, selectedEntityIds } = get();
        if (selectedEntityIds.size === 0) return [];
        return entities.filter((n) => selectedEntityIds.has(n.id));
      },

      getConnectedEdges: (entityIds: string[]): Edge[] => {
        if (entityIds.length === 0) return [];
        const { adjacencyIndex } = get();
        const seen = new Set<string>();
        const result: Edge[] = [];
        for (const entityId of entityIds) {
          const edges = adjacencyIndex.byEntity.get(entityId);
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

      getGroupChildren: (groupId: string): Entity[] => {
        const { entities } = get();
        return utilGetGroupChildren(entities, groupId);
      },

      getGroupDescendants: (groupId: string): Entity[] => {
        const { entities } = get();
        return utilGetGroupDescendants(entities, groupId);
      },

      toggleGroupCollapse: (groupId: string): void => {
        const { entityMap, collapsedGroupIds, applyEntityChanges } = get();
        const group = entityMap.get(groupId);
        if (!group || group.type !== 'frame') return;

        const newCollapsed = !collapsedGroupIds.has(groupId);
        applyEntityChanges([{ type: 'collapse', id: groupId, collapsed: newCollapsed }]);
      },

      expandGroup: (groupId: string): void => {
        const { collapsedGroupIds, applyEntityChanges } = get();
        if (collapsedGroupIds.has(groupId)) {
          applyEntityChanges([{ type: 'collapse', id: groupId, collapsed: false }]);
        }
      },

      collapseGroup: (groupId: string): void => {
        const { collapsedGroupIds, applyEntityChanges } = get();
        if (!collapsedGroupIds.has(groupId)) {
          applyEntityChanges([{ type: 'collapse', id: groupId, collapsed: true }]);
        }
      },

      isGroupCollapsed: (groupId: string): boolean => {
        const { collapsedGroupIds } = get();
        return collapsedGroupIds.has(groupId);
      },

      getGroupBounds: (groupId: string): Bounds | null => {
        const { entities } = get();
        return utilCalculateGroupBounds(entities, groupId);
      },

      setEntityParent: (entityId: string, parentId: string | null): boolean => {
        const { entityMap, applyEntityChanges } = get();
        const entity = entityMap.get(entityId);
        if (!entity) return false;

        // Validate: can't parent to self
        if (parentId === entityId) return false;

        // Validate: can't create cycle (if proposedParent is a descendant of entity)
        if (parentId) {
          const parent = entityMap.get(parentId);
          if (!parent) return false;

          // Check if parentId is a descendant of entityId
          let current: string | undefined = parent.parentId;
          while (current) {
            if (current === entityId) return false; // Would create cycle
            const currentEntity = entityMap.get(current);
            current = currentEntity?.parentId;
          }
        }

        applyEntityChanges([{ type: 'parent', id: entityId, parentId }]);
        return true;
      },

      moveGroup: (groupId: string, delta: XYPosition): void => {
        const { entities, entityMap, updateEntityPositions } = get();
        const group = entityMap.get(groupId);
        if (!group) return;

        // Get positions for group and all descendants
        const descendantPositions = calculateDescendantPositions(entities, groupId, delta);

        // Build updates array
        const updates: Array<{ id: string; position: XYPosition }> = [
          { id: groupId, position: { x: group.position.x + delta.x, y: group.position.y + delta.y } },
        ];

        for (const [id, position] of descendantPositions) {
          updates.push({ id, position });
        }

        updateEntityPositions(updates);
      },

      // ========================================
      // Phase 8: Graph Engine Implementation
      // ========================================

      getIncomers: (entityId: string): string[] => {
        return graphEngine.getIncomers(get().adjacencyIndex, entityId);
      },

      getOutgoers: (entityId: string): string[] => {
        return graphEngine.getOutgoers(get().adjacencyIndex, entityId);
      },

      getEntityEdges: (entityId: string): Edge[] => {
        return graphEngine.getEntityEdges(get().adjacencyIndex, entityId);
      },

      getInputEdges: (entityId: string): Edge[] => {
        return graphEngine.getInputEdges(get().adjacencyIndex, entityId);
      },

      getOutputEdges: (entityId: string): Edge[] => {
        return graphEngine.getOutputEdges(get().adjacencyIndex, entityId);
      },

      getEdgesBetween: (entityA: string, entityB: string): Edge[] => {
        return graphEngine.getEdgesBetween(get().adjacencyIndex, entityA, entityB);
      },

      walkUpstream: (startEntityId: string): Generator<string> => {
        return graphEngine.walkUpstream(get().adjacencyIndex, startEntityId);
      },

      walkDownstream: (startEntityId: string): Generator<string> => {
        return graphEngine.walkDownstream(get().adjacencyIndex, startEntityId);
      },

      getAnalysis: (): CachedAnalysis => {
        const { entities, adjacencyIndex, topologyVersion, mutedEntityIds } = get();
        if (cachedAnalysis && cachedAnalysis.topologyVersion === topologyVersion) {
          return cachedAnalysis;
        }
        const entityIds = entities.map((n) => n.id);
        const result = graphEngine.computeAnalysis(entityIds, adjacencyIndex, mutedEntityIds);
        cachedAnalysis = { ...result, topologyVersion };
        return cachedAnalysis;
      },

      wouldCreateCycle: (sourceEntityId: string, targetEntityId: string): boolean => {
        return graphEngine.wouldCreateCycle(get().adjacencyIndex, sourceEntityId, targetEntityId);
      },

      getAffectedEntities: (changedEntityIds: string | string[]): string[] => {
        const { adjacencyIndex, mutedEntityIds } = get();
        const analysis = get().getAnalysis();
        return graphEngine.getAffectedEntities(
          changedEntityIds,
          adjacencyIndex,
          analysis.topologicalOrder,
          mutedEntityIds
        );
      },

      getConnectedComponents: (): Map<string, string[]> => {
        const { entities, adjacencyIndex } = get();
        return graphEngine.getConnectedComponents(
          entities.map((n) => n.id),
          adjacencyIndex
        );
      },

      areConnected: (entityA: string, entityB: string): boolean => {
        return graphEngine.areConnected(get().adjacencyIndex, entityA, entityB);
      },

      getExecutionOrder: (targetEntityId: string): string[] => {
        return graphEngine.getExecutionOrder(get().adjacencyIndex, targetEntityId);
      },

      getReadyEntities: (entityIds: string[], completed: ReadonlySet<string>): string[] => {
        return graphEngine.getReadyEntities(entityIds, get().adjacencyIndex, completed);
      },

      insertOnEdge: (edgeId: string, newEntity: Entity): void => {
        const state = get();
        const edge = state.edges.find((e) => e.id === edgeId);
        if (!edge) return;

        const changes = graphEngine.computeInsertOnEdge(
          edge,
          newEntity,
          state.entityMap.get(edge.source),
          state.entityMap.get(edge.target)
        );

        const positionedEntity = { ...newEntity, position: changes.entityPosition };
        const nextEntities = [...state.entities, positionedEntity];
        const nextEdges = state.edges
          .filter((e) => e.id !== changes.removeEdgeId)
          .concat(changes.newEdges);

        const derived = rebuildDerivedState(nextEntities, state.collapsedGroupIds, state.socketLayout);
        cachedAnalysis = null;
        set({
          entities: nextEntities,
          edges: nextEdges,
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: state.topologyVersion + 1,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          ...derived,
        });
      },

      bypassEntity: (entityId: string): void => {
        const state = get();
        const changes = graphEngine.computeBypass(entityId, state.adjacencyIndex);

        const removeEdgeIdSet = new Set(changes.removeEdgeIds);
        const nextEdges = state.edges
          .filter((e) => !removeEdgeIdSet.has(e.id))
          .concat(changes.newEdges);
        const nextEntities = state.entities.filter((n) => n.id !== changes.removeEntityId);

        const derived = rebuildDerivedState(nextEntities, state.collapsedGroupIds, state.socketLayout);
        cachedAnalysis = null;

        // Update selection
        const nextSelectedEntityIds = new Set(state.selectedEntityIds);
        nextSelectedEntityIds.delete(entityId);
        const nextSelectedEdgeIds = new Set(state.selectedEdgeIds);
        for (const id of removeEdgeIdSet) nextSelectedEdgeIds.delete(id);

        set({
          entities: nextEntities,
          edges: nextEdges,
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: state.topologyVersion + 1,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          selectedEntityIds: nextSelectedEntityIds,
          selectedEdgeIds: nextSelectedEdgeIds,
          ...derived,
        });
      },

      muteEntity: (entityId: string): void => {
        const { mutedEntityIds, topologyVersion } = get();
        if (mutedEntityIds.has(entityId)) return;
        const next = new Set(mutedEntityIds);
        next.add(entityId);
        cachedAnalysis = null;
        set({ mutedEntityIds: next, topologyVersion: topologyVersion + 1 });
      },

      unmuteEntity: (entityId: string): void => {
        const { mutedEntityIds, topologyVersion } = get();
        if (!mutedEntityIds.has(entityId)) return;
        const next = new Set(mutedEntityIds);
        next.delete(entityId);
        cachedAnalysis = null;
        set({ mutedEntityIds: next, topologyVersion: topologyVersion + 1 });
      },

      isMuted: (entityId: string): boolean => {
        return get().mutedEntityIds.has(entityId);
      },

      // ========================================
      // Phase 8: Graph Validation & Subgraph Mutations
      // ========================================

      validate: (socketTypes) => {
        const { entities, edges, adjacencyIndex } = get();
        return graphEngine.validate(entities, edges, adjacencyIndex, socketTypes);
      },

      isGraphComplete: () => {
        const { entities, adjacencyIndex } = get();
        return graphEngine.isGraphComplete(entities, adjacencyIndex);
      },

      getCompatiblePorts: (sourceEntityId, sourceSocketId, isSourceInput, socketTypes, allowCycles) => {
        const { entities, adjacencyIndex } = get();
        return graphEngine.getCompatiblePorts(
          sourceEntityId,
          sourceSocketId,
          isSourceInput,
          entities,
          socketTypes,
          adjacencyIndex,
          allowCycles
        );
      },

      collapseToSubgraph: (entityIds: string[], groupId: string): void => {
        const state = get();
        const result = graphEngine.computeCollapseToSubgraph(
          entityIds,
          groupId,
          state.entities,
          state.adjacencyIndex
        );

        // Create the frame entity
        const frameEntity: Entity = {
          id: result.frameEntity.id,
          type: 'frame',
          position: result.frameEntity.position,
          width: result.frameEntity.width,
          height: result.frameEntity.height,
          data: { label: 'Group' },
          inputs: result.frameInputs.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type,
          })),
          outputs: result.frameOutputs.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type,
          })),
        };

        // Set children's parentId to the group
        const childIdSet = new Set(entityIds);
        const removeEdgeIdSet = new Set(result.removeEdgeIds);
        const nextEntities = state.entities
          .map((n) => (childIdSet.has(n.id) ? { ...n, parentId: groupId } : n))
          .concat(frameEntity);
        const nextEdges = state.edges
          .filter((e) => !removeEdgeIdSet.has(e.id))
          .concat(result.newEdges);

        const derived = rebuildDerivedState(nextEntities, state.collapsedGroupIds, state.socketLayout);
        cachedAnalysis = null;
        set({
          entities: nextEntities,
          edges: nextEdges,
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: state.topologyVersion + 1,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          ...derived,
        });
      },

      expandSubgraph: (groupId, childEntities, internalEdges, portMapping): void => {
        const state = get();
        const result = graphEngine.computeExpandSubgraph(
          groupId,
          childEntities,
          internalEdges,
          state.entities,
          state.adjacencyIndex,
          portMapping
        );

        const removeEdgeIdSet = new Set(result.removeEdgeIds);
        // Remove group entity, restore children (clear parentId), add reconnect edges
        const nextEntities = state.entities
          .filter((n) => n.id !== result.removeEntityId)
          .map((n) => (n.parentId === groupId ? { ...n, parentId: undefined } : n))
          .concat(result.restoreEntities.map((n) => ({ ...n, parentId: undefined })));
        const nextEdges = state.edges
          .filter((e) => !removeEdgeIdSet.has(e.id))
          .concat(result.restoreEdges)
          .concat(result.reconnectEdges);

        const derived = rebuildDerivedState(nextEntities, state.collapsedGroupIds, state.socketLayout);
        cachedAnalysis = null;

        // Update selection
        const nextSelectedEntityIds = new Set(state.selectedEntityIds);
        nextSelectedEntityIds.delete(groupId);
        const nextSelectedEdgeIds = new Set(state.selectedEdgeIds);
        for (const id of removeEdgeIdSet) nextSelectedEdgeIds.delete(id);

        set({
          entities: nextEntities,
          edges: nextEdges,
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: state.topologyVersion + 1,
          connectedSockets: rebuildConnectedSockets(nextEdges),
          selectedEntityIds: nextSelectedEntityIds,
          selectedEdgeIds: nextSelectedEdgeIds,
          ...derived,
        });
      },
    }))
  );
};
