/**
 * What to make of something that arrived: a pasted file, a dropped one, a URL on the clipboard.
 *
 * The rule is that pasting a picture into a canvas has to put a picture on the canvas. Anything
 * else — a callback that must be wired first, a silent no-op — is the behaviour people read as
 * broken, and it is the reason this is a default rather than an opt-in.
 *
 * What it will make: an image, a video, a model. What it will not: a guess. A text file, a PDF,
 * a spreadsheet — those belong to the app, which hears about them through `onFileDrop` and can do
 * whatever it likes.
 */

import type { Entity } from '../types';
import {
  DEFAULT_IMAGE_WIDTH,
  DEFAULT_IMAGE_HEIGHT,
  DEFAULT_VIDEO_WIDTH,
  DEFAULT_VIDEO_HEIGHT,
  DEFAULT_MESH_WIDTH,
  DEFAULT_MESH_HEIGHT,
} from '../core/constants';

export type MediaKind = 'image' | 'video' | 'mesh';

/** Just enough of a File to decide what it is; the tests hand over a plain object. */
export interface FileLike {
  name: string;
  type: string;
}

const MESH_EXTENSIONS = ['.glb', '.gltf'];

/**
 * What kind of media a file is, or null if it is not media.
 *
 * MIME type first, because a browser that knows is more reliable than a filename. glTF is the
 * case where the browser usually does not know: `model/gltf-binary` is registered but rarely
 * served, and a `.glb` off a disk arrives as an empty type or as octet-stream.
 */
export function mediaKindOfFile(file: FileLike): MediaKind | null {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.includes('gltf')) return 'mesh';

  const name = (file.name || '').toLowerCase();
  for (const ext of MESH_EXTENSIONS) if (name.endsWith(ext)) return 'mesh';
  return null;
}

/** The same question for a URL on the clipboard. */
export function mediaKindOfUrl(text: string): MediaKind | null {
  const trimmed = text.trim();
  if (!/^(https?:\/\/|data:|blob:|\/)/i.test(trimmed)) return null;
  const withoutQuery = trimmed.split(/[?#]/, 1)[0].toLowerCase();
  if (trimmed.startsWith('data:')) {
    if (trimmed.startsWith('data:image/')) return 'image';
    if (trimmed.startsWith('data:video/')) return 'video';
    if (/^data:[^,;]*gltf/.test(trimmed)) return 'mesh';
    return null;
  }
  for (const ext of MESH_EXTENSIONS) if (withoutQuery.endsWith(ext)) return 'mesh';
  if (/\.(mp4|webm|ogv|mov|m4v)$/.test(withoutQuery)) return 'video';
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(withoutQuery)) return 'image';
  return null;
}

const SIZES: Record<MediaKind, { width: number; height: number }> = {
  image: { width: DEFAULT_IMAGE_WIDTH, height: DEFAULT_IMAGE_HEIGHT },
  video: { width: DEFAULT_VIDEO_WIDTH, height: DEFAULT_VIDEO_HEIGHT },
  mesh: { width: DEFAULT_MESH_WIDTH, height: DEFAULT_MESH_HEIGHT },
};

/**
 * The entity for a piece of media, centred on where it arrived.
 *
 * Centred rather than corner-anchored, because the position is where the pointer was or where the
 * viewport's middle is, and both mean "here" rather than "the top-left of here". An image
 * reshapes itself to its own aspect once it decodes, so the size here is only the opening one.
 */
export function mediaEntity(
  kind: MediaKind,
  src: string,
  at: { x: number; y: number },
  id: string
): Entity {
  const { width, height } = SIZES[kind];
  return {
    id,
    type: kind,
    position: { x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2) },
    width,
    height,
    data: kind === 'video' ? { src, autoplay: true, loop: true } : { src },
  };
}
