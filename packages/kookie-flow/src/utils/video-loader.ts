/**
 * VideoTextureManager — one HTMLVideoElement per source, uploaded to GL as a VideoTexture.
 *
 * WHY THE VIDEO IS NOT A DOM ELEMENT. The obvious build is a positioned `<video>` in the DOM
 * overlay, and it is wrong here for one reason: `entity-depth.ts`. Entities in this renderer are
 * ordered by a real depth buffer, so a node pressed last covers a node pressed before it, and
 * every part of an entity sits inside that entity's own slice. The DOM overlay is a single sibling
 * above the whole canvas, so a `<video>` in it paints over EVERY entity regardless of stack order —
 * which is the exact defect entity-depth.ts was written to remove. A video that cannot go behind a
 * node is not a canvas object; it is a thing floating over the canvas. So the pixels come through
 * the same textured quad an image uses, and get culling, stacking, selection and the minimap free.
 *
 * WHAT THIS COSTS, AND WHAT BOUNDS IT. A playing video is one texture upload per frame — three's
 * VideoTexture sets `needsUpdate` whenever the element has a current frame, and this canvas runs
 * `frameloop="always"`. The cost therefore scales with the number of videos PLAYING, not with the
 * number on the board, and this class is what keeps those two numbers apart:
 *
 *   - Nothing plays until something asks it to. `setPlaying` is driven from the render loop's
 *     culling pass, so a video scrolled off screen pauses and stops uploading.
 *   - At most MAX_PLAYING videos run at once. This is not only a GPU budget. Browsers cap
 *     concurrent hardware video decoders — the limit is small on mobile — and past it playback
 *     fails silently rather than degrading, so an unbounded board of autoplaying clips would show
 *     black rectangles with no error anywhere.
 *   - A paused element still holds a decoder, so `release` tears the element down properly rather
 *     than merely pausing it.
 *
 * THE FLIP. `flipY = false`, to match the UVs media-quad.ts bakes into the shared geometry. A
 * VideoTexture defaults to `true` and arrives upside down without this.
 *
 * NO MIPMAPS. A video frame changes every frame and a mip chain would have to be rebuilt every
 * frame, which is far more expensive than the minification aliasing it would fix. Images get mips
 * because they are uploaded once; this is the reason the two managers are not one.
 */

import * as THREE from 'three';

/** State of a video source, mirroring image-loader's LoadState so callers can branch the same way. */
export type VideoLoadState = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * How many videos may decode at once.
 *
 * Chosen for the smallest platform rather than the largest: mobile Safari has historically allowed
 * a single hardware decode pipeline, and desktop browsers vary between about four and sixteen. Four
 * keeps a Flora-style board of previews working everywhere; the rest hold their poster frame, which
 * is what an unplayed preview should look like anyway.
 */
export const MAX_PLAYING_VIDEOS = 4;

/**
 * Where the poster frame is taken from.
 *
 * A hair past the start rather than at it, for the reason `onMeta` gives: seeking to the time the
 * element already reports is not a seek. Small enough that it is the opening frame in any real
 * clip, large enough to be a distinct timestamp.
 */
const POSTER_SEEK_SECONDS = 0.001;

export interface VideoEntry {
  /** The element doing the decoding. One per src, shared by every entity pointing at it. */
  readonly element: HTMLVideoElement;
  texture: THREE.VideoTexture | null;
  state: VideoLoadState;
  /** Intrinsic frame size, known once metadata arrives. 0 until then. */
  naturalWidth: number;
  naturalHeight: number;
  /** How many entities reference this src */
  refCount: number;
  /** Whether the manager currently wants this playing (distinct from whether it IS). */
  wantsPlay: boolean;
  /** Set while a play() promise is in flight, so a pause mid-flight is not lost. */
  playPending: boolean;
}

/**
 * Build the element.
 *
 * `muted` and `playsInline` are not preferences: without both, every browser's autoplay policy
 * rejects `play()` on an element the user has not interacted with, and a board of previews would
 * sit black. Audio therefore needs a deliberate unmute driven by a real gesture — a control this
 * layer does not yet have, and should not fake.
 *
 * `crossOrigin = 'anonymous'` because a texture upload from a cross-origin video without CORS
 * headers taints the canvas, and a tainted canvas breaks `readPixels` — which the minimap, the
 * harness probes and any export path all depend on.
 */
