/**
 * Where the agent's new nodes go when it does not say.
 *
 * NEW WORK IS ONE CLUSTER, CLEAR OF WHAT IS THERE. The added nodes are laid out left to right by how
 * far down the wiring each one sits, as a graph reads, in a block that starts below everything already
 * on the canvas. A model placing nodes itself scatters them over the person's work; this is the one
 * place that knows node sizes, so the model is asked to leave positions out.
 */

import type { Entity, XYPosition } from '@kushagradhawan/kookie-flow';
import type { GraphOp } from '../ops';
import { estimateNodeSize } from '../node-size';
import type { NodeRegistry } from '../registry';

const COLUMN_GAP = 120;
const ROW_GAP = 60;
/** Space between the canvas's existing work and the new cluster. */
const CLUSTER_GAP = 240;

function entityBox(registry: NodeRegistry, e: Entity) {
  const size = estimateNodeSize(registry, e.type);
  return { x: e.position.x, y: e.position.y, w: e.width ?? size.w, h: e.height ?? size.h };
}

/**
 * The same ops, with a position given to every `add_node` that has none. Ops that state a position
 * keep it. The cluster's top left sits under the lowest existing node, at the leftmost existing x.
 */
export function layoutCluster(
  graph: { entities: readonly Entity[] },
  ops: readonly GraphOp[],
  registry: NodeRegistry
): GraphOp[] {
  const unplaced = ops.flatMap((op, i) => (op.op === 'add_node' && !op.position ? [i] : []));
  if (unplaced.length === 0) return [...ops];

  let originX = 0;
  let originY = 0;
  if (graph.entities.length > 0) {
    let minX = Infinity;
    let maxY = -Infinity;
    for (const e of graph.entities) {
      const box = entityBox(registry, e);
      minX = Math.min(minX, box.x);
      maxY = Math.max(maxY, box.y + box.h);
    }
    originX = minX;
    originY = maxY + CLUSTER_GAP;
  }

  // Ids the ops will give their nodes, in order, so a wire can name one before it exists.
  const taken = new Set(graph.entities.map((e) => e.id));
  let counter = 0;
  for (const id of taken) {
    const m = /^n(\d+)$/.exec(id);
    if (m) counter = Math.max(counter, Number(m[1]));
  }
  const idOf = new Map<number, string>();
  const typeOf = new Map<string, string>();
  ops.forEach((op, i) => {
    if (op.op !== 'add_node') return;
    // The compiler numbers from the highest `n<number>` so far, stated ids included.
    const stated = op.id ? /^n(\d+)$/.exec(op.id) : null;
    if (stated) counter = Math.max(counter, Number(stated[1]));
    const id = op.id ?? `n${++counter}`;
    idOf.set(i, id);
    typeOf.set(id, op.type);
  });

  // Depth among the new nodes: a node sits one column right of the deepest new node feeding it.
  const feeds = new Map<string, string[]>();
  for (const op of ops) {
    if (op.op !== 'connect') continue;
    const from = op.from.slice(0, op.from.lastIndexOf('.'));
    const to = op.to.slice(0, op.to.lastIndexOf('.'));
    if (!typeOf.has(from) || !typeOf.has(to)) continue;
    const list = feeds.get(to);
    if (list) list.push(from);
    else feeds.set(to, [from]);
  }
  const depth = new Map<string, number>();
  const depthOf = (id: string, trail: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (trail.has(id)) return 0; // a loop the compiler will refuse; do not recurse forever
    trail.add(id);
    const sources = feeds.get(id) ?? [];
    const d = sources.length ? Math.max(...sources.map((s) => depthOf(s, trail) + 1)) : 0;
    trail.delete(id);
    depth.set(id, d);
    return d;
  };

  const columns = new Map<number, string[]>();
  for (const i of unplaced) {
    const id = idOf.get(i);
    if (!id) continue;
    const d = depthOf(id, new Set());
    const list = columns.get(d);
    if (list) list.push(id);
    else columns.set(d, [id]);
  }

  const position = new Map<string, XYPosition>();
  let x = originX;
  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    const ids = columns.get(d) ?? [];
    let y = originY;
    let widest = 0;
    for (const id of ids) {
      const size = estimateNodeSize(registry, typeOf.get(id) ?? '');
      position.set(id, { x, y });
      y += size.h + ROW_GAP;
      widest = Math.max(widest, size.w);
    }
    x += widest + COLUMN_GAP;
  }

  return ops.map((op, i) => {
    if (op.op !== 'add_node' || op.position) return op;
    const id = idOf.get(i);
    const at = id ? position.get(id) : undefined;
    // The id is written back too, so the compiler gives the node the id its position was worked out for.
    return at && id ? { ...op, id, position: at } : op;
  });
}
