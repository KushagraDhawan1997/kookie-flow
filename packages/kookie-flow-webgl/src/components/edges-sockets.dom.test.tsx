import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import * as THREE from 'three';
import { Edges } from './edges';
import { createFlowStore } from '@kushagradhawan/kookie-flow-core/internal/core/store';
import { getSocketYOffset } from '@kushagradhawan/kookie-flow-core/internal/utils/geometry';
import { resolveSocketLayout } from '../utils/style-resolver';
import { FALLBACK_TOKENS } from '../hooks/useThemeTokens';
import type { Entity, Edge, EntityTypeDefinition } from '../types/index';

type FrameState = { size: { width: number; height: number }; clock: { elapsedTime: number } };
const fakes = vi.hoisted(() => ({
  frame: null as ((state: FrameState, delta: number) => void) | null,
  store: null as ReturnType<typeof createFlowStore> | null,
}));
vi.mock('@react-three/fiber', () => ({
  useFrame: (frame: (state: FrameState, delta: number) => void) => {
    fakes.frame = frame;
  },
}));
vi.mock('./context', () => ({ useFlowStoreApi: () => fakes.store }));
vi.mock('../contexts/StyleContext', async (original) => ({
  ...(await original<typeof import('../contexts/StyleContext')>()),
  useSocketLayout: () => fakes.store?.getState().socketLayout,
}));

// Execute the actual renderer's frame callback with real Three buffers; only R3F scheduling and
// the host meshes are replaced. Assertions concern geometry/uploads, not rasterized pixels.
let geometries: Map<HTMLElement, THREE.BufferGeometry>;
let originalGeometry: PropertyDescriptor | undefined;
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); // React's unknown R3F DOM tags.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  geometries = new Map();
  originalGeometry = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'geometry');
  Object.defineProperty(HTMLElement.prototype, 'geometry', {
    configurable: true,
    get(this: HTMLElement) {
      let geometry = geometries.get(this);
      if (!geometry) {
        geometry = new THREE.BufferGeometry();
        geometries.set(this, geometry);
      }
      return geometry;
    },
  });
});
afterEach(() => {
  cleanup();
  fakes.store?.getState().disposeEvaluation();
  fakes.store = null;
  fakes.frame = null;
  for (const geometry of geometries.values()) geometry.dispose();
  if (originalGeometry) Object.defineProperty(HTMLElement.prototype, 'geometry', originalGeometry);
  else Reflect.deleteProperty(HTMLElement.prototype, 'geometry');
  vi.restoreAllMocks();
});

const outputs = [
  { id: 'one', name: 'One', type: 'number' },
  { id: 'two', name: 'Two', type: 'number' },
];
const source: Entity = { id: 'a', type: 'default', position: { x: 0, y: 0 }, data: {}, outputs };
const target: Entity = {
  id: 'b',
  type: 'default',
  position: { x: 400, y: 0 },
  data: {},
  inputs: [{ id: 'in', name: 'In', type: 'number' }],
};
const edge: Edge = {
  id: 'edge',
  source: 'a',
  target: 'b',
  sourceSocket: 'one',
  targetSocket: 'in',
};

function fixture(
  entities: Entity[],
  edges: Edge[],
  entityTypes?: Record<string, EntityTypeDefinition>
) {
  const store = createFlowStore({
    entities,
    edges,
    entityTypes,
    socketLayout: resolveSocketLayout(true, '2', FALLBACK_TOKENS),
  });
  fakes.store = store;
  const view = render(createElement(Edges));
  const host = view.container.querySelector('mesh');
  if (!(host instanceof HTMLElement)) throw new Error('Edge mesh did not mount');
  const geometry = geometries.get(host);
  if (!geometry) throw new Error('Edge geometry did not initialize');
  const frame = () =>
    act(() =>
      fakes.frame?.({ size: { width: 1280, height: 800 }, clock: { elapsedTime: 1 } }, 1 / 60)
    );
  frame();
  const positions = geometry.getAttribute('position');
  if (!(positions instanceof THREE.BufferAttribute))
    throw new Error('Missing edge position buffer');
  return { store, frame, geometry, positions };
}

