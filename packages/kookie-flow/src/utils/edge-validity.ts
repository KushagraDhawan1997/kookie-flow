import type { Edge, Entity, SocketType } from '../types';
import { isSocketCompatible } from './connections';

/** Track inferred flags by object identity so explicit consumer overrides retain ownership. */
export function createEdgeValidityResolver() {
  const inferred = new WeakSet<Edge>();
  return (
    edges: Edge[],
    entityMap: Map<string, Entity>,
    socketTypes: Record<string, SocketType>
  ): Edge[] => {
    let next: Edge[] | undefined;
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      if (
        (edge.invalid !== undefined && !inferred.has(edge)) ||
        edge.sourceSocket === undefined ||
        edge.targetSocket === undefined
      )
        continue;
      const invalid = !isSocketCompatible(
        { entityId: edge.source, socketId: edge.sourceSocket, isInput: false },
        { entityId: edge.target, socketId: edge.targetSocket, isInput: true },
        entityMap,
        socketTypes
      );
      if (edge.invalid === invalid) continue;
      const resolved = { ...edge, invalid };
      inferred.add(resolved);
      (next ??= edges.slice())[i] = resolved;
    }
    return next ?? edges;
  };
}
