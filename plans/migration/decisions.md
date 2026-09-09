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

---

## D6. Phases 2 and 3 are done. What the swap actually cost, and the three things it did not fix.

**Status: shipped 2026-09-09.** Ten import sites moved to `@kookie-ui/react`; 233 unit laws and 99
browser laws green ON v2, plus all four spikes. Zero v1 imports remain. v1 stays an OPTIONAL peer,
because the token reader genuinely supports both: every renamed token is read through a NAME LIST,
v2 first.

### The three silent hazards, and why laws had to be written before the swap

Of the 99 tokens the GL layer read, 59 do not exist in v2 and **40 survive by name with different
values**. The second half is the dangerous one — no missing token, no compile error, no census
failure. Three of them would have changed the graph:

| token | v1 | v2 | what it does |
|---|---|---|---|
| `--space-N` | 4/8/12/16/24/32/40 | 2/4/8/12/16/24/32 | off by ONE INDEX — every node shrinks ~20% |
| `--radius-1..5` | 6/8/10/12/16 (medium) | 9999 (default level is `full`) | every node body becomes a stadium |
| `--gray-*` | the neutral family | absent (`--neutral-*`) | falls back to the DARK table |

The reader identifies which system is mounted (`--neutral-1` exists in v2 and in no v1 build) and
shifts the space index. Radius is NOT compensated for: the harness pins `radius="large"` so the
swap stays a port, and moving the node body onto `--radius-surface-N` — capsule-proof at every
level — is a design step of its own.

### The palette: what a design system owes a graph, and what it does not

42 Radix hue tokens are frozen into `src/core/palette.ts` at the values v1 resolved, measured by
`harness/spikes/palette-freeze.mjs`. v2 ships six distinct pigments; a socket palette needs nine
and the public `AccentColor` union needs 26. Widening v2's `tones` was rejected at ~1.15KB gzipped
per family against its CSS budget gate.

**Grey, red and green are NOT frozen.** A graph owns "purple means image"; nobody owns "grey means
unspecified" or "red means wrong". The neutral family reads from the theme on both systems, and the
two semantic colours took their v2 names — `--destructive-9` for an invalid connection,
`--success-9` for a valid drop target.

**The frozen table is consulted BEFORE the theme**, which is a correction made after the swap by a
law rather than by reasoning. Theme-first looked safe (on v1 the freeze is inert) and produced a
palette half one system's and half the other's: blue, amber, orange and green DO exist in v2, so
`--blue-10` moved to `rgb(0,122,240)` and green to a near-fluorescent while twenty-one others kept
v1's. The cost is stated: an app re-declaring `--purple-10` in its own CSS no longer moves the
socket colour. The escape is `socketTypes`, which takes any CSS colour verbatim.

### Behaviour that changed, and is not being chased back

- **Icon segments are no longer square.** v1's `iconOnly` zeroed the label padding and set a
  min-width; v2 refuses the prop in the type. The only call-site spellings reach into the private
  `--kui-ct-*` stem from outside — the documented `--kui-h` trap. **Needs a system decision**, not
  a call-site hack.
- **The toolbar gap tightens 12px → 8px.** `gap="3"` is a different distance in v2, and chasing
  the v1 pixel with a different semantic index is the numeric-coincidence thinking the
  non-negotiables forbid.
- **Toolbar icons paint at the size index's box** (16 fine / 20 coarse, not a fixed 14) and use
  `iconStroke`. v2 exports it precisely because it ships no icon set.
- **Fields lose `variant="soft"`** — v2 has one resting field dress.
- **Controls are taller on a coarse pointer** (44 vs 32 at size 2). v2's control ladder is
  pointer-indexed and v1's was not; the socket layout is not, so a touch device now has a
  size mismatch inside the row. **Open.**
- **`ThemeComponent` is retyped to `{ children }`.** v2 refuses `accentColor`, `hasBackground` and
  `asChild`: it has ONE app-wide accent and its neutrals derive their hue from it, so a per-subtree
  accent would mean a per-subtree palette. An entity's colour still drives its header and selection
  in GL.

