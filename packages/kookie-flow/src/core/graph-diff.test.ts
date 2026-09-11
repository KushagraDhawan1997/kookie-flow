import { describe, it, expect } from 'vitest';
import { diffGraph } from './graph-diff';
import type { Entity, Edge } from '../types';

const node = (id: string, parentId?: string): Entity => ({ id, type: 'n', position: { x: 0, y: 0 }, data: {}, parentId });
const wire = (id: string, source: string, target: string): Edge => ({ id, source, target });

describe('diffGraph', () => {
  it('a collapse is a frame added, children re-parented, crossing wires swapped for port wires', () => {
    const before = [node('a'), node('b'), node('c')];
    const after = [node('a', 'g'), node('b', 'g'), node('c'), node('g')];
    const { entityChanges, edgeChanges } = diffGraph(
      before, after,
      [wire('e1', 'b', 'c')],
      [wire('p1', 'g', 'c')]
    );
    expect(entityChanges).toEqual([
      { type: 'parent', id: 'a', parentId: 'g' },
      { type: 'parent', id: 'b', parentId: 'g' },
      { type: 'add', entity: after[3] },
    ]);
    expect(edgeChanges).toEqual([
      { type: 'remove', id: 'e1' },
      { type: 'add', edge: { id: 'p1', source: 'g', target: 'c' } },
    ]);
  });

  it('an expand removes the frame and clears the parent with null, which is what a change carries', () => {
    const { entityChanges } = diffGraph([node('a', 'g'), node('g')], [node('a')], [], []);
    expect(entityChanges).toEqual([
      { type: 'remove', id: 'g' },
      { type: 'parent', id: 'a', parentId: null },
    ]);
  });

  it('an unchanged graph reports nothing', () => {
    const entities = [node('a'), node('b', 'a')];
    const edges = [wire('e', 'a', 'b')];
    expect(diffGraph(entities, entities.slice(), edges, edges.slice())).toEqual({ entityChanges: [], edgeChanges: [] });
  });
});
