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
 * - Full: original capped at maxTextureSize (default 2048). Used when zoomed in.
 * - Textures are Three.js `Texture` objects, disposed explicitly.
 * - Reference counted: multiple entities can share the same src.
 */

import * as THREE from 'three';
import { DEFAULT_MAX_IMAGE_TEXTURE_SIZE } from '@kushagradhawan/kookie-flow-core/internal/core/constants';
import {
  ImageDecodeWorker,
  WorkerUnavailableError,
  type DecodeResult,
} from './image-decode-worker';

// LOD threshold: if the entity's screen-space width (px) is below this, use thumbnail
export const LOD_THRESHOLD_PX = 256;
const THUMBNAIL_SIZE = 256;

export type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

/** Time (ms) to keep the raw blob in memory before evicting it.
 *  If full-res is requested after eviction, the image is re-fetched. */
const BLOB_EVICTION_MS = 30_000;

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
  /** Failed upgrades keep the thumbnail and back off instead of retrying on every redraw. */
  fullRetryAt?: number;
  fullFailures?: number;
  /** Timer ID for blob eviction (cleared on loadFull or release) */
  blobTimerId: ReturnType<typeof setTimeout> | null;
  /** Epochs are written by visible LOD queries; no per-frame source Set is needed. */
  fullRequestedFrame?: number;
  fullCandidateFrame?: number;
  /** Invalidates a queued or non-abortable decode when its admission is withdrawn. */
  fullRequestId?: number;
}

// ── Upload queue item ────────────────────────────────────────────────
// Queued as raw ImageBitmap + metadata. The THREE.Texture is only created
// when the item is popped from the queue during processUploadQueue(),
// avoiding a frame where the material references an un-uploaded texture.

interface PendingUpload {
  src: string;
  owner: TextureEntry;
  bitmap: ImageBitmap;
  tier: 'thumbnail' | 'full';
  generateMipmaps: boolean;
  requestId?: number;
  previous?: PendingUpload | null;
  next?: PendingUpload | null;
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

/**
 * Dispose a texture AND close the ImageBitmap behind it.
 *
 * `texture.dispose()` frees the GPU handle and nothing else. The decoded pixel buffer sits in an
 * ImageBitmap outside the JS heap — 16MB for a 2048x2048 tier — and is only reclaimed when the
 * object becomes unreachable and a collector gets to it, which is non-deterministic and can be a
 * long way from the moment the image left the screen. `close()` gives it back immediately.
 *
 * `image = null` is what makes the release final, and it is also the sharp edge: after this the
 * texture cannot be re-uploaded, so anything still pointing a material at it must be re-pointed in
 * the same breath. Every caller here does.
 */
function disposeTexture(tex: THREE.Texture | null | undefined): void {
  if (!tex) return;
  tex.dispose();
  const img = tex.image as ImageBitmap | null;
  if (img && typeof img.close === 'function') img.close();
  tex.image = null;
}

// ── ImageTextureManager ──────────────────────────────────────────────

/** One budget covers loaded, decoding and queued full-resolution tiers. */
const MAX_FULL_RES_TEXTURES = 32;

export class ImageTextureManager {
  private cache = new Map<string, TextureEntry>();
  /** Count of entries that currently have a full-res texture */
  private fullResCount = 0;
  private onLoad: (() => void) | undefined;
  private uploadHead: PendingUpload | null = null;
  private uploadTail: PendingUpload | null = null;
  private decodeWorker: ImageDecodeWorker | null = null;
  /** Set once a worker has failed to construct, so the main-thread path is used from then on. */
  private workerUnavailable = false;
  private maxTextureSize: number;
  private fullOwners = new Set<TextureEntry>();
  private pendingFullUploads = new Map<TextureEntry, PendingUpload>();
  private frame = 0;
  private frameActive = false;
  /** Withdrawn native decodes keep their budget slot until the promise settles. */
  private orphanedFullLoads = new Set<AbortController>();
  private candidateEntries = new Array<TextureEntry | undefined>(MAX_FULL_RES_TEXTURES);
  private candidateSources = new Array<string | undefined>(MAX_FULL_RES_TEXTURES);
  private candidateCount = 0;

  constructor(onLoad?: () => void, maxTextureSize?: number) {
    this.onLoad = onLoad;
    this.maxTextureSize = maxTextureSize ?? DEFAULT_MAX_IMAGE_TEXTURE_SIZE;
  }

  // ── Worker (lazy) ──────────────────────────────────────────────────

