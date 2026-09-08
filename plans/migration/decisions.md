# v2 migration — decisions and amendments

The migration brief is amended here. Where this file and the brief disagree, this file is right.
Every entry states what was decided, by whom, and what evidence moved it.

---

## D1. GL text editing stays. The brief is amended, not the code.

**Owner ruling (2026-09-08): "If we have it, lets use it, change the spec."**

The brief listed "no text editing in GL" as a hard exclusion and called a blinking caret in GL
"architecture violated". Flow already ships exactly that:

| File | Lines | What it does |
|---|---|---|
| `src/components/text-edit-cursor.tsx` | 343 | Blinking caret (530ms) + selection rects, drawn in WebGL |
| `src/utils/text-cursor-layout.ts` | 717 | Caret position, selection rects, hit testing from BMFont metrics |
| `src/components/text-edit-overlay.tsx` | 408 | Invisible 1×1 textarea capturing keys, IME and clipboard |

This was not an accident. `plans/technical-decisions.md` records it as decision **10G**, chosen over
Canvas2D+contenteditable and MSDF+contenteditable, with the reasoning that the invisible-textarea
pattern (Figma, Monaco, Google Docs) removes the font-matching problem entirely: MSDF renders from
BMFont metrics and `text-cursor-layout.ts` positions the caret from *the same* metrics, so there is
one set of measurements and zero visual shift on entering edit mode.

The brief's own goal — DOM never persistently coexists with GL — is already met by this design. The
DOM element is 1×1, invisible, and present only during an edit.

**Amended rule.** The exclusion binds *on-node widget fields* (brief Phase 5): a number field or a
short label on a node displays in GL and borrows a real DOM `<input>` for the edit. Free-floating
canvas **text entities** keep the shipped GL caret. This code is audited for defects like any other,
never as a conformance violation.

---

## D2. The GL label path already exists. The work is flipping the default and deleting the DOM path.

**Superseded recommendation.** An earlier reading of `dom-layer.tsx` (1,268 lines of persistent DOM
labels over GL nodes) led to a recommendation to "move labels to GL". That was wrong about the state
of the code, and the correction makes the job much smaller.

**What is actually true.** `src/components/text-renderer.tsx` (`MultiWeightTextRenderer`) already
renders entity headers, socket labels and edge labels in GL through instanced MSDF — one draw call
per font weight. Both paths are complete and shipped, selected by one prop:

```ts
// src/components/kookie-flow.tsx:118
textRenderMode = 'dom',        // 'dom' | 'webgl' — default is 'dom'

// :369-371 — the DOM layer only draws labels in 'dom' mode
showEntityLabels={textRenderMode === 'dom'}
showSocketLabels={textRenderMode === 'dom' ? showSocketLabels : false}
showEdgeLabels={textRenderMode === 'dom' ? showEdgeLabels : false}
```

Every real consumer already opts out of the default: `apps/docs/src/app/demo/page.tsx:1239` and
`apps/docs/src/app/demo-webgl/page.tsx:385` both pass `textRenderMode="webgl"`.

The project already settled which one wins. From `plans/technical-decisions.md`:

> **Problem discovered:** At 1000+ nodes with socket/edge labels enabled, DOM causes 30-40fps drop
> even with ref-based updates, RAF throttling, and viewport culling. The composite layer overhead of
> hundreds of DOM elements is unavoidable.

and

> **What stays in DOM:** Interactive widgets (inputs, dropdowns), custom node content (escape hatch).

So the documented target architecture is already the brief's law, and the DOM label path is a
leftover from the superseded Phase 7A approach whose default was never flipped.

**Decision — DONE 2026-09-08.** Flipped the default to `'webgl'`, then deleted the DOM label
path along with `textRenderMode` and `scaleTextWithZoom` (commits `feat!:` and `refactor!:` on this
branch). `dom-layer.tsx` went 1268 -> 315 lines; `CommentsContainer`, `TextEditOverlay` and
`ToolbarProvider` stayed.

The legibility gate ran and produced two findings that strengthened the case beyond performance:
at 1:1 the DOM path **garbled output socket labels** ("OO 0", "Ou 2", colliding with the socket
dot), and at zoom 0.5 it held labels at constant screen size so text overflowed the shrunken nodes.
The old default was the worse renderer, not merely the slower one. Evidence:
`harness/spikes/label-zoom.mjs` and the crops under `harness/dist/legibility/`.

Behaviour changes logged: labels now scale with zoom, and text hides at GL's thresholds (socket
labels below 0.35, all text below 0.15) rather than DOM's 0.10.

The gates as originally written were:

1. **Legibility gate** — prove MSDF labels are legible down to the LOD floor
   (`MIN_LABEL_SCREEN_SIZE = 8`, `dom-layer.tsx:39`) before the DOM path is deleted, not before the
   default flips. Keep `textRenderMode` as an escape hatch until it passes.
2. **Sign-off gate** — flipping a documented default is a change to what the library does, and
   `apps/docs/src/app/docs/api/kookie-flow/content.mdx:77` publishes `'dom'` as the default. It
   needs a logged decision and a docs change in the same commit.

Nothing was lost by removing the DOM labels. Verified against `dom-layer.tsx` as it stood at 1,268
lines: the three label kinds were `pointerEvents:'none'` + `userSelect:'none'`, with **zero**
`aria-`/`role` attributes in the whole file. Only comments were interactive
(`pointerEvents:'auto'`, `userSelect:'text'`) and their editing was unimplemented — the code said
"for editing in the future" — so comments stayed in DOM and become GL-display + borrowed-DOM-edit
later, reusing the D1 machinery.

---

## D3. WebGPU is out of scope. Keep the seam open.

**Owner ruling (2026-09-08): "Out of scope; keep the seam open."**

The brief's tech baseline said "WebGPU primary, WebGL2 fallback". There is **no WebGPU code in the
repository** — it is R3F on `THREE.WebGLRenderer` with hand-written GLSL (`utils/msdf-shader.ts`, the
edge shaders, the flat shaders inline in `text-edit-cursor.tsx`). A port means moving to
`WebGPURenderer`/TSL and rewriting every shader, stacked on top of an audit and a design-system
migration.

Stay on WebGL2. Where audit work touches shader or material code, leave a seam a WebGPU backend
could be added behind later, and note it. Do not propose the port.

---

## D4. Consuming v2 — and the CJS problem it exposes

**Status: v2 builds. The consumption path works. One real blocker found.**

`@kookie-ui/react` is version `0.0.0` and unpublished, living in a sibling checkout at
`/home/user/kookie-ui-v2`. Verified: `pnpm --filter @kookie-ui/react run build` succeeds and produces
`packages/ui/dist/` including `styles.css`.

For development, Flow consumes it as a local link (`file:`/`link:` to the sibling checkout).
Publishing v2 is a prerequisite for *releasing* Flow against it, not for building against it.

**The blocker.** v2 is **ESM-only** by deliberate design — `"type": "module"`, no `main`, and no
`require` condition in any export; its own `pack:check` runs the `esm-only` attw profile and marks
node10 resolution as intentionally unsupported. Flow, meanwhile, publishes a dual build:

```jsonc
// packages/kookie-flow/package.json
"main": "./dist/index.cjs",
"exports": { ".": { "require": { "default": "./dist/index.cjs" } } }
```

A CJS consumer of Flow that reaches any module importing v2 will fail to `require()` it. This is not
hypothetical — after brief Phase 2 the toolbar imports v2 directly.

**This narrows on its own.** Phase 4 replaces all seven DOM widgets with GL controls, so after it the
only in-package v2 consumer is `toolbar.tsx`. The open question is therefore whether Flow still needs
a CJS build at all, given React 19, Next 15 and an ESM-only design system. Dropping it is defensible
and is a breaking change to the published contract — **owner sign-off required**, not an
implementation detail.

---

## D5. The Chrome-only glass tier, named

The brief asked for the exact API to feature-detect. It is **an SVG filter referenced from
`backdrop-filter`** — `backdrop-filter: url(#lens-id) blur(...) saturate(...)` — implemented in
`kookie-ui-v2/packages/ui/src/system/refraction.tsx`.

- **Detection:** `CSS.supports("backdrop-filter", "url(#a) blur(1px)")`, plus a real-render check,
  because Safari *parses* the value it cannot render — so `CSS.supports` alone is not the test.
- **Fallback:** additive by construction. The lens is prepended through `var(--kui-lens, )`, whose
  empty substitution resolves to nothing on any engine that cannot render it. Safari and Firefox get
  blur + saturate + glint and no lens.
- **Also Chrome-only:** `corner-shape: squircle`, already gated in v2.

**Flow's rule:** inherit v2's degradation, add no new dependency on this tier, and keep the GL layer
flat — GL glass/lensing is a from-scratch shader effect and is out of scope, in the same category as
GL text editing was before D1. Material is a DOM-chrome concern only.

---

## Open, deliberately

- How long is "long" for on-node text, and single-line clip vs 2–3-line wrap for the GL preview.
  Settle against real node screens, not in the abstract.
- The long-prompt edit surface: anchored popover vs side panel vs modal.
- Which GL controls need disabled/read-only states, and how those map to v2 role tokens.
