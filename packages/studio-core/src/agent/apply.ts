/**
 * Ops applied to a stored document, away from any canvas. The editor applies ops through the canvas's
 * own handlers so they land in its history; a graph the agent creates has no canvas yet, so its first
 * ops are applied here, through the same compiler, and the document is saved as it stands.
 */

import type { Edge, Entity } from '@kushagradhawan/kookie-flow';
import type { GraphDocument } from '../document';
import { compileOps, type OpError, type GraphOp } from '../ops';
import type { NodeRegistry } from '../registry';
import { layoutCluster } from './layout';

export interface AppliedDocument {
  doc: GraphDocument;
  created: string[];
  errors: OpError[];
}

export function applyOpsToDocument(doc: GraphDocument, ops: readonly GraphOp[], registry: NodeRegistry): AppliedDocument {
  const placed = layoutCluster(doc, ops, registry);
  const compiled = compileOps(doc, placed, registry);
  // All or nothing, as in the editor: half a batch leaves ops that name nodes which never landed.
  if (compiled.errors.length) return { doc, created: [], errors: compiled.errors };

  const entities = new Map<string, Entity>(doc.entities.map((e) => [e.id, e]));
  for (const change of compiled.entityChanges) {
    switch (change.type) {
      case 'add':
        entities.set(change.entity.id, change.entity);
        break;
      case 'remove':
        entities.delete(change.id);
        break;
      case 'data': {
        const entity = entities.get(change.id);
        if (entity) entities.set(change.id, { ...entity, data: { ...entity.data, ...change.data } });
        break;
      }
      case 'position': {
        const entity = entities.get(change.id);
        if (entity) entities.set(change.id, { ...entity, position: change.position });
        break;
      }
      default:
        // The compiler makes no other kind; a new kind here is a reason to extend this, not to guess.
        break;
    }
  }

  const edges = new Map<string, Edge>(doc.edges.map((e) => [e.id, e]));
  for (const change of compiled.edgeChanges) {
    if (change.type === 'add') edges.set(change.edge.id, change.edge);
    else if (change.type === 'remove') edges.delete(change.id);
  }

  return {
    doc: { ...doc, entities: [...entities.values()], edges: [...edges.values()] },
    created: compiled.created,
    errors: compiled.errors,
  };
}