  private getDecodeWorker(): ImageDecodeWorker | null {
    if (typeof Worker === 'undefined' || this.workerUnavailable) return null; // SSR / blocked
    if (!this.decodeWorker) {
      // A CSP or sandbox that forbids workers makes `new Worker` throw a SecurityError, and the
      // throw used to escape into the decode's catch — which reports a failed IMAGE. Every image
      // in the document then failed, permanently, because nothing recorded that the worker itself
      // was the problem and the main-thread path beside it was never tried.
      const w = new ImageDecodeWorker();
      if (!w.tryStart()) {
        this.workerUnavailable = true;
        return null;
      }
      this.decodeWorker = w;
    }
    return this.decodeWorker;
  }

  // ── Upload queue ───────────────────────────────────────────────────

  private enqueueUpload(item: PendingUpload): void {
    if (item.tier === 'full') this.pendingFullUploads.set(item.owner, item);
    item.previous = this.uploadTail;
    item.next = null;
    if (this.uploadTail) this.uploadTail.next = item;
    else this.uploadHead = item;
    this.uploadTail = item;
  }

  private dequeueUpload(item: PendingUpload): void {
    if (item.previous) item.previous.next = item.next;
    else this.uploadHead = item.next ?? null;
    if (item.next) item.next.previous = item.previous;
    else this.uploadTail = item.previous ?? null;
    item.previous = null;
    item.next = null;
  }

  /**
   * Process up to `maxPerFrame` texture uploads.
   * Called from useFrame each frame. Creates the THREE.Texture, stores it on
   * the entry, and sets needsUpdate = true so Three.js uploads to GPU.
   *
   * Returns true if more uploads remain (caller should keep invalidating).
   */
  processUploadQueue(maxPerFrame: number = 2): boolean {
    let processed = 0;
    while (processed < maxPerFrame && this.uploadHead) {
      const item = this.uploadHead;
      this.dequeueUpload(item);
      processed++;
      if (item.tier === 'full' && this.pendingFullUploads.get(item.owner) === item) {
        this.pendingFullUploads.delete(item.owner);
      }
      const entry = this.cache.get(item.src);
      if (
        !entry ||
        entry !== item.owner ||
        (item.tier === 'full' && item.requestId !== entry.fullRequestId)
      ) {
        // Entry was disposed while queued — clean up bitmap
        item.bitmap.close();
        continue;
      }

      const tex = bitmapToTexture(item.bitmap, item.generateMipmaps);
      if (item.tier === 'thumbnail') {
        // Overwriting without disposing leaked the previous texture and its bitmap.
        disposeTexture(entry.thumbnail);
        entry.thumbnail = tex;
      } else {
        // The count tracks entries HOLDING a full-res texture, so it only rises when the entry did
        // not already have one — it used to rise on every upload, so a re-decode of the same image
        // inflated it permanently and drove the LRU to evict textures that were still on screen.
        if (!entry.full) this.fullResCount++;
        disposeTexture(entry.full);
        entry.full = tex;
        // Cleared HERE, at the drain, rather than when the decode was enqueued. Clearing it at
        // enqueue meant the entry read as idle while its bitmap was still in the queue, so the
        // next zoom past the LOD threshold started the whole fetch-and-decode again — once per
        // round trip, for as long as the queue took to drain.
        entry.fullLoadState = 'idle';
      }
    }

    return this.uploadHead !== null;
  }

  get hasQueuedUploads(): boolean {
    return this.uploadHead !== null;
  }

  /** Start a visible-image pass. Calls to getTexture record full-tier demand without evicting. */
  beginFrame(): void {
    this.frame++;
    this.frameActive = true;
    this.candidateCount = 0;
  }

  /**
   * Keep the visible working set stable, including tiers still decoding or queued. Excess visible
   * sources stay at thumbnail quality until an owner leaves view or asks for thumbnail quality.
   * Finished cold tiers remain cached while there is room, so zooming out and back needn't decode.
   * Both loops are bounded by 32; the caller already visited the visible images to draw them.
   */
  endFrame(): void {
    if (!this.frameActive) return;
    this.frameActive = false;
    let neededSlots =
      this.candidateCount -
      (MAX_FULL_RES_TEXTURES - this.fullOwners.size - this.orphanedFullLoads.size);
    for (const entry of this.fullOwners) {
      if (entry.fullRequestedFrame === this.frame || (entry.full && neededSlots <= 0)) continue;
      const before = this.fullOwners.size + this.orphanedFullLoads.size;
      this.releaseFull(entry);
      neededSlots -= before - (this.fullOwners.size + this.orphanedFullLoads.size);
    }
    for (let i = 0; i < this.candidateCount; i++) {
      const entry = this.candidateEntries[i];
      const src = this.candidateSources[i];
      this.candidateEntries[i] = undefined;
      this.candidateSources[i] = undefined;
      if (entry && src && this.cache.get(src) === entry) this.admitFull(src, entry);
    }
    this.candidateCount = 0;
  }

