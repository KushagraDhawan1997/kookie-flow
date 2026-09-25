import { expect, it } from 'vitest';
import type { Entity, Edge } from '../types/index';
import { createEdgeValidityResolver } from './edge-validity';
const nodes = (targetType: string): Map<string, Entity> =>
  new Map([
    [
      'a',
      {
        id: 'a',
        type: 'default',
        position: { x: 0, y: 0 },
        data: {},
        outputs: [{ id: 'out', name: 'Out', type: 'number' }],
      },
    ],
    [
      'b',
      {
        id: 'b',
        type: 'default',
        position: { x: 0, y: 0 },
        data: {},
        inputs: [{ id: 'in', name: 'In', type: targetType }],
      },
    ],
  ]);
const edge: Edge = { id: 'ab', source: 'a', sourceSocket: 'out', target: 'b', targetSocket: 'in' };
it('refreshes inferred flags after schema changes while retaining unchanged arrays', () => {
  const resolve = createEdgeValidityResolver();
  const compatible = resolve([edge], nodes('number'), {});
  expect(compatible[0].invalid).toBe(false);
  expect(resolve(compatible, nodes('number'), {})).toBe(compatible);
  const incompatible = resolve(compatible, nodes('string'), {});
  expect(incompatible[0].invalid).toBe(true);
  expect(resolve(incompatible, nodes('number'), {})[0].invalid).toBe(false);
});
it('respects explicit invalid overrides, including copied consumer-owned edges', () => {
  const resolve = createEdgeValidityResolver();
  const explicit = [{ ...edge, invalid: false }];
  expect(resolve(explicit, nodes('string'), {})).toBe(explicit);
  const inferred = resolve([edge], nodes('number'), {});
  const copied = [{ ...inferred[0] }];
  expect(resolve(copied, nodes('string'), {})).toBe(copied);
});
it('resolves the current graph without resurrecting previously supplied edges', () => {
  const resolve = createEdgeValidityResolver();
  resolve([edge], nodes('number'), {});
  expect(resolve([{ ...edge, id: 'imperative' }], nodes('string'), {}).map((e) => e.id)).toEqual([
    'imperative',
  ]);
  const empty: Edge[] = [];
  expect(resolve(empty, nodes('number'), {})).toBe(empty);
});
