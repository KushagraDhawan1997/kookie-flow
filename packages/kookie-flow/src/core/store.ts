import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  Entity,
  Edge,
  Viewport,
  EntityChange,
  EdgeChange,
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
  TextEntityData,
  FitViewOptions,
} from '../types';
import { resizableForSizingMode } from '../utils/text-texture';
import { DEFAULT_VIEWPORT, MIN_ZOOM, MAX_ZOOM } from './constants';
import { getSocketWorldX, getSocketYOffset } from '../utils/geometry';
import { Quadtree, SocketQuadtree, getEntityBounds } from './spatial';
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
import { widgetKey, type WidgetOverride } from '../utils/widget-values';
import { getParentChain, sortByDepth, getGroupDescendants } from '../utils/grouping';
import { STACK_COMPACT_AT } from '../utils/entity-depth';

// Pre-allocated ID pool for efficient cloning
let idCounter = 0;
const defaultGenerateId = () => `kf-${Date.now()}-${++idCounter}`;


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

  /**
   * What each widget's person has set that the consumer has not echoed back yet, keyed by
   * `widgetKey(entityId, socketId)`. See utils/widget-values.ts for the rule it serves.
   *
   * MUTATED IN PLACE, never replaced: it is written on every pointermove of a slider drag and a
   * fresh Map per move is exactly the allocation that rule forbids. Subscribers watch
   * `widgetValuesVersion` instead, which is the dirty flag beside it.
   */
  widgetValues: Map<string, WidgetOverride>;
  widgetValuesVersion: number;

  /**
   * Stacking order: entity id -> a monotonically increasing index; higher is nearer the camera.
   * See utils/entity-depth.ts for how the renderers turn it into depth. Mutated in place, with
   * `stackVersion` as the dirty flag beside it — the same shape as `widgetValues`.
   */
  stackOrder: Map<string, number>;
  stackVersion: number;

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
  /** Entity ids moved by the last updateEntityPositions call. Per store, not global. */
  getMovedEntityIds: () => ReadonlySet<string>;
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

  /** Record what a person set on a widget, until the consumer echoes it into the entity. */
  setWidgetValue: (entityId: string, socketId: string, value: unknown) => void;

  /**
   * Last interacted on top. Brings the entity to the front of the stacking order, with its
   * ancestors beneath it and — for a frame — its descendants above it, so a group never sits
   * over its own children.
   */
  bringToFront: (entityId: string) => void;

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
    if (entity.inputs) {
      for (let i = 0; i < entity.inputs.length; i++) {
        const socket = entity.inputs[i];
        const yOffset = getSocketYOffset(entity, i, true, socketLayout);
        socketQuadtree.insert({
          entityId: entity.id,
          socketId: socket.id,
          isInput: true,
          x: getSocketWorldX(entity, true),
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
          x: getSocketWorldX(entity, false),
          y: entity.position.y + yOffset,
        });
      }
    }
  }

  quadtree.rebuild(visibleEntities, socketLayout ?? undefined);

  return { entityMap, quadtree, socketQuadtree, collapsedGroupIds: collapsed, hiddenEntityIds };
}

/**
 * Which sockets have an edge on them, keyed `entityId:socketId:input|output`.
 *
 * THE DIRECTION SUFFIX IS THE WHOLE POINT, and its absence was a silent three-way defect. This
 * used to write `entityId:socketId` while four of its five readers asked for the three-part key —
 * `sockets.tsx` for both directions, `widget-hit.ts` and `widgets-gl.tsx` for inputs — so those
 * four lookups could never match anything and every one of them silently answered "not
 * connected", forever. A connected input kept its widget painted AND kept taking presses, so a
 * value arriving down an edge could be typed over by a control that should not have been there;
 * and no socket dot on any node ever rendered in its connected state.
 *
 * Socket ids are scoped per direction — an entity may legally have an input and an output that
 * share one id — so the two-part key was also ambiguous in principle, not only mismatched in
 * practice. Both ends of every edge are recorded: an output with an edge leaving it is as
 * connected as the input it arrives at, which is what `sockets.tsx` was already asking about.
 */