  private admitFull(src: string, entry: TextureEntry): void {
    if (entry.state !== 'loaded' || performance.now() < (entry.fullRetryAt ?? 0)) return;
    if (!this.fullOwners.has(entry)) {
      if (this.fullOwners.size + this.orphanedFullLoads.size >= MAX_FULL_RES_TEXTURES) return;
      this.fullOwners.add(entry);
    }
    if (!entry.full && entry.fullLoadState === 'idle') this.loadFull(src, entry);
  }

  /** Return a slot immediately, including its queued bitmap and non-abortable decode ownership. */
  private releaseFull(entry: TextureEntry): void {
    if (this.fullOwners.delete(entry) && entry.fullLoadState === 'loading' && entry.abort) {
      this.orphanedFullLoads.add(entry.abort);
    }
    entry.fullRequestId = (entry.fullRequestId ?? 0) + 1;
    if (entry.fullLoadState === 'loading') {
      entry.abort?.abort();
      entry.abort = null;
      entry.fullLoadState = 'idle';
    }
    const queued = this.pendingFullUploads.get(entry);
    if (queued) {
      queued.bitmap.close();
      this.dequeueUpload(queued);
      this.pendingFullUploads.delete(entry);
    }
    if (entry.full) {
      disposeTexture(entry.full);
      entry.full = null;
      this.fullResCount--;
    }
    this.scheduleBlobEviction(entry);
  }

  private scheduleBlobEviction(entry: TextureEntry): void {
    if (!entry.blob || entry.blobTimerId !== null) return;
    entry.blobTimerId = setTimeout(() => {
      entry.blobTimerId = null;
      entry.blob = null;
    }, BLOB_EVICTION_MS);
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
      blobTimerId: null,
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
      this.releaseFull(entry);
      entry.abort?.abort();
      if (entry.blobTimerId !== null) clearTimeout(entry.blobTimerId);
      disposeTexture(entry.thumbnail);
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
      entry.fullRequestedFrame = this.frame;
      if (this.frameActive) {
        if (
          entry.fullCandidateFrame !== this.frame &&
          !this.fullOwners.has(entry) &&
          entry.state === 'loaded' &&
          performance.now() >= (entry.fullRetryAt ?? 0) &&
          this.candidateCount < MAX_FULL_RES_TEXTURES
        ) {
          entry.fullCandidateFrame = this.frame;
          this.candidateEntries[this.candidateCount] = entry;
          this.candidateSources[this.candidateCount++] = src;
        }
      } else {
        // Single-source users may query without a render pass; admission is still bounded.
        this.admitFull(src, entry);
      }
      if (entry.full) return entry.full;
    }

    return entry.thumbnail ?? entry.full;
  }

  getEntry(src: string): TextureEntry | undefined {
    return this.cache.get(src);
  }

  /** Dispose all cached textures. Call on unmount. */
  disposeAll(): void {
    for (const entry of this.fullOwners) this.releaseFull(entry);
    // Close any queued bitmaps that haven't been uploaded yet
    while (this.uploadHead) {
      const item = this.uploadHead;
      this.dequeueUpload(item);
      item.bitmap.close();
    }

    this.decodeWorker?.dispose();
    this.decodeWorker = null;

    for (const [, entry] of this.cache) {
      entry.abort?.abort();
      if (entry.blobTimerId !== null) clearTimeout(entry.blobTimerId);
      disposeTexture(entry.thumbnail);
      disposeTexture(entry.full);
      entry.blob = null;
    }
    this.cache.clear();
    this.fullOwners.clear();
    this.pendingFullUploads.clear();
    this.candidateEntries.fill(undefined);
    this.candidateSources.fill(undefined);
    this.candidateCount = 0;
    this.frameActive = false;
    this.fullResCount = 0;
  }

