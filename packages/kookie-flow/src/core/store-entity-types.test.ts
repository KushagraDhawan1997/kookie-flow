import { describe, it, expect } from 'vitest';
import { createFlowStore } from './store';
import type { Entity, EntityTypeDefinition, Socket } from '../types';

/**
 * The resolver is tested on its own in entity-types.test.ts. These are the WAYS IN — every door a
 * node can come through must resolve it, because a door that forgets leaves a node with no
 * sockets and no way to tell why.
 */

const IN: Socket = { id: 'in', name: 'In', type: 'float', defaultValue: 7 };
const OUT: Socket = { id: 'out', name: 'Out', type: 'float' };
const add: EntityTypeDefinition = {
  type: 'add',
  label: 'Add',
  defaultWidth: 200,
  inputs: [IN],
  outputs: [OUT],
};
const entityTypes = { add };

const bare = (id = 'n1'): Entity => ({ id, type: 'add', position: { x: 0, y: 0 }, data: {} });
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('a table that changes what gates a run', () => {
  it('turning a manual type reactive runs the entities it was holding', async () => {
    const gated: EntityTypeDefinition = { ...add, evaluation: 'manual' };
    const store = createFlowStore({ entities: [bare()], entityTypes: { add: gated } });
    const ran: string[] = [];
    // Handlers set ONCE, as a consumer with a hoisted onEvaluate does: nothing re-sets them later.
    store.getState().setEvaluationHandlers((id) => { ran.push(id); return {}; });
    store.getState().markDirty('n1');
    await tick();
    expect(ran).toEqual([]);

    store.getState().setEntityTypes({ add: { ...add, evaluation: 'reactive' } });
    await tick();
    expect(ran).toEqual(['n1']);
    store.getState().disposeEvaluation();
  });
});

describe('every way a node gets in', () => {
  it('the initial state', () => {
    const store = createFlowStore({ entities: [bare()], entityTypes });
    expect(store.getState().entities[0].inputs).toEqual([IN]);
    expect(store.getState().entityMap.get('n1')?.width).toBe(200);
    store.getState().disposeEvaluation();
  });

  it('the prop sync', () => {
    const store = createFlowStore({ entityTypes });
    store.getState().setEntities([bare()]);
    expect(store.getState().entityMap.get('n1')?.outputs).toEqual([OUT]);
    store.getState().disposeEvaluation();
  });

  it('addElements, which is what a plugin and a paste use', () => {
    const store = createFlowStore({ entityTypes });
    store.getState().addElements({ entities: [bare()] });
    expect(store.getState().entityMap.get('n1')?.inputs).toEqual([IN]);
    store.getState().disposeEvaluation();
  });

  it('and an add change', () => {
    const store = createFlowStore({ entityTypes });
    store.getState().applyEntityChanges([{ type: 'add', entity: bare() }]);
    expect(store.getState().entityMap.get('n1')?.inputs).toEqual([IN]);
    store.getState().disposeEvaluation();
  });
});

describe('when the table changes', () => {
  it('a table that arrives after the nodes reaches them', () => {
    const store = createFlowStore({ entities: [bare()] });
    expect(store.getState().entities[0].inputs).toBeUndefined();
    store.getState().setEntityTypes(entityTypes);
    expect(store.getState().entities[0].inputs).toEqual([IN]);
    store.getState().disposeEvaluation();
  });

  it('a second table overrules what the first one filled, and nothing the node said', () => {
    const store = createFlowStore({
      entities: [{ ...bare(), width: 999 }],
      entityTypes,
    });
    store.getState().setEntityTypes({ add: { ...add, defaultWidth: 300, label: 'Plus' } });
    const n = store.getState().entityMap.get('n1');
    expect(n?.width).toBe(999); // the node's own word
    expect(n?.data?.label).toBe('Plus'); // the table's, replaced
    store.getState().disposeEvaluation();
  });

  it('the same table in a new object costs no rebuild', () => {
    // An app writing entityTypes inline hands over a new object every render. Re-resolving every
    // node and rebuilding both quadtrees for that would be a full rebuild per keystroke.
    const store = createFlowStore({ entities: [bare()], entityTypes });
    const before = store.getState().topologyVersion;
    store.getState().setEntityTypes({ add });
    expect(store.getState().topologyVersion).toBe(before);
    store.getState().disposeEvaluation();
  });

  it('but a table that really changed does rebuild', () => {
    const store = createFlowStore({ entities: [bare()], entityTypes });
    const before = store.getState().topologyVersion;
    store.getState().setEntityTypes({ add: { ...add, defaultWidth: 300 } });
    expect(store.getState().topologyVersion).toBeGreaterThan(before);
    store.getState().disposeEvaluation();
  });
});

describe('what the rest of the library sees', () => {
  it('a socket the node never mentioned is hit-testable, which is the point of resolving early', () => {
    // The socket quadtree is built from `entity.inputs`. If resolution happened anywhere later
    // than this, the socket would be drawn and not clickable — the worst kind of half-working.
    const store = createFlowStore({ entities: [bare()], entityTypes });
    const withTable = store.getState().socketQuadtree.queryPoint(0, 0, 400);
    expect(withTable.some((s) => s.socketId === 'in')).toBe(true);
    store.getState().disposeEvaluation();

    const without = createFlowStore({ entities: [bare()] });
    expect(without.getState().socketQuadtree.queryPoint(0, 0, 400)).toEqual([]);
    without.getState().disposeEvaluation();
  });

  it('the engine reads a default value the table supplied', async () => {
    const store = createFlowStore({ entities: [bare()], entityTypes });
    let seen: unknown;
    store.getState().setEvaluationHandlers((_id, _t, inputs) => { seen = inputs.in; return {}; });
    await store.getState().evaluateAll();
    expect(seen).toBe(7);
    store.getState().disposeEvaluation();
  });

  it('and still hears which types wait to be asked', async () => {
    const store = createFlowStore({ entities: [bare()] });
    store.getState().setEntityTypes({ add: { ...add, evaluation: 'manual' } });
    const ran: string[] = [];
    store.getState().setEvaluationHandlers((id) => { ran.push(id); return {}; });
    store.getState().markDirty('n1');
    await tick(); await tick();
    expect(ran).toEqual([]);
    await store.getState().evaluate('n1');
    expect(ran).toEqual(['n1']);
    store.getState().disposeEvaluation();
  });
});
