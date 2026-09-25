import { afterEach, expect, it, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import * as THREE from 'three';
import { ImageTextureManager } from '../utils/image-loader';
import { ImageEntities } from './image-entities';
import { createFlowStore } from '@kushagradhawan/kookie-flow-core/internal/core/store';

const fakes = vi.hoisted(() => ({
  frames: [] as Array<(state: unknown, delta: number) => void>,
  store: null as unknown,
}));
vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: unknown, delta: number) => void) => fakes.frames.push(cb),
}));
vi.mock('./context', () => ({ useFlowStoreApi: () => fakes.store }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fakes.frames.length = 0;
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
  });
}

it.each([false, true])(
  'reacquires images after max size changes with no React movement renders (strict=%s)',
  async (strict) => {
    // The DOM host supplies refs, but geometry/material assertions use real Three objects, not pixels.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('Worker', undefined);
    const decoded: ImageBitmap[] = [];
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        const bitmap = { width: 300, height: 300, close: vi.fn() } as unknown as ImageBitmap;
        decoded.push(bitmap);
        return bitmap;
      })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image']) }))
    );
    const acquire = vi.spyOn(ImageTextureManager.prototype, 'acquire');
    const dispose = vi.spyOn(ImageTextureManager.prototype, 'disposeAll');
    const store = createFlowStore({
      entities: [
        {
          id: 'image',
          type: 'image',
          position: { x: 0, y: 0 },
          width: 300,
          height: 300,
          data: { src: 'image.png' },
        },
      ],
    });
    fakes.store = store;
    try {
      const scene = (maxImageTextureSize: number) => {
        const images = createElement(ImageEntities, { maxImageTextureSize });
        return strict ? createElement(StrictMode, null, images) : images;
      };
      const view = render(scene(2048));
      const mountDisposals = dispose.mock.calls.length;
      const mesh = view.container.querySelector('mesh') as unknown as THREE.Mesh;
      Object.assign(mesh, { position: new THREE.Vector3(), scale: new THREE.Vector3() });
      const frame = () =>
        act(() =>
          fakes.frames[fakes.frames.length - 2]({ size: { width: 1280, height: 800 } }, 1 / 60)
        );
      frame();
      await settle();
      frame();
      await settle();
      frame();
      const firstTexture = (mesh.material as THREE.ShaderMaterial).uniforms.map
        .value as THREE.Texture;
      expect(firstTexture).toBeInstanceOf(THREE.Texture);
      expect(acquire).toHaveBeenCalledTimes(1);
      const renderCalls = fakes.frames.length;
      for (let x = 1; x <= 10; x++) {
        act(() => store.getState().updateEntityPositions([{ id: 'image', position: { x, y: 0 } }]));
        frame();
      }
      expect(fakes.frames).toHaveLength(renderCalls);

      view.rerender(scene(1024));
      expect(dispose).toHaveBeenCalledTimes(mountDisposals + 1);
      expect(firstTexture.image).toBeNull();
      frame(); // A prop change alone invalidates; no move is needed to recover the picture.
      await settle();
      frame();
      await settle();
      frame();
      expect(acquire).toHaveBeenCalledTimes(2);
      const replacement = (mesh.material as THREE.ShaderMaterial).uniforms.map
        .value as THREE.Texture;
      expect(replacement).toBeInstanceOf(THREE.Texture);
      expect(replacement).not.toBe(firstTexture);
      view.unmount();
      expect(dispose).toHaveBeenCalledTimes(mountDisposals + 2);
      for (const bitmap of decoded) expect(bitmap.close).toHaveBeenCalledOnce();
    } finally {
      store.getState().disposeEvaluation();
    }
  }
);
