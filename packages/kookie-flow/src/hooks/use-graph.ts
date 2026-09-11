import { useState, useCallback, useEffect, useRef } from 'react';
import type { Entity, Edge, EntityChange, EdgeChange, Connection, TextEntityData } from '../types';
import { resizableForSizingMode } from '../utils/text-texture';
import {
  DEFAULT_HISTORY_LIMIT,
  coalesceKey,
  emptyHistory,
  isEdit,
  record,
  stepBack,
  stepForward,
  type HistoryState,
} from '../core/history';

export interface UseGraphOptions {
  initialEntities?: Entity[];
  initialEdges?: Edge[];
  /**
   * Undo and redo over the graph this hook holds. Off by default, because a consumer with its own
   * history — a document store, a server, a CRDT — must not end up with two.
   *
   * `true` takes the defaults: fifty steps, and Cmd/Ctrl+Z bound while the graph has focus.
   */
  history?: boolean | UseGraphHistoryOptions;
}

export interface UseGraphHistoryOptions {
  /** How many steps back. Default: 50. */
  limit?: number;
  /**
   * Bind Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (and Ctrl+Y) while the graph has focus. Default: true.
   *
   * Scoped to the graph on purpose: a page that embeds a canvas must not lose undo in its own
   * text fields, which is exactly what a bare window listener does.
   */
  shortcuts?: boolean;
}

export interface UseGraphReturn {
  entities: Entity[];
  edges: Edge[];
  /** Step back. Does nothing at the beginning of history, or when history is off. */
  undo: () => void;
  /** Step forward again. */
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setEntities: React.Dispatch<React.SetStateAction<Entity[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onEntitiesChange: (changes: EntityChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addEntity: (entity: Entity) => void;
  removeEntity: (id: string) => void;
  addEdge: (edge: Edge) => void;
  removeEdge: (id: string) => void;
  getEntity: (id: string) => Entity | undefined;
  getEdge: (id: string) => Edge | undefined;
  getConnectedEdges: (entityId: string) => Edge[];
}

/**
 * Hook for managing graph state outside of KookieFlow.
 * Use this for controlled component pattern.
 */
export function useGraph(options: UseGraphOptions = {}): UseGraphReturn {
  const { initialEntities = [], initialEdges = [], history = false } = options;

  // Use React state for external management
  const [entities, setEntities] = useState<Entity[]>(initialEntities);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  // ---- history ----

  const historyOn = history !== false;
  const historyLimit =
    (typeof history === 'object' ? history.limit : undefined) ?? DEFAULT_HISTORY_LIMIT;
  const historyShortcuts =
    (typeof history === 'object' ? history.shortcuts : undefined) ?? true;

  /**
   * The stack lives in a ref, and only its two booleans live in state.
   *
   * Recording happens inside the change handlers, which run during gestures — a snapshot per
   * frame of a drag through `setState` would re-render the consumer sixty times a second, which
   * is the one thing this library will not do. What React needs to know is whether the buttons
   * are enabled, and that changes a handful of times.
   */
  const historyRef = useRef<HistoryState>(emptyHistory());
  const graphRef = useRef<{ entities: Entity[]; edges: Edge[] }>({ entities, edges });
  graphRef.current = { entities, edges };
  const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false });

  const syncHistoryFlags = useCallback(() => {
    const { past, future } = historyRef.current;
    const canUndo = past.length > 0;
    const canRedo = future.length > 0;
    setHistoryFlags((prev) =>
      prev.canUndo === canUndo && prev.canRedo === canRedo ? prev : { canUndo, canRedo }
    );
  }, []);

  /** Remember where the graph is, before a batch of changes is applied to it. */
  const remember = useCallback(
    (changes: readonly (EntityChange | EdgeChange)[]) => {
      if (!historyOn || !isEdit(changes)) return;
      // One gesture can arrive as two batches in one tick — a delete reports the wires, then the
      // node — with no render between them, so both would record the same `before`. The second
      // was an undo step that restored exactly what the first had.
      const { past } = historyRef.current;
      if (past.length > 0 && past[past.length - 1] === graphRef.current) return;
      historyRef.current = record(
        historyRef.current,
        graphRef.current,
        coalesceKey(changes),
        Date.now(),
        historyLimit
      );
      syncHistoryFlags();
    },
    [historyOn, historyLimit, syncHistoryFlags]
  );

