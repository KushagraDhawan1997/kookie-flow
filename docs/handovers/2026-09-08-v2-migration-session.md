# Handover — v2 migration, unattended session, 2026-09-08

Written for the human reviewing branch `claude/kookie-flow-v2-migration-xwpsbu`. Plain English,
and it repeats things the other docs say, because you were not in the room.

This is not a source of truth. Where this and `plans/migration/*.md` disagree, those are right and
this is stale.

---

## What you asked for, and what happened to it

You approved three things and asked for a recommendation on a fourth:

1. **GL text editing stays**, spec amended. Done — logged in `plans/migration/decisions.md` D1.
2. **WebGPU out of scope**, seam kept open. Done — D3.
3. **Labels move to GL** ("okay move them to labels"). Done, and it was smaller than I told you.
4. My labels recommendation was **wrong about the state of the code** and I corrected it before
   acting. Details below, because the correction is the interesting part.

## The labels correction

I told you labels needed moving to GL. They were already there. `MultiWeightTextRenderer` has
rendered entity headers, socket labels and edge labels through instanced MSDF for some time. Both
renderers shipped, switched by one prop, and the default was still the DOM one:

```ts
textRenderMode = 'dom',   // kookie-flow.tsx:118
```

Every real consumer already passed `"webgl"` explicitly. `plans/technical-decisions.md` had already
settled which one wins ("at 1000+ nodes DOM causes 30-40fps drop... unavoidable"). So the work was
flipping a default and deleting a dead path, not building a renderer.

**Before flipping I measured it**, because I had said I would gate on legibility. Two things came
out of that which I did not expect:

- At 1:1 the DOM path **garbles output socket labels** — they render as "OO 0", "Ou 2", colliding
  with the socket dot. GL renders them cleanly.
- At zoom 0.5 the DOM path holds labels at **constant screen size** (`scaleTextWithZoom` defaults
  to false), so text overflows the shrunken nodes it belongs to. GL scales with the world.

So the old default was the worse renderer on both counts, not merely the slower one. Screenshots
are in `packages/kookie-flow/harness/dist/legibility/` if you want to look.

**Two behaviour changes you should know about**, both deliberate:

- Labels now scale with zoom. `scaleTextWithZoom` is gone; it only ever picked between the two DOM
  containers.
- Text hides at different zooms. GL stops drawing socket labels below 0.35 and all text below
  0.15; DOM drew down to 0.10. Nothing under ~8px was readable either way, but the numbers differ.

`textRenderMode` is **removed**, not deprecated. Once the DOM path is gone the prop's only other
value selects a renderer that garbles text, which is a trap rather than an escape hatch. The
package is `0.0.1-alpha.0`, so this seemed the right moment.

`dom-layer.tsx` went 1268 → 315 lines. Comments stayed: they are the one thing in there that is
interactive and will need a text cursor, so they are GL-display + borrowed-DOM-edit work later.

## The thing that will stop Phase 3, and it is not what anyone expected

**v2's OKLCH tokens resolve to mid-grey, silently.**

`parseColorToRGB` routes anything that is not hex or `rgb()` through a probe element and reads
`getComputedStyle(probe).color`, with a comment saying this "handles oklch... and all other CSS
color formats". That was true when computed values were always serialised to `rgb()`. Measured
today:

```
probe.style.color = 'oklch(0.628 0.2577 29.23)'
getComputedStyle(probe).color  ->  "oklch(0.628 0.2577 29.23)"     // unchanged
```

So the regex matches nothing and it returns its hardcoded `[0.5, 0.5, 0.5]` — with **no warning**,
because the `console.warn` sits on a branch this path never reaches. v1's tokens are hex, so
nothing is broken today. Point it at v2 and every node, socket and edge renders grey.

**This is now fixed and pushed.** I measured four candidates; `color-mix(in srgb, <value> 100%,
transparent 0%)` is the one — full float precision, no canvas allocation, converts into the space
the shaders need. Two smaller defects went with it: the public colour probe lived outside the theme
scope (so a consumer resolving `var(--accent-9)` got black), and `display-p3` coordinates were read
as if they were sRGB.

Verified by `harness/spikes/color-formats.mjs` against an independent canvas readback — ten formats,
all passing — and both fixes falsified by re-breaking them.

