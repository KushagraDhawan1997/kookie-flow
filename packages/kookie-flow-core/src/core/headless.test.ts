import { describe, it, expect } from 'vitest';
import { createFlowStore } from './store';

const entity = { id: 'a', type: 'default', position: { x: 0, y: 0 }, data: {} };

describe('standalone engine', () => {
  it('is a vanilla observable store, not a React hook', () => {
    const store = createFlowStore({ entities: [entity] });
    expect(typeof store).toBe('object');
    const changes: number[] = [];
    const unsubscribe = store.subscribe(
      (s) => s.viewport.zoom,
      (zoom) => changes.push(zoom)
    );
    store.getState().setViewport({ x: 0, y: 0, zoom: 2 });
    unsubscribe();
    store.getState().setViewport({ x: 0, y: 0, zoom: 3 });
    expect(changes).toEqual([2]);
    store.getState().disposeEvaluation();
  });

  it('fits a host-supplied viewport without window', () => {
    expect('window' in globalThis).toBe(false);
    const store = createFlowStore({ entities: [entity] });
    store.getState().fitView({}, 800, 600);
    const viewport = store.getState().viewport;
    expect(Object.values(viewport).every(Number.isFinite)).toBe(true);
  });

  it.each([
    [undefined, undefined],
    [0, 600],
    [800, -1],
    [NaN, 600],
    [800, Infinity],
  ])('rejects an unavailable or invalid viewport (%s, %s)', (width, height) => {
    const store = createFlowStore({ entities: [entity] });
    const before = store.getState().viewport;
    expect(() => store.getState().fitView({}, width, height)).toThrow(RangeError);
    expect(store.getState().viewport).toBe(before);
  });
});
