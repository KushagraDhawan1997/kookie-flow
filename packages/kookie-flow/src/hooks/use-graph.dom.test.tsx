import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useGraph, type UseGraphReturn } from './use-graph';
import type { Entity } from '../types';

/**
 * Undo, through the hook a consumer actually holds.
 *
 * The stack itself is tested in core/history.test.ts. What is tested here is the wiring: that a
 * change recorded where the graph WAS, that undo puts it back, and that a selection — the batch
 * that arrives on every single click — does not fill the stack with steps that undo nothing.
 */

const entities: Entity[] = [
  { id: 'a', type: 'default', position: { x: 0, y: 0 }, data: {} },
];

function mountGraph(): { api: () => UseGraphReturn; unmount: () => void } {
  let latest: UseGraphReturn | null = null;
  function Harness() {
    latest = useGraph({ initialEntities: entities, history: true });
    return null;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<Harness />); });
  return {
    api: () => {
      if (!latest) throw new Error('not mounted');
      return latest;
    },
    unmount: () => {
      act(() => { root.unmount(); });
      host.remove();
    },
  };
}

describe('undo through useGraph', () => {
  it('puts a moved node back where it was', () => {
    const g = mountGraph();
    act(() => {
      g.api().onEntitiesChange([{ type: 'position', id: 'a', position: { x: 100, y: 0 } }]);
    });
    expect(g.api().entities[0].position.x).toBe(100);
    expect(g.api().canUndo).toBe(true);

    act(() => { g.api().undo(); });
    expect(g.api().entities[0].position.x).toBe(0);
    expect(g.api().canRedo).toBe(true);

    act(() => { g.api().redo(); });
    expect(g.api().entities[0].position.x).toBe(100);
    g.unmount();
  });

  it('a selection is not a step: undo after clicking around still has nothing to undo', () => {
    const g = mountGraph();
    act(() => {
      g.api().onEntitiesChange([{ type: 'select', id: 'a', selected: true }]);
      g.api().onEntitiesChange([{ type: 'select', id: 'a', selected: false }]);
    });
    expect(g.api().canUndo).toBe(false);
    g.unmount();
  });

  it('a deleted node comes back, with the edge that was deleted with it', () => {
    const g = mountGraph();
    act(() => {
      g.api().onEntitiesChange([
        { type: 'add', entity: { id: 'b', type: 'default', position: { x: 9, y: 9 }, data: {} } },
      ]);
    });
    act(() => { g.api().onEntitiesChange([{ type: 'remove', id: 'b' }]); });
    expect(g.api().entities).toHaveLength(1);

    act(() => { g.api().undo(); });
    expect(g.api().entities.map((e: Entity) => e.id)).toEqual(['a', 'b']);
    g.unmount();
  });

  it('off by default, so a consumer with its own history does not end up with two', () => {
    const seen: UseGraphReturn[] = [];
    function Harness() {
      seen.push(useGraph({ initialEntities: entities }));
      return null;
    }
    const api = () => seen[seen.length - 1];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<Harness />); });
    act(() => {
      api().onEntitiesChange([{ type: 'position', id: 'a', position: { x: 5, y: 5 } }]);
    });
    expect(api().canUndo).toBe(false);
    act(() => { api().undo(); });
    expect(api().entities[0].position.x).toBe(5);
    act(() => { root.unmount(); });
    host.remove();
  });
});
