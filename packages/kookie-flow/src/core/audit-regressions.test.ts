import { afterEach, describe, expect, it } from 'vitest';
import { createFlowStore, type FlowStore } from './store';
import type { Entity, Edge, Socket } from '../types';
import { Evaluator } from './evaluation';
import { buildAdjacencyIndex } from './graph';
import { entityDepth, topmostEntityId } from '../utils/entity-depth';

const socket = (id: string, defaultValue?: unknown): Socket => ({
  id,
  name: id,
  type: 'number',
  defaultValue,
});
const node = (id: string, extra: Partial<Entity> = {}): Entity => ({
  id,
  type: 'default',
  position: { x: 0, y: 0 },
  data: {},
  inputs: [socket('in', 0)],
  outputs: [socket('out')],
  ...extra,
});
const edge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
  sourceSocket: 'out',
  targetSocket: 'in',
});
const stores: FlowStore[] = [];
function store(entities: Entity[], edges: Edge[] = []) {
  const s = createFlowStore({ entities, edges });
  stores.push(s);
  return s;
}
afterEach(() => {
  for (const s of stores) s.getState().disposeEvaluation();
  stores.length = 0;
});

describe('deep audit: independent regression probes', () => {
  it('rewiring sockets invalidates both endpoints while an unchanged edge echo does no work', async () => {
    const s = store(
      [
        node('source', { outputs: [socket('out'), socket('other')] }),
        node('old'),
        node('next', { inputs: [socket('in', 0), socket('alternate', 4)] }),
      ],
      [edge('wire', 'source', 'old')]
    );
    const called: string[] = [];
    s.getState().setEvaluationHandlers((id, _, values) => {
      called.push(id);
      return id === 'source'
        ? { out: 1, other: 9 }
        : { out: Number(values.in) + Number(values.alternate ?? 0) };
    });
    await s.getState().evaluateAll();
    called.length = 0;
    s.getState().setEdges([{ ...s.getState().edges[0] }]);
    await s.getState().evaluateDirty();
    expect(called).toEqual([]);
    s.getState().setEdges([
      {
        id: 'wire',
        source: 'source',
        sourceSocket: 'other',
        target: 'next',
        targetSocket: 'alternate',
      },
    ]);
    await s.getState().evaluateDirty();
    expect(s.getState().getSocketValue('old', 'out')).toBe(0);
    expect(s.getState().getSocketValue('next', 'out')).toBe(9);
    expect(called.sort()).toEqual(['next', 'old']);
  });

  it('bypassing a node with no incoming wire restores the downstream default', async () => {
    const s = store(
      [node('source', { inputs: [] }), node('target')],
      [edge('wire', 'source', 'target')]
    );
    s.getState().setEvaluationHandlers((id, _, values) => ({
      out: id === 'source' ? 99 : values.in,
    }));
    await s.getState().evaluateAll();
    s.getState().bypassEntity('source');
    await s.getState().evaluateDirty();
    expect(s.getState().getSocketValue('target', 'out')).toBe(0);
    expect(s.getState().getSocketValue('source', 'out')).toBeUndefined();
  });

  it('A18: rejects a parent chain that is already cyclic without hanging', () => {
    const s = store([
      node('a', { type: 'frame', parentId: 'b' }),
      node('b', { type: 'frame', parentId: 'a' }),
      node('c'),
    ]);
    expect(s.getState().setEntityParent('c', 'a')).toBe(false);
    expect(s.getState().entityMap.get('c')?.parentId).toBeUndefined();
  });
  it('A01: replacing the source on a stable edge id recomputes its target', async () => {
    const s = store([node('a'), node('b'), node('c')], [edge('wire', 'a', 'c')]);
    s.getState().setEvaluationHandlers((id, _, inputs) => ({
      out: id === 'a' ? 1 : id === 'b' ? 9 : inputs.in,
    }));
    await s.getState().evaluateAll();
    expect(s.getState().getSocketValue('c', 'out')).toBe(1);
    s.getState().setEdges([edge('wire', 'b', 'c')]);
    await s.getState().evaluateDirty();
    expect(s.getState().getSocketValue('c', 'out')).toBe(9);
  });

  it('A02: bypass cancels a removed entity and recomputes the newly wired target', async () => {
    const s = store(
      [node('a'), node('b'), node('c')],
      [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')]
    );
    s.getState().setEvaluationHandlers((id, _, inputs) => ({
      out: id === 'a' ? 1 : Number(inputs.in) + 1,
    }));
    await s.getState().evaluateAll();
    expect(s.getState().getSocketValue('c', 'out')).toBe(3);
    s.getState().bypassEntity('b');
    await s.getState().evaluateDirty();
    expect(s.getState().getSocketValue('c', 'out')).toBe(2);
  });

  it('A03: bypass aborts an in-flight run and releases its output', async () => {
    const s = store(
      [node('a'), node('b'), node('c')],
      [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')]
    );
    let signal: AbortSignal | undefined;
    let resolve!: (v: Record<string, unknown>) => void;
    s.getState().setEvaluationHandlers((id, _, __, ctx) =>
      id === 'b'
        ? new Promise((r) => {
            signal = ctx.signal;
            resolve = r;
          })
        : {}
    );
    const pending = s.getState().evaluate('b');
    s.getState().bypassEntity('b');
    const wasAborted = signal?.aborted;
    resolve({ out: 42 });
    await pending;
    expect({ wasAborted, output: s.getState().getSocketValue('b', 'out') }).toEqual({
      wasAborted: true,
      output: undefined,
    });
  });

  it('A04: insert-on-edge evaluates the inserted node and its downstream', async () => {
    const s = store([node('a'), node('c')], [edge('ac', 'a', 'c')]);
    s.getState().setEvaluationHandlers((id, _, inputs) => ({
      out: id === 'a' ? 1 : Number(inputs.in) + 1,
    }));
    await s.getState().evaluateAll();
    s.getState().insertOnEdge('ac', node('b'));
    await s.getState().evaluateDirty();
    expect(s.getState().getSocketValue('c', 'out')).toBe(3);
  });

  it('A05: deleting a collapsed frame makes surviving children visible and hit-testable', () => {
    const s = store([
      node('frame', { type: 'frame', collapsed: true }),
      node('child', { parentId: 'frame', position: { x: 100, y: 100 } }),
    ]);
    expect(s.getState().hiddenEntityIds.has('child')).toBe(true);
    s.getState().deleteElements({ entityIds: ['frame'] });
    expect(s.getState().entityMap.has('child')).toBe(true);
    expect({
      hidden: s.getState().hiddenEntityIds.has('child'),
      hit: s.getState().quadtree.queryPoint(110, 110).includes('child'),
    }).toEqual({ hidden: false, hit: true });
  });

  it('A06: a nested subtree added in one batch is hidden under a collapsed ancestor', () => {
    const s = store([node('outer', { type: 'frame', collapsed: true })]);
    s.getState().addElements({
      entities: [
        node('inner', { type: 'frame', parentId: 'outer' }),
        node('child', { parentId: 'inner' }),
      ],
    });
    expect(s.getState().hiddenEntityIds.has('child')).toBe(true);
  });

  it('A07: deleting and recreating an id does not resurrect its old mute state', () => {
    const s = store([node('a')]);
    s.getState().muteEntity('a');
    s.getState().deleteElements({ entityIds: ['a'] });
    s.getState().addElements({ entities: [node('a')] });
    expect(s.getState().isMuted('a')).toBe(false);
  });

  it('A08: evaluateAll skips content-only entity kinds', async () => {
    const s = store([
      node('compute'),
      node('picture', { type: 'image', data: { src: 'test.png' } }),
      node('note', { type: 'text', data: { content: 'note' } }),
    ]);
    const called: string[] = [];
    s.getState().setEvaluationHandlers((id) => {
      called.push(id);
      return {};
    });
    await s.getState().evaluateAll();
    expect(called).toEqual(['compute']);
  });

  it('A09: forgetting one id preserves outputs of a distinct id containing a colon', () => {
    const entities = [node('a'), node('a:b')];
    const map = new Map(entities.map((n) => [n.id, n]));
    const e = new Evaluator({
      getEntity: (id) => map.get(id),
      entityIds: () => map.keys(),
      index: () => buildAdjacencyIndex([]),
      isMuted: () => false,
      evaluationMode: () => 'reactive',
      readInputValue: () => undefined,
      onChange: () => {},
    });
    e.setSocketValue('a:b', 'out', 7);
    e.forget(['a']);
    expect(e.getSocketValue('a:b', 'out')).toBe(7);
    e.dispose();
  });

  it('A10: a new type default changes resolved inputs and recomputes the output', async () => {
    const s = store([node('a', { type: 'typed', inputs: undefined, outputs: undefined })]);
    s.getState().setEntityTypes({
      typed: { type: 'typed', inputs: [socket('in', 1)], outputs: [socket('out')] },
    });
    s.getState().setEvaluationHandlers((_, __, inputs) => ({ out: inputs.in }));
    await s.getState().evaluateAll();
    s.getState().setEntityTypes({
      typed: { type: 'typed', inputs: [socket('in', 9)], outputs: [socket('out')] },
    });
    expect(s.getState().entityMap.get('a')?.inputs?.[0].defaultValue).toBe(9);
    await s.getState().evaluateDirty();
    expect(s.getState().getSocketValue('a', 'out')).toBe(9);
  });

  it('A11: each colon-containing entity/socket pair has its own output value', () => {
    const s = store([node('a', { outputs: [socket('b:out')] }), node('a:b')]);
    s.getState().setSocketValue('a', 'b:out', 1);
    s.getState().setSocketValue('a:b', 'out', 2);
    expect(s.getState().getSocketValue('a', 'b:out')).toBe(1);
  });

  it('A12: inserting a registered entity type resolves its sockets', () => {
    const s = store([node('a'), node('c')], [edge('ac', 'a', 'c')]);
    s.getState().setEntityTypes({
      typed: { type: 'typed', inputs: [socket('in')], outputs: [socket('out')] },
    });
    s.getState().insertOnEdge(
      'ac',
      node('b', { type: 'typed', inputs: undefined, outputs: undefined })
    );
    expect(s.getState().entityMap.get('b')?.inputs?.[0].id).toBe('in');
    expect(s.getState().edges.find((e) => e.target === 'b')?.targetSocket).toBe('in');
  });

  it('A15: the hit-test winner matches the selected node rendered in front', () => {
    const s = store([node('selected'), node('back')]);
    s.getState().selectEntities(['selected']);
    const { stackOrder, selectedEntityIds } = s.getState();
    expect(entityDepth('selected', stackOrder, selectedEntityIds)).toBeGreaterThan(
      entityDepth('back', stackOrder, selectedEntityIds)
    );
    expect(topmostEntityId(['selected', 'back'], stackOrder, selectedEntityIds)).toBe('selected');
  });
});
