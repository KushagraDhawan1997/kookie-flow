import { afterEach, describe, expect, it } from 'vitest';
import { createFlowStore } from './store';
import { computeCollapseToSubgraph } from './graph';
import type { Entity, Edge } from '../types/index';

const stores: ReturnType<typeof createFlowStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.getState().disposeEvaluation();
});
function node(id: string, value = 1, type = 'default'): Entity {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {},
    inputs: [{ id: 'in', name: 'In', type: 'number', defaultValue: value }],
    outputs: [{ id: 'out', name: 'Out', type: 'number' }],
  };
}
function wire(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, sourceSocket: 'out', target, targetSocket: 'in' };
}
function storeFor(entities: Entity[], edges: Edge[] = []) {
  const store = createFlowStore({ entities, edges });
  stores.push(store);
  store.getState().setEvaluationHandlers((_id, type, inputs) => ({
    out: Number(inputs.in) * (type === 'double' ? 2 : 1),
  }));
  return store;
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('evaluation across store mutation paths', () => {
  it('data.values changes through setEntities correctly propagate', async () => {
    const a = node('a', 1);
    const store = storeFor([a, node('b')], [wire('a', 'b')]);
    await store.getState().evaluateAll();
    store.getState().setEntities([{ ...a, data: { values: { in: 9 } } }, node('b')]);
    await tick();
    expect(store.getState().getSocketValue('b', 'out')).toBe(9);
  });
  it('addElements correctly evaluates a new node', async () => {
    const store = storeFor([]);
    store.getState().addElements({ entities: [node('a', 4)] });
    await tick();
    expect(store.getState().getSocketValue('a', 'out')).toBe(4);
  });
  it('a muted reactive entity passes through changed inputs', async () => {
    const store = storeFor(
      [node('a', 7), node('gate'), node('b')],
      [wire('a', 'gate'), wire('gate', 'b')]
    );
    await store.getState().evaluateAll();
    store.getState().muteEntity('gate');
    store.getState().setWidgetValue('a', 'in', 13);
    await tick();
    expect(store.getState().getSocketValue('b', 'out')).toBe(13);
  });
  it('re-evaluates an unconnected input when controlled entities replace its default', async () => {
    const a = node('a', 1);
    const store = storeFor([a]);
    await store.getState().evaluateAll();
    expect(store.getState().getSocketValue('a', 'out')).toBe(1);
    store.getState().setEntities([{ ...a, inputs: node('a', 9).inputs }]);
    await tick();
    expect(store.getState().getSocketValue('a', 'out')).toBe(9);
  });
  it('re-evaluates when changing an entity type resolves different type-defined inputs', async () => {
    const a: Entity = { id: 'a', type: 'single', position: { x: 0, y: 0 }, data: {} };
    const store = storeFor([a]);
    store.getState().setEntityTypes({
      single: {
        type: 'single',
        inputs: node('template', 3).inputs,
        outputs: node('template').outputs,
      },
      double: {
        type: 'double',
        inputs: node('template', 5).inputs,
        outputs: node('template').outputs,
      },
    });
    await store.getState().evaluateAll();
    expect(store.getState().getSocketValue('a', 'out')).toBe(3);
    store.getState().setEntities([{ ...a, type: 'double' }]);
    await tick();
    expect(store.getState().entityMap.get('a')?.inputs?.[0].defaultValue).toBe(5);
    expect(store.getState().getSocketValue('a', 'out')).toBe(10);
  });
  it('forgets removed compound-node outputs on expand', () => {
    const a = node('a');
    const store = storeFor([a]);
    store.getState().collapseToSubgraph(['a'], 'group');
    const retainedOutput = new Uint8Array(1024);
    store.getState().setSocketValue('group', 'out', retainedOutput);
    // The documented unfold leaves childEntities empty because those children never left.
    store.getState().expandSubgraph('group', [], [], { inputs: [], outputs: [] });
    expect(store.getState().entityMap.has('group')).toBe(false);
    expect(store.getState().getSocketValue('group', 'out')).toBeUndefined();
  });
  it('new nodes added through applyEntityChanges are evaluated', async () => {
    const store = storeFor([]);
    store.getState().applyEntityChanges([{ type: 'add', entity: node('a', 4) }]);
    await tick();
    expect(store.getState().getSocketValue('a', 'out')).toBe(4);
  });
  it('input edits through applyEntityChanges re-evaluate', async () => {
    const store = storeFor([node('a', 1)]);
    await store.getState().evaluateAll();
    store.getState().applyEntityChanges([{ type: 'data', id: 'a', data: { values: { in: 9 } } }]);
    await tick();
    expect(store.getState().getSocketValue('a', 'out')).toBe(9);
  });
  it('a folded frame is evaluated and forwards the result its application supplies', async () => {
    const store = storeFor(
      [node('a', 3), node('b', 1, 'double'), node('c')],
      [wire('a', 'b'), wire('b', 'c')]
    );
    const calls: string[] = [];
    store.getState().setEvaluationHandlers((id, type, inputs) => {
      calls.push(id);
      return type === 'frame'
        ? { 'gout-0': Number(inputs['gin-0']) * 2 }
        : { out: Number(inputs.in) * (type === 'double' ? 2 : 1) };
    });
    await store.getState().evaluateAll();
    expect(store.getState().getSocketValue('c', 'out')).toBe(6);
    store.getState().collapseToSubgraph(['b'], 'group');
    calls.length = 0;
    store.getState().setWidgetValue('a', 'in', 4);
    await tick();
    // The retained, disconnected b also updates after losing its input; the folded chain orders
    // the app's frame evaluation after a and before c.
    expect(calls.filter((id) => id !== 'b')).toEqual(['a', 'group', 'c']);
    expect(store.getState().getSocketValue('c', 'out')).toBe(8);
  });
  it('re-evaluates restored input connections after the documented unfold sequence', async () => {
    const store = storeFor(
      [node('a', 3), node('b', 1, 'double'), node('c')],
      [wire('a', 'b'), wire('b', 'c')]
    );
    store
      .getState()
      .setEvaluationHandlers((_id, type, inputs) =>
        type === 'frame'
          ? { 'gout-0': Number(inputs['gin-0']) * 2 }
          : { out: Number(inputs.in) * (type === 'double' ? 2 : 1) }
      );
    await store.getState().evaluateAll();
    const before = store.getState();
    const plan = computeCollapseToSubgraph(['b'], 'group', before.entities, before.adjacencyIndex);
    const toMapping = (port: {
      id: string;
      originalEntityId: string;
      originalSocketId: string;
    }) => ({
      framePortId: port.id,
      originalEntityId: port.originalEntityId,
      originalSocketId: port.originalSocketId,
    });
    store.getState().collapseToSubgraph(['b'], 'group');
    store.getState().setWidgetValue('a', 'in', 4);
    await tick();
    expect(store.getState().getSocketValue('c', 'out')).toBe(8);
    store.getState().expandSubgraph('group', [], [], {
      inputs: plan.frameInputs.map(toMapping),
      outputs: plan.frameOutputs.map(toMapping),
    });
    await tick();
    expect(store.getState().entities.map((entity) => entity.id)).toEqual(['a', 'b', 'c']);
    expect(store.getState().getSocketValue('b', 'out')).toBe(8);
  });

  it.each(['setEntities', 'applyEntityChanges'] as const)(
    '%s preserves an in-flight run when its pending widget value is echoed',
    async (method) => {
      const a = { ...node('a'), data: { values: { in: 1 } } };
      const store = storeFor([a]);
      let runs = 0;
      let signal: AbortSignal | undefined;
      let finish: (() => void) | undefined;
      store.getState().setEvaluationHandlers(async (_id, _type, inputs, ctx) => {
        runs++;
        signal = ctx.signal;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { out: inputs.in };
      });
      store.getState().setWidgetValue('a', 'in', 7);
      await tick();
      if (method === 'setEntities') {
        store.getState().setEntities([{ ...a, data: { values: { in: 7 } } }]);
      } else {
        store
          .getState()
          .applyEntityChanges([{ type: 'data', id: 'a', data: { values: { in: 7 } } }]);
      }
      await tick();
      expect(runs).toBe(1);
      expect(signal?.aborted).toBe(false);
      expect(store.getState().widgetValues.size).toBe(0);
      finish?.();
      await store.getState().evaluateDirty();
      expect(store.getState().getSocketValue('a', 'out')).toBe(7);
    }
  );

  it('does not evaluate movement, dimensions or labels through either mutation API', async () => {
    const a = node('a');
    const store = storeFor([a]);
    let runs = 0;
    store.getState().setEvaluationHandlers(() => {
      runs++;
      return { out: 1 };
    });
    await store.getState().evaluateAll();
    store
      .getState()
      .setEntities([{ ...a, position: { x: 20, y: 10 }, data: { label: 'Renamed' } }]);
    store.getState().applyEntityChanges([
      { type: 'data', id: 'a', data: { label: 'Again' } },
      { type: 'dimensions', id: 'a', dimensions: { width: 200, height: 100 } },
      { type: 'position', id: 'a', position: { x: 30, y: 10 } },
    ]);
    await tick();
    expect(runs).toBe(1);
  });

  it('re-evaluates an input whose frame output was removed without a port mapping', async () => {
    const store = storeFor(
      [node('group', 1, 'frame'), node('target', 9)],
      [wire('group', 'target')]
    );
    await store.getState().evaluateAll();
    expect(store.getState().getSocketValue('target', 'out')).toBe(1);
    store.getState().expandSubgraph('group', [], [], { inputs: [], outputs: [] });
    await tick();
    expect(store.getState().getSocketValue('target', 'out')).toBe(9);
  });

  it('resolves and evaluates restored nodes and their internal wires after expansion', async () => {
    const store = storeFor([node('group', 1, 'frame')]);
    store.getState().setEntityTypes({
      typed: {
        type: 'typed',
        inputs: node('template', 5).inputs,
        outputs: node('template').outputs,
      },
    });
    const restored = ['x', 'y'].map((id) => ({
      id,
      type: 'typed',
      position: { x: 0, y: 0 },
      data: {},
    }));
    store
      .getState()
      .expandSubgraph('group', restored, [wire('x', 'y')], { inputs: [], outputs: [] });
    await tick();
    expect(store.getState().entityMap.get('x')?.inputs?.[0].defaultValue).toBe(5);
    expect(store.getState().getSocketValue('x', 'out')).toBe(5);
    expect(store.getState().getSocketValue('y', 'out')).toBe(5);
  });

  it('aborts a removed group run and discards results that arrive after expansion', async () => {
    const store = storeFor([node('group', 1, 'frame')]);
    let signal: AbortSignal | undefined;
    let finish: (() => void) | undefined;
    store.getState().setEvaluationHandlers(async (_id, _type, _inputs, ctx) => {
      signal = ctx.signal;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { out: new Uint8Array(1024) };
    });
    const running = store.getState().evaluate('group');
    expect(store.getState().getEvaluationStatus('group')).toBe('running');
    store.getState().expandSubgraph('group', [], [], { inputs: [], outputs: [] });
    expect(signal?.aborted).toBe(true);
    expect(store.getState().getEvaluationRecord('group')).toBeUndefined();
    finish?.();
    await running;
    expect(store.getState().getSocketValue('group', 'out')).toBeUndefined();
    expect(store.getState().getEvaluationRecord('group')).toBeUndefined();
  });

  it('clears mute and collapse state before a removed group id is reused', async () => {
    const store = storeFor([{ ...node('group', 1, 'frame'), collapsed: true }]);
    store.getState().muteEntity('group');
    store.getState().expandSubgraph('group', [], [], { inputs: [], outputs: [] });
    expect(store.getState().isMuted('group')).toBe(false);
    expect(store.getState().isGroupCollapsed('group')).toBe(false);
    store.getState().addElements({ entities: [node('group', 5, 'double')] });
    await tick();
    expect(store.getState().getSocketValue('group', 'out')).toBe(10);
  });

  it('evaluates a newly folded frame and its rewired targets without another input edit', async () => {
    const store = storeFor(
      [node('a', 3), node('b', 1, 'double'), node('c')],
      [wire('a', 'b'), wire('b', 'c')]
    );
    store.getState().setEvaluationHandlers((_id, type, inputs) =>
      type === 'frame'
        ? // The app explicitly defines the new frame's computation; it is not an inner-graph runner.
          { 'gout-0': Number(inputs['gin-0']) * 3 }
        : { out: Number(inputs.in) * (type === 'double' ? 2 : 1) }
    );
    await store.getState().evaluateAll();
    expect(store.getState().getSocketValue('c', 'out')).toBe(6);
    store.getState().collapseToSubgraph(['b'], 'group');
    await tick();
    expect(store.getState().getSocketValue('group', 'gout-0')).toBe(9);
    expect(store.getState().getSocketValue('c', 'out')).toBe(9);
    // Its old boundary input was removed, so the retained child now reads its default.
    expect(store.getState().getSocketValue('b', 'out')).toBe(2);
  });

  it.each(['collapseGroup', 'toggleGroupCollapse'] as const)(
    'expanding one group preserves another group collapsed using %s',
    (collapse) => {
      const other = node('other', 1, 'frame');
      const child = { ...node('child'), parentId: 'other' };
      const store = storeFor([node('group', 1, 'frame'), other, child]);
      store.getState()[collapse]('other');
      expect(store.getState().entityMap.get('other')?.collapsed).toBe(true);
      store.getState().expandSubgraph('group', [], [], { inputs: [], outputs: [] });
      expect(store.getState().isGroupCollapsed('other')).toBe(true);
      expect(store.getState().hiddenEntityIds.has('child')).toBe(true);
    }
  );
});
