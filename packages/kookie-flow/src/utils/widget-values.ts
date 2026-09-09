/**
 * The value a widget SHOWS, when what the person set and what the entity holds disagree.
 *
 * This is the DOM widgets' rule (widgets-layer.tsx, `editingRef`) restated as data, because
 * the GL layer has no component per widget to hold a `useState` in. The rule, verbatim from
 * there: a widget's value is local, but it follows an external write unless you are mid-edit.
 *
 *  - The library records what the person set (`value`) the moment it emits `onWidgetChange`,
 *    together with what the entity said at that instant (`baseline`).
 *  - While that write is in flight — the consumer has not echoed it into the entity yet — the
 *    widget shows the local value, so a slider moves under the pointer and a field does not
 *    snap back between keystrokes in every consumer that batches or debounces.
 *  - The moment the entity's value MOVES OFF the baseline, the consumer has answered and the
 *    round trip is complete: the local record is DROPPED, and external writes win again — a
 *    consumer setting it, an undo, a preset.
 *
 * THE BASELINE IS WHY THIS IS NOT JUST A VALUE COMPARISON, and the difference is a real defect.
 * Retirement used to be `Object.is(mine, incoming)` — the local record went only when the entity
 * came back holding EXACTLY what the person had set. A consumer that clamps, rounds, validates or
 * re-serialises answers with something else, so the comparison never matched, the override never
 * retired, and the widget showed the person's rejected value forever while the entity held the
 * corrected one. A slider capped at 100 sat at the 150 someone dragged it to, permanently, and
 * every later external write to that socket lost to it. Comparing against the baseline instead
 * asks the question that actually matters — has the consumer responded at all — and a clamped
 * answer is still an answer.
 *
 * A consumer that never echoes keeps showing the local value, which is the same trade the DOM
 * layer made and stated: a write arriving mid-edit loses to what the person chose.
 *
 * Widget values are primitives — a string, a number, a boolean — which is what makes `Object.is`
 * the right comparison for the baseline. A consumer storing an object under a socket id would
 * hand back a fresh reference every render and retire the override instantly; nothing in the
 * package produces one, and the widget types cannot express one.
 *
 * The map is mutated in place and never replaced — a pointermove must not allocate — so the
 * store bumps `widgetValuesVersion` beside it for anything that needs to notice a change.
 */

/** What the person set, and what the entity said when they set it. */
export interface WidgetOverride {
  /** The value to show until the consumer answers. */
  value: unknown;
  /** What `entity.data.values[socketId]` held at the moment of the local write. */
  baseline: unknown;
}

/** One key per widget, in the shape `connectedSockets` already uses for the same pair. */
export function widgetKey(entityId: string, socketId: string): string {
  return `${entityId}:${socketId}`;
}

/**
 * Resolve what to show for one widget, and retire the local record once the consumer has answered.
 *
 * `incoming` is the entity's own value with the config default already applied — what the
 * widget would show if nobody had touched it.
 */
export function readWidgetValue(
  local: Map<string, WidgetOverride>,
  key: string,
  incoming: unknown
): unknown {
  const mine = local.get(key);
  if (mine === undefined) return incoming;
  if (!Object.is(mine.baseline, incoming)) {
    // The entity has moved since the local write, so the consumer has answered — whatever it
    // answered with. External writes win again.
    local.delete(key);
    return incoming;
  }
  return mine.value;
}
