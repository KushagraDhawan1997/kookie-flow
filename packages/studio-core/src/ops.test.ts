import { describe, expect, it } from 'vitest';
import type { Edge } from '@kushagradhawan/kookie-flow';
import { compileOps, replacedWires } from './ops';
import { registry } from './nodes';
import { emptyDocument, describeGraph, nextNodeId } from './document';

const apply = (ops: Parameters<typeof compileOps>[1], start = emptyDocument()) =>
  compileOps(start, ops, registry);

describe('compileOps', () => {
  it('adds nodes with the next short id and wires them', () => {
    const r = apply([
      { op: 'add_node', type: 'source/number', values: { value: 2 } },
      { op: 'add_node', type: 'source/number', values: { value: 3 } },
      { op: 'add_node', type: 'math/add' },
      { op: 'connect', from: 'n1.out', to: 'n3.a' },
      { op: 'connect', from: 'n2.out', to: 'n3.b' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.created).toEqual(['n1', 'n2', 'n3']);
    expect(r.entityChanges.filter((c) => c.type === 'add')).toHaveLength(3);
    expect(r.edgeChanges.map((c) => c.type)).toEqual(['add', 'add']);
  });

  it('refuses an unknown type, a missing socket and a type mismatch', () => {
    const r = apply([
      { op: 'add_node', type: 'nope/nothing' },
      { op: 'add_node', type: 'source/text' },
      { op: 'add_node', type: 'math/add' },
      { op: 'connect', from: 'n1.out', to: 'n2.a' },
      { op: 'connect', from: 'n1.nope', to: 'n2.a' },
    ]);
    expect(r.errors.map((e) => e.message)).toEqual([
      'unknown node type "nope/nothing"',
      'cannot connect text to float',
      '"n1" has no output "nope"',
    ]);
  });

  it('replaces the wire already in an input and refuses a loop', () => {
    const first = apply([
      { op: 'add_node', type: 'source/number' },
      { op: 'add_node', type: 'source/number' },
      { op: 'add_node', type: 'math/add' },
      { op: 'add_node', type: 'math/add' },
      { op: 'connect', from: 'n1.out', to: 'n3.a' },
      { op: 'connect', from: 'n2.out', to: 'n3.a' },
      { op: 'connect', from: 'n3.out', to: 'n4.a' },
      { op: 'connect', from: 'n4.out', to: 'n3.b' },
    ]);
    expect(first.edgeChanges.map((c) => c.type)).toEqual(['add', 'remove', 'add', 'add']);
    expect(first.errors.map((e) => e.message)).toEqual(['that wire would make a loop']);
  });

  it('merges values into the whole bag and removes a node with its wires', () => {
    const r = apply([
      { op: 'add_node', type: 'math/remap', values: { inMax: 10 } },
      { op: 'set_values', id: 'n1', values: { outMax: 5 } },
      { op: 'add_node', type: 'source/number' },
      { op: 'connect', from: 'n2.out', to: 'n1.value' },
      { op: 'remove_node', id: 'n2' },
    ]);
    expect(r.errors).toEqual([]);
    const data = r.entityChanges.find((c) => c.type === 'data');
    expect(data && data.type === 'data' ? data.data : null).toEqual({ values: { inMax: 10, outMax: 5 } });
    expect(r.edgeChanges.map((c) => c.type)).toEqual(['add', 'remove']);
    expect(r.entityChanges.at(-1)).toEqual({ type: 'remove', id: 'n2' });
  });
});

describe('replacedWires', () => {
  const edges: Edge[] = [
    { id: 'e1', source: 'n1', sourceSocket: 'out', target: 'n3', targetSocket: 'a' },
    { id: 'e2', source: 'n2', sourceSocket: 'out', target: 'n3', targetSocket: 'b' },
    { id: 'e3', source: 'n1', sourceSocket: 'out', target: 'n4', targetSocket: 'a' },
  ];

  it('names only the wires landing on that one input', () => {
    expect(replacedWires(edges, 'n3', 'a')).toEqual(['e1']);
    expect(replacedWires(edges, 'n3', 'b')).toEqual(['e2']);
    expect(replacedWires(edges, 'n3', 'c')).toEqual([]);
    expect(replacedWires(edges, 'n5', 'a')).toEqual([]);
  });

  it('replaces nothing when the drag has no target yet', () => {
    expect(replacedWires(edges, null, 'a')).toEqual([]);
    expect(replacedWires(edges, 'n3', null)).toEqual([]);
  });
});

describe('document', () => {
  it('numbers ids past the highest existing one', () => {
    expect(nextNodeId([])).toBe('n1');
    expect(nextNodeId([{ id: 'n4', type: 'x', position: { x: 0, y: 0 }, data: {} }, { id: 'abc', type: 'x', position: { x: 0, y: 0 }, data: {} }])).toBe('n5');
  });

  it('describes a graph compactly, defaults left out unless focused', () => {
    const doc = emptyDocument();
    const r = compileOps(doc, [
      { op: 'add_node', type: 'source/number', values: { value: 2 }, label: 'Width' },
      { op: 'add_node', type: 'math/add' },
      { op: 'connect', from: 'n1.out', to: 'n2.a' },
    ], registry);
    const entities = r.entityChanges.flatMap((c) => (c.type === 'add' ? [c.entity] : []));
    const edges = r.edgeChanges.flatMap((c) => (c.type === 'add' ? [c.edge] : []));
    expect(describeGraph({ entities, edges }, registry)).toBe(
      'n1 source/number "Width" value=2\nn2 math/add\nn1.out -> n2.a'
    );
    expect(describeGraph({ entities, edges }, registry, ['n2'])).toContain('n2 math/add a=0 b=0');
  });
});
