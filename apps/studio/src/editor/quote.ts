/**
 * The price of running a node, quoted with the same table the server charges from. Inputs resolve as
 * the engine resolves them: a wired one reads what its source holds, the rest their own value. The
 * inspector's footer and the agent's `estimate` both ask here, so the two can never disagree.
 */

import type { Edge, Entity, KookieFlowInstance } from '@kushagradhawan/kookie-flow';
import { estimateModelMicros, registry, TASK_BY_NODE_TYPE, valueBag, withFee, type Charge } from 'studio-core';

export function quoteNode(entity: Entity, edges: readonly Edge[], flow: KookieFlowInstance | null): Charge | null {
  const def = registry.get(entity.type);
  const task = TASK_BY_NODE_TYPE[entity.type];
  if (!def || !task) return null;
  const values = valueBag(entity);
  const resolved: Record<string, unknown> = {};
  for (const [id, spec] of Object.entries(def.inputs)) {
    const edge = edges.find((e) => e.target === entity.id && e.targetSocket === id);
    resolved[id] =
      edge && edge.sourceSocket ? flow?.getSocketValue(edge.source, edge.sourceSocket) : (values[id] ?? spec.default);
  }
  const model = estimateModelMicros(task, resolved);
  return model === undefined ? null : withFee(model);
}