  /** Fall back only for worker infrastructure failures; corrupt-image errors stay image errors. */
  private async decodeImage(
    blob: Blob,
    maxDim: number,
    current: () => boolean
  ): Promise<DecodeResult | null> {
    const worker = this.getDecodeWorker();
    if (worker) {
      try {
        const result = await worker.decode(maxDim, blob);
        if (!current()) {
          result.bitmap.close();
          return null;
        }
        return result;
      } catch (error) {
        if (!current()) return null;
        if (!(error instanceof WorkerUnavailableError)) throw error;
        this.workerUnavailable = true;
        if (this.decodeWorker === worker) {
          this.decodeWorker = null;
          worker.dispose();
        }
      }
    }
    const bitmap = await createImageBitmap(blob);
    if (!current()) {
      bitmap.close();
      return null;
    }
    const naturalWidth = bitmap.width;
    const naturalHeight = bitmap.height;
    let resized: ImageBitmap;
    try {
      resized = await downscale(bitmap, maxDim);
    } catch (error) {
      bitmap.close();
      throw error;
    }
    if (resized !== bitmap) bitmap.close();
    if (!current()) {
      resized.close();
      return null;
    }
    return { bitmap: resized, naturalWidth, naturalHeight };
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

      const result = await this.decodeImage(
        blob,
        THUMBNAIL_SIZE,
        () => !signal?.aborted && this.cache.get(src) === entry
      );
      if (!result) return;
      entry.naturalWidth = result.naturalWidth;
      entry.naturalHeight = result.naturalHeight;
      this.enqueueUpload({
        src,
        owner: entry,
        bitmap: result.bitmap,
        tier: 'thumbnail',
        generateMipmaps: false,
      });
      entry.blob = blob;
      this.scheduleBlobEviction(entry);
      entry.state = 'loaded';
      entry.abort = null;
      this.onLoad?.();
    } catch (err: unknown) {
      if (signal?.aborted || this.cache.get(src) !== entry) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.warn(`[KookieFlow] Image load failed for "${src}":`, err);
      entry.state = 'error';
      entry.abort = null;
      this.onLoad?.();
    }
  }

  /**
   * Deferred full-res decode. Triggered on demand when zoom crosses LOD threshold.
   * Decodes from the stored blob and enqueues for GPU upload.
   */
  private async loadFull(src: string, entry: TextureEntry): Promise<void> {
    if (entry.fullLoadState !== 'idle') return;
    entry.fullLoadState = 'loading';
    const controller = new AbortController();
    entry.abort = controller;
    const requestId = (entry.fullRequestId ?? 0) + 1;
    entry.fullRequestId = requestId;
    const current = () =>
      !controller.signal.aborted &&
      this.cache.get(src) === entry &&
      entry.fullRequestId === requestId;

    // Cancel blob eviction timer — we're using/fetching it now
    if (entry.blobTimerId !== null) {
      clearTimeout(entry.blobTimerId);
      entry.blobTimerId = null;
    }

    try {
      // Re-fetch if blob was evicted by timeout
      let blob = entry.blob;
      if (!blob) {
        // Abortable: releasing an image mid-decode used to leave the fetch running to completion
        // and be discarded afterwards.
        const response = await fetch(src, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        blob = await response.blob();
        if (!current()) return;
      }

      const result = await this.decodeImage(blob, this.maxTextureSize, current);
      if (!result) return;
      this.enqueueUpload({
        src,
        owner: entry,
        bitmap: result.bitmap,
        tier: 'full',
        generateMipmaps: true,
        requestId,
      });

      // Free blob memory — no longer needed. `fullLoadState` is NOT cleared here: the bitmap is
      // still queued for upload at this point, and saying "idle" invites the next zoom to start
      // the same fetch again. The drain clears it, once the texture actually exists.
      entry.blob = null;
      entry.fullFailures = 0;
      entry.fullRetryAt = 0;
      this.onLoad?.();
    } catch (err) {
      if (!current()) return;
      console.warn(`[KookieFlow] Full-res image decode failed for "${src}":`, err);
      entry.fullFailures = (entry.fullFailures ?? 0) + 1;
      entry.fullRetryAt =
        performance.now() + Math.min(30_000, 1000 * 2 ** Math.min(entry.fullFailures - 1, 5));
      this.releaseFull(entry);
    } finally {
      const releasedSlot = this.orphanedFullLoads.delete(controller);
      if (entry.abort === controller) entry.abort = null;
      // A cancelled native decode may have been the last occupied slot. Wake the visible pass
      // after it settles so a waiting image can be admitted without another user interaction.
      if (releasedSlot && this.cache.size > 0) this.onLoad?.();
    }
  }
}

/**
 * Create a placeholder gradient image as a blob URL for demos.
 * Uses canvas.toBlob() instead of toDataURL() to avoid 33% base64 overhead.
 */
export async function createDemoImageBlobURL(
  width: number,
  height: number,
  colors: [string, string] = ['#6366f1', '#ec4899']
): Promise<string> {
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

  return new Promise<string>((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png'));
    }, 'image/png');
  });
}
