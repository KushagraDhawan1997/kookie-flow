/**
 * The keyboard cursor walks the graph the way a person reads it.
 *
 * One tab stop only pays for itself if the arrow keys can reach every node from it, and "every
 * node" has to mean something a person can follow. The order under test is reading order — down,
 * then across — rather than the order the consumer happened to put entities in their array, which
 * is whatever their data source produced and can put two visually adjacent nodes at opposite ends.
 */

import { describe, it, expect } from 'vitest';
import { stepEntityCursor } from './entity-cursor';
import type { Entity } from '../types';

function at(id: string, x: number, y: number): Entity {
  return { id, type: 'default', position: { x, y }, data: {} };
}

/** Deliberately shuffled: array order must not be what the cursor follows. */
const grid: Entity[] = [
  at('c', 200, 100),
  at('a', 0, 0),
  at('d', 0, 200),
  at('b', 200, 0),
];

describe('stepEntityCursor walks in reading order', () => {
  it('starts at the top-left node whichever direction it is asked for first', () => {
    expect(stepEntityCursor(grid, null, 1)).toBe('a');
    expect(stepEntityCursor(grid, null, -1)).toBe('d');
  });

  it('goes down a row before across, and back the same way', () => {
    expect(stepEntityCursor(grid, 'a', 1)).toBe('b');
    expect(stepEntityCursor(grid, 'b', 1)).toBe('c');
    expect(stepEntityCursor(grid, 'c', 1)).toBe('d');
    expect(stepEntityCursor(grid, 'd', -1)).toBe('c');
    expect(stepEntityCursor(grid, 'b', -1)).toBe('a');
  });

  it('wraps at both ends rather than stopping dead', () => {
    // A cursor that stops at the last node stops at a node that looks no different from the rest,
    // so the only feedback is that the key did nothing.
    expect(stepEntityCursor(grid, 'd', 1)).toBe('a');
    expect(stepEntityCursor(grid, 'a', -1)).toBe('d');
  });

  it('breaks a tie on id, so two nodes at one point cannot trap the cursor', () => {
    // Without a total order both are "before" the other and neither is ever the next one.
    const stacked = [at('z', 10, 10), at('y', 10, 10)];
    expect(stepEntityCursor(stacked, 'y', 1)).toBe('z');
    expect(stepEntityCursor(stacked, 'z', -1)).toBe('y');
  });

  it('lands on the first node when the id it was given has gone', () => {
    // How a cursor left pointing at a removed entity heals, instead of costing every removal a
    // lookup to clear it.
    expect(stepEntityCursor(grid, 'deleted', 1)).toBe('a');
  });

  it('skips what it is told to skip, including the node it is standing on', () => {
    const hidden = new Set(['b']);
    expect(stepEntityCursor(grid, 'a', 1, (id) => hidden.has(id))).toBe('c');
    // Standing on a node that has since been hidden — a collapsed group's child — must not pin
    // the cursor there.
    expect(stepEntityCursor(grid, 'b', 1, (id) => hidden.has(id))).toBe('a');
  });

  it('answers null when there is nowhere to go', () => {
    expect(stepEntityCursor([], null, 1)).toBeNull();
    expect(stepEntityCursor(grid, null, 1, () => true)).toBeNull();
  });
});
