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
- **`role="application"` covers the consumer's `children` too, and this is not hypothetical.**
  NVDA and JAWS leave browse mode for the roled element's whole subtree, and `{children}` is
  rendered inside the container — so a consumer's own panel nested in the canvas inherits
  application mode and its controls stop answering the reader's own navigation keys. Observed on
  `apps/docs/demo`, whose radio group sits inside the container for exactly this reason. The role
  has to be on the FOCUSED element for the mode switch to happen at all, and the focused element
  is the container, so the fix is structural — a `role="document"` wrapper restores browse mode
  for a subtree — and it changes the DOM a consumer's CSS is written against. Worth doing
  deliberately; not smuggled in here.

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

---

## D10. The GL layer draws light. D5's "keep it flat" is amended.

**Owner ruling (2026-09-10): "The edges are plain old boring edges when we have the entire world
of shaders at our disposal. Think Flora."**

D5 said the GL layer stays flat and that material is a DOM-chrome concern. Half of that survives.
The GL layer now draws LIGHT — a card's shadow, a selection's halo, an edge's glow and gradient,
the moving spot on an animated edge, a socket's punch ring and hover halo, a well's inner shade
and focus ring — every one an SDF falloff or a `uTime` read inside a pass that already existed.
It still draws no MATERIAL: no glass, no `backdrop-filter`, no SVG filter, no DOM dress. The edit
overlay is transparent for every kind and GL paints its focus, which is what fixed the select
looking different when pressed (a serif fallback font, a 4px radius under an 8px well, and a
border the GL well never drew).

### The value stack, and why colours became pairs

The canvas is the floor in dark (`--neutral-1`) and a step below the card in light
(`--neutral-2`); a card sits a step ABOVE the floor in dark (`--neutral-3`) and is the white
thing in light (`--neutral-1`); a well is punched through to the canvas in dark and one step
below the card in light. One token index cannot play "the well" in both, so `THEME_COLORS` takes
a `ColorTokenRef` — a key, or `{ light, dark }` — collapsed by `pickToken` at material build and
never per frame. The DOM canvas colour renders the light half and writes the dark half in a
layout effect: the token reader detects appearance from the DOM in a state initialiser, so an
appearance-dependent style attribute was a hydration mismatch on every dark page.

### What was measured, and what it cost

Counts at 2000 entities with widgets and values, before → after: pan 6 → 6 KB/frame uploaded,
zoom 2 → 2, hover 0 → 0 with zero React commits, drag 835 → 822 KB/frame. Draw calls unchanged.
The cost is fill: edges are an 8px ribbon (core 2 + glow 3 each side) instead of 1.5px, sockets
draw a 10px quad instead of 6, widgets grow 4px a side for the focus ring, node shadow quads grow
28 world px a side. `EDGE_HALF_WIDTH` in edges.tsx is the dial if a DPR-2 Safari frame ever pays
more than a millisecond for it. 180 browser laws pass unchanged; no geometry, hit box, socket
position or row metric moved.

### Three things the pass found that were not visual

- The selection outline's `uCornerRadius` was created at 0 and never written, so every selection
  and hover ring had been square around a rounded card.
- The text renderer attached its glyph attributes in a passive effect, so one frame after every
  capacity growth drew the new mesh against the previous capacity's buffers:
  `glDrawElementsInstanced: Vertex buffer is not big enough`, in every graph big enough to grow.
  Both init effects are layout effects now, in declaration order.
- The grid's dirty check compared the store viewport and not the camera frustum, so a canvas that
  got its size after the first frame kept a zero-sized grid plane. The harness had never painted a
  grid at rest.

### Deliberately not done

- Node hover as material (shadow lift, a hover attribute on the node layer): the node `useFrame`
  is the hottest loop here and hover stays a hairline in the selection pass.
- A pressed state for checkbox and slider with duration: the shader paths exist (`aHover = 2`),
  only `editingWidgetKey` drives them. Driving a press needs a store field; `editingWidgetKey`
  cannot be reused because the text layer suppresses the readout on it.
- Mid-edge resize handles are hit-testable and undrawn; the cursor is the affordance. The four
  corner dots draw only while the selected entity is also hovered.

---

## D11. The radius scale is partitioned by role. A node body is a surface; a widget is a control.

