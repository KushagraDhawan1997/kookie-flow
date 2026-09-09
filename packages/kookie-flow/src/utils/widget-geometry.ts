/**
 * Where a widget sits, in WORLD coordinates.
 *
 * ONE home, because there are about to be three readers: the GL renderer that draws the widget,
 * the hit test that decides which one a pointer landed on, and the DOM input borrowed for the
 * duration of an edit. Three implementations of one rectangle is exactly the shape that produced
 * the socket-geometry defects — a dot painted 40px from where pressing it did anything.
 *
 * The numbers come from the socket layout cache, which already computes them; this only states
 * the box the cache implies, so nothing here re-derives a height or a padding.
 */

import { getEntitySocketLayout } from './socket-layout-cache';
import { DEFAULT_ENTITY_WIDTH, SOCKET_LABEL_WIDTH } from '../core/constants';
import type { ResolvedSocketLayout } from './style-resolver';
import type { Entity } from '../types';

/** A widget's world-space box. */
export interface WidgetBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The world box of the widget on input socket `socketIndex`, or null if that socket has none.
 *
 * `labelWidth` and `defaultWidth` are passed rather than read from the constants directly because
 * both are public props on `<KookieFlow>`; a reader that hardcoded them would be right until a
 * consumer set one.
 */
export function getWidgetBox(
  entity: Entity,
  socketIndex: number,
  socketLayout: ResolvedSocketLayout,
  defaultWidth: number = DEFAULT_ENTITY_WIDTH,
  labelWidth: number = SOCKET_LABEL_WIDTH
): WidgetBox | null {
  const layout = getEntitySocketLayout(entity, socketLayout);
  const pos = layout.inputs[socketIndex];
  if (!pos) return null;

  const width = entity.width ?? defaultWidth;
  const height = entity.height ?? layout.computedHeight;

  // Sockets centre vertically inside an entity taller than its own content.
  const centerOffset = (height - layout.computedHeight) / 2;

  const stacked = pos.layout === 'stacked';
  return {
    x: entity.position.x + socketLayout.padding + (stacked ? 0 : labelWidth),
    y: entity.position.y + pos.widgetY + centerOffset,
    width: width - socketLayout.padding * 2 - (stacked ? 0 : labelWidth),
    height: pos.widgetHeight,
  };
}

/** Is this world point inside the box? */
export function isPointInWidget(box: WidgetBox, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}
