/**
 * Tidying a graph: where nodes go when nobody has said where they should.
 *
 * A layered layout, the shape every node editor's "arrange" produces. Three passes:
 *
 *   RANK. Every node sits one column to the right of whatever feeds it, so a wire always points
 *   forward and the eye can follow the flow left to right. Computed by longest path, which is what
 *   keeps a node with two upstreams of different depths from landing on top of its own source.
 *
 *   ORDER. Within a column, nodes are placed near the average position of what they connect to,
 *   which is the cheap half of crossing reduction and gets most of the benefit — a full barycentre
 *   sweep is a lot of machinery for a board a person is going to nudge anyway.
 *
 *   PLACE. Columns are spaced by the widest node in them, rows by the tallest, so nothing overlaps
 *   at any size.
 *
 * Cycles are not an error. A graph with a loop in it still has to be laid out, so an edge that
 * would point backwards is ignored for ranking and drawn as it falls.
 *
 * Pure: it takes sizes and edges and returns positions. Nothing here knows what a node is.
 */

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface LayoutOptions {
  /** Left-to-right (default) or top-to-bottom. */
  direction?: 'horizontal' | 'vertical';
  /** Space between columns, along the flow. Default: 120. */
  rankGap?: number;
  /** Space between nodes within a column. Default: 40. */
  nodeGap?: number;
  /** Where the first column starts. Default: the origin. */
  origin?: { x: number; y: number };
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
}

const DEFAULT_RANK_GAP = 120;
const DEFAULT_NODE_GAP = 40;

/**
 * The column each node belongs in.
 *
 * Longest path from any root, computed by walking the graph in dependency order. A node whose
 * upstreams are not all resolved waits; when nothing can advance — which is what a cycle looks
 * like from in here — the remaining nodes are given the rank they have so far and the walk ends,
 * rather than looping forever.
 */
export function rankNodes(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[]
): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    incoming.get(edge.target)?.push(edge.source);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const rank = new Map<string, number>();
  const remaining = new Map<string, number>();
  const queue: string[] = [];
  for (const node of nodes) {
    const count = incoming.get(node.id)?.length ?? 0;
    remaining.set(node.id, count);
    if (count === 0) {
      rank.set(node.id, 0);
      queue.push(node.id);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const here = rank.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      // Longest path: a node sits behind its DEEPEST upstream, not its first.
      rank.set(next, Math.max(rank.get(next) ?? 0, here + 1));
      const left = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  // Whatever is left is in a cycle, or downstream of one. It still needs a column: one past the
  // deepest thing that reaches it, which keeps the loop drawn as a loop rather than a pile.
  for (const node of nodes) {
    if (rank.has(node.id)) continue;
    let deepest = 0;
    for (const from of incoming.get(node.id) ?? []) {
      const r = rank.get(from);
      if (r !== undefined) deepest = Math.max(deepest, r + 1);
    }
    rank.set(node.id, deepest);
  }

  return rank;
}

export function layoutGraph(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions = {}
): LayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return { positions };

  const vertical = options.direction === 'vertical';
  const rankGap = options.rankGap ?? DEFAULT_RANK_GAP;
  const nodeGap = options.nodeGap ?? DEFAULT_NODE_GAP;
  const originX = options.origin?.x ?? 0;
  const originY = options.origin?.y ?? 0;

  const rank = rankNodes(nodes, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const columns = new Map<number, LayoutNode[]>();
  for (const node of nodes) {
    const r = rank.get(node.id) ?? 0;
    const column = columns.get(r);
    if (column) column.push(node);
    else columns.set(r, [node]);
  }

  // Order within a column: near the average position of the upstreams already placed. The first
  // column has no upstreams, so it keeps the order it arrived in — which is the consumer's, and
  // as good a guess as any.
  const upstreams = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const list = upstreams.get(edge.target);
    if (list) list.push(edge.source);
    else upstreams.set(edge.target, [edge.source]);
  }

  const slot = new Map<string, number>();
  const ranks = Array.from(columns.keys()).sort((a, b) => a - b);
  let along = vertical ? originY : originX;

  for (const r of ranks) {
    const column = columns.get(r) ?? [];
    if (r > 0) {
      column.sort((a, b) => barycentre(a.id, upstreams, slot) - barycentre(b.id, upstreams, slot));
    }

    // Centred on the origin's cross axis: a column of one sits opposite a column of five rather
    // than at its top corner.
    let extent = 0;
    for (const node of column) extent += (vertical ? node.width : node.height) + nodeGap;
    extent -= nodeGap;
    let across = (vertical ? originX : originY) - extent / 2;

    let thickest = 0;
    for (let i = 0; i < column.length; i++) {
      const node = column[i];
      positions.set(node.id, vertical ? { x: across, y: along } : { x: along, y: across });
      slot.set(node.id, across + (vertical ? node.width : node.height) / 2);
      across += (vertical ? node.width : node.height) + nodeGap;
      thickest = Math.max(thickest, vertical ? node.height : node.width);
    }
    along += thickest + rankGap;
  }

  return { positions };
}

function barycentre(
  id: string,
  upstreams: Map<string, string[]>,
  slot: Map<string, number>
): number {
  const list = upstreams.get(id);
  if (!list || list.length === 0) return Number.MAX_SAFE_INTEGER;
  let total = 0;
  let seen = 0;
  for (const from of list) {
    const at = slot.get(from);
    if (at === undefined) continue;
    total += at;
    seen++;
  }
  return seen === 0 ? Number.MAX_SAFE_INTEGER : total / seen;
}