function rebuildConnectedSockets(edges: Edge[], widgetValues?: Map<string, WidgetOverride>): Set<string> {
  const connected = new Set<string>();
  for (const edge of edges) {
    if (edge.targetSocket) {
      connected.add(`${edge.target}:${edge.targetSocket}:input`);
    }
    if (edge.sourceSocket) {
      connected.add(`${edge.source}:${edge.sourceSocket}:output`);
    }
  }

  // A widget stops being drawn the moment its socket is connected, and the local override for it
  // retires only where it IS drawn (utils/widget-values.ts, read from widgets-gl.tsx). So an
  // override set just before an edge landed on that socket survived — hidden, and with no path
  // left to retire it — and then resurfaced as a stale value the moment the edge was removed,
  // beating every external write to that socket until one happened to equal it. This is the one
  // place that knows a socket's fate has changed, so this is where the override goes.
  //
  // No key parsing: `widgetKey` is `entityId:socketId` and the connected key is that plus
  // `:input`.
  if (widgetValues) {
    for (const key of widgetValues.keys()) {
      if (connected.has(`${key}:input`)) widgetValues.delete(key);
    }
  }
  return connected;
}

/**
 * Drop what an entity's widgets had pending, because the entity is gone.
 *
 * `widgetValues` had two writers and one eraser, and the eraser only ran when a value round-tripped
 * through a painted widget. Nothing at all cleared a key when its entity was deleted, so the map
 * grew for the life of the session — and worse, an id that came back (an undo restores ids
 * verbatim) inherited the override the previous life of that id had left behind: the restored
 * entity's own value was shown over by a number the person had set before deleting it, and the
 * restore looked like it had failed.
 *
 * Both directions are swept. `setWidgetValue` is public and takes any socket id, so an output key
 * is reachable even though only inputs currently draw widgets. Returns whether anything went, so
 * the caller can bump `widgetValuesVersion` only when there is something to notice.
 */
function dropWidgetValues(widgetValues: Map<string, WidgetOverride>, entity: Entity): boolean {
  if (widgetValues.size === 0) return false;
  let dropped = false;
  for (const sockets of [entity.inputs, entity.outputs]) {
    if (!sockets) continue;
    for (const socket of sockets) {
      if (widgetValues.delete(widgetKey(entity.id, socket.id))) dropped = true;
    }
  }
  return dropped;
}

/**
 * The same sweep for a wholesale replacement of the entity array, where there is no list of what
 * was removed: keep only the keys the new entities can still account for. This is the widget-value
 * twin of `reconcileStackOrder`, and it exists for the same reason — `setEntities` is the one
 * reconciler, so a key it does not clean up here is a key nothing will ever clean up.
 */
function reconcileWidgetValues(widgetValues: Map<string, WidgetOverride>, entities: Entity[]): boolean {
  if (widgetValues.size === 0) return false;
  const live = new Set<string>();
  for (const entity of entities) {
    for (const sockets of [entity.inputs, entity.outputs]) {
      if (!sockets) continue;
      for (const socket of sockets) live.add(widgetKey(entity.id, socket.id));
    }
  }
  let dropped = false;
  for (const key of widgetValues.keys()) {
    if (!live.has(key)) {
      widgetValues.delete(key);
      dropped = true;
    }
  }
  return dropped;
}

