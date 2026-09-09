# Phase 1 audit — what it found, and what has been done about it

Full report and raw findings: run the audit's own artefacts from the session, or read the summary
below. 214 raw findings from 7 lenses → 177 after dedup → **143 survived adversarial refutation**
(34 refuted and excluded). 10 critical, 38 high, 47 medium, 48 low. A completeness critic added 10
more.

**The finding behind the findings.** Exactly one file in the package had tests — `graph.ts`, at
100% function coverage — and it contributed **zero** of the 143. Every defect lives in a file with
no coverage. Nine confirmed store defects, and 149/149 stayed green throughout. That is not an
argument for building the harness first; it is a measurement.

---

## Fixed on this branch

| # | What | Where | Proof |
|---|---|---|---|
| 1 | **`radius="full"` erased every node.** `roundedBoxSDF` never clamped `r` to `min(b.x, b.y)`, so past that bound every fragment falls outside the shape and the early-discard removes the box. | `nodes.tsx`, `entity-selection.tsx` (3 SDF definitions) | Node-body ink 170/170 → **3/170**, back to 169/170 after the clamp |
| 2 | **The library was not reentrant.** `_idToIndex` and `_movedEntityIds` were module singletons and `createFlowStore` cleared the shared map, so a second `<KookieFlow>` killed dragging in the first. | `core/store.ts` | Falsified: the first store's entity did not move at all |
| 3 | **The id index went stale**, so a drag after a delete wrote to the wrong slot — or past the end, spreading `undefined` and appending an entity with `id === undefined`. | `core/store.ts` (6 actions) | Falsified: `entities.every(e => typeof e.id === 'string')` is false pre-fix |
| 4 | **Parent-chain walks were unbounded.** A cycle set through the public `setEntities` or `applyEntityChanges({type:'parent'})` hangs the tab, and `isEntityHidden` runs for every entity on every change. | `utils/grouping.ts` (5 walkers + `sortByDepth`) | Falsified: the pre-fix test run does not fail, it **hangs** |
| 5 | **Theme changes never reached WebGL.** The token reader's MutationObserver filtered five `data-*` attributes and not `class`, but v1 carries appearance in className and `detectAppearance` reads `classList`. | `hooks/useThemeTokens.ts` | GL mean colour now moves 251,251,252 → 18,18,20 on a flip |
| 6 | **`tokensEqual` sampled four values**, so an accent-only change was swallowed. | `hooks/useThemeTokens.ts` | Now compares every token |
| 7 | **A theme change erased the nodes.** `args={[geometry, material, capacity]}` makes R3F reconstruct the mesh when the theme-memoised material changes, while the init effect was keyed on the buffers. | `nodes.tsx` | Ink 170/170 → **41/170** on a flip; fixed |
| 8 | **Same for the socket meshes**, which additionally lose the `fgMesh.instanceMatrix = bgMesh.instanceMatrix` aliasing the two-layer split depends on. | `sockets.tsx` | Socket band 1730 → 1176 pre-fix |
| 9 | **Same for the selection outline** — found only by the round trip; it came back as a partial rectangle and never recovered. | `entity-selection.tsx` | Round trip drifted by 382px; now identical |
| 10 | **OKLCH, lab and every modern colour function resolved to mid-grey**, silently. Chrome returns them from `getComputedStyle` unchanged. | `utils/color.ts` | 10 formats verified against an independent canvas readback |
| 11 | **The per-edge layer cache was a zero-length array**, never grown while its three siblings were, so every write was silently discarded and the change-detection comparison was always true — the selection fast path rewrote every vertex of every edge. | `edges.tsx` | Correctness covered by the selection behaviours; the perf benefit is **unmeasured** |
| 12 | **A socket was not grabbable where it was painted, three ways.** The index defaulted a width-less entity to 200 while the renderer uses `DEFAULT_ENTITY_WIDTH` (240); the update path wrote `x + width` where the insert path wrote `x + width + SOCKET_OFFSET`; and the index ignored an explicit `socket.position` that all three renderer copies honour. | `core/store.ts` (4 paths), `utils/geometry.ts` | Falsified in Chromium: pressing the painted dot started **no** connection, and a press 40px left over empty canvas did |
| 13 | **Edges did not touch the sockets they named.** `edges.tsx` and `connection-line.tsx` re-derived socket Y with `max(1, out + in) * rowHeight` — a uniform row height — which is right only where every row is the same height. | `edges.tsx`, `connection-line.tsx`, `sockets.tsx`, `geometry.ts` | Read off the DRAWN vertices: 10px off a stacked socket, 40px off a three-row widget, 28px off an explicit socket height; 0.00px after |
| 14 | **The wrapped-text cache was blind to the font.** Its key was `content\|maxWidth\|letterSpacing`; a `clearWrapCache()` export carried the comment "Call when font changes" and had **zero callers**, so a paragraph kept the previous font's line breaks for the rest of the session. | `utils/text-layout.ts` | Falsified: three of four laws fail against a single font-blind cache, including the premise that two fonts wrap differently at all |
| 15 | **The published hit box was 44px shorter than the drawn one.** `isPointInEntity`, `getEntityAtPosition` and `getEntitiesInBox` assumed `DEFAULT_ENTITY_HEIGHT` (100) for a height-less entity, which the renderer draws at its computed height (144 for a three-socket node). The app was never affected — its hit testing goes through the quadtree, which has taken the layout since it was written. | `utils/geometry.ts` | Falsified three ways, including an over-fix that answers "inside" everywhere |
| 16 | **A computed box did not contain what it was computed from.** `fitView`, `calculateGroupBounds` and `computeCollapseToSubgraph` measured a size-less entity as 200x100 against a drawn 240x144: the camera framed less than the content, an auto-fitted group frame did not contain its children, and a collapse frame did not contain what it collapsed. | `core/store.ts`, `utils/grouping.ts`, `core/graph.ts` | Falsified at all three sites. **The existing test could not fail** — `graph.test.ts` asserts the frame size with a fixture that sets `width: 200, height: 100`, exactly the two wrong defaults |

