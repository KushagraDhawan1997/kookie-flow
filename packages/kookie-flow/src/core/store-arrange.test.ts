import { describe, it, expect } from 'vitest';
import { createFlowStore } from './store';
import type { Entity } from '../types';

/**
 * Align, distribute and toggle, through the store. The planning is tested in utils/arrange.test.ts;
 * what is pinned here is what only the store knows — which entities are in the plan, and that a
 * frame takes its contents with it.
 */

const node = (id: string, x: number, y: number, extra: Partial<Entity> = {}): Entity => ({
  id,
  type: 'default',
  position: { x, y },
  width: 100,
  height: 50,
  data: {},
  ...extra,
});

describe('arranging a selection', () => {
  it('moves the selection, and returns exactly what moved', () => {
    const store = createFlowStore({ entities: [node('a', 0, 0), node('b', 40, 100)] });
    store.getState().selectEntities(['a', 'b']);
    const moved = store.getState().alignSelection('left');
    expect(moved).toEqual([{ id: 'b', position: { x: 0, y: 100 } }]);
    expect(store.getState().entityMap.get('b')?.position).toEqual({ x: 0, y: 100 });
    store.getState().disposeEvaluation();
  });

  it('a frame carries its contents, and a child of a selected frame is not moved on its own', () => {
    const store = createFlowStore({
      entities: [
        node('f', 100, 0, { type: 'frame', width: 300, height: 200 }),
        node('c', 150, 50, { parentId: 'f' }),
        node('x', 0, 300),
      ],
    });
    store.getState().selectEntities(['f', 'c', 'x']);
    store.getState().alignSelection('left');
    const at = (id: string) => store.getState().entityMap.get(id)?.position.x;
    expect(at('f')).toBe(0);
    // Moved once, by the frame's 100, and still 50 inside it.
    expect(at('c')).toBe(50);
    expect(at('x')).toBe(0);
    store.getState().disposeEvaluation();
  });

  it('distribute spaces three evenly and needs three', () => {
    const store = createFlowStore({ entities: [node('a', 0, 0), node('b', 130, 0), node('c', 300, 0)] });
    store.getState().selectEntities(['a', 'c']);
    expect(store.getState().distributeSelection('horizontal')).toEqual([]);
    store.getState().selectEntities(['a', 'b', 'c']);
    store.getState().distributeSelection('horizontal');
    expect(store.getState().entityMap.get('b')?.position.x).toBe(150);
    store.getState().disposeEvaluation();
  });
});

describe('toggling the selection', () => {
  it('adds an entity that is out, and takes out one that is in', () => {
    const store = createFlowStore({ entities: [node('a', 0, 0), node('b', 200, 0)] });
    store.getState().selectEntity('a');
    store.getState().toggleEntitySelection('b');
    expect([...store.getState().selectedEntityIds].sort()).toEqual(['a', 'b']);
    store.getState().toggleEntitySelection('a');
    expect([...store.getState().selectedEntityIds]).toEqual(['b']);
    store.getState().disposeEvaluation();
  });
});
