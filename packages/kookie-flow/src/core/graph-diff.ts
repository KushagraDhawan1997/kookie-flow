/**
 * What changed between two graphs, as the changes a controlled consumer applies.
 *
 * For the operations that rewrite the graph wholesale inside the store — collapsing a set of nodes
 * into a subgraph, and expanding it again — and still have to report what they did, as every
 * gesture does. Unreported, the consumer's next render handed back the graph from before: the
 * frame vanished, its children lost their parent, and the port wires it made were left pointing
 * at nothing.
 */

import type { Entity, Edge, EntityChange, EdgeChange } from '../types';

export interface GraphDiff {
  entityChanges: EntityChange[];
  edgeChanges: EdgeChange[];
}

export function diffGraph(
  prevEntities: readonly Entity[],
  nextEntities: readonly Entity[],
  prevEdges: readonly Edge[],
  nextEdges: readonly Edge[]
): GraphDiff {
  const entityChanges: EntityChange[] = [];
  const prevEntityById = new Map<string, Entity>();
  for (const e of prevEntities) prevEntityById.set(e.id, e);
  const nextEntityIds = new Set<string>();
  for (const e of nextEntities) nextEntityIds.add(e.id);
  for (const e of prevEntities) {
    if (!nextEntityIds.has(e.id)) entityChanges.push({ type: 'remove', id: e.id });
  }
  for (const e of nextEntities) {
    const before = prevEntityById.get(e.id);
    if (!before) {
      entityChanges.push({ type: 'add', entity: e });
    } else if (before.parentId !== e.parentId) {
      entityChanges.push({ type: 'parent', id: e.id, parentId: e.parentId ?? null });
    }
  }

  const edgeChanges: EdgeChange[] = [];
  const prevEdgeIds = new Set<string>();
  for (const e of prevEdges) prevEdgeIds.add(e.id);
  const nextEdgeIds = new Set<string>();
  for (const e of nextEdges) nextEdgeIds.add(e.id);
  for (const e of prevEdges) if (!nextEdgeIds.has(e.id)) edgeChanges.push({ type: 'remove', id: e.id });
  for (const e of nextEdges) if (!prevEdgeIds.has(e.id)) edgeChanges.push({ type: 'add', edge: e });

  return { entityChanges, edgeChanges };
}
