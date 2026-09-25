import type { Edge, Entity } from '../types/index';

export type GraphStructureIssue =
  | { type: 'duplicate-id'; kind: 'entity' | 'edge'; id: string }
  | { type: 'duplicate-socket'; entityId: string; socketId: string; direction: 'input' | 'output' }
  | { type: 'missing-endpoint'; edgeId: string; entityId: string; endpoint: 'source' | 'target' }
  | {
      type: 'missing-socket';
      edgeId: string;
      entityId: string;
      socketId: string;
      endpoint: 'source' | 'target';
    }
  | { type: 'missing-parent'; entityId: string; parentId: string }
  | { type: 'parent-cycle'; entityIds: string[] }
  | { type: 'missing-reroute'; edgeId: string; entityId: string }
  | { type: 'invalid-geometry'; entityId: string };

/** Structural validity is separate from execution readiness: cycles and empty inputs may be intentional. */
export function validateGraphStructure(entities: Entity[], edges: Edge[]): GraphStructureIssue[] {
  const issues: GraphStructureIssue[] = [];
  const nodes = new Map<string, Entity>();
  const ports = new Map<string, { source: Set<string>; target: Set<string> }>();
  for (const entity of entities) {
    if (nodes.has(entity.id)) issues.push({ type: 'duplicate-id', kind: 'entity', id: entity.id });
    nodes.set(entity.id, entity);
    if (
      !Number.isFinite(entity.position.x) ||
      !Number.isFinite(entity.position.y) ||
      [entity.width, entity.height].some((n) => n !== undefined && (!Number.isFinite(n) || n < 0))
    ) {
      issues.push({ type: 'invalid-geometry', entityId: entity.id });
    }
    const source = new Set<string>(),
      target = new Set<string>();
    for (const [sockets, ids, direction] of [
      [entity.inputs, target, 'input'],
      [entity.outputs, source, 'output'],
    ] as const) {
      for (const socket of sockets ?? []) {
        if (ids.has(socket.id))
          issues.push({
            type: 'duplicate-socket',
            entityId: entity.id,
            socketId: socket.id,
            direction,
          });
        ids.add(socket.id);
      }
    }
    ports.set(entity.id, { source, target });
  }
  // A functional parent graph needs only one walk per entity, including deep or cyclic imports.
  const visited = new Set<string>();
  for (const entity of entities) {
    if (entity.parentId !== undefined && !nodes.has(entity.parentId)) {
      issues.push({ type: 'missing-parent', entityId: entity.id, parentId: entity.parentId });
    }
    if (visited.has(entity.id)) continue;
    const path: string[] = [];
    const offsets = new Map<string, number>();
    let id: string | undefined = entity.id;
    while (id !== undefined && nodes.has(id) && !visited.has(id)) {
      const start = offsets.get(id);
      if (start !== undefined) {
        issues.push({ type: 'parent-cycle', entityIds: path.slice(start) });
        break;
      }
      offsets.set(id, path.length);
      path.push(id);
      id = nodes.get(id)!.parentId;
    }
    for (const member of path) visited.add(member);
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) issues.push({ type: 'duplicate-id', kind: 'edge', id: edge.id });
    edgeIds.add(edge.id);
    for (const endpoint of ['source', 'target'] as const) {
      const entityId = edge[endpoint];
      const socketId = endpoint === 'source' ? edge.sourceSocket : edge.targetSocket;
      if (!nodes.has(entityId))
        issues.push({ type: 'missing-endpoint', edgeId: edge.id, entityId, endpoint });
      else if (socketId !== undefined && !ports.get(entityId)![endpoint].has(socketId)) {
        issues.push({ type: 'missing-socket', edgeId: edge.id, entityId, socketId, endpoint });
      }
    }
    for (const id of edge.reroutes ?? []) {
      if (nodes.get(id)?.type !== 'reroute')
        issues.push({ type: 'missing-reroute', edgeId: edge.id, entityId: id });
    }
  }
  return issues;
}
