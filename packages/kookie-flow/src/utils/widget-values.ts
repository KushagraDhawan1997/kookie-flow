/**
 * The value a widget SHOWS, when what the person set and what the entity holds disagree.
 *
 * This is the DOM widgets' rule (widgets-layer.tsx, `editingRef`) restated as data, because
 * the GL layer has no component per widget to hold a `useState` in. The rule, verbatim from
 * there: a widget's value is local, but it follows an external write unless you are mid-edit.
 *
 *  - The library records what the person set (`local`) the moment it emits `onWidgetChange`.
 *  - While that write is in flight — the consumer has not echoed it into the entity yet — the
 *    widget shows the local value, so a slider moves under the pointer and a field does not
 *    snap back between keystrokes in every consumer that batches or debounces.
 *  - The moment the entity's value equals the local one, the round trip is complete: the local
 *    record is DROPPED, and external writes win again — a consumer setting it, an undo, a preset.
 *
 * A consumer that never echoes keeps showing the local value, which is the same trade the DOM
 * layer made and stated: a write arriving mid-edit loses to what the person chose.
 *
 * The map is mutated in place and never replaced — a pointermove must not allocate — so the
 * store bumps `widgetValuesVersion` beside it for anything that needs to notice a change.
 */

/** One key per widget, in the shape `connectedSockets` already uses for the same pair. */
export function widgetKey(entityId: string, socketId: string): string {
  return `${entityId}:${socketId}`;
}

/**
 * Resolve what to show for one widget, and retire the local record once it has round-tripped.
 *
 * `incoming` is the entity's own value with the config default already applied — what the
 * widget would show if nobody had touched it.
 */
export function readWidgetValue(
  local: Map<string, unknown>,
  key: string,
  incoming: unknown
): unknown {
  if (!local.has(key)) return incoming;
  const mine = local.get(key);
  if (Object.is(mine, incoming)) {
    // Our own value came back: the round trip is complete and external writes win again.
    local.delete(key);
    return incoming;
  }
  return mine;
}