  const undo = useCallback(() => {
    if (!historyOn) return;
    const step = stepBack(historyRef.current, graphRef.current);
    if (!step) return;
    historyRef.current = step.state;
    setEntities(step.restored.entities);
    setEdges(step.restored.edges);
    syncHistoryFlags();
  }, [historyOn, syncHistoryFlags]);

  const redo = useCallback(() => {
    if (!historyOn) return;
    const step = stepForward(historyRef.current, graphRef.current);
    if (!step) return;
    historyRef.current = step.state;
    setEntities(step.restored.entities);
    setEdges(step.restored.edges);
    syncHistoryFlags();
  }, [historyOn, syncHistoryFlags]);

  /**
   * Cmd/Ctrl+Z, and its two redo spellings, while the graph has focus.
   *
   * The focus test is what keeps a page that embeds a canvas from losing undo in its own text
   * fields. A bare window listener would take the key everywhere on the page, which is a defect
   * this codebase has already recorded once for the graph's own shortcuts.
   */
  useEffect(() => {
    if (!historyOn || !historyShortcuts) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const active = document.activeElement;
      if (!active || !active.closest('[data-kookie-flow-container]')) return;
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [historyOn, historyShortcuts, undo, redo]);

  const onEntitiesChange = useCallback((changes: EntityChange[]) => {
    remember(changes);
    setEntities((nds) => {
      const nextEntities = [...nds];

      // Build id->index map once for O(1) lookups
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
              // Update indices for subsequent removals
              idToIndex.delete(change.id);
              for (let i = index; i < nextEntities.length; i++) {
                idToIndex.set(nextEntities[i].id, i);
              }
            }
            break;
          }
          case 'add': {
            idToIndex.set(change.entity.id, nextEntities.length);
            nextEntities.push(change.entity);
            break;
          }
          case 'parent': {
            const index = idToIndex.get(change.id);
            if (index !== undefined) {
              nextEntities[index] = { ...nextEntities[index], parentId: change.parentId ?? undefined };
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
        }
      }

      return nextEntities;
    });
  }, [remember]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    remember(changes);
    setEdges((eds) => {
      const nextEdges = [...eds];

      // Build id->index map once for O(1) lookups
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
              // Update indices for subsequent removals
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

      return nextEdges;
    });
  }, [remember]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    // A new wire is an edit like any other, and arrives by its own door rather than as a change.
    remember([{ type: 'add', edge: { id: 'pending', source: connection.source, target: connection.target } }]);

    const newEdge: Edge = {
      id: `${connection.source}-${connection.sourceSocket ?? 'out'}-${connection.target}-${connection.targetSocket ?? 'in'}`,
      source: connection.source,
      target: connection.target,
      sourceSocket: connection.sourceSocket ?? undefined,
      targetSocket: connection.targetSocket ?? undefined,
      invalid: connection.invalid,
    };

    setEdges((eds) => [...eds, newEdge]);
  }, [remember]);

  const addEntity = useCallback((entity: Entity) => {
    setEntities((nds) => [...nds, entity]);
  }, []);

  const removeEntity = useCallback((id: string) => {
    setEntities((nds) => nds.filter((n) => n.id !== id));
    // Also remove connected edges
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  }, []);

  const addEdge = useCallback((edge: Edge) => {
    setEdges((eds) => [...eds, edge]);
  }, []);

  const removeEdge = useCallback((id: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== id));
  }, []);

  const getEntity = useCallback(
    (id: string) => entities.find((n) => n.id === id),
    [entities]
  );

  const getEdge = useCallback(
    (id: string) => edges.find((e) => e.id === id),
    [edges]
  );

  const getConnectedEdges = useCallback(
    (entityId: string) => edges.filter((e) => e.source === entityId || e.target === entityId),
    [edges]
  );

  return {
    entities,
    edges,
    undo,
    redo,
    canUndo: historyFlags.canUndo,
    canRedo: historyFlags.canRedo,
    setEntities,
    setEdges,
    onEntitiesChange,
    onEdgesChange,
    onConnect,
    addEntity,
    removeEntity,
    addEdge,
    removeEdge,
    getEntity,
    getEdge,
    getConnectedEdges,
  };
}
