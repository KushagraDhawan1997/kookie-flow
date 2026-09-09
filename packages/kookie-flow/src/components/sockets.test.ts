import { describe, it, expect } from 'vitest';
import { indexConnectedSockets } from './sockets';
import type { Edge } from '../types';

/**
 * Which end of an edge lands in which map.
 *
 * The socket renderer used to answer "does this socket have an edge on it?" against one flat set
 * of `entityId:socketId:input` strings, which meant building that key — a fresh string — for every
 * socket in the graph on every rebuild. Splitting it into per-entity sets by direction removes the
 * allocation, and introduces exactly one way to get it wrong: an edge's SOURCE end is an output on
 * `edge.source`, and its TARGET end is an input on `edge.target`. Swap those and every socket in
 * the graph draws the wrong fill — solid where it should be a hollow ring, and vice versa — which
 * no type would catch, since both maps have the same shape.
 */
describe('indexConnectedSockets', () => {
  const edges: Edge[] = [
    { id: 'e1', source: 'a', target: 'b', sourceSocket: 'out1', targetSocket: 'in1' },
    { id: 'e2', source: 'a', target: 'c', sourceSocket: 'out2', targetSocket: 'in1' },
  ];

  it('files the source end under outputs and the target end under inputs', () => {
    const inputs = new Map<string, Set<string>>();
    const outputs = new Map<string, Set<string>>();

    indexConnectedSockets(edges, inputs, outputs);

    expect(outputs.get('a')).toEqual(new Set(['out1', 'out2']));
    expect(inputs.get('b')).toEqual(new Set(['in1']));
    expect(inputs.get('c')).toEqual(new Set(['in1']));
    // The same socket id on the other side of an entity must not bleed across directions.
    expect(inputs.has('a')).toBe(false);
    expect(outputs.has('b')).toBe(false);
  });

  it('ignores edge ends that name no socket', () => {
    const inputs = new Map<string, Set<string>>();
    const outputs = new Map<string, Set<string>>();

    indexConnectedSockets([{ id: 'e', source: 'a', target: 'b' }], inputs, outputs);

    expect(outputs.size).toBe(0);
    expect(inputs.size).toBe(0);
  });
});