**Owner ruling (2026-09-10): "See how Kookie ui v2 does it and implement here."**

`radius="full"` turned a node into a stadium that cut through its own title and first socket row,
and the `radius` prop never reached the fields on the node at all. Both are one cause.

### What v2 actually does

The scale is split by role, not by magnitude, and the theme's `data-radius` level scales each half
on its own terms. Read out of the shipped stylesheet:

| level | `--radius-1..5` (controls) | `--radius-6..10` (surfaces) |
|---|---|---|
| none | 0 | 0 |
| small | 2 3 4 5 6 | 5 6 8 10 12 |
| medium | 4 6 8 10 12 | 12 18 24 30 36 |
| large | 6 8 12 14 16 | 24 32 40 48 56 |
| **full** | **9999 ×5** | **24 32 40 48 56** |

At `full` the control family becomes a pill and **the surface family does not move at all** — it is
exactly where `large` leaves it. A `.kui-surface[data-size=N]` reads `--radius-surface-N`
(= `--radius-6..9`), so there is no level at which a surface becomes a capsule. A control at that
level is `calc(control-height / 2)`: a pill bounded by the element's own height, which is why it
can never reach past the thing it rounds.

### What was wrong here

`RADIUS_MAP` mixed the halves — `--radius-2`, `--radius-4`, `--radius-6`, then `--radius-full` —
for a thing that is a card. Three control tokens and a pill. The quiet half of that is worse than
the loud half: v2's DEFAULT level (`:root`, no `data-radius`) resolves `--radius-1..5` to 9999 too,
so `radius="medium"` did the same thing to any app that simply never stated a level. Measured on
the docs app, whose Theme states `medium`, `--radius-4` is 10px; at `:root` it is 9999px.

Widgets were a fixed 8, so the level stopped at the body.

### What it is now

- The body reads `--radius-surface-1..4` at every level (`none` → 0), and `SIZE_MAP` sizes it off
  the same family. Bounded everywhere, by construction rather than by a clamp.
- A widget reads the control ladder, `--radius-1..3` and `--radius-full` at the top. The shader
  already clamps to half the widget's box, so that 9999 lands on v2's own `calc(height / 2)`.
- An `entityStyle.borderRadius` override is the body's shape alone. A node with square corners does
  not thereby have square fields; v2 keeps the families independent for the same reason.
- The borrowed edit overlay wears the resolved control radius, clamped the same way, so the caret
  and the selection highlight are clipped to a pill rather than to a rectangle inside one.

Four tokens are new — `--radius-surface-1..4` — with v1 fallbacks of 8/12/16/20, which leaves a v1
app on the radii it already had (`medium` → 12px, the old `--radius-4`).

### What this changes on screen

Nodes are rounder at the default. Under the docs Theme (`medium`) a `radius="medium"` node goes
10px → 18px; under the harness Theme (`large`) it goes 10px → 32px. That is the design system's
opinion of a card, and it is the price of reading the surface family instead of the control one.
Widgets now move with the level: 0 at `none`, a pill at `full`.

The harness still pins `<Theme radius="large">`. The reason has changed and is written into the
fixture: the body is capsule-proof now, but at v2's default level every widget is a pill, and that
is a different picture in every pixel law in the suite.

---

## D12. Spacing reads the layout FAMILIES, and roundness buys its own padding.

**Owner ruling (2026-09-10): "Spacing and padding is all wrong still, please check with kookie ui
v2 properly." and "Roundness also uses extra padding."**

Twelve agents audited every number in the node interior against v2's shipped stylesheet and source.
Forty-eight findings, three skeptics on different axes, and the honest headline is that **most of
the numbers were already right and almost none of the derivations were**.

### v2 has three spacing families, and this package was reading one for all three jobs

| family | tokens | what it dresses |
|---|---|---|
| raw palette | `--space-1..12` = 2,4,8,12,16,24,32,40,48,64,96,128 | the material other bands index into |
| layout | `--layout-space-N`, `--surface-p-N` = 16,24,32,40 | a surface's padding — the one lever density moves |
| control | `--control-height-N`, `--control-px-N`, `--control-px-pill-N`, `--control-gap-N`, `--row-inset-N` | everything inside a control |

Every number here came from `--space-N`, so a node body's inset was invariant to density while
every real card beside it moved, and a widget's height would not follow a coarse pointer.

