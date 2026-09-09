/**
 * Where an entity sits in DEPTH — the GL answer to z-index, and the reason the widgets moved
 * into GL in the first place.
 *
 * THE DEFECT THIS REPLACES. Every layer here painted with `depthTest: false`, so the only thing
 * deciding what covered what was `renderOrder` — and renderOrder is per LAYER, not per NODE.
 * All widgets were above all unselected bodies, all labels above all widgets, for every node
 * in the scene at once. Two overlapping nodes therefore interleaved: the back node's slider
 * painted over the front node's body. That is the DOM's z-index problem, reproduced in GL
 * with the one hardware feature that solves it switched off.
 *
 * THE RULE. Each entity has a stack index (store: `stackOrder`, bumped by `bringToFront` on
 * every press — last interacted on top, Figma's rule). Its depth is that index scaled, and
 * everything the entity is made of — body, widgets, sockets, labels — sits a small fixed step
 * above its body, INSIDE the entity's own slice, so a node in front covers all of a node
 * behind and nothing of its own. Bodies write depth; the parts test against it but do not
 * write, so a glyph quad's transparent corners cannot punch holes in what is behind them.
 *
 * THE NUMBERS, and the two inequalities they have to satisfy. The camera is orthographic at
 * z=100 with near 0.1 and far 1000, so usable depth is (-900, 99.9), and a 24-bit buffer
 * resolves about 6e-5 per step across it. A stack step of 0.01 is ~160 ticks; the widest layer
 * offset, 0.006, is ~100.
 *
 *  1. The selected boost must exceed the WHOLE unselected span, or a selected entity with a low
 *     index would sit under an unselected one with a high index:
 *        SELECTED_BOOST > STACK_COMPACT_AT * STACK_STEP        (450 > 400)
 *  2. The top of the selected range must stay under the near plane, and the base above the far:
 *        BASE + span + boost + label < 99.9                    (-850 + 400 + 450 + 0.006)
 *        BASE > -900
 *
 * Both are asserted in entity-depth.test.ts; the first draft of these numbers failed both.
 */

export const STACK_STEP = 0.01;
const BASE_DEPTH = -850;
const SELECTED_BOOST = 450;

/**
 * Renormalise once the counter would push the selected range past the camera: 40k presses of
 * 0.01 is 400 units. The store compacts the order back to 1..n when this is crossed; it costs
 * a sort, rarely.
 */
export const STACK_COMPACT_AT = 40000;

/** Fixed offsets above the body, within one stack step. Order is the paint order. */
export const DEPTH_LAYER = {
  body: 0,
  widget: 0.002,
  socket: 0.004,
  label: 0.006,
} as const;

/** The depth of an entity's body plane. Add a `DEPTH_LAYER` for anything drawn on it. */
export function entityDepth(
  id: string,
  stackOrder: ReadonlyMap<string, number>,
  selectedEntityIds: ReadonlySet<string>
): number {
  return (
    BASE_DEPTH +
    (stackOrder.get(id) ?? 0) * STACK_STEP +
    (selectedEntityIds.has(id) ? SELECTED_BOOST : 0)
  );
}

/**
 * Which of several entities under a point is the one a press should land on: the one on top.
 *
 * The quadtree hands back every entity whose box contains the point, in reverse insertion
 * order, and every hit test used to take `[0]` — an implicit "later in the array wins" that
 * matched the old paint order and matches nothing now. With overlapping nodes that meant a
 * press on the node you could SEE went to the node underneath it: measured, dragging the
 * visible node's slider moved the hidden node instead.
 *
 * O(k) over the candidates, which the quadtree has already narrowed to the one or two boxes
 * that contain the point.
 */
export function topmostEntityId(
  ids: readonly string[],
  stackOrder: ReadonlyMap<string, number>
): string | null {
  let best: string | null = null;
  let bestIndex = -Infinity;
  for (const id of ids) {
    const index = stackOrder.get(id) ?? 0;
    if (index > bestIndex) {
      bestIndex = index;
      best = id;
    }
  }
  return best;
}
