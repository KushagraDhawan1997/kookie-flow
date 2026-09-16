import { expect, it } from 'vitest';
import { connectedSocketKey, entitySocketKey } from './socket-key';
import { SocketQuadtree } from '../core/spatial';
import { createFlowStore } from '../core/store';
import type { Entity } from '../types';

it('keeps entity/socket/direction tuples distinct, including delimiters and percent escapes', () => {
  const ids = ['', 'a', 'a:b', 'a%3Ab', ':', '%', 'input', 'output', 'a:b:input'];
  const keys = new Set<string>();
  for (const entity of ids)
    for (const socket of ids)
      for (const input of [true, false]) {
        keys.add(connectedSocketKey(entity, socket, input));
      }
  expect(keys.size).toBe(ids.length ** 2 * 2);
  expect(entitySocketKey('node', 'socket')).toBe('node:socket');
});

it('moves and removes colliding legacy socket keys independently in the spatial index', () => {
  const tree = new SocketQuadtree({ x: -1000, y: -1000, width: 2000, height: 2000 });
  tree.insert({ entityId: 'a', socketId: 'b:c', isInput: true, x: 10, y: 10 });
  tree.insert({ entityId: 'a:b', socketId: 'c', isInput: true, x: 100, y: 100 });
  tree.insert({ entityId: 'a:b', socketId: 'c', isInput: false, x: 200, y: 200 });
  tree.update('a', 'b:c', true, 300, 300);
  tree.remove('a:b', 'c', true);
  expect(tree.size).toBe(2);
  expect(tree.queryPoint(300, 300, 5)[0]?.entityId).toBe('a');
  expect(tree.queryPoint(100, 100, 5)).toEqual([]);
  expect(tree.queryPoint(200, 200, 5)[0]?.isInput).toBe(false);
});

it('keeps widget overrides and connected flags separate across colliding legacy keys', () => {
  const entities: Entity[] = ['a', 'a:b'].map((id, i) => ({
    id,
    type: 'default',
    data: {},
    position: { x: i * 400, y: 0 },
    inputs: [{ id: i ? 'c' : 'b:c', name: 'value', type: 'number', defaultValue: 0 }],
    outputs: [{ id: 'out', name: 'out', type: 'number' }],
  }));
  const store = createFlowStore({
    entities,
    edges: [{ id: 'wire', source: 'a', sourceSocket: 'out', target: 'a:b', targetSocket: 'c' }],
  });
  try {
    store.getState().setWidgetValue('a', 'b:c', 12);
    store.getState().setWidgetValue('a:b', 'c', 34);
    expect(store.getState().widgetValues.get(entitySocketKey('a', 'b:c'))?.value).toBe(12);
    expect(store.getState().widgetValues.get(entitySocketKey('a:b', 'c'))?.value).toBe(34);
    expect(store.getState().connectedSockets.has(connectedSocketKey('a', 'b:c', true))).toBe(false);
    expect(store.getState().connectedSockets.has(connectedSocketKey('a:b', 'c', true))).toBe(true);
    store.getState().deleteElements({ entityIds: ['a'] });
    expect(store.getState().widgetValues.get(entitySocketKey('a:b', 'c'))?.value).toBe(34);
  } finally {
    store.getState().disposeEvaluation();
  }
});
