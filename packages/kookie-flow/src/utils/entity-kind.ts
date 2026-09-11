/**
 * Which entity types draw themselves, and which are nodes.
 *
 * THE LIST WAS DUPLICATED, AND THAT IS WHY THIS FILE EXISTS. `nodes.tsx` and `text-renderer.tsx`
 * each carried the same four-way `entity.type === 'comment' || … || 'image'` chain, and each was
 * the same claim: this type has its own renderer, so do not paint a node body or a node title on
 * it. Two copies of one list is one copy too many — adding `video` and `mesh` to a chain in one
 * file and not the other paints a node body underneath a playing video, which is exactly the class
 * of defect that only shows up when the two renderers disagree.
 *
 * MEDIA is called out separately from the rest because it earns behaviour beyond "not a node":
 * a picture, a clip and a model all have an intrinsic aspect ratio, so all three lock their
 * proportions on resize by default, and all three are reshaped to that ratio once it is known.
 */

import type { Entity } from '../types';

/**
 * Types drawn as a rectangle of media with an intrinsic aspect ratio.
 *
 * All three are one textured quad — see utils/media-quad.ts. What differs is where the pixels come
 * from: a decoded ImageBitmap, a video frame, or a render target holding a 3D scene.
 */
const MEDIA_TYPES: ReadonlySet<string> = new Set(['image', 'video', 'mesh']);

/**
 * Types that own their whole appearance, so the node renderers must leave them alone.
 *
 * Comments are DOM. Text is its own glyph layer. Reroutes are a dot. The media types are quads.
 * Ink is a ribbon of triangles. None of them wants a node body, a header band or a title drawn
 * over it.
 */
const SELF_DRAWN_TYPES: ReadonlySet<string> = new Set([
  'comment',
  'reroute',
  'text',
  'image',
  'video',
  'mesh',
  'draw',
]);

/**
 * Types the evaluation engine never runs. They hold content and compute nothing, so a consumer's
 * `onEvaluate` is never asked about them. Reroutes are absent on purpose: they carry values.
 */
const UNEVALUATED_TYPES: ReadonlySet<string> = new Set(['comment', 'text', 'image', 'video', 'mesh', 'draw']);

/** Whether the evaluation engine runs entities of this type. */
export function isEvaluated(type: string): boolean {
  return !UNEVALUATED_TYPES.has(type);
}

/** Whether an entity is drawn by a renderer of its own rather than as a node body. */
export function isSelfDrawn(type: string): boolean {
  return SELF_DRAWN_TYPES.has(type);
}

/** Whether an entity is a media rectangle: image, video or mesh. */
export function isMediaType(type: string): boolean {
  return MEDIA_TYPES.has(type);
}

/**
 * Whether a resize should hold this entity's proportions unless the user says otherwise.
 *
 * True for media, because a picture squashed off its own aspect ratio is a mistake far more often
 * than it is an intent — so Shift INVERTS the default rather than enabling it. `aspectLocked:
 * false` in the entity's data opts out, which is the escape hatch for a deliberate stretch.
 */
export function locksAspectByDefault(entity: Entity | undefined): boolean {
  if (!entity || !isMediaType(entity.type)) return false;
  return (entity.data as { aspectLocked?: boolean }).aspectLocked !== false;
}
