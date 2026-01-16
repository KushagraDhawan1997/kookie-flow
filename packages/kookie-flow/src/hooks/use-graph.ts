import { useState, useCallback, useMemo } from 'react';
import type { Node, Edge, NodeChange, EdgeChange, Connection } from '../types';

export interface UseGraphOptions {
  initialNodes?: Node[];
  initialEdges?: Edge[];
}

export interface UseGraphReturn {
  nodes: Node[];
  edges: Edge[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: Node) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: Edge) => void;
  removeEdge: (id: string) => void;
  getNode: (id: string) => Node | undefined;
  getEdge: (id: string) => Edge | undefined;
  getConnectedEdges: (nodeId: string) => Edge[];
}

/**
 * Hook for managing graph state outside of KookieFlow.
 * Use this for controlled component pattern.
 */
export function useGraph(options: UseGraphOptions = {}): UseGraphReturn {
  const { initialNodes = [], initialEdges = [] } = options;

  // Use React state for external management
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => {
      const nextNodes = [...nds];

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

      return nextNodes;
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => {
      const nextEdges = [...eds];

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
    };

    setEdges((eds) => [...eds, newEdge]);
  }, []);

  const addNode = useCallback((node: Node) => {
    setNodes((nds) => [...nds, node]);
  }, []);

  const removeNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    // Also remove connected edges
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  }, []);

  const addEdge = useCallback((edge: Edge) => {
    setEdges((eds) => [...eds, edge]);
  }, []);

  const removeEdge = useCallback((id: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== id));
  }, []);

  const getNode = useCallback(
    (id: string) => nodes.find((n) => n.id === id),
    [nodes]
  );

  const getEdge = useCallback(
    (id: string) => edges.find((e) => e.id === id),
    [edges]
  );

  const getConnectedEdges = useCallback(
    (nodeId: string) => edges.filter((e) => e.source === nodeId || e.target === nodeId),
    [edges]
  );

  return {
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    removeNode,
    addEdge,
    removeEdge,
    getNode,
    getEdge,
    getConnectedEdges,
  };
}

