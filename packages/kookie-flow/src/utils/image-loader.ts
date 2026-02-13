/**
 * ImageTextureManager — async image loading with LOD tiers, caching, and disposal.
 *
 * Performance optimizations:
 * - Upload queue: limits GPU texture uploads to 1-2 per frame (avoids 300ms+ stalls).
 * - Lazy full-res: only decodes thumbnail on load; full-res deferred until zoom demands it.
 * - Web Worker decode: createImageBitmap runs off-thread via transferable ImageBitmap.
 *
 * Design decisions:
 * - Each unique `src` gets one CacheEntry with up to 2 LOD tiers (thumbnail + full).
 * - Thumbnail: ≤ 256px on longest axis. Used when entity is small on screen.
 * - Full: original capped at MAX_IMAGE_TEXTURE_SIZE (4096). Used when zoomed in.
 * - Textures are Three.js `Texture` objects, disposed explicitly.
 * - Reference counted: multiple entities can share the same src.
 */

import * as THREE from 'three';
import { MAX_IMAGE_TEXTURE_SIZE } from '../core/constants';
import { ImageDecodeWorker } from './image-decode-worker';

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
  /** Stored blob for deferred full-res decode */
  blob: Blob | null;
  /** Whether full-res decode is in progress */
  fullLoadState: 'idle' | 'loading';
}

// ── Upload queue item ────────────────────────────────────────────────
// Queued as raw ImageBitmap + metadata. The THREE.Texture is only created
// when the item is popped from the queue during processUploadQueue(),
// avoiding a frame where the material references an un-uploaded texture.

interface PendingUpload {
  src: string;
  bitmap: ImageBitmap;
  tier: 'thumbnail' | 'full';
  generateMipmaps: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Downscale an ImageBitmap to `maxDim` on its longest side.
 * Main-thread fallback when Worker is unavailable (SSR, old browsers).
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

// ── ImageTextureManager ──────────────────────────────────────────────

export class ImageTextureManager {
  private cache = new Map<string, TextureEntry>();
  private onLoad: (() => void) | undefined;
  private uploadQueue: PendingUpload[] = [];
  private decodeWorker: ImageDecodeWorker | null = null;

  constructor(onLoad?: () => void) {
    this.onLoad = onLoad;
  }

  // ── Worker (lazy) ──────────────────────────────────────────────────

  private getDecodeWorker(): ImageDecodeWorker | null {
    if (typeof Worker === 'undefined') return null; // SSR fallback
    if (!this.decodeWorker) {
      this.decodeWorker = new ImageDecodeWorker();
    }
    return this.decodeWorker;
  }

  // ── Upload queue ───────────────────────────────────────────────────

  private enqueueUpload(item: PendingUpload): void {
    this.uploadQueue.push(item);
  }

  /**
   * Process up to `maxPerFrame` texture uploads.
   * Called from useFrame each frame. Creates the THREE.Texture, stores it on
   * the entry, and sets needsUpdate = true so Three.js uploads to GPU.
   *
   * Returns true if more uploads remain (caller should keep invalidating).
   */
  processUploadQueue(maxPerFrame: number = 2): boolean {
    if (this.uploadQueue.length === 0) return false;

    const count = Math.min(maxPerFrame, this.uploadQueue.length);
    for (let i = 0; i < count; i++) {
      const item = this.uploadQueue[i];
      const entry = this.cache.get(item.src);
      if (!entry) {
        // Entry was disposed while queued — clean up bitmap
        item.bitmap.close();
        continue;
      }

      const tex = bitmapToTexture(item.bitmap, item.generateMipmaps);
      if (item.tier === 'thumbnail') {
        entry.thumbnail = tex;
      } else {
        entry.full = tex;
      }
    }
    this.uploadQueue.splice(0, count);

    return this.uploadQueue.length > 0;
  }

  get hasQueuedUploads(): boolean {
    return this.uploadQueue.length > 0;
  }

