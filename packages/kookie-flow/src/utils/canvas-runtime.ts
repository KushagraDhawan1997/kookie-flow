/**
 * The renderer, reachable from outside the canvas.
 *
 * `toImage()` is called on the instance ref — an object the consumer holds, outside the r3f tree
 * — and the thing that can draw is inside it. Registered by store, the same way the media
 * controls are, because that is what identifies one flow among however many are mounted.
 */

export interface CaptureOptions {
  /**
   * Device pixels per canvas pixel. Default: 2, which is a retina screenshot of what is on
   * screen. Capped at 8, because past that a large board asks for a framebuffer no GPU will give.
   */
  pixelRatio?: number;
  /** A colour behind the graph. Transparent when not given. */
  background?: string;
  /** Image format. Default: `image/png`. */
  type?: string;
}

export type CaptureFn = (options?: CaptureOptions) => string | null;

const captures = new WeakMap<object, CaptureFn>();

export function registerCapture(key: object, fn: CaptureFn | null): void {
  if (fn) captures.set(key, fn);
  else captures.delete(key);
}

export function capture(key: object, options?: CaptureOptions): string | null {
  return captures.get(key)?.(options) ?? null;
}