function createElement(src: string, loop: boolean): HTMLVideoElement {
  const el = document.createElement('video');
  el.src = src;
  el.crossOrigin = 'anonymous';
  el.muted = true;
  el.defaultMuted = true;
  el.playsInline = true;
  el.loop = loop;
  // 'auto' would start buffering every clip on the board at once. Metadata is enough to size the
  // entity and to decode the first frame for a poster.
  el.preload = 'metadata';
  return el;
}

export class VideoTextureManager {
  private cache = new Map<string, VideoEntry>();
  private onReady: (() => void) | undefined;
  /** Sources currently allowed to decode, in the order they asked. Bounded by MAX_PLAYING_VIDEOS. */
  private playing = new Set<string>();

  constructor(onReady?: () => void) {
    this.onReady = onReady;
  }

  /** Get or start loading the entry for a src. Returns immediately; the frame arrives later. */
  acquire(src: string, loop: boolean): VideoEntry {
    const existing = this.cache.get(src);
    if (existing) {
      existing.refCount++;
      return existing;
    }

    const element = createElement(src, loop);
    const entry: VideoEntry = {
      element,
      texture: null,
      state: 'loading',
      naturalWidth: 0,
      naturalHeight: 0,
      refCount: 1,
      wantsPlay: false,
      playPending: false,
    };
    this.cache.set(src, entry);

    const onMeta = () => {
      entry.naturalWidth = element.videoWidth;
      entry.naturalHeight = element.videoHeight;
      // FORCE A FIRST FRAME. `preload = 'metadata'` stops at readyState 1 — the size is known and
      // there is no picture — so `loadeddata` never fires and a board of unplayed previews would
      // sit on the placeholder indefinitely. Seeking makes the browser fetch and decode around
      // that point, which is the standard way to obtain a poster from the file itself rather than
      // asking the consumer to supply a second URL for one.
      //
      // Not 0: currentTime is already 0, and assigning the value it holds performs no seek.
      if (element.readyState < 2 /* HAVE_CURRENT_DATA */) {
        element.currentTime = POSTER_SEEK_SECONDS;
      }
    };

    // 'loadeddata' rather than 'loadedmetadata' is what gates the texture: metadata knows the frame
    // SIZE but there is no frame to upload yet, and a VideoTexture built that early samples black
    // until the first decode lands — which on a slow connection is a visible black rectangle where
    // the placeholder should still be.
    const onData = () => {
      if (!entry.texture) {
        const tex = new THREE.VideoTexture(element);
        tex.flipY = false;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        entry.texture = tex;
      }
      entry.naturalWidth = element.videoWidth;
      entry.naturalHeight = element.videoHeight;
      entry.state = 'loaded';
      this.onReady?.();
    };

    const onError = () => {
      entry.state = 'error';
      this.onReady?.();
    };

    element.addEventListener('loadedmetadata', onMeta);
    element.addEventListener('loadeddata', onData);
    element.addEventListener('error', onError);
    // Kept on the entry so `release` can detach them; an element that outlives its listeners is a
    // leak the GC cannot see through, because the listener closes over `this`.
    listeners.set(entry, [
      ['loadedmetadata', onMeta],
      ['loadeddata', onData],
      ['error', onError],
    ]);

    // Nothing is fetched by setting .src alone in every browser; load() makes the request explicit.
    element.load();
    return entry;
  }

  /** Decrement the ref count. Tears the element down when nothing references this src. */
  release(src: string): void {
    const entry = this.cache.get(src);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount > 0) return;

    this.playing.delete(src);
    const el = entry.element;
    el.pause();

    for (const [type, fn] of listeners.get(entry) ?? []) {
      el.removeEventListener(type, fn);
    }
    listeners.delete(entry);

    entry.texture?.dispose();
    entry.texture = null;

    // Pausing alone leaves the decoder and the network buffer alive. Clearing the source and
    // re-loading is the only portable way to make a browser give both back.
    el.removeAttribute('src');
    el.load();