  // ── Public API ─────────────────────────────────────────────────────

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
      blob: null,
      fullLoadState: 'idle',
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
      entry.blob = null;
      this.cache.delete(src);
    }
  }

  /**
   * Get the best available texture for a given screen-space width.
   * Triggers lazy full-res decode when zoom crosses LOD_THRESHOLD_PX.
   */
  getTexture(src: string, screenWidth: number): THREE.Texture | null {
    const entry = this.cache.get(src);
    if (!entry) return null;

    if (screenWidth > LOD_THRESHOLD_PX) {
      if (entry.full) return entry.full;
      // Trigger deferred full-res decode (if not already in progress)
      if (entry.blob && entry.fullLoadState === 'idle') {
        this.loadFull(src, entry);
      }
    }

    return entry.thumbnail ?? entry.full;
  }

  getEntry(src: string): TextureEntry | undefined {
    return this.cache.get(src);
  }

  /** Dispose all cached textures. Call on unmount. */
  disposeAll(): void {
    // Close any queued bitmaps that haven't been uploaded yet
    for (const item of this.uploadQueue) {
      item.bitmap.close();
    }
    this.uploadQueue.length = 0;

    this.decodeWorker?.dispose();
    this.decodeWorker = null;

    for (const [, entry] of this.cache) {
      entry.abort?.abort();
      entry.thumbnail?.dispose();
      entry.full?.dispose();
      entry.blob = null;
    }
    this.cache.clear();
  }

  // ── Private: load pipelines ────────────────────────────────────────

  /**
   * Initial load: fetch blob, decode thumbnail only, enqueue for GPU upload.
   * Full-res is deferred until getTexture() sees zoom past LOD threshold.
   */
  private async load(src: string, entry: TextureEntry): Promise<void> {
    const signal = entry.abort?.signal;
    try {
      const response = await fetch(src, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (signal?.aborted) return;

      const worker = this.getDecodeWorker();
      if (worker) {
        // Off-thread decode + resize
        const result = await worker.decode(THUMBNAIL_SIZE, blob);
        if (signal?.aborted) { result.bitmap.close(); return; }

        entry.naturalWidth = result.naturalWidth;
        entry.naturalHeight = result.naturalHeight;
        this.enqueueUpload({
          src,
          bitmap: result.bitmap,
          tier: 'thumbnail',
          generateMipmaps: false,
        });
      } else {
        // Main-thread fallback (SSR, old browsers)
        const bitmap = await createImageBitmap(blob);
        if (signal?.aborted) { bitmap.close(); return; }

        entry.naturalWidth = bitmap.width;
        entry.naturalHeight = bitmap.height;

        const thumbBitmap = await downscale(bitmap, THUMBNAIL_SIZE);
        if (signal?.aborted) {
          thumbBitmap.close();
          if (thumbBitmap !== bitmap) bitmap.close();
          return;
        }

        if (thumbBitmap !== bitmap) bitmap.close();
        this.enqueueUpload({
          src,
          bitmap: thumbBitmap,
          tier: 'thumbnail',
          generateMipmaps: false,
        });
      }

      // Store blob for deferred full-res decode
      entry.blob = blob;
      entry.state = 'loaded';
      entry.abort = null;
      this.onLoad?.();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      entry.state = 'error';
      entry.abort = null;
    }
  }

  /**
   * Deferred full-res decode. Triggered on demand when zoom crosses LOD threshold.
   * Decodes from the stored blob and enqueues for GPU upload.
   */
  private async loadFull(src: string, entry: TextureEntry): Promise<void> {
    if (entry.fullLoadState !== 'idle' || !entry.blob) return;
    entry.fullLoadState = 'loading';

    try {
      const blob = entry.blob;
      const worker = this.getDecodeWorker();

      if (worker) {
        const result = await worker.decode(MAX_IMAGE_TEXTURE_SIZE, blob);
        if (!this.cache.has(src)) { result.bitmap.close(); return; }

        this.enqueueUpload({
          src,
          bitmap: result.bitmap,
          tier: 'full',
          generateMipmaps: true,
        });
      } else {
        // Main-thread fallback
        const bitmap = await createImageBitmap(blob);
        if (!this.cache.has(src)) { bitmap.close(); return; }

        const fullBitmap = await downscale(bitmap, MAX_IMAGE_TEXTURE_SIZE);
        if (!this.cache.has(src)) {
          fullBitmap.close();
          if (fullBitmap !== bitmap) bitmap.close();
          return;
        }

        if (fullBitmap !== bitmap) bitmap.close();
        this.enqueueUpload({
          src,
          bitmap: fullBitmap,
          tier: 'full',
          generateMipmaps: true,
        });
      }

      // Free blob memory — no longer needed
      entry.blob = null;
      entry.fullLoadState = 'idle';
      this.onLoad?.();
    } catch {
      entry.fullLoadState = 'idle'; // Allow retry on error
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
