import { describe, it, expect } from 'vitest';
import {
  COALESCE_MS,
  coalesceKey,
  emptyHistory,
  isEdit,
  record,
  stepBack,
  stepForward,
} from './history';
import type { Edge, Entity } from '../types';

/**
 * What one press of undo takes back. The stack is the easy half; these tests are about the two
 * decisions that make undo trustworthy or useless.
 */

const entity = (id: string, x = 0): Entity => ({
  id, type: 'default', position: { x, y: 0 }, data: {},
});
const snapshot = (x: number): { entities: Entity[]; edges: Edge[] } => ({
  entities: [entity('a', x)], edges: [],
});

describe('what counts as an edit', () => {
  it('moving something does', () => {
    expect(isEdit([{ type: 'position', id: 'a', position: { x: 1, y: 1 } }])).toBe(true);
  });

  it('selecting something does not — it is where you are, not what the graph is', () => {
    expect(isEdit([{ type: 'select', id: 'a', selected: true }])).toBe(false);
  });

  it('and a batch that is nothing but selection does not, however many are in it', () => {
    expect(isEdit([
      { type: 'select', id: 'a', selected: true },
      { type: 'select', id: 'b', selected: false },
    ])).toBe(false);
  });

  it('but a batch that also moves something does', () => {
    expect(isEdit([
      { type: 'select', id: 'a', selected: true },
      { type: 'position', id: 'a', position: { x: 1, y: 1 } },
    ])).toBe(true);
  });
});

describe('what counts as the same edit', () => {
  it('two moves of the same node', () => {
    const a = coalesceKey([{ type: 'position', id: 'a', position: { x: 1, y: 0 } }]);
    const b = coalesceKey([{ type: 'position', id: 'a', position: { x: 2, y: 0 } }]);
    expect(a).toBe(b);
  });

  it('but not moves of different nodes', () => {
    expect(coalesceKey([{ type: 'position', id: 'a', position: { x: 1, y: 0 } }]))
      .not.toBe(coalesceKey([{ type: 'position', id: 'b', position: { x: 1, y: 0 } }]));
  });

  it('nor a move and a data edit of the same node', () => {
    expect(coalesceKey([{ type: 'position', id: 'a', position: { x: 1, y: 0 } }]))
      .not.toBe(coalesceKey([{ type: 'data', id: 'a', data: { label: 'x' } }]));
  });

  it('and the order of the ids in a batch does not make a new key', () => {
    const one = coalesceKey([
      { type: 'position', id: 'b', position: { x: 0, y: 0 } },
      { type: 'position', id: 'a', position: { x: 0, y: 0 } },
    ]);
    const two = coalesceKey([
      { type: 'position', id: 'a', position: { x: 0, y: 0 } },
      { type: 'position', id: 'b', position: { x: 0, y: 0 } },
    ]);
    expect(one).toBe(two);
  });

  it('an add is never the same as anything: each one is a thing that happened', () => {
    expect(coalesceKey([{ type: 'add', entity: entity('a') }])).toBeNull();
    expect(coalesceKey([{ type: 'remove', id: 'a' }])).toBeNull();
  });

  it('and selection inside a batch does not change what the batch is about', () => {
    expect(coalesceKey([
      { type: 'select', id: 'a', selected: true },
      { type: 'position', id: 'a', position: { x: 1, y: 0 } },
    ])).toBe(coalesceKey([{ type: 'position', id: 'a', position: { x: 2, y: 0 } }]));
  });
});

describe('the stack', () => {
  it('a drag is one step, however many values it passes through', () => {
    let h = emptyHistory();
    h = record(h, snapshot(0), 'position:a', 1000);
    h = record(h, snapshot(1), 'position:a', 1100);
    h = record(h, snapshot(2), 'position:a', 1200);
    expect(h.past).toHaveLength(1);
    expect(h.past[0].entities[0].position.x).toBe(0);
  });

  it('coming back to the same control after a pause starts a new step', () => {
    let h = emptyHistory();
    h = record(h, snapshot(0), 'position:a', 1000);
    h = record(h, snapshot(1), 'position:a', 1000 + COALESCE_MS + 1);
    expect(h.past).toHaveLength(2);
  });

  it('undo gives back where the graph was, and offers the way forward again', () => {
    let h = emptyHistory();
    h = record(h, snapshot(0), 'position:a', 1000);
    const back = stepBack(h, snapshot(5));
    expect(back?.restored.entities[0].position.x).toBe(0);
    expect(back?.state.future).toHaveLength(1);

    const forward = stepForward(back!.state, back!.restored);
    expect(forward?.restored.entities[0].position.x).toBe(5);
  });

  it('undo at the beginning does nothing, rather than something surprising', () => {
    expect(stepBack(emptyHistory(), snapshot(0))).toBeNull();
    expect(stepForward(emptyHistory(), snapshot(0))).toBeNull();
  });

  it('and doing something new after an undo abandons what was undone', () => {
    let h = emptyHistory();
    h = record(h, snapshot(0), 'position:a', 1000);
    const back = stepBack(h, snapshot(5));
    expect(back?.state.future).toHaveLength(1);
    const after = record(back!.state, snapshot(0), 'position:b', 2000);
    expect(after.future).toHaveLength(0);
  });

  it('an undo ends the gesture, so the next edit is its own step', () => {
    let h = emptyHistory();
    h = record(h, snapshot(0), 'position:a', 1000);
    const back = stepBack(h, snapshot(1));
    const next = record(back!.state, snapshot(2), 'position:a', 1100);
    expect(next.past).toHaveLength(1); // the redo entry's own, not folded into the undone one
  });

  it('the stack has a floor, and it drops the oldest rather than refusing the newest', () => {
    let h = emptyHistory();
    for (let i = 0; i < 10; i++) h = record(h, snapshot(i), `k${i}`, i * 10_000, 4);
    expect(h.past).toHaveLength(4);
    expect(h.past[h.past.length - 1].entities[0].position.x).toBe(9);
    expect(h.past[0].entities[0].position.x).toBe(6);
  });
});