/** Narrow an entity's open-ended `data.values` bag without asserting it into shape. */
function isValueBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const createFlowStore = (initialState?: Partial<FlowState>) => {
  // Initialize derived state from initial entities and edges
  const initialEntities = initialState?.entities ?? [];
  const initialEdges = initialState?.edges ?? [];
  /**
   * The resolved socket layout, when the caller already knows it — and <KookieFlow> does, because
   * StyleProvider resolves it above the FlowProvider that builds this store.
   *
   * Without it this build ran on default row heights and was then thrown away whole. The mount
   * effect in kookie-flow.tsx calls `setSocketLayout`, which found `socketLayout === null`, could
   * not take its value-equality skip, and rebuilt both quadtrees a second time — every socket
   * offset and every entity bound computed twice on mount, the first time from numbers that were
   * wrong, and one extra notification to every subscriber watching the derived state. Seeding it
   * makes the first build the correct one and lets the effect skip.
   *
   * It stays optional, and the layout-less build below stays the fallback rather than becoming a
   * deferred build. FlowProvider is a public export that can be mounted with no style context at
   * all, and geometry.ts documents the no-layout branch as the path the frames before the sync
   * take; hit testing depends on both quadtrees being usable the moment the store exists, so
   * "leave them empty until someone supplies a layout" would leave a standalone FlowProvider with
   * every click and hover dead.
   */
  const initialSocketLayout = initialState?.socketLayout ?? null;
  const { entityMap, quadtree, socketQuadtree, collapsedGroupIds, hiddenEntityIds } =
    rebuildDerivedState(initialEntities, undefined, initialSocketLayout);
  const connectedSockets = rebuildConnectedSockets(initialEdges);

  /**
   * The stacking counter. PER STORE, not module-level: a shared counter is the reentrancy
   * defect the drag index had (see store.test.ts), and two graphs on one page would otherwise
   * hand each other's presses ever-larger indices.
   */
  let stackCounter = 0;
  /** Give every entity that has no index the next one, in array order — the order they painted in. */
  const assignStackOrder = (order: Map<string, number>, entities: Entity[]) => {
    for (const e of entities) if (!order.has(e.id)) order.set(e.id, ++stackCounter);
  };
  /** Drop ids that are gone, then assign the rest. Used when the whole array is replaced. */
  const reconcileStackOrder = (order: Map<string, number>, entities: Entity[]) => {
    const keep = new Set(entities.map((e) => e.id));
    for (const id of order.keys()) if (!keep.has(id)) order.delete(id);
    assignStackOrder(order, entities);
  };
  const initialStackOrder = new Map<string, number>();
  assignStackOrder(initialStackOrder, initialEntities);
  const initialAdjacencyIndex = graphEngine.buildAdjacencyIndex(initialEdges);
  /**
   * Side-channel for communicating moved entity IDs to renderers. Kept out of Zustand state so a
   * drag frame allocates no Set.
   *
   * PER STORE, not module-level. These were module singletons, which made the library
   * non-reentrant: `createFlowStore` cleared the shared id map on construction, so mounting a
   * second <KookieFlow> stopped dragging from working in the first — measured, the first store's
   * entity did not move at all.
   */
  const movedEntityIds = new Set<string>();

  /**
   * Persistent id-to-index map — avoids an O(n) rebuild on every drag frame.
   *
   * It must be rebuilt wherever the entities array changes length or order. When it goes stale and
   * the stale index is past the end of the array, the drag path spreads `undefined` and appends an
   * entity with `id === undefined` to state.entities. It self-heals on the next add/remove, which
   * is exactly the profile of a bug that survives manual testing.
   */
  const idToIndex = new Map<string, number>();
  const rebuildIdToIndex = (entities: Entity[]): void => {
    idToIndex.clear();
    for (let i = 0; i < entities.length; i++) {
      idToIndex.set(entities[i].id, i);
    }
  };
  rebuildIdToIndex(initialEntities);

  /**
   * Resolve an id to its array slot, verifying the cached index still points AT that entity.
   *
   * `index !== undefined` is not a sufficient guard. A stale index that is still in bounds writes
   * to the WRONG entity, and one past the end makes `{...nextEntities[index]}` spread `undefined`
   * — which appends an entity with `id === undefined` to state.entities. Checking identity catches
   * both, and falling back to a scan means a stale cache costs one O(n) walk instead of corrupting
   * the document. With the rebuilds above in place this fallback should never run.
   */
  const resolveIndex = (entities: Entity[], id: string): number => {
    const cached = idToIndex.get(id);
    if (cached !== undefined && entities[cached]?.id === id) return cached;
    const found = entities.findIndex((e) => e.id === id);
    if (found >= 0) idToIndex.set(id, found);
    return found;
  };

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
      widgetValues: new Map<string, WidgetOverride>(),
      widgetValuesVersion: 0,
      stackOrder: initialStackOrder,
      stackVersion: 0,

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
      socketLayout: initialSocketLayout,

      // Setters - rebuild derived state when entities change
      getMovedEntityIds: () => movedEntityIds,

      setEntities: (entities) => {
        const derived = rebuildDerivedState(entities, undefined, get().socketLayout);
        cachedAnalysis = null;
        rebuildIdToIndex(entities);
        // Bump both topologyVersion and positionVersion so ALL downstream
        // renderers (edges, sockets, widgets) detect the full replacement
        const state = get();
        reconcileStackOrder(state.stackOrder, entities);
        // The widget overrides need the same reconciliation, and for a sharper reason than tidiness:
        // a key left behind for an id that is no longer here comes back to life if that id does,
        // and shows a value the restored entity never held.
        const widgetValuesDropped = reconcileWidgetValues(state.widgetValues, entities);
        set({
          entities,
          ...derived,
          topologyVersion: state.topologyVersion + 1,
          positionVersion: state.positionVersion + 1,
          stackVersion: state.stackVersion + 1,
          ...(widgetValuesDropped
            ? { widgetValuesVersion: state.widgetValuesVersion + 1 }
            : {}),
        });
      },
      setEdges: (edges) => {
        cachedAnalysis = null;
        set({
          edges,
          connectedSockets: rebuildConnectedSockets(edges, get().widgetValues),
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
      /**
       * Deduped by VALUE. The hit test runs on every pointermove and mints a fresh handle object
       * each time, so an unguarded `set` notifies every subscriber sixty times a second with a
       * deep-equal value — and the sockets renderer answers each one by rebuilding every socket in
       * the graph.
       *
       * The guard lives here rather than at the call site because there is one of these and two of
       * those, and because the caller's own version of it was missing `isInput` — socket ids are
       * scoped per direction (the connected-set keys are `entity:socket:input|output`), so an
       * entity with an input and an output sharing an id could move the hover between them and
       * have it swallowed.
       *
       * This is an API-visible change: `FlowStore` is exported and a consumer can subscribe. What
       * they stop receiving is a notification carrying a value equal to the one they already have.
       */
      setHoveredSocketId: (hoveredSocketId) => {
        const prev = get().hoveredSocketId;
        if (
          prev?.entityId === hoveredSocketId?.entityId &&
          prev?.socketId === hoveredSocketId?.socketId &&
          prev?.isInput === hoveredSocketId?.isInput
        ) {
          return;
        }
        set({ hoveredSocketId });
      },
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

      setWidgetValue: (entityId, socketId, value) => {
        const { widgetValues, widgetValuesVersion, entityMap } = get();
        // The BASELINE — what the entity says right now — is recorded alongside the value,
        // because that is what tells us later whether the consumer has answered. See
        // utils/widget-values.ts: comparing the echo against the value the person SET means a
        // consumer that clamps or rounds never closes the round trip, and the widget shows the
        // rejected value forever.
        const values = entityMap.get(entityId)?.data.values;
        const baseline = isValueBag(values) ? values[socketId] : undefined;
        widgetValues.set(widgetKey(entityId, socketId), { value, baseline });
        set({ widgetValuesVersion: widgetValuesVersion + 1 });
      },

      bringToFront: (entityId) => {
        const { entityMap, entities, stackOrder, stackVersion } = get();
        const entity = entityMap.get(entityId);
        if (!entity) return;

        // Already on top, and nothing under it to lift: a re-press must not repaint the scene.
        if (stackOrder.get(entityId) === stackCounter && entity.type !== 'frame') return;

        // Ancestors first (root outermost), then the entity, then — only for a frame, because
        // the descendant walk is O(n) — its children in depth order, so they land above it.
        const chain = getParentChain(entity, entityMap).reverse();
        for (const a of chain) stackOrder.set(a.id, ++stackCounter);
        stackOrder.set(entityId, ++stackCounter);
        if (entity.type === 'frame') {
          for (const d of sortByDepth(getGroupDescendants(entities, entityId), entityMap)) {
            stackOrder.set(d.id, ++stackCounter);
          }
        }

        // Keep the depth range inside the camera: renumber 1..n by current order, rarely.
        if (stackCounter > STACK_COMPACT_AT) {
          const sorted = [...stackOrder.entries()].sort((a, b) => a[1] - b[1]);
          stackCounter = 0;
          for (const [id] of sorted) stackOrder.set(id, ++stackCounter);
        }

        set({ stackVersion: stackVersion + 1 });
      },

      // Apply changes
      applyEntityChanges: (changes) => {
        const { entities, collapsedGroupIds: currentCollapsed } = get();
        const nextEntities = [...entities];
        let collapsedChanged = false;
        let topologyChanged = false;
        let widgetValuesDropped = false;
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
                const removed = nextEntities[index];
                nextEntities.splice(index, 1);
                topologyChanged = true;
                get().stackOrder.delete(change.id);
                // The stack index was already cleaned up here; the widget overrides were not, and
                // an id that returns must not inherit them.
                if (dropWidgetValues(get().widgetValues, removed)) widgetValuesDropped = true;
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
              // A new entity arrives on top: it is the thing the person just made.
              get().stackOrder.set(change.entity.id, ++stackCounter);
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
                const entity = nextEntities[index];
                const merged = { ...entity, data: { ...entity.data, ...change.data } };
                // Auto-derive resizable when sizingMode changes on text entities
                if (entity.type === 'text' && 'sizingMode' in change.data) {
                  const mode = (change.data as TextEntityData).sizingMode ?? 'auto-height';
                  merged.resizable = resizableForSizingMode(mode);
                }
                nextEntities[index] = merged;
              }
              break;
            }
            default: {
              // An unrecognised change type used to be dropped in silence. The union is public and
              // a consumer building changes by hand gets no signal that a typo'd `type` did
              // nothing at all — a behaviour test written against `{ type: 'update' }` reported a
              // component as broken when the component was fine and the change had simply been
              // thrown away. Unconditional, matching FontContext's existing warnings: the package
              // has no dev-only mechanism, and this is a programming error worth surfacing wherever
              // it happens.
              console.warn(
                `[kookie-flow] applyEntityChanges: ignoring unknown change type ${JSON.stringify(
                  (change as { type?: unknown }).type
                )}. Valid types: position, select, remove, add, dimensions, collapse, parent, data.`
              );
              break;
            }
          }
        }

        // Rebuild derived state (entityMap, quadtree, socketQuadtree) to stay in sync
        const finalCollapsed = collapsedChanged ? nextCollapsed : currentCollapsed;
        const derived = rebuildDerivedState(nextEntities, finalCollapsed, get().socketLayout);
        if (topologyChanged) {
          cachedAnalysis = null;
          rebuildIdToIndex(nextEntities);
        }
        set({
          entities: nextEntities,
          ...derived,
          ...(topologyChanged
            ? { topologyVersion: get().topologyVersion + 1, stackVersion: get().stackVersion + 1 }
            : {}),
          ...(widgetValuesDropped
            ? { widgetValuesVersion: get().widgetValuesVersion + 1 }
            : {}),
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
          connectedSockets: rebuildConnectedSockets(nextEdges, get().widgetValues),
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
        const { selectedEdgeIds } = get();
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
        const { entities: allEntities, socketLayout } = get();

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
          // 200x100 was neither the renderer's default width nor any entity's computed height, so
          // fitView framed a box smaller than the content and cut entities off at the right and
          // bottom edges.
          const { width, height } = getEntityBounds(entity, socketLayout ?? undefined);
          minX = Math.min(minX, entity.position.x);
          minY = Math.min(minY, entity.position.y);
          maxX = Math.max(maxX, entity.position.x + width);
          maxY = Math.max(maxY, entity.position.y + height);
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

        // Populate moved entity IDs side-channel for renderers
        movedEntityIds.clear();
        for (const { id } of updates) {
          movedEntityIds.add(id);
        }

        // Update each entity: O(k) using persistent idToIndex map
        for (const { id, position } of updates) {
          const index = resolveIndex(nextEntities, id);
          if (index >= 0) {
            const entity = { ...nextEntities[index], position };
            nextEntities[index] = entity;
            entityMap.set(id, entity);
            quadtree.update(id, getEntityBounds(entity, socketLayout ?? undefined));

            // Update socket positions in socketQuadtree
            const inputX = getSocketWorldX(entity, true);
            const outputX = getSocketWorldX(entity, false);
            if (entity.inputs) {
              for (let i = 0; i < entity.inputs.length; i++) {
                const socket = entity.inputs[i];
                const yOffset = getSocketYOffset(entity, i, true, socketLayout);
                socketQuadtree.update(id, socket.id, true, inputX, position.y + yOffset);
              }
            }
            if (entity.outputs) {
              for (let i = 0; i < entity.outputs.length; i++) {
                const socket = entity.outputs[i];
                const yOffset = getSocketYOffset(entity, i, false, socketLayout);
                socketQuadtree.update(id, socket.id, false, outputX, position.y + yOffset);
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

        const nextEntities = [...entities];
        const index = resolveIndex(nextEntities, id);
        if (index < 0) return;

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
        movedEntityIds.add(id);

        // Always update socket quadtree — width changes move output sockets,
        // position changes move all sockets
        const pos = entity.position;
        const inputX = getSocketWorldX(entity, true);
        const outputX = getSocketWorldX(entity, false);
        if (entity.inputs) {
          for (let i = 0; i < entity.inputs.length; i++) {
            const socket = entity.inputs[i];
            const yOffset = getSocketYOffset(entity, i, true, socketLayout);
            socketQuadtree.update(id, socket.id, true, inputX, pos.y + yOffset);
          }
        }
        if (entity.outputs) {
          for (let i = 0; i < entity.outputs.length; i++) {
            const socket = entity.outputs[i];
            const yOffset = getSocketYOffset(entity, i, false, socketLayout);
            socketQuadtree.update(id, socket.id, false, outputX, pos.y + yOffset);
          }
        }

        // Bump positionVersion so sockets, edges, and widgets detect the change
        set({ entities: nextEntities, positionVersion: positionVersion + 1 });
      },

      fitEntityToContent: (id) => {
        const { entities, entityMap, quadtree, socketQuadtree, positionVersion, socketLayout } = get();
        const existing = entityMap.get(id);
        if (!existing) return;

        const nextEntities = [...entities];
        const index = resolveIndex(nextEntities, id);
        if (index < 0) return;

        // Clear explicit dimensions to revert to computed minimum
        const { width: _w, height: _h, ...rest } = existing;
        const entity = rest as Entity;
        nextEntities[index] = entity;
        entityMap.set(id, entity);
        quadtree.update(id, getEntityBounds(entity, socketLayout ?? undefined));

        // Dropping the explicit size is a resize, so it has to finish like one. This used to set
        // `entities` and nothing else: the socket index kept the sockets where the OLD width put
        // them, so after a fit the output dot's hit box sat off to one side of the dot and a press
        // on the visible socket missed; and with no `positionVersion` bump the edges layer, which
        // watches only that counter and the entity count, never redrew — every edge on the entity
        // stayed anchored to the old geometry. `updateEntityDimensions` does both, and this is the
        // same operation with the target size computed rather than given.
        const pos = entity.position;
        const inputX = getSocketWorldX(entity, true);
        const outputX = getSocketWorldX(entity, false);
        if (entity.inputs) {
          for (let i = 0; i < entity.inputs.length; i++) {
            const socket = entity.inputs[i];
            const yOffset = getSocketYOffset(entity, i, true, socketLayout);
            socketQuadtree.update(id, socket.id, true, inputX, pos.y + yOffset);
          }
        }
        if (entity.outputs) {
          for (let i = 0; i < entity.outputs.length; i++) {
            const socket = entity.outputs[i];
            const yOffset = getSocketYOffset(entity, i, false, socketLayout);
            socketQuadtree.update(id, socket.id, false, outputX, pos.y + yOffset);
          }
        }

        set({ entities: nextEntities, positionVersion: positionVersion + 1 });
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
        const { entities: currentEntities, edges: currentEdges, entityMap, quadtree, socketQuadtree, socketLayout, stackOrder, stackVersion } = get();
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
          if (entity.inputs) {
            for (let i = 0; i < entity.inputs.length; i++) {
              const socket = entity.inputs[i];
              const yOffset = getSocketYOffset(entity, i, true, socketLayout);
              socketQuadtree.insert({
                entityId: entity.id,
                socketId: socket.id,
                isInput: true,
                x: getSocketWorldX(entity, true),
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
                x: getSocketWorldX(entity, false),
                y: entity.position.y + yOffset,
              });
            }
          }
        }

        // Everything arriving here lands on top, exactly as applyEntityChanges' add branch puts a
        // new entity there. Without an index these entities fell through `stackOrder.get(id) ?? 0`
        // to the bottom of the stack: a paste at the default {50,50} offset painted BEHIND the
        // entity it was copied from, and a press on the overlap picked the original, because
        // topmostEntityId was comparing the paste's 0 against the original's real index. Paste,
        // insert-on-edge and collapse all reach the graph through here.
        assignStackOrder(stackOrder, newEntities);

        cachedAnalysis = null;
        // Length/order changed: the drag fast path's index is stale until this runs.
        rebuildIdToIndex(nextEntities);
        set({
          entities: nextEntities,
          edges: nextEdges,
          connectedSockets: rebuildConnectedSockets(nextEdges, get().widgetValues),
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: get().topologyVersion + 1,
          stackVersion: stackVersion + 1,
        });
      },

      deleteElements: (batch) => {
        const { entities, edges, selectedEntityIds, selectedEdgeIds, entityMap, quadtree, socketQuadtree, stackOrder, stackVersion, widgetValues, widgetValuesVersion } = get();
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
        //
        // The two per-entity maps that are NOT derived state have to be swept here as well.
        // `stackOrder` and `widgetValues` are mutated in place and never rebuilt, and this path
        // cleaned up neither: with delete bound to a key, as the shortcuts docs recommend, both
        // grew without bound while `entities.length` stayed flat, and bringToFront's compaction
        // then renumbered the dead ids too, so they permanently held indices ahead of live
        // entities. A restored id also inherited whatever override its previous life left behind.
        // applyEntityChanges' remove branch already did the stackOrder half; this is the same
        // removal reached through the batch API.
        let widgetValuesDropped = false;
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
            if (dropWidgetValues(widgetValues, entity)) widgetValuesDropped = true;
          }
          entityMap.delete(entityId);
          stackOrder.delete(entityId);
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
        // Length/order changed: the drag fast path's index is stale until this runs.
        rebuildIdToIndex(nextEntities);
        set({
          entities: nextEntities,
          edges: nextEdges,
          connectedSockets: rebuildConnectedSockets(nextEdges, get().widgetValues),
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: get().topologyVersion + 1,
          stackVersion: stackVersion + 1,
          selectedEntityIds: nextSelectedEntityIds,
          selectedEdgeIds: nextSelectedEdgeIds,
          ...(widgetValuesDropped ? { widgetValuesVersion: widgetValuesVersion + 1 } : {}),
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

      /**
       * The document as it stands — including what the person has set on a widget and the consumer
       * has not echoed back.
       *
       * This used to return `entities` untouched, which meant a save did not match the canvas. In
       * an uncontrolled graph nothing ever echoes, so `widgetValues` is where the slider's value
       * lives permanently (utils/widget-values.ts states that trade outright: "a consumer that
       * never echoes keeps showing the local value"). Dragging a slider from 0.25 to 0.8 and saving
       * wrote 0.25, and reloading snapped the slider back — the person's edit was visible on screen
       * and absent from the file.
       *
       * Folding, not retiring: `readWidgetValue` drops a key once the value has round-tripped, and
       * that belongs to the paint, which is the only thing that knows a widget was actually shown.
       * A save reads. It also keeps the entity objects it was given whenever there is nothing
       * pending for them, so the common case allocates nothing.
       */
      toObject: (): FlowObject => {
        const { entities, edges, viewport, widgetValues } = get();
        if (widgetValues.size === 0) return { entities, edges, viewport };

        const folded = entities.map((entity) => {
          let pending: Record<string, unknown> | null = null;
          for (const sockets of [entity.inputs, entity.outputs]) {
            if (!sockets) continue;
            for (const socket of sockets) {
              const key = widgetKey(entity.id, socket.id);
              if (!widgetValues.has(key)) continue;
              if (pending === null) pending = {};
              pending[socket.id] = widgetValues.get(key)?.value;
            }
          }
          if (pending === null) return entity;
          // Same place the widgets read from: `entity.data.values`, keyed by socket id.
          const existing = entity.data.values;
          return {
            ...entity,
            data: {
              ...entity.data,
              values: { ...(isValueBag(existing) ? existing : {}), ...pending },
            },
          };
        });
        return { entities: folded, edges, viewport };
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
        return utilCalculateGroupBounds(entities, groupId, undefined, get().socketLayout ?? undefined);
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
        // The entity dropped onto the edge is the thing the person just made, so it arrives on top.
        // With no index it sat at 0 and painted under the two entities it was inserted between.
        state.stackOrder.set(positionedEntity.id, ++stackCounter);
        // Length/order changed: the drag fast path's index is stale until this runs.
        rebuildIdToIndex(nextEntities);
        set({
          entities: nextEntities,
          edges: nextEdges,
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: state.topologyVersion + 1,
          stackVersion: state.stackVersion + 1,
          connectedSockets: rebuildConnectedSockets(nextEdges, get().widgetValues),
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

        // A bypass removes an entity, so it owes the same sweep every other removal owes: the two
        // in-place maps keyed by entity id are not derived state and no rebuild will clear them.
        const bypassed = state.entityMap.get(changes.removeEntityId);
        state.stackOrder.delete(changes.removeEntityId);
        const widgetValuesDropped = bypassed
          ? dropWidgetValues(state.widgetValues, bypassed)
          : false;

        // Update selection
        const nextSelectedEntityIds = new Set(state.selectedEntityIds);
        nextSelectedEntityIds.delete(entityId);
        const nextSelectedEdgeIds = new Set(state.selectedEdgeIds);
        for (const id of removeEdgeIdSet) nextSelectedEdgeIds.delete(id);

        // Length/order changed: the drag fast path's index is stale until this runs.
        rebuildIdToIndex(nextEntities);
        set({
          entities: nextEntities,
          edges: nextEdges,
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: state.topologyVersion + 1,
          stackVersion: state.stackVersion + 1,
          connectedSockets: rebuildConnectedSockets(nextEdges, get().widgetValues),
          selectedEntityIds: nextSelectedEntityIds,
          selectedEdgeIds: nextSelectedEdgeIds,
          ...derived,
          ...(widgetValuesDropped
            ? { widgetValuesVersion: state.widgetValuesVersion + 1 }
            : {}),
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
          state.adjacencyIndex,
          state.socketLayout ?? undefined
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

        // The new frame goes on top of the graph and its children go on top of IT — bringToFront's
        // ordering for a frame, kept here for its reason: a frame body drawn above the entities it
        // contains hides them. The frame had no stack index at all before, which put it at the
        // bottom of the whole graph, behind entities it has nothing to do with.
        state.stackOrder.set(frameEntity.id, ++stackCounter);
        for (const child of sortByDepth(
          nextEntities.filter((n) => childIdSet.has(n.id)),
          derived.entityMap
        )) {
          state.stackOrder.set(child.id, ++stackCounter);
        }

        // Length/order changed: the drag fast path's index is stale until this runs.
        rebuildIdToIndex(nextEntities);
        set({
          entities: nextEntities,
          edges: nextEdges,
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: state.topologyVersion + 1,
          stackVersion: state.stackVersion + 1,
          connectedSockets: rebuildConnectedSockets(nextEdges, get().widgetValues),
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

        // An expand both removes the frame and brings entities back, and the restored ones may
        // never have had an index in this store at all — they arrive as arguments. Reconciling
        // against the final array is the one operation that covers both halves: drop the frame's
        // key, hand every id that lacks one the next index. Without it the frame's entry outlived
        // the frame and every restored child sat at 0, behind the rest of the graph.
        reconcileStackOrder(state.stackOrder, nextEntities);
        const widgetValuesDropped = reconcileWidgetValues(state.widgetValues, nextEntities);

        // Update selection
        const nextSelectedEntityIds = new Set(state.selectedEntityIds);
        nextSelectedEntityIds.delete(groupId);
        const nextSelectedEdgeIds = new Set(state.selectedEdgeIds);
        for (const id of removeEdgeIdSet) nextSelectedEdgeIds.delete(id);

        // Length/order changed: the drag fast path's index is stale until this runs.
        rebuildIdToIndex(nextEntities);
        set({
          entities: nextEntities,
          edges: nextEdges,
          adjacencyIndex: graphEngine.buildAdjacencyIndex(nextEdges),
          topologyVersion: state.topologyVersion + 1,
          stackVersion: state.stackVersion + 1,
          connectedSockets: rebuildConnectedSockets(nextEdges, get().widgetValues),
          selectedEntityIds: nextSelectedEntityIds,
          selectedEdgeIds: nextSelectedEdgeIds,
          ...derived,
          ...(widgetValuesDropped
            ? { widgetValuesVersion: state.widgetValuesVersion + 1 }
            : {}),
        });
      },
    }))
  );
};
