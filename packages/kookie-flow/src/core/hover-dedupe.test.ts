import { describe, it, expect } from 'vitest';
import { createFlowStore } from './store';
import type { Entity } from '../types';

/**
 * The hover handle is deduped by value, and the guard lives in one place.
 *
 * The hit test runs on every pointermove and mints a fresh handle object each time, so an
 * unguarded `set` notified every subscriber sixty times a second with a deep-equal value — and the
 * sockets renderer answered each notification by rebuilding every socket in the graph.
 *
 * The guard used to live at the call site instead, and it compared entityId and socketId only.
 * Socket ids are scoped per DIRECTION — the renderer's own connected-set keys are
 * `entity:socket:input|output` — so an entity carrying an input and an output that share an id
 * could move the hover between them and have the change swallowed. Nothing in the types forbids
 * that pair. Because the call-site test ran first, it would have kept swallowing it even after the
 * store gained a complete guard, which is why that `if` was deleted rather than left as a fast path.
 */

function withSharedSocketId(id = 'e1'): Entity {
  return {
    id,
    type: 'default',
    position: { x: 0, y: 0 },
    data: {},
    // Same socket id on both sides. This is the fixture the old guard could not tell apart, and a
    // fixture that gave them different ids would pass against both implementations.
    inputs: [{ id: 'value', name: 'Value in', type: 'float' }],
    outputs: [{ id: 'value', name: 'Value out', type: 'float' }],
  };
}

function countingStore() {
  const store = createFlowStore({ entities: [withSharedSocketId()] });
  let notifications = 0;
  const off = store.subscribe(
    (s) => s.hoveredSocketId,
    () => {
      notifications++;
    }
  );
  return { store, off, count: () => notifications };
}

describe('hovering a socket', () => {
  it('a fresh handle for the same socket notifies nobody', () => {
    const { store, off, count } = countingStore();
    const handle = () => ({ entityId: 'e1', socketId: 'value', isInput: true });
    store.getState().setHoveredSocketId(handle());
    expect(count()).toBe(1);
    // Sixty pointermoves over one socket: the hit test returns a new object every time.
    for (let i = 0; i < 60; i++) store.getState().setHoveredSocketId(handle());
    off();
    expect(count()).toBe(1);
  });

  it('moving between an input and an output that share a socket id DOES notify', () => {
    // The case the old call-site guard swallowed, and the reason it was deleted rather than kept.
    const { store, off, count } = countingStore();
    store.getState().setHoveredSocketId({ entityId: 'e1', socketId: 'value', isInput: true });
    store.getState().setHoveredSocketId({ entityId: 'e1', socketId: 'value', isInput: false });
    off();
    expect(count()).toBe(2);
  });

  it('leaving a socket notifies', () => {
    // The guard against over-fixing: a dedupe that swallowed the null would leave a socket lit
    // after the pointer had gone.
    const { store, off, count } = countingStore();
    store.getState().setHoveredSocketId({ entityId: 'e1', socketId: 'value', isInput: true });
    store.getState().setHoveredSocketId(null);
    off();
    expect(count()).toBe(2);
  });

  it('null to null notifies nobody', () => {
    // Most pointermoves are over empty canvas, which is the common case rather than an edge one.
    const { store, off, count } = countingStore();
    for (let i = 0; i < 30; i++) store.getState().setHoveredSocketId(null);
    off();
    expect(count()).toBe(0);
  });

  it('moving to a different entity notifies', () => {
    const { store, off, count } = countingStore();
    store.getState().setHoveredSocketId({ entityId: 'e1', socketId: 'value', isInput: true });
    store.getState().setHoveredSocketId({ entityId: 'e2', socketId: 'value', isInput: true });
    off();
    expect(count()).toBe(2);
  });

  it('the store still reports what is hovered', () => {
    // Deduping must not turn into not-storing.
    const { store, off } = countingStore();
    store.getState().setHoveredSocketId({ entityId: 'e1', socketId: 'value', isInput: false });
    off();
    expect(store.getState().hoveredSocketId).toEqual({ entityId: 'e1', socketId: 'value', isInput: false });
  });
});

