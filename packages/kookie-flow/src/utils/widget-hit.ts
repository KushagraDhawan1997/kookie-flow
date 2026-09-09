/**
 * Which widget a world point is on.
 *
 * Reads `getWidgetBox`, the same function the GL renderer draws from, so a widget cannot be
 * painted in one place and pressed in another. That is not a hypothetical: the socket geometry had
 * five copies of one arithmetic and two of them were wrong, which put a dot 40px from anything
 * that would answer a press.
 *
 * O(visible entities x their input sockets) rather than a spatial index, and that is a deliberate
 * bound rather than an oversight: it walks only entities whose box already contains the point —
 * which the quadtree has narrowed to one or two before either function here is called.
 *
 * TWO ENTRY POINTS, on two different clocks. `getWidgetAt` answers a POINTER DOWN and hands back
 * everything a press needs, including a box the caller keeps for the length of an edit.
 * `getWidgetSocketIdAt` answers a POINTERMOVE, sixty times a second, and therefore allocates
 * nothing at all: it walks the same sockets under the same two skip rules and returns a socket id
 * that already exists. They must agree at every point, which is a law rather than an intention —
 * see widget-hit.test.ts.
 */

import { getWidgetBox, readWidgetBoxInto, isPointInWidget, type WidgetBox } from './widget-geometry';
import { resolveWidgetConfig } from './widgets';
import { readWidgetValue, widgetKey, type WidgetOverride } from './widget-values';
import type { ResolvedSocketLayout } from './style-resolver';
import type { Entity, ResolvedWidgetConfig, SocketType } from '../types';

/**
 * The zoom below which widgets are not drawn, and therefore must not be pressable.
 *
 * This number exists because `widgets-gl.tsx` stops painting widget chrome under it — at that
 * size they are noise, not controls. It lives here as well as there because a threshold that the
 * painter honours and the presser does not is an invisible control: zoomed to 0.2, which the
 * default MIN_ZOOM of 0.01 allows, a node showed no widget row at all and a single click on it
 * still flipped a checkbox, set a slider from the click x, or opened a borrowed text input at a
 * fifth scale. Nothing on screen said a widget was there.
 *
 * One number, one meaning: `widgets-gl.tsx` should import this rather than declare its own.
 */
export const MIN_WIDGET_ZOOM = 0.4;

export interface WidgetHit {
  entityId: string;
  socketId: string;
  /**
   * The socket's human name, carried so the borrowed DOM input can announce itself.
   *
   * It used to name itself `hit.socketId` — 'label', 'w0', whatever the consumer's data model
   * happened to call the field — while the GL layer painted `socket.name` beside it. A screen
   * reader read one thing and the screen said another, and the id is not reachable from anything
   * a hit already carries, so the name had to come along with it.
   */
  socketName: string;
  /** Index among the entity's INPUT sockets. */
  index: number;
  box: WidgetBox;
  config: ResolvedWidgetConfig;
  /** The value the widget is SHOWING — the entity's, with a pending local write on top. */
  value: unknown;
}

/**
 * The widget under this world point on this entity, or null.
 *
 * `widgetValues` is the store's map of what the person has set and the consumer has not echoed
 * back yet, and it is here for the same reason the renderer reads it (widgets-gl.tsx): the press
 * path has to compute from the value on screen, not the value in the entity. Without it a
 * checkbox read `false` off the entity on the second press as well as the first and emitted
 * `true` twice, so it never unchecked; a select advanced one option and stayed there; and a text
 * field reopened showing the string it had before the last edit, underneath a GL widget already
 * showing the new one. Any consumer that batches, debounces or declines to echo saw all three.
 */
export function getWidgetAt(
  entity: Entity,
  worldX: number,
  worldY: number,
  socketTypes: Record<string, SocketType>,
  socketLayout: ResolvedSocketLayout,
  connectedSockets: Set<string>,
  widgetValues: Map<string, WidgetOverride>,
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
      socketName: socket.name,
      index: i,
      box,
      config,
      value: readWidgetValue(
        widgetValues,
        widgetKey(entity.id, socket.id),
        values?.[socket.id] ?? config.defaultValue
      ),
    };
  }
  return null;
}

/**
 * One rectangle, reused by the hover test below and by nothing else.
 *
 * It is module-scoped and never escapes: `getWidgetSocketIdAt` reads it and returns a socket id,
 * which is a string that already exists. The same shape as the `tempMatrix` every renderer here
 * keeps beside its frame loop, and for the same reason — this runs on every pointermove.
 */
const SCRATCH: WidgetBox = { x: 0, y: 0, width: 0, height: 0 };

/**
 * WHICH widget a world point is on, without building a hit for it.
 *
 * The press path needs a `WidgetHit`: a box it can keep for the length of an edit, the resolved
 * config, and the value on screen. The HOVER path needs none of that — it needs a socket id, to
 * put in the store so the renderer can light one instance. Calling `getWidgetAt` for it would
 * allocate a box per candidate socket and a hit object per hover, on every pointermove that lands
 * on a node.
 *
 * The skips are the same two `getWidgetAt` applies, deliberately: a connected socket has no widget
 * because its value comes down the edge, and a socket whose type resolves no widget has nothing to
 * hover. A hover that lit something the press path would not answer is the same paint-vs-press
 * disagreement in a different direction.
 */
export function getWidgetSocketIdAt(
  entity: Entity,
  worldX: number,
  worldY: number,
  socketTypes: Record<string, SocketType>,
  socketLayout: ResolvedSocketLayout,
  connectedSockets: Set<string>,
  defaultWidth?: number,
  labelWidth?: number
): string | null {
  const inputs = entity.inputs;
  if (!inputs) return null;
  for (let i = 0; i < inputs.length; i++) {
    const socket = inputs[i];
    if (connectedSockets.has(`${entity.id}:${socket.id}:input`)) continue;
    if (!resolveWidgetConfig(socket, socketTypes)) continue;
    const box = readWidgetBoxInto(SCRATCH, entity, i, socketLayout, defaultWidth, labelWidth);
    if (!box) continue;
    if (!isPointInWidget(box, worldX, worldY)) continue;
    return socket.id;
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
  // Clamped to the ORDERED pair, not to (min, max) as written. A config with min above max —
  // `min: 10, max: 0`, a descending slider — made `Math.max(min, snapped)` answer `min` for every
  // pointer position, since min exceeds everything in range, and the outer `Math.min(max, min)`
  // then answered `max`. The slider was frozen at one value and the grip never moved. `raw` is
  // already inside the pair by construction, so this only ever pulls a snap back in.
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(hi, Math.max(lo, snapped));
}