### Still open, and out of Phase 2/3 scope

- **apps/docs cannot stay on v1 and cannot leave it.** The two stylesheets cannot coexist on one
  page — they share 188 token names and the same `[data-radius]` vocabulary, and v1's block writes
  `calc(... * var(--scaling))` where `--scaling` is declared only on `.radix-themes`, so on a
  `.kui-theme` host v2's derived bands resolve EMPTY. Meanwhile `@kushagradhawan/kookie-blocks`
  peer-depends on v1 and the docs use five of its components. Port the docs off kookie-blocks, port
  kookie-blocks to v2, or keep a v1-only docs build.
- **The CJS question from D4 is untouched.** v2 is ESM-only by deliberate design; kookie-flow still
  publishes a `require` condition. Owner sign-off.
- **Releasability.** `@kookie-ui/react` is unpublished, vendored as a tarball at
  `vendor/kookie-ui-react-0.0.0.tgz`. The peer range is a placeholder.

---

## D7. Phase 4 and Phase 5: the widgets are in GL, and one thing that went with them is not back.

**Status: shipped 2026-09-09.** The seven built-in socket widgets — checkbox, slider, select,
colour, text, number, textarea — draw in WebGL and take their interaction there. The DOM's entire
remaining role on a node is one borrowed input, for one field, while it is being edited.

### What is where

| | |
|---|---|
| `widgets-gl.tsx` | every widget's chrome, ONE instanced draw call, kind and value as per-instance attributes |
| `widget-geometry.ts` | the world box, read by the renderer, the hit test and the borrowed input alike |
| `widget-hit.ts` | which widget a press landed on, and what a slider drag means at a given x |
| `widget-edit-overlay.tsx` | the borrowed DOM input — mounts on edit, unmounts on close |
| `widgets-layer.tsx` | now ONLY consumer-supplied widget components, the documented escape hatch |

A checkbox and a slider never touch the DOM at any point in a gesture. The other four borrow a
real input, because of what a text field OWES rather than what is possible: IME composition, the
platform's own selection and clipboard behaviour, and — for colour — the operating system's
picker, which cannot be reimplemented. The GL caret this repo already ships earns its place on a
canvas TEXT ENTITY, where the text is the document and the metrics are ours; here it would be a
reimplementation of the platform.

### THE ACCESSIBILITY GAP, and how it was closed

**Before this phase a screen-reader user could reach a socket widget. Then there was nothing to
reach.** A canvas has no roles, no names and no focusable children, so moving the widgets into GL
took them out of the accessibility tree entirely. The naming law that used to cover them covered
only the DOM that remained — the toolbar, a consumer-supplied widget, and the borrowed input — and
said so in its own docstring rather than quietly measuring something easier.

Two routes were on the table:

1. **An off-screen DOM mirror.** A visually-hidden, focusable element per widget, kept in step with
   the GL layer, with the real roles and names. It is what every serious canvas app does. It also
   risks putting persistent DOM back on a node — which is what this phase existed to remove — so
   the honest version is that the rule is about PAINT, not about the accessibility tree.
2. **ARIA on the canvas element.** Cheaper and much weaker: the graph announces as one thing with
   a description. It does not give anyone a way to operate a slider.

**Status: route 1, shipped 2026-09-10.** The rule is amended, in this file and in
`widgets-gl.tsx`'s own docstring: **everything persistent PAINTS in GL — the accessibility tree is
not paint.** What the rule forbids is a per-node compositing cost, not a per-node entry in a tree
the compositor never sees.

#### The bound, which is the whole of what makes it honest

**The mirror is a keyboard cursor, not a copy of the graph.** `src/components/widget-a11y-mirror.tsx`
mounts one real control per widget on exactly ONE entity — the one under the store's new
`focusedEntityId` — and its element count therefore does not move with the size of the graph.
`harness/behaviors.mjs` pins that at a thousand nodes rather than leaving it to a comment.

Two other bounds were considered and rejected in the writing:

