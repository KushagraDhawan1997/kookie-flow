/**
 * Which widgets ONE entity exposes to the accessibility tree.
 *
 * The GL widget layer draws every widget on screen and the hit test answers a press on any of
 * them; both walk an entity's input sockets under the same two skip rules. This walks them a
 * third time, for the third consumer — `components/widget-a11y-mirror.tsx`, which mounts a real,
 * named DOM control per entry so a screen-reader or keyboard-only user has something to reach.
 *
 * THE SKIP RULES ARE THE POINT, and they are copied from `getWidgetAt` on purpose rather than
 * re-derived. A connected input socket has no widget, because its value comes down the edge; a
 * socket whose type resolves no widget config has nothing to mirror. A mirror that disagreed with
 * either would announce a control that is not on screen and cannot be pressed — the same
 * paint-versus-press disagreement the socket geometry produced once, in a direction no screenshot
 * can show.
 *
 * THE THIRD SKIP IS THIS FILE'S OWN, and it exists because the DOM widget path did not go away.
 * `widgets-layer.tsx` still mounts a consumer-supplied component — an inline `socket.widget`
 * component, or a `widgetTypes` entry replacing a built-in type — and that component is already a
 * real named control inside a `[data-entity-id]` group. Mirroring it too would put two identically
 * named controls on one node, which is exactly the defect the naming law in harness/behaviors.mjs
 * fails on ("no two widgets on one node announce the same name").
 *
 * NO GEOMETRY HERE. The mirror does not position itself over its widget — it is clipped to a
 * pixel wherever it happens to sit, and the viewport is panned to the widget instead. Asking for
 * a `WidgetBox` would mean recomputing layout on every focus move for nothing.
 *
 * NO VALUES HERE EITHER, and that is deliberate. `readWidgetValue` MUTATES the override map as a
 * side effect — it retires a local write the moment the consumer answers — so calling it from a
 * React render would be a side effect during render. The mirror reads values in an effect, from
 * the entry's config, which is why this returns the SHAPE of a widget and not its state.
 */

import { resolveWidgetConfig } from './widgets';
import type { Entity, ResolvedWidgetConfig, SocketType } from '../types';

/** One widget on one entity, as the accessibility mirror needs it. */
export interface MirrorEntry {
  socketId: string;
  /** The socket's human name — what the GL layer paints, and what the control announces. */
  socketName: string;
  /** Index among the entity's INPUT sockets, matching `WidgetHit.index`. */
  index: number;
  config: ResolvedWidgetConfig;
}

const EMPTY: MirrorEntry[] = [];

/**
 * The widgets on `entity` that no DOM control already covers, in socket order.
 *
 * `widgetTypes` is read for KEY PRESENCE only — whether the consumer has replaced this widget
 * type with a component of their own — so it is typed by what is actually used rather than by
 * what the caller happens to hold. Passing the real `Record<string, ComponentType<WidgetProps>>`
 * satisfies it without a cast.
 */
export function listEntityWidgets(
  entity: Entity,
  socketTypes: Record<string, SocketType>,
  connectedSockets: Set<string>,
  widgetTypes?: Record<string, unknown>
): MirrorEntry[] {
  const inputs = entity.inputs;
  if (!inputs || inputs.length === 0) return EMPTY;
  let out: MirrorEntry[] | null = null;
  for (let i = 0; i < inputs.length; i++) {
    const socket = inputs[i];
    // A connected socket has no widget — its value comes down the edge. The `:input` suffix is
    // not decoration: the connected set is keyed per direction, and dropping it here would mirror
    // every socket whose OUTPUT side happens to be wired.
    if (connectedSockets.has(`${entity.id}:${socket.id}:input`)) continue;
    const config = resolveWidgetConfig(socket, socketTypes);
    if (!config) continue;
    // Already a real DOM control, mounted by widgets-layer.tsx. See the docstring.
    if (config.customComponent) continue;
    if (widgetTypes && widgetTypes[config.type]) continue;
    out ??= [];
    out.push({ socketId: socket.id, socketName: socket.name, index: i, config });
  }
  return out ?? EMPTY;
}

/**
 * Do two entry lists describe the same set of controls?
 *
 * The mirror recomputes its entries whenever the graph's topology moves, which on a controlled
 * consumer is every echoed keystroke. Committing a new element set for each of those would tear
 * down and rebuild the very `<input>` the person is typing into. This answers the only question
 * that matters — has the SHAPE changed — so an unchanged shape keeps the elements that already
 * exist. Values are not compared, because values never come from here.
 */
export function sameMirrorShape(a: MirrorEntry[], b: MirrorEntry[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.socketId !== y.socketId) return false;
    if (x.socketName !== y.socketName) return false;
    if (x.config.type !== y.config.type) return false;
    if (x.config.min !== y.config.min) return false;
    if (x.config.max !== y.config.max) return false;
    if (x.config.step !== y.config.step) return false;
    if (x.config.rows !== y.config.rows) return false;
    if (x.config.placeholder !== y.config.placeholder) return false;
    const ao = x.config.options;
    const bo = y.config.options;
    if (ao !== bo) {
      if (!ao || !bo || ao.length !== bo.length) return false;
      for (let j = 0; j < ao.length; j++) if (ao[j] !== bo[j]) return false;
    }
  }
  return true;
}

/**
 * What a mirror control's `value` should read, given the value the widget is showing.
 *
 * This exists because writing a value a control cannot represent NEVER SETTLES, and the sync that
 * writes it runs again on every store change. Each of the three cases below is a real browser
 * behaviour that silently rewrites what you assigned:
 *
 *  - a `range` clamps an out-of-bounds number to its own min/max, so assigning 150 to a 0..100
 *    slider leaves `el.value === '100'` and a naive `el.value !== next` comparison is true
 *    forever;
 *  - a `color` coerces anything that is not `#rrggbb` to `#000000`;
 *  - a `select` given a value none of its options offer reports `''`.
 *
 * Normalising here means the comparison in the sync loop reaches a fixed point after one write,
 * which is the difference between a hidden input touched once and a hidden input touched on every
 * pointermove of a drag.
 */
export function mirrorDisplayValue(config: ResolvedWidgetConfig, value: unknown): string {
  if (config.type === 'slider') {
    const min = config.min ?? 0;
    const max = config.max ?? 1;
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    const n = Number(value);
    if (!Number.isFinite(n)) return String(lo);
    return String(Math.min(hi, Math.max(lo, n)));
  }
  if (config.type === 'color') {
    const s = typeof value === 'string' ? value : '';
    return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : '#000000';
  }
  if (config.type === 'select') {
    const s = value === undefined || value === null ? '' : String(value);
    return config.options?.includes(s) ? s : '';
  }
  return value === undefined || value === null ? '' : String(value);
}
