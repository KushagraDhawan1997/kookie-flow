/**
 * What a preview band was given, and therefore how to draw it.
 *
 * The value on an output socket is whatever the app's `onEvaluate` returned — a URL, a data URI,
 * a decoded bitmap, a number, an object, or nothing yet. This decides which of the three drawing
 * paths it belongs to, and it is a pure function so the decision can be tested without a GPU.
 *
 * Deliberately narrow: a value it does not recognise leaves the band empty rather than guessing.
 * A band that shows the wrong thing is worse than one that shows nothing, and the app can always
 * hand over a string.
 */

/** Something the GPU can upload directly, handed over rather than fetched. */
export type PreviewBitmap = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

export type PreviewSource =
  | { kind: 'image'; src: string }
  | { kind: 'video'; src: string }
  | { kind: 'mesh'; src: string }
  | { kind: 'bitmap'; image: PreviewBitmap }
  | { kind: 'none' };

const NONE: PreviewSource = { kind: 'none' };

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogv', '.mov', '.m4v'];
const MESH_EXTENSIONS = ['.glb', '.gltf'];

/**
 * The extension of a URL, lowercased, with any query string and fragment removed.
 *
 * `?v=2` and `#t=3` are ordinary on a real asset URL, and a naive `endsWith('.mp4')` misses every
 * one of them.
 */
function extensionOf(src: string): string {
  const withoutQuery = src.split(/[?#]/, 1)[0];
  const lastDot = withoutQuery.lastIndexOf('.');
  const lastSlash = withoutQuery.lastIndexOf('/');
  if (lastDot < 0 || lastDot < lastSlash) return '';
  return withoutQuery.slice(lastDot).toLowerCase();
}

/** The media type named in a `data:` URI, e.g. `image/png`. */
function dataUriType(src: string): string {
  const semicolon = src.indexOf(';');
  const comma = src.indexOf(',');
  const end = semicolon >= 0 && semicolon < comma ? semicolon : comma;
  return end < 0 ? '' : src.slice(5, end).toLowerCase();
}

function classifyString(src: string): PreviewSource {
  if (src.length === 0) return NONE;

  if (src.startsWith('data:')) {
    const type = dataUriType(src);
    if (type.startsWith('image/')) return { kind: 'image', src };
    if (type.startsWith('video/')) return { kind: 'video', src };
    if (type.includes('gltf')) return { kind: 'mesh', src };
    return NONE;
  }

  const ext = extensionOf(src);
  if (MESH_EXTENSIONS.includes(ext)) return { kind: 'mesh', src };
  if (VIDEO_EXTENSIONS.includes(ext)) return { kind: 'video', src };

  /**
   * Everything else that looks like a location is treated as a picture.
   *
   * An image URL often has no extension at all — a signed CDN link, an `/api/render/42` — and
   * refusing those would make the common case the one that does not work. A blob URL has no
   * extension either and is what `URL.createObjectURL` gives back. Plain words are not locations
   * and stay empty: a node whose output happens to be the string "done" must not fetch it.
   */
  if (
    src.startsWith('blob:') ||
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('/') ||
    src.startsWith('./') ||
    src.startsWith('../')
  ) {
    return { kind: 'image', src };
  }
  return NONE;
}

export function classifyPreviewValue(value: unknown): PreviewSource {
  if (typeof value === 'string') return classifyString(value);
  if (value === null || value === undefined) return NONE;

  // `instanceof` needs the constructors, which do not exist while server-rendering.
  if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) {
    return { kind: 'bitmap', image: value };
  }
  if (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) {
    return { kind: 'bitmap', image: value };
  }
  if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) {
    return { kind: 'bitmap', image: value };
  }
  return NONE;
}

/** Whether two classifications name the same thing, so a redraw can be skipped. */
export function sameSource(a: PreviewSource, b: PreviewSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'bitmap' && b.kind === 'bitmap') return a.image === b.image;
  if (a.kind === 'none' || b.kind === 'none') return true;
  return 'src' in a && 'src' in b && a.src === b.src;
}
