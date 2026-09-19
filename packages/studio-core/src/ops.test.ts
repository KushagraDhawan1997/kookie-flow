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
      '"n1" has no output "nope"; its outputs are "out"',
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

describe('arrange', () => {
  const chain: Parameters<typeof compileOps>[1] = [
    { op: 'add_node', type: 'math/add', position: { x: 900, y: 40 } },
    { op: 'add_node', type: 'source/number', position: { x: 300, y: 700 } },
    { op: 'add_node', type: 'source/number', position: { x: 520, y: -80 } },
    { op: 'connect', from: 'n2.out', to: 'n1.a' },
    { op: 'connect', from: 'n3.out', to: 'n1.b' },
  ];
  const placedAt = (r: ReturnType<typeof compileOps>) =>
    new Map(r.entityChanges.flatMap((c) => (c.type === 'add' ? [[c.entity.id, c.entity.position] as const] : [])));

  it('puts a node one column right of what feeds it, with nothing overlapping', () => {
    const r = apply([...chain, { op: 'arrange' }]);
    expect(r.errors).toEqual([]);
    const at = placedAt(r);
    const [sum, a, b] = [at.get('n1'), at.get('n2'), at.get('n3')];
    if (!sum || !a || !b) throw new Error('a node was not placed');
    expect(a.x).toBe(b.x);
    expect(sum.x).toBeGreaterThan(a.x);
    expect(Math.abs(a.y - b.y)).toBeGreaterThan(60);
    // Nodes the batch added land in place: no second move for the canvas to animate or undo.
    expect(r.entityChanges.some((c) => c.type === 'position')).toBe(false);
  });

  it('gives the same graph the same picture wherever its nodes started', () => {
    const scattered = chain.map((op) => (op.op === 'add_node' ? { ...op, position: { x: 0, y: 0 } } : op));
    const one = placedAt(apply([...chain, { op: 'arrange' }]));
    const two = placedAt(apply([...scattered, { op: 'arrange' }]));
    const shape = (at: ReturnType<typeof placedAt>) => {
      const origin = at.get('n2');
      if (!origin) throw new Error('n2 was not placed');
      return [...at].map(([id, p]) => [id, p.x - origin.x, p.y - origin.y]);
    };
    expect(shape(one)).toEqual(shape(two));
  });

  it('keeps the block where it was, moves only the ids asked for, and uses real sizes when given', () => {
    const built = apply(chain);
    const doc = { ...emptyDocument(), entities: built.entityChanges.flatMap((c) => (c.type === 'add' ? [c.entity] : [])), edges: built.edgeChanges.flatMap((c) => (c.type === 'add' ? [c.edge] : [])) };

    const whole = compileOps(doc, [{ op: 'arrange' }], registry);
    const moved = new Map(doc.entities.map((e) => [e.id, e.position]));
    for (const c of whole.entityChanges) if (c.type === 'position') moved.set(c.id, c.position);
    expect(Math.min(...[...moved.values()].map((p) => p.x))).toBe(300);
    expect(Math.min(...[...moved.values()].map((p) => p.y))).toBe(-80);

    const some = compileOps(doc, [{ op: 'arrange', ids: ['n2', 'n3'] }], registry);
    expect(some.entityChanges.every((c) => c.type === 'position' && c.id !== 'n1')).toBe(true);

    const tall = compileOps(doc, [{ op: 'arrange' }], registry, { sizeOf: () => ({ width: 300, height: 1000 }) });
    const ys = tall.entityChanges.flatMap((c) => (c.type === 'position' && c.id !== 'n1' ? [c.position.y] : []));
    expect(Math.abs((ys[0] ?? 0) - (ys[1] ?? 0))).toBeGreaterThanOrEqual(1000);

    expect(compileOps(doc, [{ op: 'arrange', ids: ['nope'] }], registry).errors).toHaveLength(1);
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
    // A wired input names its wire rather than a stored value it does not use.
    expect(describeGraph({ entities, edges }, registry, ['n2'])).toContain('n2 math/add a<-n1.out b=0');
  });
});