Full detail, including the three candidates that do NOT work, is in
`plans/migration/finding-colour-pipeline.md`.

## Where I was wrong, twice, about colour

I reported to you mid-session that the node colour path "looks like a real colour-space bug". It
is not, and I retracted it. The shipped pipeline is correct: `<Canvas flat legacy>` turns three's
colour management off, so every unmanaged shader paints the token's own sRGB bytes and both
construction styles in the codebase agree.

An earlier draft claimed the exact opposite — that the float sites were too bright. Also wrong.

Both wrong answers came from the same mistake: **measuring a smaller system than the one in
question.** First `THREE.Color` alone, then bare three.js, and only the third time the real app
with its real renderer flags. The retraction is kept in the finding doc on purpose.

What survives is worth having: that coherence rests entirely on `legacy`, which R3F documents as
deprecated. Remove it and the grid and connection line silently darken from byte 128 to 55 while
everything else stays correct. There is now a spike that would catch it.

## What is on the branch

Six commits, each independently revertible:

| | |
|---|---|
| `docs:` | migration decisions + verified environment facts |
| `test:` | Phase-0 harness foundation |
| `docs:` | colour pipeline investigation + the Phase-3 blocker |
| `feat!:` | labels render in GL by default |
| `refactor!:` | delete the DOM label path and its props |
| `test:` | behaviour suite (31 green) + perf baseline |
| `fix:` | resolve OKLCH, lab and every modern colour function |

`pnpm --filter @kushagradhawan/kookie-flow lint` and `test` are green (149 tests, plus the harness
typecheck which is new).

## The harness, and what it can and cannot do

`packages/kookie-flow/harness/` — this is Phase 0, which the brief called non-negotiable and which
did not exist. There were 149 tests, all pure graph algorithms, and zero coverage of rendering,
interaction, pan/zoom, selection, widgets, text or performance.

```
pnpm run harness:build          # bundle the fixture (esbuild)
node harness/behaviors.mjs      # behaviour suite — exit 0 is green
node harness/spikes/color-parity.mjs
node harness/spikes/label-zoom.mjs
node harness/spikes/perf-baseline.mjs
```

It mounts the real library in headless Chromium and it genuinely renders — nodes, MSDF text, typed
sockets, bezier edges. Assertions are against **store state**, not pixels, because the store is the
contract a consumer sees and it survives rendering changes; pixel claims are confined to the spikes.

Three things worth knowing before you trust a number from it:

- **There is no GPU here.** Everything is SwiftShader. Perf numbers are valid for before/after
  comparison on the same machine and are not an SLO. Do not quote them as fps.
- **Run perf on a quiet machine.** My first attempt ran alongside the audit and the behaviour suite
  on 4 cores and measured the load rather than the library. I threw it away.
- **`?preserveBuffer=1` is required for any pixel assertion.** The product sets
  `preserveDrawingBuffer: false` for Safari, which makes screenshots and readPixels come back empty
  — it looks exactly like "the renderer drew nothing".

Three instrumentation attempts failed before one worked, and they are documented in the fixture
because each produced a confident number that meant nothing. The worst: three 0.182 assigns
`render` as an *instance* property, so patching `WebGLRenderer.prototype` intercepts nothing and
reported `renders: 0` for an app drawing 13,000 instances a second.

## A bug I nearly reported that does not exist

The behaviour suite reported that ctrl-click multi-select was broken — selecting a second node
dropped the first. I traced it to two `selectEntity` call sites in `kookie-flow.tsx`, one passing
`additive` and one not, and had a plausible story about pointerdown clobbering the selection before
pointerup could honour the modifier.

Then I measured what the events actually carried, and the story collapsed:

```
mouse.click(x, y, { modifiers: ['Control'] })   ->  pointerdown ctrl:false   selection ["n2"]
keyboard.down('Control') + mouse.down/up        ->  pointerdown ctrl:true    selection ["n0","n1","n2"]
```

**`page.mouse.click()` silently ignores a `modifiers` option** — `Mouse.click` takes
`{button, clickCount, delay}` and nothing else. My "ctrl-click" was a plain click. Flow's
multi-select is correct.

It also produced a false PASS: "shift-click does not add" passed because shift was never applied
either. A test that cannot press the key it is testing agrees with everything.