### Two decisions the audit could not make for itself

**The node index is one below the host's page default.** `nodeIndex(size) = clamp(size - 1, 1, 4)`,
so a resting `size="2"` node reads index 1 from every family. v2's index 2 is calibrated for a page
card several hundred pixels wide at 1:1; a node is 240px and this package already argues in device
pixels (`WIDGET_VALUE_MIN_ZOOM`). Index 2 wholesale spends 24 + 96 + 24 = 144px of a 240px node on
chrome before the first glyph and puts body type at 14px on a canvas read at half scale. It also
settles `EntitySize` '5', which v2 has no index for: it clamps to 4.

**The row pitch is declared, not imported.** An audit finding wanted 40 → `--control-height-2` = 32.
That reads `.kui-row`, which is a modifier on `.kui-control` for a row that CONTAINS TEXT. A socket
row is a `.kui-field-item` — `grid-template-columns: auto 1fr` inside a `.kui-field-group` whose
`row-gap` is `--layout-space-3` — so its pitch is control height + gap = 32 + 8 = 40. And a socket
row is also the pitch at which EDGE ENDPOINTS are separated, which has a floor a page row never has
to respect: a hit circle is `socketSize + SOCKET_HIT_TOLERANCE` = 14 in radius, so 32 would leave
4px between adjacent circles — two device pixels at half zoom. The row now takes
`max(controlHeight + gap, 2*(socketSize + tolerance) + SOCKET_MIN_CLEAR)`, which is 40 today and
says why.

### Roundness buys its own padding, and v2 spends it as a token

`.kui-control` sets `padding-inline` from `--control-px-pill-N` **unconditionally** and lets the
token carry the bump: it equals `--control-px-N` at every radius level below `full`, and steps up
(10 → 14 at index 2) at `full`, because a capsule's curve eats the corner the first glyph would
otherwise sit in. The same idea appears for nested surfaces as
`--kui-sf-radius: calc(--radius-row-N + --kui-sf-p)` — a container's corner is its child's corner
plus the padding between them, so the curves stay concentric.

Measured here: a corner of radius r needs about `0.29 r` of inset before content clears the arc. At
`radius="full"` the body corner is 48 and needs 14; the padding was 12, so the title and the first
row sat inside the curve. `--surface-p-1` = 16 clears every level.

The synthesised spec REJECTED the pill inset, on the grounds that a widget's corner is not a pill —
while, four sections earlier, moving the widget corner to `--radius-control-N`, which at the shipped
`radius="full"` is half the control height. That is a near-pill. The rejection is overruled and
`--control-px-pill-N` is read.

### What moved, and what deliberately did not

| | before | after |
|---|---|---|
| body inset (padding + border) | 12 | 17 |
| row pitch | 40 (`--space-7`) | 40 (`control-height + gap`, floored by the wiring clear) |
| widget height | 32 (`--space-6`) | 32 (`row − 2 × row-inset`) |
| value inset | 6 (literal) | `--control-px-pill-N`, so it grows when the well is a pill |
| body type | 12 (literal) | 12 (`--font-size-1` at the node index) |
| label origin | 12 (literal, four sites) | `padding + borderWidth` |

Type does not move at the resting size, and neither does the pitch — the two changes the audit
argued loudest for are the two the skeptics killed. 180 laws pass unchanged.

### Rejected

- **Row 40 → 32.** Wrong v2 pattern; see above.
- **Body type 12 → 14, title → 16.** v2's 14 is a page number at 1:1. Titles also get no
  truncation, so 16 overruns the node edge on any realistic name.
- **Flat `--surface-p-2` = 24 padding.** 20% of a 240px node, before a 96px gutter.
- **A squircle corner** (`radius × 1.613`). Needs a superellipse term in the SDF and is a
  corner-profile question, not a spacing one.
- **`SOCKET_LABEL_WIDTH` → content-sized.** v2's `auto 1fr` refuses a fixed label column, but a
  graph wants its controls in a column so rows scan vertically. Kept, and now documented as a
  canvas decision with no token behind it.

### Still open

- The label gutter is a fixed 96 while `text-renderer` truncates against the CONSTANT and
  `widget-geometry` lays out against the PROP, so a consumer who sets `socketLabelWidth` gets dead
  gutter. Named, not fixed.
