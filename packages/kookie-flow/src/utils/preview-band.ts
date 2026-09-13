/**
 * Where a node's preview band sits, in world space.
 *
 * One function for the renderer that draws the band and the pointer handler that presses its
 * controls. Computed separately it would be two answers to one question, and a press would land a
 * few pixels away from the button it was aimed at the first time either changed.
 */

import type { Entity } from '../types';
import type { ResolvedSocketLayout } from './style-resolver';
import { getEntitySocketLayout } from './socket-layout-cache';

export interface BandRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Write the band's box into `out` and return whether there is one to draw.
 *
 * Writes into a caller's scratch rectangle: the renderer calls this for every visible band on every
 * pass, and a fresh object there is the hot-path allocation this project forbids.
 */
export function previewBandRect(
  entity: Entity,
  socketLayout: ResolvedSocketLayout,
  out: BandRect
): boolean {
  if (!entity.preview) return false;
  const layout = getEntitySocketLayout(entity, socketLayout);
  const width = (entity.width ?? 0) - socketLayout.padding * 2;
  /**
   * THE BAND JOINS THE SAME VERTICAL FLOW AS EVERY ROW.
   *
   * A card taller than its own content centres what is inside it: `geometry.ts` and
   * `widget-geometry.ts` both add `(height - computedHeight) / 2` to every socket and every widget.
   * Positioned at the bare `previewY`, an entity with an explicit height moved its rows down by
   * that offset and left the band where it was, drawing the picture over the inputs. Same term,
   * same sign, unclamped, exactly as the other two compute it.
   *
   * The band takes the height the layout gave it, unless the entity was given an explicit height
   * smaller than its content — then it shrinks to what is left inside the card rather than hanging
   * out of the bottom of it.
   */
  const entityHeight = entity.height ?? layout.computedHeight;
  const centerOffset = (entityHeight - layout.computedHeight) / 2;
  const top = layout.previewY + centerOffset;
  const available = entity.height === undefined
    ? layout.previewHeight
    : entityHeight - socketLayout.padding - top;
  const height = Math.min(layout.previewHeight, available);
  if (width <= 0 || height <= 0) return false;
  out.x = entity.position.x + socketLayout.padding;
  out.y = entity.position.y + top;
  out.width = width;
  out.height = height;
  return true;
}