- **Mirror what is VISIBLE.** Visibility changes as the viewport moves, so the element set would
  change on pan frames. Mounting and unmounting DOM per frame is strictly worse than the transform
  writes D2 deleted, and it would move focus out from under whoever was using it.
- **Mirror the SELECTION.** `selectAll` puts every entity in `selectedEntityIds`, so Ctrl+A would
  commit a thousand nodes' worth of hidden controls in one render. That is why the store carries a
  dedicated single-valued cursor rather than reusing selection.

#### What it is, concretely

- **Exactly one tab stop.** Tab reaches the canvas container and then leaves the graph, as it did
  before. Every mirror control carries `tabIndex={-1}`: still programmatically focusable, still
  fully present in the accessibility tree, never a second Tab stop.
- **Arrow keys are an entity cursor.** Down/Right and Up/Left walk the nodes in READING ORDER —
  `src/utils/entity-cursor.ts`, an O(n) scan per keypress with no sort and no cache to go stale —
  Home and End jump to the ends, each move selects the node so the GL ring says where the cursor
  is, and pans it into view if it is off camera. Enter steps into the node's controls; inside the
  group Down and Up move between them (not Left and Right, which a range input owns) and Escape
  hands focus back.
- **Real elements, never ARIA roles.** `input[type=range]`, `input[type=checkbox]`, a real
  `select`, a real `textarea`, `input[type=color]`. The platform supplies the role, the value
  semantics and the keyboard model. The one hand-rolled `role="slider"` the naming law excuses is
  upstream's and no longer applies to a socket widget.
- **Hidden means CLIPPED.** `position:absolute; width:1px; height:1px; clip-path:inset(50%)`.
  `display:none`, `visibility:hidden`, the `hidden` attribute and `aria-hidden` each remove an
  element from the accessibility tree, which would make the whole exercise ceremonial; `opacity:0`
  still paints and at full size would be a composited surface over the canvas. A harness law fails
  on all of them.
- **The container has an identity.** `role="application"`, an `aria-label` (new public prop
  `ariaLabel`, default 'Flow graph') and an `aria-describedby` pointing at one hidden sentence of
  instructions. `application` is what stops a screen reader eating the arrow keys the cursor needs.
  **The cost, stated:** NVDA and JAWS switch out of browse mode for the whole subtree, which
  includes any `children` a consumer renders inside the canvas. The alternative — `role="group"`
  plus intercepting arrows only while the container is focused — does not work, because in browse
  mode the keydown never arrives at all.
- **A polite live region** announces the node the cursor moved to. Moving the cursor while real
  focus stays on the container otherwise changes nothing a screen reader would read.
- **The borrowed input now names itself `socket.name`**, not `socket.id`. It announced 'label'
  where the screen said 'Label', and it has to agree with the mirror or the two become a duplicate.

#### What it does NOT give

- **No edge or connection navigation.** A screen-reader user can operate a focused node's controls
  and cannot discover what that node is wired to, or make or break a connection. The store has
  `adjacencyIndex` for it; it is a larger surface and deserves its own decision.
- **No mirror for entity headers, comments or the canvas text entities.**
- **A colour picker that opens at a clipped pixel.** `input[type=color]` opens the OS picker at the
  focused element's rect, which here is 1px. Un-clipping it to the widget's real box would make it
  paint and composite, which is the cost the bound exists to avoid.
- **Reading order is positional, not semantic.** Two nodes at the same point are ordered by id.

#### Convergence, deliberately not done

For `text | number | textarea | color | select` the mirror and the borrowed input are the same
element with different CSS, and unifying them would delete `widget-edit-overlay.tsx` and the
mirror's editing skip along with it. It also re-opens both ordering bugs recorded below — focus
attempted before the style landed, and draft-versus-live value — so it is worth doing later and
deliberately, not as part of this.

### Bugs this phase produced and fixed, both of them ordering

- **The borrowed input could not take focus.** Its style was applied from a passive effect and the
  focus from a layout effect — and layout effects run first, so focus was attempted while the
  element was still at its initial `display: none`. The browser refuses that silently: the field
  mounted, looked correct, and swallowed every keystroke. The style is computed during render now.
