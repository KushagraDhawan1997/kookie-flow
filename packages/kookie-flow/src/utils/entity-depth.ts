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
 * THE NUMBERS, and the three inequalities they have to satisfy. The camera is orthographic at
 * z=100 with near 0.1 and far 1000, so usable depth is (-900, 99.9) — a 999.9-unit span.
 *
 * THE FIRST DRAFT SIZED THIS FOR A 24-BIT BUFFER AND WAS WRONG ON HARDWARE THAT GIVES 16.
 * WebGL guarantees 16 bits, not 24, and `depth: true` is a request rather than a promise. At 16
 * bits one quantum is 999.9 / 65536 = 0.01526 — and the first draft's whole ladder fitted inside
 * a single quantum: STACK_STEP was 0.01 (0.65 of a tick, so two entities one index apart could
 * round to the SAME depth and, with LessEqualDepth, both pass) and the layer offsets were 0.002,
 * 0.004 and 0.006, so a body, its widgets, its sockets and its labels all collapsed onto one
 * value. Everything the file exists to separate would have re-interleaved, on exactly the
 * hardware least able to spare the debugging.
 *
 * These numbers are sized for the 16-bit guarantee, so 24-bit hardware simply has margin:
 *
 *  1. Every step is at least two quanta, so no two distinct depths can round together:
 *        min(step between layers) = 0.04  >  2 * 0.01526
 *  2. The selected boost must exceed the WHOLE unselected span, or a selected entity with a low
 *     index would sit under an unselected one with a high index:
 *        SELECTED_BOOST > STACK_COMPACT_AT * STACK_STEP        (450 > 400)
 *  3. The top of the selected range must stay under the near plane, and the base above the far:
 *        BASE + span + boost + label < 99.9                    (-850 + 400 + 450 + 0.12)
 *        BASE > -900
 *
 * All three are asserted in entity-depth.test.ts, and the harness asserts at mount that the
 * context has a depth buffer at all — the arithmetic here passed for a long time while
 * DEPTH_BITS was 0 and none of it was reaching the GPU.
 */

/** One 16-bit depth quantum across the camera's usable range. Nothing here may be smaller. */
export const DEPTH_QUANTUM = 999.9 / 65536;

export const STACK_STEP = 0.2;
const BASE_DEPTH = -850;
const SELECTED_BOOST = 450;

/**
 * Renormalise once the counter would push the selected range past the camera: 2000 presses of
 * 0.2 is 400 units. The store compacts the order back to 1..n when this is crossed; it costs
 * a sort, rarely.
 */
export const STACK_COMPACT_AT = 2000;

/**
 * Fixed offsets above the body, within one stack step. Order is the paint order.
 *
 * Spaced 0.04 apart — a little over two 16-bit quanta — and the highest (0.12) is well under one
 * STACK_STEP, which is what keeps a back node's label behind a front node's body.
 */
export const DEPTH_LAYER = {
  body: 0,
  widget: 0.04,
  socket: 0.08,
  label: 0.12,
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