- The checkbox mark (18) and slider track (4) are still shader literals where `--mark-N` and
  `--slider-track-N` exist.
- `--scale` is a public v2 lever and every fallback literal in the reader pins it to 1.

---

## D13. The node body is a real squircle. GL has no fallback branch to be stuck in.

**Owner ruling (2026-09-10): "We use squircle shape there, and so the radius feels lesser than it
is; in the non-squircle branch like for safari the radius on surfaces like cards and dialog is too
much, and we seem to have copied that. Since this is all shaders, can we not achieve squircle?"**

Yes, and it is nine lines.

### What v2 actually ships

```css
.kui-surface { border-radius: calc(var(--kui-sf-radius) * var(--kui-corner-k, 1)) }
@supports (corner-shape: squircle) {
  .kui-surface, .kui-shell:after { --kui-corner-k: 1.613; corner-shape: squircle }
  .kui-surface.kui-floating-rows { --kui-corner-k: 1.75 }
}
```

Two branches with the same intent and different results. A superellipse hugs the corner far closer
than a circular arc of the same radius, so v2 multiplies by `--kui-corner-k` = 1.613 where it can
draw one. Only Chrome has `corner-shape` today; Safari and Firefox fall through to `k = 1` and get
a CIRCLE at the raw token — the rounder of the two, and the one this package copied when it took
`--radius-surface-N` and drew an arc with it. **The node bodies were the Safari fallback, not the
design.** That is the owner's observation, and the stylesheet confirms it exactly.

`corner-shape` appears on `.kui-surface` and nowhere else. `.kui-control` is a plain
`border-radius: var(--kui-ct-radius)`, so widget wells stay circular — a deliberate distinction,
not an omission, and they are untouched here.

### The shape

`corner-shape: squircle` is `superellipse(2)`, and CSS defines `superellipse(k)` as
|x|^n + |y|^n = 1 with n = 2^k — so a squircle is the **L4 norm** where a circle is L2. The whole
change is swapping the norm in the rounded-box SDF, in `src/utils/corner-shader.ts` so the profile
is defined once and the body, its shadow and the selection ring cannot drift apart:

```glsl
vec2 m = max(q, 0.0);
vec2 m2 = m * m;
return min(max(q.x, q.y), 0.0) + sqrt(sqrt(dot(m2, m2))) - r;
```

No `pow`: `(x⁴ + y⁴)^(1/4)` is `sqrt(sqrt(dot(m², m²)))`, two multiplies and two square roots
against two transcendental calls, per fragment on the body, the shadow halo and the ring.

It is not a Euclidean distance field for n ≠ 2 — the gradient is not unit length off the axes — but
every consumer antialiases with `fwidth(d)`, which measures the real screen-space rate of change
and self-corrects. That is what makes the substitution safe rather than merely convenient.

### Measured, because the shape is the claim

Painted radius on the harness fixture at `radius="large"`: `--radius-surface-3` = 40 × 1.613 = 64.52.
Walking the 45° diagonal in from the node's bounding-box corner to the first opaque pixel:

| | diagonal gap |
|---|---|
| a circle of that radius predicts | 18.90 px |
| a squircle of that radius predicts | 10.27 px |
| **measured** | **10.50 px** |

The circle is rejected by 8px. The 0.23px residual is the 0.25px sampling step and the antialiased
edge.

### What this is worth beyond parity

The DOM has to feature-detect and degrade; a fragment shader does not. Every browser gets the
intended profile, so the canvas is strictly closer to the design than the DOM chrome beside it is
on Safari — one of the few places this renderer can beat the thing it is matching rather than
merely equal it.

### The same defect is still live in v2 itself

Not fixed here, because it is another repository: v2's non-squircle branch leaves `k = 1`, so
Safari and Firefox draw cards and dialogs at the raw token as circles and they read too round. The
fix there is a fallback `k` that compensates in the other direction — a circle of radius `r/1.613`
matches a squircle of `r` at the same perceived roundness — or accepting the difference explicitly
rather than by omission.

---

## D14. A title drawn in the body gets a row of its own.

**Owner ruling (2026-09-10): "The node header is too close to edge."**