it('refreshes endpoints when sockets reorder at an unchanged node count', () => {
  const { store, frame, positions } = fixture([source, target], [edge]);
  expect(positions.getY(0)).toBeCloseTo(
    -getSocketYOffset(source, 0, false, store.getState().socketLayout)
  );
  const changed = { ...source, outputs: [...outputs].reverse() };
  act(() => store.getState().setEntities([changed, target]));
  frame();
  expect(positions.getY(0)).toBeCloseTo(
    -getSocketYOffset(changed, 1, false, store.getState().socketLayout)
  );
});

it('refreshes sockets resolved from a changed entity type', () => {
  const typed = { ...source, type: 'processor', outputs: undefined };
  const { store, frame, positions } = fixture([typed, target], [edge], {
    processor: { type: 'processor', outputs },
  });
  act(() =>
    store
      .getState()
      .setEntityTypes({ processor: { type: 'processor', outputs: [...outputs].reverse() } })
  );
  frame();
  const changed = store.getState().entityMap.get(source.id);
  if (!changed) throw new Error('Typed entity disappeared');
  expect(positions.getY(0)).toBeCloseTo(
    -getSocketYOffset(changed, 1, false, store.getState().socketLayout)
  );
});

it('indexes replacement nodes when the total node count stays constant', () => {
  const { store, frame, positions } = fixture([source, target], [edge]);
  const replacement = { ...source, id: 'replacement', outputs: [...outputs].reverse() };
  act(() => {
    store.getState().setEntities([replacement, target]);
    store.getState().setEdges([{ ...edge, source: replacement.id }]);
  });
  frame();
  expect(positions.getY(0)).toBeCloseTo(
    -getSocketYOffset(replacement, 1, false, store.getState().socketLayout)
  );
});

it('indexes nodes added incrementally without replacing the entity map', () => {
  const { store, frame, positions } = fixture([target], []);
  const map = store.getState().entityMap;
  act(() =>
    store.getState().addElements({ entities: [source], edges: [{ ...edge, sourceSocket: 'two' }] })
  );
  expect(store.getState().entityMap).toBe(map);
  frame();
  expect(positions.getY(0)).toBeCloseTo(
    -getSocketYOffset(source, 1, false, store.getState().socketLayout)
  );

  act(() => store.getState().deleteElements({ entityIds: [source.id] }));
  const replacement = { ...source, outputs: [...outputs].reverse() };
  act(() =>
    store
      .getState()
      .addElements({ entities: [replacement], edges: [{ ...edge, sourceSocket: 'two' }] })
  );
  frame();
  expect(positions.getY(0)).toBeCloseTo(
    -getSocketYOffset(replacement, 0, false, store.getState().socketLayout)
  );
});

it.each(['drag', 'controlled move'] as const)(
  'keeps %s uploads confined to the moved edge',
  (mode) => {
    const secondSource = { ...source, id: 'c', position: { x: 0, y: 300 } };
    const secondTarget = { ...target, id: 'd', position: { x: 400, y: 300 } };
    const { store, frame, positions, geometry } = fixture(
      [source, target, secondSource, secondTarget],
      [edge, { ...edge, id: 'second', source: 'c', target: 'd' }]
    );
    const totalComponents = geometry.drawRange.count * 3;
    expect(totalComponents).toBeGreaterThan(0);
    positions.clearUpdateRanges();
    const map = store.getState().entityMap;
    act(() => {
      if (mode === 'drag')
        store.getState().updateEntityPositions([{ id: 'a', position: { x: 20, y: 10 } }]);
      else
        store
          .getState()
          .setEntities([
            { ...source, position: { x: 20, y: 10 } },
            target,
            secondSource,
            secondTarget,
          ]);
    });
    expect(store.getState().entityMap).toBe(map);
    frame();
    const uploaded = positions.updateRanges.reduce((count, range) => count + range.count, 0);
    expect(uploaded).toBeGreaterThan(0);
    expect(uploaded).toBeLessThan(totalComponents);
    expect(positions.getY(0)).toBeCloseTo(
      -10 - getSocketYOffset(source, 0, false, store.getState().socketLayout)
    );
  }
);