- **Only the last character of anything typed survived.** The input was controlled on the value
  captured when the widget was pressed, which never moves — so each keystroke wrote out correctly
  and then the field re-rendered with the original string. Typing "hello" into a field reading
  "name" left "nameo". The draft is local for the length of the edit, which is the conclusion the
  DOM widgets had already reached by the same route.

### Still open

- ~~The accessibility gap above.~~ Closed by the mirror; the residue is listed under "What it does
  NOT give" and the edge/connection half is the one worth its own decision.
- ~~A GL widget has no hover or focus state yet; the shader has the attributes for it.~~ Hover
  landed. The second half of that sentence was WRONG and worth recording: all five per-instance
  attributes were load-bearing — `aValue` is the slider fraction, `aTint` the colour widget's
  value, `aRadius` the corner radius, `aSize` and `aKind` self-evidently — so hover needed a SIXTH
  (`aHover`, one float, 4 bytes an instance). Anyone reading this line before writing the code
  would have gone looking for room that was not there.
- Focus is closed as "nothing to draw", not as done. The four kinds that borrow a DOM input are
  covered by an opaque overlay with an accent border for the whole edit, so a GL ring under it
  could not be seen; the two that do not borrow anything have no keyboard focus to hold, because
  a canvas has no focusable children (D-keyboard above). What a checkbox and a slider CAN show is
  pressed, and the slider does, through the same hover attribute. The mirror does not change this:
  DOM focus lands on a clipped element, and nothing in GL is drawn for it. A keyboard user
  operating a checkbox through the mirror sees the value change and no focus ring. That is now
  worth drawing, and it is a GL change rather than an accessibility one.