Fixes 7–9 are one mistake in three files, and **fixing 5 is what made them reachable at all** —
while theme changes never arrived, the meshes were never reconstructed.

### What fixes 12 and 13 say about the shape of this codebase

FIVE copies of the same arithmetic — the socket index, `getSocketPosition`, the edge renderer, the
connection line and the socket renderer — and three of the five were wrong, each for a different
reason. The repair is not a set of patches: `getSocketWorldX` and `getSocketYOffset` in
`utils/geometry.ts` are now the only place a socket's position is computed, and every caller goes
through them. The socket renderer's version takes the entity layout it had already hoisted, so the
consolidation costs it no extra cache lookups in its hottest loop.

`src/utils/socket-geometry-home.test.ts` is what stops a sixth copy. It has to read the SOURCE, and
that is the same trap again: now that everyone shares the arithmetic, no behavioural law can see a
new private copy that happens to agree on the day it is written.

**That unification broke the first law written for it, which is worth recording.** The obvious law
is "the index agrees with `getSocketPosition`" — and once both sides call one function they agree by
construction. Three separate sabotages of the shared arithmetic all left the sweep green. The file
is now in two halves: the sweep catches the store re-growing a private copy (falsified — putting
`position.x + (entity.width ?? 200)` back fails it), and value laws state each fact against the
constants directly so a change to the shared function fails there. Neither half reads the renderer,
so a third law lives in `harness/behaviors.mjs`: find the socket dots by colour with no help from
the index, press each one, and require a connection to start. All three geometry sabotages kill it.

Fix 11 is honest about its limits: it is plainly correct by inspection and the selection behaviours
prove it did not break anything, but the work it saves cannot be measured here. Frame times on a
software rasteriser would not show it, and the instrument that would — the audit's
counts-and-allocations spike — does not exist yet. It is recorded as unmeasured rather than
claimed.

### The instrument lesson from 7–9

A single light→dark ink comparison with a 10% threshold **passed with the socket fix deliberately
sabotaged**. Ink cannot separate "the geometry is gone" from "the colours legitimately changed",
and a threshold tuned to tell them apart is fitted to noise.

The instrument that works is a **round trip**: flip light → dark → light, and require the same
geometry. Colour differences cancel and no threshold is needed. A **null control** — sample twice
with identical waits and no flip — proves the measurement is stable before any of it counts. That
is what exposed finding 9, which every earlier check had missed.

---

## The migration is a redesign, not a rename

The five `migration-blocker` findings that need your decision:

- **58 of the 93 CSS custom properties the theme reader asks for do not exist in v2**, and every
  miss falls back to a hard-coded **dark** value. A light v2 app would render a dark GL scene with
  no warning, and the existing validity check samples two tokens so it cannot see 58 misses.
- **v1 `--space-N` equals v2 `--space-(N+1)` exactly across 1..7.** These resolve under v2 with no
  fallback and no error, so every entity height, socket row and widget slot silently shifts one
  rung. The fix is not an index remap: `SOCKET_ROW_HEIGHT_TOKEN` and `WIDGET_HEIGHT_TOKEN` are
  asking "how tall is a Kookie control at size 2", which v2 answers directly with
  `--control-height-2`.
- **`Entity.color` has no v2 target.** It is the 26-value Radix hue union, resolved by
  string-building `--${color}-9`. v2 ships ten tone families and exposes a family only through a
  `data-tone` stamp. Four map directly, two are renames, **twenty have nothing to point at** — and
  the docs demo uses three of the twenty. Narrowing it is a breaking change to Flow's own public
  API, forced rather than chosen.
- **v2 refuses `accentColor`, `asChild` and `hasBackground` by branded type**, which deletes the
  mechanism the per-entity accent feature is built on (`ThemeComponent` in `widgets-layer.tsx`).
- **v2's default radius level sets `--radius-1..5` to 9999px**, which is what `SIZE_MAP` and
  `RADIUS_MAP` read. Fix 1 above removes the crash independently, but the corner values would still
  be wrong: v2 indexes corners by band (`--radius-control-N`, `--radius-surface-N`).

---

## Still open, grouped by what is at stake

The audit's remediation plan orders the rest into eight phases. The highest-value remaining work:

**Phase 0 (harness) — done except the measurement.** Built here: the browser fixture, 33
behaviours, the colour spikes, the theme round trip, the perf scaffold, and the two-project vitest
split (a `.test.tsx` file used to be **silently skipped**). The degenerate fixture is gone —
`explicitSize` now defaults false, and `makeShapes` adds seven entities chosen because one of the
divergent paths gets each of them wrong. Writing it is what exposed fix 12; a uniform 200×120 grid
agrees everywhere and proves nothing. Still missing: a counts-and-allocations spike, so the ~32
perf findings get a valid measurement under software rasterisation, and the perf baseline itself,
which needs a quiet machine.

**T2 — one measurement, four implementations. CLOSED for sockets, open for the minimap.** Fixes 12
and 13 collapsed five copies of the socket arithmetic into one, held there by a source law. What
remains is `minimap.tsx`, which still sizes its node rectangles with `calculateMinEntityHeight` —
the uniform-row-height formula — so a minimap rectangle is the wrong height for any entity with a
stacked socket, a multi-row widget or an explicit socket height. Different blast radius, so it is
named in the source law's expectations rather than fixed under cover of this one.

**T3 — the frame loop has no granularity.** Edges and sockets are never viewport-culled; every
pointermove during a connection drag triggers a full rebuild of every socket in the graph.

**T4 — React state used as a change detector.** The drag fast path allocates a fresh
`[...entities]` every frame, making `state.entities` identity-unstable, which is why every React
consumer defensively gated on `array.length` — a signature that structurally cannot see a content
change. One upstream decision produces the comment-content freeze, the widget-value freeze and the
per-entity accent freeze as three symptoms.

**T8 — nothing is announced.** Every socket widget is an unlabeled form control; the socket's name
exists only as GL pixels.

## Decisions that need you

The report groups 74 fixes that change observable behaviour into five categories. The ones with the
sharpest edges:

- Deleting a collapsed frame: **delete** its contents or **release** them?
- Click-away during a text edit: **commit** or **discard**? (Today a click faster than one rAF
  discards what was typed.)
- Quadtree bounds, socket hit regions and edge hit-testing all change **which entity a click
  picks** in an overlap.
- Scoping the window keyboard handler to the canvas means shortcuts stop working until the user
  clicks in once.
- `Entity.color` narrowing, per section above.

One the audit flagged that is worth repeating: **do not cascade edge deletion in
`applyEntityChanges` in controlled mode.** `FlowSync` re-pushes the consumer's `edges` prop, so a
store-side cascade deletes edges the consumer still holds and the next prop change restores them —
the user sees an edge vanish and reappear.