The label is drawn for every entity — it is the node's name — and its Y came from
`(headerHeight - lineBox) / 2`, a centring inside a band measured from the body's OUTER edge. Two
things followed.

Its distance from the top was 13px however much the body was padded, so it never moved with
`padding` the way the left inset did, and a large corner then curved into it.

Worse, at `header="none"` — the default — the layout reserved no band at all: `marginTop` was
`padding`, so the title and the FIRST SOCKET ROW occupied the same 40px. Measured on the widgets
fixture before the fix: title ink at y+20, the first output label's ink at y+30. Ten pixels apart,
sharing a row, with the title hard against the edge.

`marginTop` now reserves the band whenever the title is drawn in the body — `header !== 'outside'`,
not `header === 'inside'` — and the title centres in `[contentInset, contentInset + headerHeight)`.

- `header="inside"` gains the correct inset at **no geometry cost**: `marginTop` was already
  `rowHeight + padding`, so only the title moved, down by one padding.
- `header="none"` grows by one `rowHeight` (40px at size 2), because it was drawing a title into
  space it had not reserved. Every default node is 40px taller and its first socket row starts
  40px lower.
- `header="outside"` is untouched; the band is above the body, where no inset applies.

180 laws pass — they re-derive socket Y from the live layout rather than restating it, which is
what that suite exists for.

## D15 — the bundled face is Inter, and Google Sans is gone

`font="system"` was never a font: `loadFontPreset('system')` returns `null` and
`text-renderer.tsx` bails on a null font, so it drew NO GL text at all. A real system face needs a
runtime-generated SDF atlas — `system-ui` resolves to SF Pro, Segoe UI or Roboto per platform, and
MSDF wants a concrete file at build time. That is a separate build, not a switch.

So the face changed instead. Inter, generated by the existing `scripts/generate-fonts.js`, which
already knew the family and only lacked the TTFs.

- **Why Inter and not Google Sans.** Google Sans is Google's brand face, not an open-licensed one,
  and two 2 MB TTFs of it were checked into this repo. Inter is OFL, and the license ships beside
  it as `fonts/Inter-LICENSE.txt`.
- **The atlas got smaller.** 171 glyphs at 568 KB of base64 against Google Sans's ~656 KB. It stays
  a dynamic `import()`, so it is still its own chunk and still absent from the ESM entry.
- **`embedded-font.ts` is now whichever family is the default.** The generator's special case was
  hardcoded to `'google-sans'`; it is now `DEFAULT_FAMILY`, and every other family writes a sibling
  in `embedded-fonts/` that nothing imports. Regenerating a different default is a one-word change.
- **The preset union lost a member.** `FontPreset` is `'inter' | 'roboto' | 'source-serif' |
  'system'`. Breaking, and deliberate: leaving `'google-sans'` in as an alias for Inter would be a
  name that lies about what it draws.
- **The DOM had to follow.** `widget-edit-overlay.tsx` leads its font stack with the atlas face,
  because the `<input>` it mounts lands exactly on top of the glyphs it replaces. That constant is
  `"Inter"` now, and the docs app loads Inter via `next/font/google` so the name resolves to a real
  face rather than falling through to `system-ui` on focus.

446 unit tests and 181 laws pass.

## D16 — video and mesh are quads in the scene, not elements over it

`'video'` and `'mesh'` had been in `BuiltInEntityType` with no renderer behind either of them.
Both now render, and the decision worth recording is where their pixels live.

**The obvious build for video is a positioned `<video>` in the DOM overlay, and it is wrong here.**
Entities in this renderer are ordered by a real depth buffer — `entity-depth.ts` exists because
every layer once painted with `depthTest: false` and two overlapping nodes interleaved, the back
one's slider over the front one's body. The DOM overlay is a single sibling above the whole canvas.
A `<video>` in it paints over EVERY entity regardless of stack order, which is that same defect
returned in a form the depth buffer cannot fix. A clip that can never go behind a node is not a
canvas object; it is a thing floating over the canvas.

So all three media types are one textured quad — `utils/media-quad.ts`, extracted from
image-entities.tsx, which had owned the geometry and the object-fit shader alone. They differ only
in where the texture comes from: a decoded ImageBitmap, a video frame, or a render target.

**What each costs.** This is the part that decided the shapes of the two new managers.