(The `select` bullet that stood here — "cycles to the next option on press rather than opening a
list… Not judged" — is judged in D9.)

---

## D8. The widgets draw their values.

**Status: shipped 2026-09-10.** D7 above says the chrome is in GL and that "a widget's value and a
select's current option are contributed to the text renderer rather than re-implemented" — and the
contribution was never written. Every field on every node showed an empty well, every select a
chevron with no option beside it, every slider a bar with no number. It is the most visible thing
the migration cost, and the widget laws all passed through it: they count instances and drive
presses, and a widget with no text is still one instance that still answers a press.

The values are collected in `text-renderer.tsx`, as a fourth family beside entity headers, socket
names and edge labels, from `widget-text.ts` — a pure function that answers what one widget prints
and where in its box it sits. Three kinds deliberately print nothing, and each says why at its own
branch: a checkbox's tick IS its value, a colour swatch's fill IS its value, and a consumer's own
component prints its own.

### What this cost, measured

At a thousand entities with a value on every input socket, `harness/spikes/counts.mjs --widgets`
and a glyph census at zoom 1: 676 glyph instances before, 843 after — +167, a quarter more glyphs
and 1.3% more drawn instances of any kind. At zoom 0.51, the densest frame where values still
print, +570 glyphs, +23% of glyphs and +3.9% of all instances. Uploads per frame did not move,
because the text layer already declares the written span rather than re-sending its whole capacity.

### The lever, and the bug the lever produced

Values stop printing at zoom 0.5, above the 0.4 at which the chrome stops — a 12px glyph at 0.4 is
under five device pixels, and low zoom is where the most nodes are on screen. Adding a floor
exposed a hole in the pan hysteresis: `lodBucket` had a bit for each of the three existing cliffs,
zooming IN only shrinks the visible rect, and a shrinking rect stays inside the one the set was
collected for — so crossing 0.5 upward re-collected nothing and every field stayed blank until
something unrelated marked the layer dirty. There is a fourth bit now. A gate with no bit is a gate
that only closes.

### Still open

- A widget whose TYPE a consumer has replaced through `widgetTypes` gets both a DOM control and GL
  chrome, and now GL value text under it as well. `resolveWidgetConfig` sees `customComponent` but
  not the consumer's type map, so neither GL layer can tell. Pre-existing for the chrome; the text
  inherits it.
- `text-renderer.tsx` allocates one `WidgetBox` and one resolved config per visible widget per
  dirty frame, the same shape of cost `widgets-gl.tsx` already pays, now paid twice. If it ever
  shows up, the fix that keeps one source for the arithmetic is a `getWidgetBoxInto(out, …)` used
  by BOTH layers, not a second copy of it.

---

## D9. A select opens a list, and the list belongs to the platform.

**Status: shipped 2026-09-10.** D7 left this open: a press on a select advanced to the next option
and wrapped. It was honest and it was operable, and it was also the only control in the package
where choosing cost a number of presses proportional to how far away your answer was — the fourth
of five options took four presses — and where the set you were choosing from was never on screen at
all. The GL layer draws a well, a chevron and the current option; there was nothing to read.

The choice was a GL menu or a borrowed DOM `<select>`, and it is the borrowed `<select>`, through
the same overlay the text, number, textarea and colour widgets already borrow an input through. The
rule that decided it is the rule that overlay already states for the colour picker: **borrow the
platform where the platform OWES something**, not merely where borrowing is easier. A list owes the
same class of things a colour picker does — arrow and Home/End navigation, type-ahead, the native
picker on touch, and a popup that is allowed to leave the canvas bounds — and it narrows D7's
accessibility gap rather than widening it, because a real `<select>` is a control a screen reader
can reach and a GL menu is not. The GL side is untouched: no new instance kind, no buffer growth,
no extra draw call, no change to the depth ladder. A menu drawn in GL would have needed an
always-on-top pass outside the per-entity depth slice, its own instanced mesh, row hit testing,
scrolling, dismissal, and rows contributed to the text batch.

### Two things fell out of it, and both are load-bearing

- **The press is answered on pointer UP.** The borrowed select opens its list as soon as it is
  mounted and focused. Mount it on pointerdown and the popup appears under a button that is still
  held: the platform opens the list with the current option beneath the cursor, so the release
  picks that same option and shuts the list again. The press reads as a flash and nothing changes.
  The hit is parked in a ref between the two halves of one press, carrying its pointer id for the
  reason the slider drag carries one — a second finger's release must not answer the first finger's
  press — and the same handler is bound to `pointercancel` and `pointerleave`, neither of which is
  a choice, so the open is gated on the event actually being a release.
- **The select paints transparent over its own GL chrome**, where a field replaces it. The well and
  the chevron underneath are already the right control at the right size, and the text layer
  already stops printing a widget's value while an edit is open, so the borrowed element has only
  to contribute the option text and the list. Drawing a second well and a second chevron on top of
  the first is what not saying so looks like.

`nextSelectValue` is deleted rather than kept for keyboard use: the native select supplies arrows,
Home/End and type-ahead itself, and D7 records that GL widgets are not in the accessibility tree,
so there was no other keyboard path to reach it from.

### The rule with the most ways to get it wrong

A select fires `change` for keyboard navigation as well as for a pick — arrows on a closed select,
and type-ahead everywhere — so ending the edit on every change would close it on the first arrow
press, which is the opposite of choosing. A change with no key in front of it came from the list,
and only that ends the edit. The flag that records this is cleared on `keyup` as well as on the
change, because a key that moves nothing still arms it: typing a letter no option starts with fires
a keydown and no change at all, and a flag left standing there makes the NEXT pick fail to close.

### Still open

- Options are `string[]`, so a label distinct from its value cannot be expressed. Widening it
  touches `Socket.options`, `WidgetProps.options` and `ResolvedWidgetConfig.options`, wants a
  `normalizeOptions` beside `resolveWidgetConfig`, and the GL text path needs the label too.
- Non-string option values are not representable either. A pick commits the raw `<option value>`
  string, exactly as the cycling press did.
- The OPEN list is drawn by the OS and is not styleable in any portable way. This is the same trade
  already accepted for the colour picker. The CLOSED control is matched exactly.
