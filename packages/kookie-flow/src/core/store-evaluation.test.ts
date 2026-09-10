import { describe, it, expect } from 'vitest';
import { createFlowStore } from './store';
import type { Edge, Entity, Socket } from '../types';

/**
 * The engine is tested on its own in evaluation.test.ts. These are the HOOKS — the places where
 * a store mutation is an input change and must say so — because a hook that is missing fails
 * silently: the graph simply never re-runs after that kind of edit, and every engine test still
 * passes.
 *
 * Each test asks one question: after this mutation, is the right entity dirty?
 */

function sock(id: string, defaultValue?: unknown): Socket {
  return { id, name: id, type: 'number', defaultValue };
}

function ent(id: string, inputs: Socket[] = [], outputs: Socket[] = [], values?: Record<string, unknown>): Entity {
  return { id, type: 'default', position: { x: 0, y: 0 }, data: values ? { values } : {}, inputs, outputs };
}

function edge(source: string, sourceSocket: string, target: string, targetSocket: string): Edge {
  return { id: `${source}->${target}`, source, sourceSocket, target, targetSocket };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function chain() {
  // a -> b -> c, each with one input and one output.
  return createFlowStore({
    entities: [
      ent('a', [sock('in', 1)], [sock('out')], { in: 1 }),
      ent('b', [sock('in')], [sock('out')]),
      ent('c', [sock('in')], [sock('out')]),
    ],
    edges: [edge('a', 'out', 'b', 'in'), edge('b', 'out', 'c', 'in')],
  });
}

describe('what a store mutation tells the engine', () => {
  it('a widget write marks the entity and its downstream', () => {
    const store = createFlowStore({ entities: chain().getState().entities, edges: chain().getState().edges });
    store.getState().setWidgetValue('a', 'in', 5);
    expect(store.getState().getEvaluationStatus('a')).toBe('dirty');
    expect(store.getState().getEvaluationStatus('b')).toBe('dirty');
    expect(store.getState().getEvaluationStatus('c')).toBe('dirty');
    store.getState().disposeEvaluation();
  });

  it('a new wire marks its target; a removed wire marks the target it left', () => {
    const store = createFlowStore({
      entities: [ent('a', [], [sock('out')]), ent('b', [sock('in')])],
    });
    const e = edge('a', 'out', 'b', 'in');
    store.getState().applyEdgeChanges([{ type: 'add', edge: e }]);
    expect(store.getState().getEvaluationStatus('b')).toBe('dirty');
    store.getState().disposeEvaluation();

    const store2 = createFlowStore({
      entities: [ent('a', [], [sock('out')]), ent('b', [sock('in')])],
      edges: [e],
    });
    store2.getState().applyEdgeChanges([{ type: 'remove', id: e.id }]);
    expect(store2.getState().getEvaluationStatus('b')).toBe('dirty');
    store2.getState().disposeEvaluation();
  });

  it('setEdges diffs by id, so a sync that changed nothing marks nothing', () => {
    const store = chain();
    const same = [...store.getState().edges];
    store.getState().setEdges(same);
    expect(store.getState().getEvaluationStatus('b')).toBe('idle');
    expect(store.getState().getEvaluationStatus('c')).toBe('idle');
    store.getState().disposeEvaluation();
  });

  it('a consumer replacing data.values marks the entity — an undo or a preset', () => {
    const store = chain();
    const next = store.getState().entities.map((e) =>
      e.id === 'a' ? { ...e, data: { values: { in: 9 } } } : e
    );
    store.getState().setEntities(next);
    expect(store.getState().getEvaluationStatus('a')).toBe('dirty');
    expect(store.getState().getEvaluationStatus('c')).toBe('dirty');
    store.getState().disposeEvaluation();
  });

  it('but the echo of a local widget write does not mark again', async () => {
    // setWidgetValue marked and started a run; the consumer's echo arrives while the local
    // override is still pending. A second mark here would abort that run for no reason.
    const store = chain();
    let runs = 0;
    let aborted = 0;
    store.getState().setEvaluationHandlers(async (_id, _t, _in, ctx) => {
      runs++;
      ctx.signal.addEventListener('abort', () => { aborted++; });
      await tick();
      return { out: 1 };
    });
    store.getState().setWidgetValue('a', 'in', 5);
    await tick(); // the run for 'a' starts
    const echoed = store.getState().entities.map((e) =>
      e.id === 'a' ? { ...e, data: { values: { in: 5 } } } : e
    );
    store.getState().setEntities(echoed);
    await store.getState().evaluateDirty();
    expect(aborted).toBe(0);
    expect(runs).toBe(3); // a, b, c — once each
    store.getState().disposeEvaluation();
  });

  it('muting and unmuting marks the entity, because its value semantics changed', () => {
    const store = chain();
    store.getState().muteEntity('b');
    expect(store.getState().getEvaluationStatus('b')).toBe('dirty');
    store.getState().disposeEvaluation();
  });

  it('deleting an entity marks what it fed, and forgets the entity itself', async () => {
    const store = chain();
    store.getState().deleteElements({ entityIds: ['b'] });
    expect(store.getState().getEvaluationStatus('c')).toBe('dirty');
    await tick();
    expect(store.getState().getEvaluationRecord('b')).toBeUndefined();
    store.getState().disposeEvaluation();
  });

  it('adding entities marks them so a new node computes without being poked', () => {
    const store = createFlowStore({ entities: [] });
    store.getState().addElements({ entities: [ent('n', [sock('in', 1)])] });
    expect(store.getState().getEvaluationStatus('n')).toBe('dirty');
    store.getState().disposeEvaluation();
  });

  it('every engine change bumps evaluationVersion, which is what the renderer watches', () => {
    const store = chain();
    const before = store.getState().evaluationVersion;
    store.getState().setWidgetValue('a', 'in', 2);
    expect(store.getState().evaluationVersion).toBeGreaterThan(before);
    store.getState().disposeEvaluation();
  });
});

describe('what the engine reads through the store', () => {
  it('an unconnected input resolves the person\'s pending write before the entity\'s value', async () => {
    const store = createFlowStore({ entities: [ent('a', [sock('in', 1)], [sock('out')], { in: 1 })] });
    let seen: unknown;
    store.getState().setEvaluationHandlers((_id, _t, inputs) => { seen = inputs.in; return {}; });
    store.getState().setWidgetValue('a', 'in', 7);
    await store.getState().evaluateDirty();
    expect(seen).toBe(7);
    store.getState().disposeEvaluation();
  });

  it('a connected input resolves the upstream output through the store\'s own index', async () => {
    const store = chain();
    const seen: Record<string, unknown> = {};
    store.getState().setEvaluationHandlers((id, _t, inputs) => {
      seen[id] = inputs.in;
      return { out: `${id}:${String(inputs.in)}` };
    });
    store.getState().setWidgetValue('a', 'in', 3);
    await store.getState().evaluateDirty();
    expect(seen.b).toBe('a:3');
    expect(seen.c).toBe('b:a:3');
    expect(store.getState().getSocketValue('c', 'out')).toBe('c:b:a:3');
    store.getState().disposeEvaluation();
  });

  it('the manual mode comes from the entity type table handed to the store', async () => {
    const store = createFlowStore({
      entities: [
        ent('a', [sock('in', 1)], [sock('out')], { in: 1 }),
        { ...ent('g', [sock('in')], [sock('out')]), type: 'gate' },
      ],
      edges: [edge('a', 'out', 'g', 'in')],
    });
    const ran: string[] = [];
    store.getState().setEntityTypes({ gate: { type: 'gate', evaluation: 'manual' } });
    store.getState().setEvaluationHandlers((id) => { ran.push(id); return { out: 1 }; });
    store.getState().setWidgetValue('a', 'in', 2);
    await tick(); await tick();
    expect(ran).toEqual(['a']);
    expect(store.getState().getEvaluationStatus('g')).toBe('dirty');
    await store.getState().evaluate('g');
    expect(ran).toEqual(['a', 'g']);
    store.getState().disposeEvaluation();
  });
});