- A video uploads a frame per frame WHILE PLAYING. `VideoTextureManager.reconcilePlayback` takes a
  set of what should be playing, computed fresh by the culling pass, and makes reality match it —
  so an entity scrolled off screen pauses and stops uploading. The set exists rather than
  per-entity `setPlaying` calls because a culled entity is no longer iterated and cannot ask to be
  paused, and a source shared by two entities must keep playing while either can see it.
- At most four videos decode at once. Not a GPU budget: browsers cap concurrent hardware decoders,
  the cap is small on mobile, and past it playback fails SILENTLY — black rectangles, no error.
- A mesh renders into a `WebGLRenderTarget` only when the target is dirty. A still model in a still
  box produces the same pixels every frame, so a board of static previews costs nothing per frame
  beyond the quads. `autoRotate` is opt-in for exactly this reason.
- The mesh pass runs at `useFrame` priority **-1**, and the sign is load-bearing: r3f disables its
  own render as soon as any subscriber has `priority > 0`, so a positive priority would hand this
  file responsibility for drawing the whole graph. Negative keeps r3f rendering and merely orders
  the pass first.

**The duplicated list is gone.** `nodes.tsx` and `text-renderer.tsx` each carried their own
`type === 'comment' || … || 'image'` chain saying "this type draws itself". Two copies of one list
is how a node body ends up painted under a playing video, so both now call `utils/entity-kind.ts`,
which also owns the aspect-lock default the resize handler had inlined for images only.

474 unit tests and 187 laws pass, and the laws include the one that pins the decision: a plain node
overlaps the video, and the pixel where they cross must be the node's. It has a witness pixel
beside it, because without one the check passes when there is no video at all — verified by
deleting the renderer and watching it go red.


## D17 — evaluation is orchestration in the store, computation in the consumer

Phase 8.5 is built. The spec (`plans/phase-data-flow.md`) held; four things were decided in the
building that it did not say.

**Status lives in the engine, not on `entity.data.status`.** The spec said "auto-set on
entities". It cannot: the component is controlled, and `FlowSync` replaces every entity on every
prop change — which arrives within a frame of any widget edit, the very event that starts a run.
A status written into entity data would be erased before it was drawn. So `core/evaluation.ts`
keeps its own records and `nodes.tsx` reads `data.status ?? engine status`: the consumer's word
wins where they have one, the engine fills in where they do not. `dirty` joined `EntityStatus` for
the consumer's benefit; the engine also has `idle`, which the renderer maps to "no status".

**The engine is a module with a host interface, not store code.** Every lifecycle claim — dirty,
running, cancelled, error, gate, cascade — is an ordering claim, and ordering claims are what a
unit test pins and a browser cannot. `Evaluator` takes an `EvaluationHost` of reads; the store is
one host and `evaluation.test.ts` hands in a literal. The store owns the instance the way it owns
`cachedAnalysis`: in the factory closure, exposed through actions, disposed on unmount.

**Cancellation is by run identity, and it is what makes a slider drag safe.** Each run carries a
monotonic id; a result whose run is no longer current is dropped whether it resolved or rejected.
Combined with the invariant that downstream of a dirty entity is always dirty — so a repeat mark
walks nothing — a drag marks once per pointermove at O(1) and the final stored output is always
from the final input. The law "a superseded run never lands" was sabotaged to confirm it goes red.

**An upstream error holds the chain.** The spec did not say what a downstream entity does when
the node it reads from failed. Running it on the stale output produces a result that looks fine
and is wrong; it stays `dirty` — visibly — until the failure is fixed, and then the chain resumes.

**What the hooks are, because a missing one fails silently.** `setWidgetValue` (the person moved
a widget); `setEntities` where an entity's `data.values` reference changed and no local widget
write is pending for it (an undo, a preset — but not the echo of a mark already made, which would
abort the run it started); `setEdges` and `applyEdgeChanges` for every target whose wire appeared
or left; `addElements` for new entities and new wires' targets; `deleteElements` for the targets
that lost a wire; mute and unmute. `store-evaluation.test.ts` asks one question per hook: after
this mutation, is the right entity dirty?

Measured: a full cascade through two nodes — dirty, running, success, idle, twice — costs zero
React commits (law: "a full evaluation cascade costs no React commits"). The slider drag's own
commits are the fixture's controlled-component echo, which is the consumer's contract, not the
library's cost. 498 unit tests, 201 laws.

