/**
 * The minimap's entity layer must not be repainted for a viewport-only change.
 *
 * The component subscribes to the whole store with no selector, so a pan — or a hover, or a
 * connection drag — wakes it on every `set()`. Standard mode fits the transform to the entity
 * bounds alone, so those frames redraw pixels that are already correct: one `fillStyle` assignment
 * and one `fillRect` per entity, per frame, for nothing. This tier cannot rasterise, so the
 * assertions count canvas calls rather than looking at pixels: how many `fillRect`s reached the
 * offscreen entity layer, and whether the layer was blitted onto the visible canvas.
 *
 * jsdom has no 2D context at all, so `getContext` is replaced with a recorder. The recorder is a
 * fake, but the thing under test — how many draw calls the component issues, and when — is real.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { FlowProvider, useFlowStoreApi } from './context';
import { Minimap } from './minimap';
import type { FlowStore } from '../core/store';
import type { Entity } from '../types';

interface Recorder {
  fillRect: number;
  clearRect: number;
  drawImage: number;
}

const recorders = new Map<HTMLCanvasElement, Recorder>();

function makeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const counts: Recorder = { fillRect: 0, clearRect: 0, drawImage: 0 };
  recorders.set(canvas, counts);
  const ctx = {
    canvas,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    scale: () => {},
    fillRect: () => {
      counts.fillRect++;
    },
    clearRect: () => {
      counts.clearRect++;
    },
    strokeRect: () => {},
    drawImage: () => {
      counts.drawImage++;
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

function recorderFor(canvas: HTMLCanvasElement): Recorder {
  const found = recorders.get(canvas);
  if (!found) throw new Error('canvas never asked for a 2D context');
  return found;
}

/** Manual RAF queue: the component schedules through it, the test drains it on demand. */
let frames: FrameRequestCallback[] = [];
let originalGetContext: HTMLCanvasElement['getContext'];
let originalRaf: typeof globalThis.requestAnimationFrame;
let originalCaf: typeof globalThis.cancelAnimationFrame;

function flushFrames(): void {
  const pending = frames;
  frames = [];
  act(() => {
    for (const cb of pending) cb(0);
  });
}

beforeEach(() => {
  recorders.clear();
  frames = [];

  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
    return type === '2d' ? makeContext(this) : null;
  } as HTMLCanvasElement['getContext'];

  originalRaf = globalThis.requestAnimationFrame;
  originalCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
});

afterEach(() => {
  cleanup();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCaf;
});

const ENTITY_COUNT = 40;

function makeEntities(offset = 0): Entity[] {
  const entities: Entity[] = [];
  for (let i = 0; i < ENTITY_COUNT; i++) {
    entities.push({
      id: `n${i}`,
      type: 'default',
      position: { x: (i % 8) * 300 + offset, y: Math.floor(i / 8) * 200 },
      data: {},
      width: 200,
      height: 120,
    });
  }
  return entities;
}

interface Mounted {
  store: FlowStore;
  visible: HTMLCanvasElement;
  layer: HTMLCanvasElement;
}

function mountMinimap(entities: Entity[]): Mounted {
  let captured: FlowStore | null = null;
  function CaptureStore() {
    captured = useFlowStoreApi();
    return null;
  }

  const view = render(
    <FlowProvider initialState={{ entities }}>
      <CaptureStore />
      <Minimap />
    </FlowProvider>
  );

  const visible = view.container.querySelector('canvas');
  if (!visible) throw new Error('minimap did not render a canvas');

  // Every canvas that asked for a 2D context is in the recorder map; the one that is not the
  // rendered element is the offscreen entity layer.
  let layer: HTMLCanvasElement | null = null;
  for (const canvas of recorders.keys()) {
    if (canvas !== visible) layer = canvas;
  }
  if (!layer) throw new Error('no offscreen entity layer was created');

  const store: FlowStore | null = captured;
  if (!store) throw new Error('store was not captured');

  return { store, visible, layer };
}

describe('Minimap entity layer caching', () => {
  it('paints every entity once on mount and blits the layer onto the visible canvas', () => {
    const { visible, layer } = mountMinimap(makeEntities());
    flushFrames();

    expect(recorderFor(layer).fillRect).toBe(ENTITY_COUNT);
    expect(recorderFor(visible).drawImage).toBeGreaterThan(0);
  });

  it('does not repaint the entity layer when only the viewport moves', () => {
    const { store, visible, layer } = mountMinimap(makeEntities());
    flushFrames();

    const fillsAfterMount = recorderFor(layer).fillRect;
    const blitsAfterMount = recorderFor(visible).drawImage;
    expect(fillsAfterMount).toBe(ENTITY_COUNT);

    // Three pans, each a separate store write and so a separate scheduled frame.
    for (let i = 1; i <= 3; i++) {
      act(() => {
        store.getState().setViewport({ x: -100 * i, y: -40 * i, zoom: 1 });
      });
      flushFrames();
    }

    // No entity was refilled: the layer is untouched by a viewport-only change.
    expect(recorderFor(layer).fillRect).toBe(fillsAfterMount);
    // The minimap still repainted — the cached layer was blitted on those frames.
    expect(recorderFor(visible).drawImage).toBe(blitsAfterMount + 3);
  });

  it('does not repaint the entity layer for a store write the minimap cannot render', () => {
    const { store, layer } = mountMinimap(makeEntities());
    flushFrames();
    const fillsAfterMount = recorderFor(layer).fillRect;

    act(() => {
      store.getState().setHoveredEntityId('n2');
    });
    flushFrames();

    expect(recorderFor(layer).fillRect).toBe(fillsAfterMount);
  });

  it('repaints the entity layer when an entity moves', () => {
    const { store, layer } = mountMinimap(makeEntities());
    flushFrames();
    const fillsAfterMount = recorderFor(layer).fillRect;

    act(() => {
      store.getState().setEntities(makeEntities(50));
    });
    flushFrames();

    expect(recorderFor(layer).fillRect).toBe(fillsAfterMount + ENTITY_COUNT);
  });

  it('repaints the entity layer when the selection changes', () => {
    const { store, layer } = mountMinimap(makeEntities());
    flushFrames();
    const fillsAfterMount = recorderFor(layer).fillRect;

    act(() => {
      store.getState().selectEntity('n3');
    });
    flushFrames();

    expect(recorderFor(layer).fillRect).toBe(fillsAfterMount + ENTITY_COUNT);
  });
});
