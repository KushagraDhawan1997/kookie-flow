import { describe, it, expect } from 'vitest';
import { toFlowObject } from './serialize';
import { createFlowStore } from './store';
import type { Edge, Entity } from '../types';

/**
 * Saving is a promise that what comes back is what went in. These tests are about the line
 * between the graph and the moment: the moment must not end up in the file.
 */

const entity = (id: string, extra: Partial<Entity> = {}): Entity => ({
  id,
  type: 'default',
  position: { x: 1, y: 2 },
  data: { label: id },
  ...extra,
});

const viewport = { x: 10, y: 20, zoom: 1.5 };

describe('what gets written down', () => {
  it('the graph, and the place you were looking at it from', () => {
    const out = toFlowObject([entity('a')], [{ id: 'e', source: 'a', target: 'a' }], viewport);
    expect(out.entities).toHaveLength(1);
    expect(out.edges).toHaveLength(1);
    expect(out.viewport).toEqual(viewport);
  });

  it('not what is selected — a reload should not open with a highlight', () => {
    const out = toFlowObject([entity('a', { selected: true })], [], viewport);
    expect('selected' in out.entities[0]).toBe(false);
  });

  it('not what is being dragged, which is true for a few hundred milliseconds a day', () => {
    const out = toFlowObject([entity('a', { dragging: true })], [], viewport);
    expect('dragging' in out.entities[0]).toBe(false);
  });

  it('nor a selected edge', () => {
    const out = toFlowObject([], [{ id: 'e', source: 'a', target: 'b', selected: true }], viewport);
    expect('selected' in out.edges[0]).toBe(false);
  });

  it('but everything else the entity carries, untouched', () => {
    const e = entity('a', {
      width: 300,
      height: 120,
      color: 'blue',
      parentId: 'g',
      inputs: [{ id: 'in', name: 'In', type: 'float' }],
      data: { label: 'Add', values: { in: 3 } },
    });
    const out = toFlowObject([e], [], viewport);
    expect(out.entities[0]).toEqual(e);
  });
});

describe('what it costs', () => {
  it('an entity with nothing to strip is not copied', () => {
    const e = entity('a');
    expect(toFlowObject([e], [], viewport).entities[0]).toBe(e);
  });

  it('the viewport is copied, because the store keeps moving its own', () => {
    const live = { x: 0, y: 0, zoom: 1 };
    const out = toFlowObject([], [], live);
    live.x = 500;
    expect(out.viewport.x).toBe(0);
  });
});

describe('the round trip', () => {
  it('what comes out is what <KookieFlow entities edges> takes in', () => {
    const entities: Entity[] = [entity('a', { selected: true }), entity('b')];
    const edges: Edge[] = [{ id: 'e', source: 'a', sourceSocket: 'out', target: 'b', targetSocket: 'in' }];
    const saved = JSON.parse(JSON.stringify(toFlowObject(entities, edges, viewport)));
    const reloaded = toFlowObject(saved.entities, saved.edges, saved.viewport);
    expect(reloaded).toEqual(saved);
  });
});

describe('what the store saves', () => {
  it('a pending widget write is folded in, so a save holds what the person can see', () => {
    const store = createFlowStore({
      entities: [entity('a', { inputs: [{ id: 'in', name: 'In', type: 'float' }] })],
    });
    store.getState().setWidgetValue('a', 'in', 42);
    const saved = store.getState().toObject();
    expect((saved.entities[0].data as { values?: Record<string, unknown> }).values?.in).toBe(42);
    store.getState().disposeEvaluation();
  });

  it('and selection is left behind on that path too', () => {
    const store = createFlowStore({
      entities: [entity('a', { inputs: [{ id: 'in', name: 'In', type: 'float' }] }), entity('b')],
    });
    store.getState().setWidgetValue('a', 'in', 1);
    store.getState().selectEntity('b');
    const saved = store.getState().toObject();
    expect(saved.entities.some((e) => 'selected' in e)).toBe(false);
    store.getState().disposeEvaluation();
  });
});