The suite now holds modifiers explicitly and, before any modifier-dependent assertion, proves the
modifier reaches the page (`INSTRUMENT: ctrl actually reaches the page`). Calibrate the instrument
against a known answer before its output is evidence.

One real thing did come out of it: **Flow uses Ctrl/Cmd for additive selection, not Shift**
(`kookie-flow.tsx:1889`). Figma, Illustrator and Finder all use Shift. That is a choice rather than
a defect, so the suite pins it in both directions — but it is worth a deliberate look.

## Two things I did not act on, deliberately

**v2 is ESM-only and Flow publishes a CJS entry point.** v2 builds fine and links locally, but it
has `"type": "module"` and no `require` condition anywhere. A CJS consumer of Flow that reaches
v2 breaks. It narrows on its own — after Phase 4 only the toolbar imports v2 — but *whether Flow
keeps a CJS build at all* is a breaking change to your published contract and your call. See D4.

**`CLAUDE.md` documents the coordinate transform backwards.** It says
`screenPos = (worldPos + viewport.offset) * viewport.zoom`; `utils/geometry.ts worldToScreen` does
`world * zoom + offset`. Those agree only at zoom 1 with zero offset, which is where almost
everything sits, so it has been harmless — I nearly wrote a test around the wrong one. The harness
now uses the code's version and has a case at zoom 0.5 where they disagree. I have not edited
`CLAUDE.md` because it is your instruction file.

## The audit landed

57 agents, 214 raw findings from 7 lenses, 177 after dedup, **143 survived adversarial refutation**
(34 refuted and excluded). Full summary in `plans/migration/audit-findings.md`.

**Its headline is a measurement, not an opinion.** Exactly one file had tests — `graph.ts`, at 100%
function coverage — and it contributed **zero** of the 143 findings. Every defect lives in a file
with no coverage. Nine confirmed store defects, and 149/149 stayed green.

It also caught my own fixture: it sets `width: 200, height: 120` on every entity, which masks both
a 240-vs-200 index/paint mismatch and the entire auto-height divergence. Widening it is named as
the highest-leverage remaining commit and I have **not** done it yet.

**Ten of its findings are fixed on this branch**, including six criticals. The most striking:

- `radius="full"` erased every node. No clamp in the rounded-box SDF, so past `min(b.x, b.y)` every
  fragment falls outside the shape. Node-body ink 170/170 → **3/170**.
- The library was not reentrant — a second `<KookieFlow>` killed dragging in the first.
- A stale id index appended an entity with `id === undefined` to your document, then self-healed on
  the next add or remove. That is the profile of a bug that survives every manual test.
- A `parentId` cycle set through the public API **hangs the tab**. The regression test does not
  fail against the old code; it times out.
- **Theme changes never reached WebGL at all** — the observer watched five `data-*` attributes and
  not `class`, and v1 carries appearance in className. Fixing that exposed three more: node,
  socket and selection-outline meshes are reconstructed on a theme change and nobody re-initialised
  them.

One caveat if you read the raw audit: it started before the label deletion, so its `dom-overlay`
map describes containers that no longer exist. The lenses read files fresh, so their findings are
against current code — but treat anything naming `CrispLabelsContainer`, `ScaledContainer`,
`SocketLabelsContainer` or `EdgeLabelsContainer` as void.

## A second instrument lesson, and this one cost real time

My first theme check compared GL ink across a light→dark flip with a 10% threshold. It **passed
with the socket fix deliberately sabotaged**. Ink cannot separate "the geometry is gone" from "the
colours legitimately changed", and any threshold that tells them apart is fitted to noise.

What works is a **round trip** — flip light → dark → light and require the same geometry. Colour
differences cancel; no threshold needed. Plus a **null control**: sample twice with identical waits
and no flip, to prove the measurement is stable before trusting it.

The round trip immediately found a third regression the single flip had missed: the selection
outline came back as a partial rectangle and never recovered, 382px permanently lost.

## What I would do next

1. Take the audit's remediation sequence and work it in bisectable commits, harness green.
2. Decide the CJS question, because Phase 2 needs it.
3. Run the perf baseline on a quiet machine and commit the numbers, so Phase 1 has a real before.
4. Then Phase 2 proper: toolbar and widgets onto v2.
