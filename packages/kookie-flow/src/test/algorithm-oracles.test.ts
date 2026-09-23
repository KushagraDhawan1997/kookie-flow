import { expect, it } from 'vitest';
import { buildAdjacencyIndex, computeAnalysis, wouldCreateCycle } from '../core/graph';
import { layoutGraph } from '../core/layout';
import { Quadtree } from '../core/spatial';
import type { Entity, Edge } from '../types';
let seed = 7331;
const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
it('500 seeded directed graphs agree with transitive-closure cycle oracle', () => {
  for (let k = 0; k < 500; k++) {
    const n = 2 + Math.floor(rand() * 24),
      ids = Array.from({ length: n }, (_, i) => String(i));
    const reach = Array.from({ length: n }, () => Array(n).fill(false));
    const edges: Edge[] = [];
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++)
        if (rand() < 0.08) {
          reach[a][b] = true;
          edges.push({ id: `${a}/${b}`, source: String(a), target: String(b) });
        }
    for (let c = 0; c < n; c++)
      for (let a = 0; a < n; a++)
        for (let b = 0; b < n; b++) reach[a][b] ||= reach[a][c] && reach[c][b];
    const index = buildAdjacencyIndex(edges),
      analysis = computeAnalysis(ids, index);
    expect(analysis.hasCycles).toBe(ids.some((_, i) => reach[i][i]));
    expect(analysis.cycleEntityIds).toEqual(ids.filter((_, i) => reach[i][i]));
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++)
        expect(wouldCreateCycle(index, String(a), String(b))).toBe(a === b || reach[b][a]);
    if (!analysis.hasCycles) {
      const rank = new Map(analysis.topologicalOrder!.map((id, i) => [id, i]));
      for (const e of edges) expect(rank.get(e.source)!).toBeLessThan(rank.get(e.target)!);
    }
  }
});
it('100 mixed-size DAG layouts are finite, separated and flow forward', () => {
  for (let k = 0; k < 100; k++) {
    const nodes = Array.from({ length: 40 }, (_, i) => ({
      id: String(i),
      width: 20 + rand() * 500,
      height: 20 + rand() * 500,
    }));
    const edges = [];
    for (let a = 0; a < 40; a++)
      for (let b = a + 1; b < 40; b++)
        if (rand() < 0.07) edges.push({ source: String(a), target: String(b) });
    for (const direction of ['horizontal', 'vertical'] as const) {
      const { positions } = layoutGraph(nodes, edges, { direction });
      for (let a = 0; a < 40; a++)
        for (let b = a + 1; b < 40; b++) {
          const p = positions.get(String(a))!,
            q = positions.get(String(b))!;
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
          expect(
            p.x + nodes[a].width <= q.x ||
              q.x + nodes[b].width <= p.x ||
              p.y + nodes[a].height <= q.y ||
              q.y + nodes[b].height <= p.y
          ).toBe(true);
        }
      for (const e of edges) {
        const p = positions.get(e.source)!,
          q = positions.get(e.target)!;
        expect(direction === 'horizontal' ? p.x < q.x : p.y < q.y).toBe(true);
      }
    }
  }
});
it('1000 seeded spatial mutations and range queries agree with a brute-force oracle', () => {
  const nodes: Entity[] = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    type: 'frame',
    data: {},
    width: 30 + rand() * 80,
    height: 30 + rand() * 80,
    position: { x: rand() * 3000, y: rand() * 3000 },
  }));
  const tree = new Quadtree({ x: 0, y: 0, width: 1, height: 1 });
  tree.rebuild(nodes);
  for (let k = 0; k < 1000; k++) {
    const e = nodes[Math.floor(rand() * nodes.length)];
    e.position = { x: rand() * 10000 - 5000, y: rand() * 10000 - 5000 };
    tree.update(e.id, { ...e.position, width: e.width!, height: e.height! });
    const q = { x: rand() * 10000 - 5000, y: rand() * 10000 - 5000, width: 500, height: 500 };
    const expected = nodes
      .filter(
        (e) =>
          e.position.x < q.x + q.width &&
          e.position.x + e.width! > q.x &&
          e.position.y < q.y + q.height &&
          e.position.y + e.height! > q.y
      )
      .map((e) => e.id)
      .sort();
    expect(tree.queryRange(q).sort()).toEqual(expected);
    const out: string[] = [];
    const count = tree.queryRangeInto(q, out);
    expect(out.slice(0, count).sort()).toEqual(expected);
  }
});
