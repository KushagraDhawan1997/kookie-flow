/**
 * Which widget a world point is on.
 *
 * Reads `getWidgetBox`, the same function the GL renderer draws from, so a widget cannot be
 * painted in one place and pressed in another. That is not a hypothetical: the socket geometry had
 * five copies of one arithmetic and two of them were wrong, which put a dot 40px from anything
 * that would answer a press.
 *
 * O(visible entities x their input sockets) rather than a spatial index, and that is a deliberate
 * bound rather than an oversight: this runs on POINTER DOWN, not per frame, and it walks only
 * entities whose box already contains the point — which the quadtree has narrowed to one or two
 * before this is called.
 */

import { getWidgetBox, isPointInWidget, type WidgetBox } from './widget-geometry';
import { resolveWidgetConfig } from './widgets';
import type { ResolvedSocketLayout } from './style-resolver';
import type { Entity, ResolvedWidgetConfig, SocketType } from '../types';

export interface WidgetHit {
  entityId: string;
  socketId: string;
  /** Index among the entity's INPUT sockets. */
  index: number;
  box: WidgetBox;
  config: ResolvedWidgetConfig;
  /** The value the widget is showing, straight off the entity. */
  value: unknown;
}

/** The widget under this world point on this entity, or null. */
export function getWidgetAt(
  entity: Entity,
  worldX: number,
  worldY: number,
  socketTypes: Record<string, SocketType>,
  socketLayout: ResolvedSocketLayout,
  connectedSockets: Set<string>,
  defaultWidth?: number,
  labelWidth?: number
): WidgetHit | null {
  const inputs = entity.inputs ?? [];
  for (let i = 0; i < inputs.length; i++) {
    const socket = inputs[i];
    // A connected socket has no widget — its value comes down the edge.
    if (connectedSockets.has(`${entity.id}:${socket.id}:input`)) continue;
    const config = resolveWidgetConfig(socket, socketTypes);
    if (!config) continue;
    const box = getWidgetBox(entity, i, socketLayout, defaultWidth, labelWidth);
    if (!box) continue;
    if (!isPointInWidget(box, worldX, worldY)) continue;
    const values = (entity.data as { values?: Record<string, unknown> } | undefined)?.values;
    return {
      entityId: entity.id,
      socketId: socket.id,
      index: i,
      box,
      config,
      value: values?.[socket.id] ?? config.defaultValue,
    };
  }
  return null;
}

/**
 * The value a slider takes when the pointer is at `worldX`.
 *
 * Snapped to `step` where one is given, and clamped to the box — a grip that could leave its
 * channel is the wall defect a segmented control already had to fix.
 */
export function sliderValueAt(hit: WidgetHit, worldX: number): number {
  const min = hit.config.min ?? 0;
  const max = hit.config.max ?? 1;
  const t = Math.min(1, Math.max(0, (worldX - hit.box.x) / hit.box.width));
  const raw = min + t * (max - min);
  const step = hit.config.step;
  if (!step || !Number.isFinite(step) || step <= 0) return raw;
  // Snapped relative to `min`, not to zero: a range of 1..10 stepping by 3 offers 1/4/7/10, and
  // snapping to absolute multiples would offer 3/6/9 — values outside the stated range.
  const snapped = min + Math.round((raw - min) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

/** The option a select moves to when it is pressed, cycling and wrapping. */
export function nextSelectValue(hit: WidgetHit): string | null {
  const options = hit.config.options;
  if (!options || options.length === 0) return null;
  const current = typeof hit.value === 'string' ? options.indexOf(hit.value) : -1;
  return options[(current + 1) % options.length];
}
