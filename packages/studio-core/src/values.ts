/**
 * What sits on a socket.
 *
 * A picture is never the bytes. It is a reference: a content hash that says WHICH picture, a size,
 * and one or more places the pixels can be found — a URL, a texture in the GPU worker, a small
 * bitmap for the node's band. Two values with the same hash are the same picture, which is what
 * lets a re-run with unchanged inputs return the cached result and lets the canvas skip a redraw.
 */

export type MediaKind = 'image' | 'video' | 'mask';

export interface MediaRef {
  kind: MediaKind;
  /** Content hash. Equal hash, equal pixels. */
  hash: string;
  width: number;
  height: number;
  /** Where the bytes live outside the GPU, when they do: a stored asset or a data URL. */
  url?: string;
  /** For a GPU result that has not left the worker: the worker's texture id. */
  texture?: string;
  /**
   * A small picture for the node's band. The canvas draws this directly; it is what a node
   * shows without anyone uploading the full result to the main thread.
   */
  preview?: string | ImageBitmap;
  mime?: string;
  /** Seconds; video only. */
  duration?: number;
  /** Video only. */
  fps?: number;
}

export function isMediaRef(value: unknown): value is MediaRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<MediaRef>;
  return (
    (v.kind === 'image' || v.kind === 'video' || v.kind === 'mask') &&
    typeof v.hash === 'string' &&
    typeof v.width === 'number' &&
    typeof v.height === 'number'
  );
}

/** The identity of a value for a cache key: a picture is its hash, anything else is itself. */
export function valueIdentity(value: unknown): unknown {
  if (isMediaRef(value)) return `${value.kind}:${value.hash}`;
  if (Array.isArray(value)) return value.map(valueIdentity);
  return value;
}