    this.cache.delete(src);
  }

  getEntry(src: string): VideoEntry | undefined {
    return this.cache.get(src);
  }

  /** The texture for a src, or null while it is still loading or has failed. */
  getTexture(src: string): THREE.VideoTexture | null {
    return this.cache.get(src)?.texture ?? null;
  }

  /** Whether a src is one of the sources currently allowed to decode. */
  isPlaying(src: string): boolean {
    return this.playing.has(src);
  }

  get playingCount(): number {
    return this.playing.size;
  }

  /**
   * Ask for a src to play or pause. Honoured up to MAX_PLAYING_VIDEOS; beyond that the request is
   * recorded on the entry and granted later, when a playing video is culled or deselected.
   *
   * Returns whether the src is playing after the call, so a caller can show a paused affordance
   * for the ones that did not get a slot.
   */
  setPlaying(src: string, wantsPlay: boolean): boolean {
    const entry = this.cache.get(src);
    if (!entry) return false;
    entry.wantsPlay = wantsPlay;

    if (!wantsPlay) {
      if (this.playing.delete(src)) {
        entry.element.pause();
      }
      return false;
    }

    if (this.playing.has(src)) return true;
    if (this.playing.size >= MAX_PLAYING_VIDEOS) return false;

    this.playing.add(src);
    this.start(entry, src);
    return true;
  }

  /**
   * Make what is decoding match what the render loop wants decoding, in one pass.
   *
   * This exists instead of per-entity `setPlaying` calls because neither end of that arrangement
   * can answer the two questions that matter. An entity that has just been culled is no longer
   * iterated, so it cannot ask to be paused; and a source shared by two entities must keep playing
   * while EITHER of them can see it, which no single entity knows. A set of what should be playing,
   * computed fresh each pass, answers both — the caller states a desired state rather than a
   * sequence of transitions it has to get right.
   *
   * Allocates nothing: the caller owns and reuses the set, and the two loops here iterate in place.
   * Deleting from `playing` while iterating it is defined behaviour for a Set.
   */
  reconcilePlayback(want: ReadonlySet<string>): void {
    for (const src of this.playing) {
      if (want.has(src)) continue;
      const entry = this.cache.get(src);
      if (entry) {
        entry.wantsPlay = false;
        entry.element.pause();
      }
      this.playing.delete(src);
    }

    for (const src of want) {
      const entry = this.cache.get(src);
      if (!entry) continue;
      entry.wantsPlay = true;
      if (this.playing.has(src)) continue;
      // The cap is a hard stop, not a queue. A source that misses a slot keeps its poster frame
      // and will be granted one on a later pass, when a playing video is culled or removed.
      if (this.playing.size >= MAX_PLAYING_VIDEOS) continue;
      this.playing.add(src);
      this.start(entry, src);
    }
  }

  /**
   * `play()` returns a promise that REJECTS when autoplay is refused, and an unhandled rejection
   * here is a console error on every frame a preview scrolls into view. It can also resolve after
   * the caller has already asked for a pause — a fast scroll does exactly that — so the resolved
   * branch re-checks what is still wanted rather than trusting the request that started it.
   */
  private start(entry: VideoEntry, src: string): void {
    if (entry.playPending) return;
    entry.playPending = true;
    const p = entry.element.play();
    if (!p || typeof p.then !== 'function') {
      entry.playPending = false;
      return;
    }
    p.then(
      () => {
        entry.playPending = false;
        if (!entry.wantsPlay) {
          entry.element.pause();
          this.playing.delete(src);
        }
      },
      () => {
        // Refused (autoplay policy, or a source that cannot decode). Give the slot back so a
        // video that CAN play is not starved by one that never will.
        entry.playPending = false;
        entry.wantsPlay = false;
        this.playing.delete(src);
      }
    );
  }

  /** Release everything. Call on unmount. */
  disposeAll(): void {
    for (const src of [...this.cache.keys()]) {
      const entry = this.cache.get(src);
      if (entry) entry.refCount = 1;
      this.release(src);
    }
    this.playing.clear();
  }
}

/**
 * Listener bookkeeping, off the entry so the public shape stays data.
 *
 * A WeakMap rather than a field: the entry is what the manager hands to callers, and a caller with
 * a reference to three bound closures on it is a caller that can accidentally keep the element
 * alive.
 */
const listeners = new WeakMap<VideoEntry, Array<[string, () => void]>>();
