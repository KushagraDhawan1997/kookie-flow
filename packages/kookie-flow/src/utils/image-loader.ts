/**
 * ImageTextureManager — async image loading with LOD tiers, caching, and disposal.
 *
 * Design decisions:
 * - Each unique `src` gets one CacheEntry with up to 2 LOD tiers (thumbnail + full).
 * - Thumbnail: ≤ 256px on longest axis. Used when entity is small on screen.
 * - Full: original capped at MAX_IMAGE_TEXTURE_SIZE (4096). Used when zoomed in.
 * - `createImageBitmap()` decodes off-main-thread. No jank.
 * - Textures are Three.js `Texture` objects, disposed explicitly.
 * - Reference counted: multiple entities can share the same src.
 */

import * as THREE from 'three';
import { MAX_IMAGE_TEXTURE_SIZE } from '../core/constants';

// LOD threshold: if the entity's screen-space width (px) is below this, use thumbnail
export const LOD_THRESHOLD_PX = 256;
const THUMBNAIL_SIZE = 256;

export type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

export interface TextureEntry {
  thumbnail: THREE.Texture | null;
  full: THREE.Texture | null;
  state: LoadState;
  /** Natural width/height of the original image (before any cap) */
  naturalWidth: number;
  naturalHeight: number;
  /** How many entities reference this src */
  refCount: number;
  /** AbortController for in-flight loads */
  abort: AbortController | null;
}

/**
 * Downscale an ImageBitmap to `maxDim` on its longest side.
 * Uses createImageBitmap resize (off-main-thread, no OffscreenCanvas).
 * Keeping all LOD tiers as ImageBitmap avoids flipY inconsistencies —
 * WebGL's UNPACK_FLIP_Y has no effect on ImageBitmap but does flip canvas sources.
 */
async function downscale(bitmap: ImageBitmap, maxDim: number): Promise<ImageBitmap> {
  const { width, height } = bitmap;
  if (width <= maxDim && height <= maxDim) return bitmap;

  const scale = maxDim / Math.max(width, height);
  const tw = Math.round(width * scale);
  const th = Math.round(height * scale);

  return createImageBitmap(bitmap, 0, 0, width, height, {
    resizeWidth: tw,
    resizeHeight: th,
    resizeQuality: 'medium',
  });
}

function bitmapToTexture(bitmap: ImageBitmap, generateMipmaps: boolean): THREE.Texture {
  const tex = new THREE.Texture(bitmap as unknown as HTMLCanvasElement);
  // Disable Three.js flipY — UNPACK_FLIP_Y_WEBGL is unreliable for ImageBitmap
  // across browsers/WebGL versions. We flip the shared quad UVs instead.
  tex.flipY = false;
  tex.needsUpdate = true;
  tex.minFilter = generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = generateMipmaps;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ImageTextureManager {
  private cache = new Map<string, TextureEntry>();
  private onLoad: (() => void) | undefined;

  constructor(onLoad?: () => void) {
    this.onLoad = onLoad;
  }

  /** Get or start loading the entry for a given src. Returns the entry immediately. */
  acquire(src: string): TextureEntry {
    let entry = this.cache.get(src);
    if (entry) {
      entry.refCount++;
      return entry;
    }

    entry = {
      thumbnail: null,
      full: null,
      state: 'loading',
      naturalWidth: 0,
      naturalHeight: 0,
      refCount: 1,
      abort: new AbortController(),
    };
    this.cache.set(src, entry);
    this.load(src, entry);
    return entry;
  }

  /** Decrement ref count. Disposes textures when no entities reference this src. */
  release(src: string): void {
    const entry = this.cache.get(src);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
      entry.abort?.abort();
      entry.thumbnail?.dispose();
      entry.full?.dispose();
      this.cache.delete(src);
    }
  }

  /** Get the best available texture for a given screen-space width. */
  getTexture(src: string, screenWidth: number): THREE.Texture | null {
    const entry = this.cache.get(src);
    if (!entry) return null;
    if (screenWidth > LOD_THRESHOLD_PX && entry.full) return entry.full;
    return entry.thumbnail ?? entry.full;
  }

  getEntry(src: string): TextureEntry | undefined {
    return this.cache.get(src);
  }

  /** Dispose all cached textures. Call on unmount. */
  disposeAll(): void {
    for (const [, entry] of this.cache) {
      entry.abort?.abort();
      entry.thumbnail?.dispose();
      entry.full?.dispose();
    }
    this.cache.clear();
  }

  private async load(src: string, entry: TextureEntry): Promise<void> {
    const signal = entry.abort?.signal;
    try {
      const response = await fetch(src, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (signal?.aborted) return;

      const bitmap = await createImageBitmap(blob);
      if (signal?.aborted) { bitmap.close(); return; }

      entry.naturalWidth = bitmap.width;
      entry.naturalHeight = bitmap.height;

      // Thumbnail (off-main-thread resize via createImageBitmap)
      const thumbBitmap = await downscale(bitmap, THUMBNAIL_SIZE);
      if (signal?.aborted) { thumbBitmap.close(); if (thumbBitmap !== bitmap) bitmap.close(); return; }
      entry.thumbnail = bitmapToTexture(thumbBitmap, false);

      // Full resolution (capped at MAX_IMAGE_TEXTURE_SIZE)
      const fullBitmap = await downscale(bitmap, MAX_IMAGE_TEXTURE_SIZE);
      if (signal?.aborted) { fullBitmap.close(); if (fullBitmap !== bitmap) bitmap.close(); return; }
      entry.full = bitmapToTexture(fullBitmap, true);

      // Close the original bitmap if downscale created separate copies.
      // downscale() returns the same bitmap when it's already within bounds,
      // so only close if neither LOD tier is reusing the original.
      if (bitmap !== thumbBitmap && bitmap !== fullBitmap) {
        bitmap.close();
      }

      entry.state = 'loaded';
      entry.abort = null;
      this.onLoad?.();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      entry.state = 'error';
      entry.abort = null;
    }
  }
}

/**
 * Create a placeholder gradient image as a data URL for demos.
 * Generates a colorful gradient on a canvas, returns a blob URL.
 */
export function createDemoImageBlobURL(
  width: number,
  height: number,
  colors: [string, string] = ['#6366f1', '#ec4899']
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(1, colors[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Add a subtle pattern overlay
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#fff';
  const step = Math.max(20, Math.floor(width / 12));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if ((x + y) % (step * 2) === 0) {
        ctx.fillRect(x, y, step, step);
      }
    }
  }
  ctx.globalAlpha = 1;

  // Draw a small image icon in the center
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  const iconSize = Math.min(width, height) * 0.3;
  const cx = width / 2;
  const cy = height / 2;
  // Mountain shape
  ctx.beginPath();
  ctx.moveTo(cx - iconSize / 2, cy + iconSize / 3);
  ctx.lineTo(cx - iconSize / 6, cy - iconSize / 4);
  ctx.lineTo(cx + iconSize / 8, cy + iconSize / 8);
  ctx.lineTo(cx + iconSize / 4, cy - iconSize / 6);
  ctx.lineTo(cx + iconSize / 2, cy + iconSize / 3);
  ctx.closePath();
  ctx.fill();
  // Sun circle
  ctx.beginPath();
  ctx.arc(cx + iconSize / 4, cy - iconSize / 4, iconSize / 8, 0, Math.PI * 2);
  ctx.fill();

  return canvas.toDataURL('image/png');
}
