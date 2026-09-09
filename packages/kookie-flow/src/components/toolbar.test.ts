import { describe, it, expect } from 'vitest';
import { hasSelectedEntityWithToolbar } from './toolbar';
import type { Entity, EntityTypeDefinition } from '../types';

/**
 * The toolbar's visibility check runs on every viewport write — every pan frame, every wheel
 * tick. It used to answer "is there a toolbar to show?" by materialising the list of selected
 * entities that have one, which cost a lookup per selected entity and an array allocation per
 * input event. These tests pin the answer it gives and, more to the point, pin that it stops
 * looking once it has one.
 */

function entity(id: string, type: string): Entity {
  return { id, type, position: { x: 0, y: 0 }, data: {} };
}

/** A Map that records how many lookups the predicate actually performs. */
class CountingMap extends Map<string, Entity> {
  gets = 0;
  override get(key: string): Entity | undefined {
    this.gets += 1;
    return super.get(key);
  }
}

const types: Record<string, EntityTypeDefinition> = {
  text: { type: 'text', toolbar: true },
  plain: { type: 'plain' },
  disabled: { type: 'disabled', toolbar: false },
};

describe('hasSelectedEntityWithToolbar', () => {
  it('is true when a selected entity has a toolbar config', () => {
    const map = new Map([['a', entity('a', 'text')]]);
    expect(hasSelectedEntityWithToolbar(new Set(['a']), map, types)).toBe(true);
  });

  it('is false when no selected type declares a toolbar', () => {
    const map = new Map([
      ['a', entity('a', 'plain')],
      ['b', entity('b', 'unregistered')],
    ]);
    expect(hasSelectedEntityWithToolbar(new Set(['a', 'b']), map, types)).toBe(false);
  });

  it('treats an explicit `toolbar: false` as no toolbar', () => {
    const map = new Map([['a', entity('a', 'disabled')]]);
    expect(hasSelectedEntityWithToolbar(new Set(['a']), map, types)).toBe(false);
  });

  it('ignores selected ids that are no longer in the entity map', () => {
    const map = new Map([['b', entity('b', 'text')]]);
    expect(hasSelectedEntityWithToolbar(new Set(['ghost', 'b']), map, types)).toBe(true);
  });

  it('stops at the first match instead of scanning the whole selection', () => {
    const map = new CountingMap();
    const ids = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const id = `e${i}`;
      ids.add(id);
      map.set(id, entity(id, 'text'));
    }

    expect(hasSelectedEntityWithToolbar(ids, map, types)).toBe(true);
    // The list-building version did 500. One is the whole point.
    expect(map.gets).toBe(1);
  });

  it('scans the full selection only when the answer is no', () => {
    const map = new CountingMap();
    const ids = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      const id = `e${i}`;
      ids.add(id);
      map.set(id, entity(id, 'plain'));
    }

    expect(hasSelectedEntityWithToolbar(ids, map, types)).toBe(false);
    expect(map.gets).toBe(10);
  });
});