**Addendum (2026-09-11) — what the node shows, and what the tests had to be.** Reported progress
is a bar along the bottom edge inside the border, over a faint track, in the running hue; it is
drawn only while the engine's own status is `running`, because a consumer overriding status has
said the run is not what is happening. A thrown message is drawn under the node in the invalid
hue, truncated to the node's width; `data.statusMessage` wins over it, and a consumer status
override withdraws the engine's message with the engine's status. `ctx.entity` hands the entity to
`onEvaluate`. `setHandlers` schedules a pass, because handlers arriving late — or a type table
turning a gate reactive — can change the answer for something already dirty.

The engine tests grew to the shapes that break naive schedulers: a diamond's join runs once, after
both branches, with both values; a cycle neither hangs nor throws and stays honestly dirty while an
acyclic branch beside it runs; an entity removed mid-run lands nothing; two wires into one input
resolve deterministically; `onEvaluate` may inject values re-entrantly; a superseded run's
progress cannot scribble on the record. Two law mistakes are recorded because they are the kind
that pass silently: `glyphs()` is one batch per mesh, not per label, so a message is observed as a
glyph-count delta — and that delta is the message's non-space length, since a space is advance and
not a quad. 521 unit tests, 209 laws.

**Addendum (2026-09-11) — the outline is the progress.** The bottom bar went. It was a widget
bolted onto the card; the card's own outline can say everything the bar said. While running, the
ring sweeps the perimeter from top-centre clockwise to `ctx.progress`, at one speed all the way
round (`perimeterT` measures straights by length and corners by angle — a plain angle about the
centre races along a wide card's short sides). A run reporting nothing sends a short arc round
instead. Done completes the ring and then DISSOLVES it over the hold, and the dissolve is not
decoration: a full accent ring held still is exactly what a selected card looks like, and one cue
must not carry two meanings. That needed the record to carry `since` and the node pass to keep
rebuilding while a hold runs — bounded, because the engine ends the hold. Stale fades the card a
step and tints the hairline. One hue for all of it, the theme's accent; error keeps the graph's
invalid red; warning stays the consumer's amber. The laws read the ring at both edge midpoints,
so the clockwise direction is pinned, not just the fact; and the dissolve is pinned by two samples
in the hold. 522 unit tests, 211 laws.

**Addendum (2026-09-11) — the sweep eases toward the report.** A handler reports when it has
something to say — every tenth, once a chunk, once a second — and the ring drew that number raw,
so it jumped between reports and read as a stutter next to the smooth travelling arc of a run that
reports nothing. The drawn sweep now chases the reported one: each frame closes a share of the gap
(`progressEaseAlpha`, a rate per second, so the same wall-clock arrival at 60Hz or 120Hz), and a
target behind the ring means a new run, which sweeps out of zero rather than winding back. That
also means a run owns the render pass the way a hold does — nothing else would move `aProgress`
between reports. The law that pins it reads a point a quarter along the BOTTOM edge, which the
sweep reaches late: just after a single 0.5 report it is plain, and later in that same unchanged
report it is lit. Both halves were checked by sabotage — snapping to the report, and dropping the
per-frame pass — and each fails only that law.

**Addendum (2026-09-11) — the arc's phase is the run's, not the clock's.** Starting a run showed
the travelling arc somewhere arbitrary for an instant before the sweep began from zero: a run that
reports nothing draws the arc, its head was `fract(uTime * 0.3)`, and `uTime` is the render clock,
which knows nothing about when this run began. So the moment between a run starting and its first
report flashed the arc at wherever the clock stood. `aProgress` now carries the run's AGE in its
negative half — positive is the sweep, negative is an arc and how long it has been travelling —
and the arc sets off from top-centre, where a sweep starts, every time. That retired `uTime`
entirely: everything that moves on a card is carried by `aProgress` and drawn by the forced pass,
which is one less clock to reason about. A consumer who only sets `data.status = 'running'` has no
run to anchor to, so that case keeps the clock's phase. The law runs the same quiet work twice, a
hold apart, and reads two border points at the same moment into each: a clock-driven arc cannot
land twice alike, and under sabotage it does not. 533 unit tests, 215 laws.
