import { expect, it } from 'vitest';
import { createFlowStore } from './store';
import type { Entity } from '../types/index';

it('movement and resize avoid array notifications while preserving caller data and saved snapshots', () => {
  const input: Entity[] = [
    { id: 'a', type: 'default', position: { x: 0, y: 0 }, data: {}, width: 100, height: 100 },
  ];
  const store = createFlowStore({ entities: input });
  const snapshot = store.getState().toObject();
  let arrays = 0,
    positions = 0;
  const offArray = store.subscribe(
    (s) => s.entities,
    () => arrays++
  );
  const offPosition = store.subscribe(
    (s) => s.positionVersion,
    () => positions++
  );
  for (let i = 1; i <= 100; i++)
    store.getState().updateEntityPositions([{ id: 'a', position: { x: i, y: 0 } }]);
  store.getState().updateEntityDimensions('a', 200, 150);
  expect({ arrays, positions }).toEqual({ arrays: 0, positions: 101 });
  expect(input[0].position.x).toBe(0);
  expect(input[0].width).toBe(100);
  expect(snapshot.entities[0].position.x).toBe(0);
  expect(store.getState().entities[0].position.x).toBe(100);
  expect(store.getState().quadtree.queryPoint(250, 50)).toContain('a');

  const replacement = [{ ...input[0], position: { x: 500, y: 0 } }];
  store.getState().setEntities(replacement);
  store.getState().updateEntityPositions([{ id: 'a', position: { x: 600, y: 0 } }]);
  expect(arrays).toBe(1);
  expect(replacement[0].position.x).toBe(500);
  expect(store.getState().entityMap.get('a')?.position.x).toBe(600);
  offArray();
  offPosition();
  store.getState().disposeEvaluation();
});
