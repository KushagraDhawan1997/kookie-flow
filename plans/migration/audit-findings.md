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

Fixes 7–9 are one mistake in three files, and **fixing 5 is what made them reachable at all** —
while theme changes never arrived, the meshes were never reconstructed.

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

**Phase 0 (harness) — partly done.** Built here: the browser fixture, 31 behaviours, the colour
spikes, the theme round trip, the perf scaffold. Not yet done, and named as the highest-leverage
commit in the plan: **the fixture sets `width: 200, height: 120` on every entity**, which
simultaneously masks a 240-vs-200 index/paint mismatch and the entire auto-height divergence. Any
baseline built on it blesses both bugs. Also missing: a jsdom tier (`vitest.config.ts` globs
`src/**/*.test.ts`, so a `.test.tsx` file would be **silently skipped**), and a counts-and-
allocations spike so the ~32 perf findings get a valid measurement under software rasterisation.

**T2 — one measurement, four implementations.** `getEntitySocketLayout` is the source of truth for
entity height and socket Y, and `edges.tsx`, `connection-line.tsx`, `minimap.tsx` and `store.ts`
each re-derive it independently with different fallbacks. Edges detach from their sockets.

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
