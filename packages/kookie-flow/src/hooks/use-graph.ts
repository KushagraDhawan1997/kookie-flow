import { useState, useCallback, useMemo } from 'react';
import type { Entity, Edge, EntityChange, EdgeChange, Connection, TextEntityData } from '../types';
import { resizableForSizingMode } from '../utils/text-texture';

export interface UseGraphOptions {
  initialEntities?: Entity[];
  initialEdges?: Edge[];
}

export interface UseGraphReturn {
  entities: Entity[];
  edges: Edge[];
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
  const { initialEntities = [], initialEdges = [] } = options;

  // Use React state for external management
  const [entities, setEntities] = useState<Entity[]>(initialEntities);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  const onEntitiesChange = useCallback((changes: EntityChange[]) => {
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
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
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
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;

    const newEdge: Edge = {
      id: `${connection.source}-${connection.sourceSocket ?? 'out'}-${connection.target}-${connection.targetSocket ?? 'in'}`,
      source: connection.source,
      target: connection.target,
      sourceSocket: connection.sourceSocket ?? undefined,
      targetSocket: connection.targetSocket ?? undefined,
      invalid: connection.invalid,
    };

    setEdges((eds) => [...eds, newEdge]);
  }, []);

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
