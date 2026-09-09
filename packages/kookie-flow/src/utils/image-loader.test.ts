import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Image textures give their memory back, and a full-res decode happens once.
 *
 * Three separate leaks, all in the same file:
 *
 *  - `texture.dispose()` frees the GPU handle and leaves the decoded pixels — an ImageBitmap
 *    outside the JS heap, ~16MB for a 2048x2048 tier — to a collector that may not run for a long
 *    time. `close()` returns it at the moment the image leaves the screen.
 *  - the upload drain assigned `entry.full = tex` over whatever was already there, so a re-decode
 *    of the same image leaked the previous texture AND incremented the full-res count a second
 *    time, which drove the LRU to evict textures still on screen.
 *  - `fullLoadState` was cleared when the decode was ENQUEUED, so the entry read as idle while its
 *    bitmap was still in the upload queue and the next zoom past the LOD threshold started the
 *    whole fetch-and-decode again.
 *
 * These drive the real `ImageTextureManager` with fake bitmaps. `close()` is the observable: a
 * spy on it is the only way to tell "disposed" from "disposed and released", and the whole point
 * of the first fix is that those looked identical before.
 */

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  return actual;
});

const { ImageTextureManager } = await import('./image-loader');

/** A stand-in for an ImageBitmap: what three keeps as `texture.image`. */
function fakeBitmap(width = 64, height = 64) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

/** Reach into the manager the way the upload queue does, without a GPU. */
function enqueue(mgr: InstanceType<typeof ImageTextureManager>, src: string, tier: 'thumbnail' | 'full', bmp: ImageBitmap) {
  // @ts-expect-error — private by design; this is the seam the drain reads.
  mgr.uploadQueue.push({ src, bitmap: bmp, tier, generateMipmaps: tier === 'full' });
}

function seed(mgr: InstanceType<typeof ImageTextureManager>, src: string) {
  // @ts-expect-error — private cache, seeded so the drain has an entry to fill.
  mgr.cache.set(src, {
    refCount: 1,
    thumbnail: null,
    full: null,
    blob: null,
    blobTimerId: null,
    abort: null,
    state: 'loaded',
    fullLoadState: 'loading',
    lastAccessTime: 0,
  });
  // @ts-expect-error — private cache
  return mgr.cache.get(src);
}

let mgr: InstanceType<typeof ImageTextureManager>;
beforeEach(() => {
  mgr = new ImageTextureManager();
});

describe('image texture memory', () => {
  it('releasing an image closes its bitmaps, not just the GPU handle', () => {
    const thumb = fakeBitmap();
    const full = fakeBitmap(512, 512);
    seed(mgr, 'a');
    enqueue(mgr, 'a', 'thumbnail', thumb);
    enqueue(mgr, 'a', 'full', full);
    mgr.processUploadQueue(4);

    mgr.release('a');

    expect(thumb.close).toHaveBeenCalledTimes(1);
    expect(full.close).toHaveBeenCalledTimes(1);
  });

  it('disposeAll closes every bitmap it holds', () => {
    const a = fakeBitmap();
    const b = fakeBitmap();
    seed(mgr, 'a');
    seed(mgr, 'b');
    enqueue(mgr, 'a', 'full', a);
    enqueue(mgr, 'b', 'full', b);
    mgr.processUploadQueue(4);

    mgr.disposeAll();

    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
  });

  it('re-decoding the same image releases the texture it replaces', () => {
    const first = fakeBitmap();
    const second = fakeBitmap();
    seed(mgr, 'a');
    enqueue(mgr, 'a', 'full', first);
    mgr.processUploadQueue(4);
    enqueue(mgr, 'a', 'full', second);
    mgr.processUploadQueue(4);

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
  });

  it('re-decoding the same image does not inflate the full-res count', () => {
    // The count drives LRU eviction. Counting the same entry twice made the manager evict
    // textures that were still on screen.
    seed(mgr, 'a');
    enqueue(mgr, 'a', 'full', fakeBitmap());
    mgr.processUploadQueue(4);
    enqueue(mgr, 'a', 'full', fakeBitmap());
    mgr.processUploadQueue(4);

    // @ts-expect-error — private counter, which is the thing under test.
    expect(mgr.fullResCount).toBe(1);
  });

  it('an entry stays non-idle until its texture actually exists', () => {
    // Cleared at enqueue, the entry read as idle while its bitmap was still queued — so the next
    // zoom past the LOD threshold started the same fetch and decode over again.
    const entry = seed(mgr, 'a');
    expect(entry).toBeDefined();
    enqueue(mgr, 'a', 'full', fakeBitmap());
    expect(entry?.fullLoadState).toBe('loading');
    mgr.processUploadQueue(4);
    expect(entry?.fullLoadState).toBe('idle');
  });

  it('a bitmap whose entry vanished mid-flight is still closed', () => {
    // The guard against a fix that only releases on the happy path.
    const orphan = fakeBitmap();
    seed(mgr, 'a');
    enqueue(mgr, 'a', 'full', orphan);
    mgr.release('a');
    mgr.processUploadQueue(4);
    expect(orphan.close).toHaveBeenCalledTimes(1);
  });
});