/**
 * The widget hover is the same law, and it needs its own guard rather than the socket one's.
 *
 * A widget handle carries two fields where a socket handle carries three, and it is set from a
 * different call site — the pointermove block tests the entity the quadtree named and mints a
 * fresh `{entityId, socketId}` on every move that lands on a control. Everything the GL widget
 * layer claims about not re-rendering rests on this guard: it subscribes to `hoveredWidget` and
 * marks itself dirty, so an unguarded set would rebuild every visible widget's instance data
 * sixty times a second for a pointer that is sitting still.
 */
function countingWidgetStore() {
  const store = createFlowStore({ entities: [withSharedSocketId()] });
  let notifications = 0;
  const off = store.subscribe(
    (s) => s.hoveredWidget,
    () => {
      notifications++;
    }
  );
  return { store, off, count: () => notifications };
}

describe('hovering a widget', () => {
  it('a fresh handle for the same widget notifies nobody', () => {
    const { store, off, count } = countingWidgetStore();
    const handle = () => ({ entityId: 'e1', socketId: 'value' });
    store.getState().setHoveredWidget(handle());
    expect(count()).toBe(1);
    // Sixty pointermoves across one slider, which is about a second of resting on it.
    for (let i = 0; i < 60; i++) store.getState().setHoveredWidget(handle());
    off();
    expect(count()).toBe(1);
  });

  it('moving to another widget on the same node notifies', () => {
    const { store, off, count } = countingWidgetStore();
    store.getState().setHoveredWidget({ entityId: 'e1', socketId: 'value' });
    store.getState().setHoveredWidget({ entityId: 'e1', socketId: 'other' });
    off();
    expect(count()).toBe(2);
  });

  it('leaving a widget notifies', () => {
    // Over-fixing guard: a dedupe that swallowed the null would leave a control lit after the
    // pointer had gone, which is exactly the stuck-hover the socket version of this law exists for.
    const { store, off, count } = countingWidgetStore();
    store.getState().setHoveredWidget({ entityId: 'e1', socketId: 'value' });
    store.getState().setHoveredWidget(null);
    off();
    expect(count()).toBe(2);
  });

  it('null to null notifies nobody', () => {
    // The common case by a distance: most pointermoves are not over a control.
    const { store, off, count } = countingWidgetStore();
    for (let i = 0; i < 30; i++) store.getState().setHoveredWidget(null);
    off();
    expect(count()).toBe(0);
  });

  it('the same socket id on a different entity is a different widget', () => {
    // Two nodes of the same kind side by side share every socket id they have.
    const { store, off, count } = countingWidgetStore();
    store.getState().setHoveredWidget({ entityId: 'e1', socketId: 'value' });
    store.getState().setHoveredWidget({ entityId: 'e2', socketId: 'value' });
    off();
    expect(count()).toBe(2);
  });

  it('the store still reports what is hovered', () => {
    // Deduping must not turn into not-storing: the renderer reads this field, it does not
    // accumulate the notifications.
    const { store, off } = countingWidgetStore();
    store.getState().setHoveredWidget({ entityId: 'e1', socketId: 'value' });
    off();
    expect(store.getState().hoveredWidget).toEqual({ entityId: 'e1', socketId: 'value' });
  });
});

describe('an unknown change type is not swallowed', () => {
  it('warns rather than dropping it in silence', () => {
    // `applyEntityChanges` takes a public union and ignored anything outside it without a word, so
    // a consumer building changes by hand got no signal that a typo'd `type` did nothing. Found by
    // writing a behaviour law with `{ type: 'update' }` — there is no `update` variant, the change
    // vanished, and the law reported a working component as broken.
    const store = createFlowStore({
      entities: [{ id: 'a', type: 'default', position: { x: 0, y: 0 }, data: {} }],
    });
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args[0]);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.getState().applyEntityChanges([{ type: 'update', id: 'a', data: {} } as any]);
    } finally {
      console.warn = original;
    }
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0])).toContain('update');
  });

  it('a valid change still applies without warning', () => {
    // The guard against a warning that fires on everything.
    const store = createFlowStore({
      entities: [{ id: 'a', type: 'default', position: { x: 0, y: 0 }, data: {} }],
    });
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args[0]);
    try {
      store.getState().applyEntityChanges([{ type: 'data', id: 'a', data: { label: 'x' } }]);
    } finally {
      console.warn = original;
    }
    expect(warnings).toEqual([]);
    expect(store.getState().entityMap.get('a')?.data).toEqual({ label: 'x' });
  });
});
