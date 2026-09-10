import { describe, it, expect } from 'vitest';
import { layoutGraph, rankNodes, type LayoutEdge, type LayoutNode } from './layout';

/**
 * Tidying a graph. The claims worth pinning are the ones a person would notice immediately if
 * they broke: the flow points one way, nothing overlaps, and a graph with a loop in it still
 * comes out laid out rather than hanging.
 */

const node = (id: string, width = 200, height = 100): LayoutNode => ({ id, width, height });
const edge = (source: string, target: string): LayoutEdge => ({ source, target });

describe('which column a node goes in', () => {
  it('a chain marches one column at a time', () => {
    const rank = rankNodes([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c')]);
    expect([rank.get('a'), rank.get('b'), rank.get('c')]).toEqual([0, 1, 2]);
  });

  it('a node sits behind its DEEPEST upstream, not its first', () => {
    // d is fed by a (column 0) and by c (column 2). It belongs at 3, or its wire from c points
    // backwards.
    const rank = rankNodes(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('b', 'c'), edge('a', 'd'), edge('c', 'd')]
    );
    expect(rank.get('d')).toBe(3);
  });

  it('two roots both start at the left', () => {
    const rank = rankNodes([node('a'), node('b'), node('c')], [edge('a', 'c'), edge('b', 'c')]);
    expect(rank.get('a')).toBe(0);
    expect(rank.get('b')).toBe(0);
    expect(rank.get('c')).toBe(1);
  });

  it('an unconnected node is a root of its own', () => {
    const rank = rankNodes([node('a'), node('lonely')], []);
    expect(rank.get('lonely')).toBe(0);
  });

  it('a cycle is laid out rather than hung on', () => {
    const rank = rankNodes([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);
    expect(rank.get('a')).toBeTypeOf('number');
    expect(rank.get('b')).toBeTypeOf('number');
  });

  it('and a node feeding itself is not an upstream of itself', () => {
    const rank = rankNodes([node('a')], [edge('a', 'a')]);
    expect(rank.get('a')).toBe(0);
  });
});

describe('where the nodes land', () => {
  it('the flow runs left to right', () => {
    const { positions } = layoutGraph([node('a'), node('b')], [edge('a', 'b')]);
    expect(positions.get('b')!.x).toBeGreaterThan(positions.get('a')!.x);
    expect(positions.get('a')!.y).toBe(positions.get('b')!.y);
  });

  it('or top to bottom, when asked', () => {
    const { positions } = layoutGraph([node('a'), node('b')], [edge('a', 'b')], {
      direction: 'vertical',
    });
    expect(positions.get('b')!.y).toBeGreaterThan(positions.get('a')!.y);
    expect(positions.get('a')!.x).toBe(positions.get('b')!.x);
  });

  it('nodes in a column never overlap, whatever their heights', () => {
    const nodes = [node('a', 200, 300), node('b', 200, 80), node('c', 200, 140)];
    const { positions } = layoutGraph(nodes, [], { nodeGap: 20 });
    const boxes = nodes
      .map((n) => ({ top: positions.get(n.id)!.y, bottom: positions.get(n.id)!.y + n.height }))
      .sort((p, q) => p.top - q.top);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i - 1].bottom);
    }
  });

  it('columns clear the widest node in the one before, so nothing overlaps sideways', () => {
    const nodes = [node('wide', 400, 100), node('narrow', 100, 100)];
    const { positions } = layoutGraph(nodes, [edge('wide', 'narrow')], { rankGap: 50 });
    expect(positions.get('narrow')!.x).toBe(positions.get('wide')!.x + 400 + 50);
  });

  it('a column of one sits opposite a column of many, not at its top corner', () => {
    const nodes = [node('a'), node('b'), node('one')];
    const { positions } = layoutGraph(nodes, [edge('a', 'one'), edge('b', 'one')], { nodeGap: 40 });
    const aMid = positions.get('a')!.y + 50;
    const bMid = positions.get('b')!.y + 50;
    const oneMid = positions.get('one')!.y + 50;
    expect(oneMid).toBeCloseTo((aMid + bMid) / 2, 5);
  });

  it('the origin is where the first column starts', () => {
    const { positions } = layoutGraph([node('a')], [], { origin: { x: 500, y: 300 } });
    expect(positions.get('a')!.x).toBe(500);
  });

  it('an empty graph lays out to nothing rather than throwing', () => {
    expect(layoutGraph([], []).positions.size).toBe(0);
  });

  it('and an edge naming a node that is not here is ignored', () => {
    const { positions } = layoutGraph([node('a')], [edge('a', 'ghost'), edge('ghost', 'a')]);
    expect(positions.size).toBe(1);
  });
});

describe('crossings', () => {
  it('a column follows the order of what feeds it', () => {
    // a and b feed x and y respectively. Laid out naively by insertion order, y would come before
    // x and the two wires would cross.
    const nodes = [node('a'), node('b'), node('y'), node('x')];
    const { positions } = layoutGraph(nodes, [edge('a', 'x'), edge('b', 'y')]);
    const aFirst = positions.get('a')!.y < positions.get('b')!.y;
    const xFirst = positions.get('x')!.y < positions.get('y')!.y;
    expect(xFirst).toBe(aFirst);
  });
});
