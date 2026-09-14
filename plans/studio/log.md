# Studio: build log

> Newest first. What was built, what was verified, what went wrong and what is open. The plan is
> [plan.md](./plan.md); the stack reasons are [research.md](./research.md).

---

## 2026-09-14, the editor's chrome and its faces

### Right-click adds a node

Asked after the empty state. A right-click on the canvas opens v2's `ContextMenu`: "Add node" over
one submenu per category, in the catalog's order. A node chosen there lands with its corner where
the right-click was. The canvas box is the trigger itself, through `render`, and the rows live in
`canvas-menu.tsx`. `onAdd` takes an optional position for it; + and ⌘K still place new nodes in the
middle of the view.

The menu opens on empty canvas only. Over a node, the minimap or a node's toolbar, the handler
stands Base UI down and refuses the platform's menu as well, since that menu means nothing over a
graph. A text field keeps the platform's menu. Whether a node is under the pointer is read from the
flow store's `hoveredEntityId`, once per right-click: a `StoreBridge` inside the canvas hands the
store out, rather than a subscription copying the hover out on every store write. The minimap takes
a `kd-minimap` class so the handler can tell it apart.

Verified in a browser, light and dark, each on a new graph. A right-click on empty canvas opens the
menu at the pointer, with the platform's menu refused. Its rows are Sources, Text, Math, Video and
AI. Math opens its nodes, and Clamp lands exactly at the right-clicked point and closes the menu. A
right-click on the node or on the minimap opens nothing and still refuses the platform's menu.
Escape closes the menu without adding anything, undo takes the node back, and a left-click still
selects. No page or console errors. `tsc` is clean for studio.

The first run failed one check, and the check was wrong: Base UI stops the event after refusing the
platform's menu, so a listener on the window never saw it. The check now listens in the capture
phase. Not checked: opening the menu from the keyboard.

### The inspector's empty state

Asked with a screenshot of the pane holding one line of grey text. The pane now shows the empty
state from v2's docs blocks, copied to `src/app/empty-state.tsx` because studio cannot import from
v2's docs app: a title and one sentence, centred, with the title a span rather than a heading. It
comes in two versions, as the builder's Layers panel does. A graph with no nodes says "No nodes
yet" and points at +. A graph with nodes and nothing selected says "Nothing selected" and says to
click a node. Neither has an action, because what fills the pane happens on the canvas. It sits
straight in the pane rather than in a scroller, whose content has no height, so it centres in the
pane.

Verified in a browser, light and dark, each on a new graph. Both versions show the right words,
centre exactly across and down the pane, and add no heading. + still opens the palette, choosing a
node closes it, clicking the canvas shows "Nothing selected", and clicking the node brings its
settings back. No page or console errors. `tsc` is clean for studio.

### The canvas runs under the inspector, which is glass

Asked once the inspector floated: nothing passed behind it, so it could not be glass. The inspector
states `backdrop`, and the canvas container is the whole content pane again, undoing the stop in
the entry below. That stop had two reasons, and each now has its own answer:

- **The minimap** sat at the container's bottom-right, which is now under the pane, and had no way
  to move. The library's `MinimapProps` gains `style`, applied after the minimap's own inline
  styles, which a stylesheet rule cannot beat. Studio passes
  `right: calc(10px + var(--kui-shell-inset-inline-end, 0px))`. The changelog, the minimap docs
  page and a test (`minimap.dom.test.tsx`, "lets a stated style win over its corner") carry it.
- **A new node landed at the container's centre.** The canvas now holds an inert box that stops at
  the reach, and `placeAt` measures that instead. `containerRef` is renamed `visibleRef`.

Closing the inspector no longer resizes the GL surface; only the minimap moves.

Verified in a browser, light and dark. The canvas and its GL surface reach the window's edge under
the pane. The pane is translucent with a backdrop filter and still takes its own presses; the canvas
beside it takes its presses too. The measured box ends one gap (8px) short of the pane. The minimap
sits 18px clear of the pane, goes back to 10px from the corner when the pane closes, and clears the
pane again when it reopens. A node added with + lands at x 552, the middle of the part in view,
where the whole canvas's middle is 720. No page errors or inset warnings. `tsc` is clean for studio
and the library, and the minimap tests pass (7/7).

### The inspector floats

Asked after the v2 builder got the same. `ShellInspector` takes `flush={false}` and drops
`width={320}`, which only restated the frame's token: the reach the content pane publishes is
derived from the token, so a pane stating its own width drifts from it. The canvas container now
ends at `--kui-shell-inset-inline-end` instead of running under the pane, because the minimap has
no style prop and sits at the container's bottom-right, and a new node lands at the container's
centre.

Verified in a browser, light and dark. The pane sits 8px off the window's edges and the published
reach matches it (336px). The canvas ends 8px short of it, the header's controls and the minimap
clear it, and closing the pane gives the canvas the full width back. No page errors or inset
warnings. `tsc` is clean for studio.

### + is loud

Asked with a screenshot of the strip. The + button takes `emphasis="loud"`, since it is the way into
the catalog. No tone: neutral, so it does not compete with Run's accent.

Verified in a browser, light and dark. The button fills dark on light and light on dark, and still
opens the palette. No page or console errors. `tsc` is clean for studio.

### Undo and redo take Hugeicons' own drawings

Asked with a screenshot of Hugeicons' "undo" results. The bottom row's buttons swap the turn arrows
(`ArrowTurnBackward`, `ArrowTurnForward`) for `Undo` and `Redo`, the mirrored circle arrows. Both
names clash with studio's own wrappers in `icons.tsx`, so they are imported as `UndoDrawing` and
`RedoDrawing`.

Verified in a browser, light and dark. Each button draws exactly Hugeicons' paths, and both are
disabled on a fresh graph. Undo and redo of an added node land in the saved graph. No page or
console errors. `tsc` is clean for studio.

### Run becomes a split button, on a re-vendored v2

Asked after the header work. v2 was rebuilt from its working tree and packed into `vendor/`.
`SplitButton` was still uncommitted in v2, so the tarball carries it ahead of v2's own history.

- **`pnpm install` kept the old copy.** The tarball keeps its name and version, so the lockfile
  looked current and the install skipped it. `pnpm update -r @kookie-ui/react` read it again and
  wrote the new integrity; `vendor/README.md` now says so. pnpm 12 runs on Node 24 here; the
  shell's Node 22 shim fails.
- **Run is the action, Run all is the menu.** The label runs what changed; the chevron's one row
  runs everything.
- **The halves sit outside the header's arrow-key order.** v2's toolbar notes say a plain Button in
  a toolbar is its own tab stop, and `SplitButton` is two plain Buttons. v2 has no toolbar version
  of it yet. Not tested.
- **Studio's float-band CSS rule is gone.** v2 `140b252` makes a floating band's toolbar pass the
  pointer itself.

Verified in a browser, light and dark, on a scratch graph deleted afterwards. With a spy on the flow
instance, Run calls `evaluateDirty` only, and Run all from the menu calls `evaluateAll` and closes
the menu. The menu opens 4px under the button, flush with its end. Enter on the chevron opens it;
Escape closes it and returns focus. The halves share one fill and the row's 40px height, with
square inner corners. Presses beside the bands' controls reach the canvas without the old rule.
⌘K still opens the palette, and a selected generation node still shows its own Run. No page or
console errors. `tsc` is clean for studio, docs and the library.

### Header, bottom row and the palette's openers

Asked in a run of messages. The Studio mark leads the header and is the way home. The graph name
moves right, before Run, Run all and the inspector toggle. The Home and search buttons go. The
bottom-left row holds appearance, then Undo and Redo as separate buttons, then the save line.

- **The save line is muted and says when.** It reads "Last saved at 12:04", "Saving…", or, before
  the session's first save, "All changes saved". The status store holds no time, so `SaveStatus`
  notes it when a save lands. "Not saved" and "Changed elsewhere, reload to keep editing" are not
  muted.
- **The palette keeps its open state in the + strip.** It was lifted into the editor for a header
  search button that was then removed. The lift caused an "onOpenChange is not a function" error
  on ⌘K in an open tab: hot reload applied the strip, which then required the prop, before the
  editor that passed it. A fresh load was fine.

### Faces

- Inter reads in both apps; that switch landed from another session. The `layout.tsx` comments
  that still called Inter the canvas's face alone are fixed.
- PP Playground Medium sets the wordmark: "Flow" at step 8 in the docs sidebar, "Kookie© Flow" in
  the docs footer, "Studio" at step 8 in the studio header. The file is Pangram Pangram's, so it
  is copied into each app's gitignored `public/fonts`, and a clone without it sets the mark in
  Inter.

Verified in a browser, light and dark. The mark links home, and no Home or search button remains.
The name leads the right cluster. The bottom row reads appearance, Undo, Redo, save line; Undo and
Redo are disabled on a fresh graph and undo and redo an added node. The line turns to "Last saved
at …" after a rename. + and ⌘K open the palette, and ⌘K closes it. Presses beside the bands'
controls reach the canvas. Both wordmarks render in PP Playground as a web font. No page or
console errors. `tsc` is clean for studio.

---

## 2026-09-13, the node's shadow, and generation nodes that cost nothing

### The shadow was never KookieUI's

Asked why a node's float looked unlike the docs demo's, and why the studio's read as "cut". Two
different answers, and the second one was the real fault.

- **The demo was pinned to `variant="classic"`**, which resolved a `--shadow-N` token — a tight
  DOM-card shadow — while the studio took the default surface treatment. v2's Card is "one
  treatment and no variants", so the prop named a look the design system had deleted. Removed.
- **The body's float was invented.** `useThemeTokens` never parses `--shadow-1..5` at all — it
  returns hardcoded single-layer stand-ins, saying CSS shadows are "too complex to parse
  reliably" — and `NODE_SHADOW` then ignored even those, on the grounds that the tokens "top out
  at blur 16". That was only ever true of the fake table: v2's real `--shadow-3` is three layers
  reaching 48, and `gl/material.ts` has carried it, read off v2's stylesheet, all along. The
  popover has drawn it correctly since it was written. The node body was the one surface never
  moved over, and now draws the same three-layer cast.
- **The "cut" was a discard threshold.** The halo was thrown away below 1% alpha while the tail
  was still ~1% black — three luma levels on the light floor, a hard edge tracing the card's
  outline out in open canvas. A 4px blur hid it against the card's edge; a 20px one did not.
  Measured on the canvas before and after: a three-level step became one, the floor's own
  quantisation.

Still v1 residue, deliberately not swept up in a shadow fix: the fake `--shadow-N` table, the now
unread `NODE_SHADOW` and `resolvedStyle.shadow*`, and the whole `EntityVariant` axis (a public
type, documented in `entities.mdx`).

### Generation nodes, against a mock

Five nodes, all `where: 'server'` and `evaluation: 'manual'` — the two go together, because a node
that costs money must never run because a slider moved. Generate image, Edit image, Upscale,
Remove background, Animate image.

The pipeline is real and only the pixels are not: `/api/jobs` writes a row, paints a deterministic
placeholder PNG (hashed from the request, so the same prompt and seed give the same picture and a
second Run is answered from the evaluator's cache), stores it content-addressed, and returns a
`MediaRef`. The encoder is `node:zlib` and about sixty lines; no dependency, no key, no spend. The
fal adapter is a swap at the port, not a rewrite.

**Library change 1 from the plan, which was still undone:** `classifyPreviewValue` returned
nothing for an object, so a `MediaRef` on an output socket could never draw its own band. It now
reads a reference's `preview` before its `url`, and believes `kind: 'video'` over a URL with no
extension — a stored asset is served from an extensionless path, and a clip drawn as a picture is
a still that never moves. Five tests.

Three defects the screenshots caught, all the same v1-token trap: a prompt well took the control
family's pill sentinel and came out a **circle** (a multi-row field has to say `textarea`, which
is what `wellRadius` keys on); the inspector's output picture read `--radius-2` and did the same;
and it then ran off the panel, because a flex item's automatic minimum size is its content's.

Two more the owner caught by eye, both config rather than rendering. A prompt sat in the
half-width column beside its own label: the Text source node says `layout: 'stacked'` and the
generation nodes did not, and a prompt is the thing you came to the node to write. And the band
letterboxed — the registry asked for `fit: 'contain'`, so a square generation in a wide, short
band was centred with the card's fill either side, reading as a small picture in a frame rather
than as a band. It covers now; the uncropped frame is one click away in the inspector.

Verified in a browser: the band draws, the inspector reports Done, bytes land in `.data/blobs`,
and the video node's reference carries its duration and fps. `tsc` clean in all three packages;
library 752 tests, studio-core 24.

### The band was not in the same flow as the rows

Resizing a node drew the picture straight over its own inputs. A card taller than its content
CENTRES what is inside it — `geometry.ts` and `widget-geometry.ts` both add
`(height - computedHeight) / 2` to every socket and every widget — and the band alone was placed
at the bare `previewY`. So the moment an entity carried an explicit height, from a resize or from
a document that set one, the rows moved down and the band did not. It takes the same term now,
same sign, unclamped, and measures its remaining room from the offset top rather than from
`previewY`.

Reproduced without touching a drag handle: two nodes in one document, one default and one at
`width: 240, height: 720`. The sized one showed the overlap every time and is clean now.

### A band can lead

`EntityPreview` takes `position?: 'top' | 'bottom'`, defaulting to `bottom` — so the docs, the
demo and every existing consumer keep the layout they had, and adding a band to a node still
moves nothing. The studio asks for `top` on every node that has one: on a generator the picture
IS the point, and the prompt and the sizes are the controls underneath it. The layout places the
band before the outputs, and `buildCacheKey` carries `position` because it moves every row below
it — `fit` stays out of that key, being a drawing decision the layout never sees.

A leading band then sat too close to the title, and the reason is that `marginTop` is
`padding + titleBand`: content begins flush against the bottom of the title's own air. A socket
row hides that, its label being centred inside a tall row, so the space arrives for free. A
picture has no inside — its pixels start on that edge, and the title ends up sitting on the frame.
It takes `padding` above it now, the same inset it already had left and right, so the picture
carries an even margin on three sides.

### Real files instead of a painted placeholder

The mock answers with two real files from `apps/studio/mock/`: a photograph for every picture
(Birmingham Museums Trust, a 3999×2896 progressive JPEG) and a clip for every video (2560×1440
H.264, 17.95 s at 29.97 fps). The PNG painter is gone. A painted PNG only proved that PNGs work;
a large JPEG and an MP4 served by range are what a provider will actually hand back. Each file is
read and hashed once per process — a repeat job answers in 8 ms against 38 ms for the first.

Verified: the JPEG serves 200 at its exact size, the MP4 answers a range with 206, the photograph
draws in the Generate band, and the clip MOVES — 12,624 pixels change across 1.5 s, all inside
the Animate band. One run hit a shader compile error in `media-quad.ts`; it was a stale compile
of an in-flight save and cleared on reload.

The two files are 13.4 MB and uncommitted. Whether they belong in git is a call for later.

### The editor loses its header

Laid out the way the docs site is (`docs-chrome.tsx`), because what the header held was either
the frame's own chrome or a control for the graph — and neither belongs in a band across the
whole window. The graph's controls float in a `ShellPaneHeader` over the canvas, which passes
behind them. The way home sits beside the node search in the sidebar's floating header; the
appearance control in its floating footer.

No separators, as the docs band has none: undo and redo are one `ToolbarGroup`, every other
control is its own capsule, and the gap between clusters is one step wider than the row's own, so
the air does the separating.

Two things the move broke, both caught on screen and fixed. The node list started UNDER the
floating header, hiding "Sources"; it now spends the pane's published reach with the docs nav's
own two lines. And the search ran off the pane; it grows into the row now, which needed
`minInlineSize: 0` on the field's wrapper, and its placeholder is "Search" because "Search nodes"
clipped at 167 px. Measured rather than eyeballed: zero separators, zero header elements, the
list's first label below the band, the field inside the pane.

### Refreshing stops locking the editor out

Asked about "this graph changed elsewhere" on refresh. Reproduced in a browser against a clone of
the graph. It was two bugs.

- **Opening a graph wrote the origin over its saved view.** The canvas started at the origin and
  was moved to the stored view one effect later, so autosave read the origin as a pan. Strict
  mode's cleanup sent that as a beacon and never learned the new revision, so the corrective save
  was refused. This is why the user's graph sat at 0,0. Fixed: the canvas starts on the stored
  view (`defaultViewport`), and the unmount path sends an ordinary save whose answer is read.
- **A refresh inside the save window renders the new page before the old page's last save
  lands.** The beacon goes at `pagehide`, which a reload fires only after the server has rendered
  the new page. The new page opened a revision behind, without the last edit, and its first save
  was refused. Fixed with a handover: the old page leaves its graph, and fingerprints of the writes
  it never heard back about, in session storage. The new page opens on that graph when its render
  is the tab's own history. Saves name the fingerprints (`supersedes`), and the server lets a stale
  write land only when the row holds one of them, conditional again on the revision it read.
  `documentFingerprint` is in studio-core, so browser and server compute the same value.

Also: a 409 logs a warning, not an error, since the status line already says it. A save whose
request failed counts as unanswered, so its retry is not refused if it landed. The autosave seed
is serialised once rather than on every render.

Verified by a browser script, 16 of 16. Opening a panned graph writes nothing and keeps the view. A
plain refresh writes nothing. Pan then refresh carries the pan and saves over its own beacon (base
2, answered revision 4). Two quick refreshes do the same. A second tab with its own session is
still refused and overwrites nothing. `tsc` is clean for studio and studio-core; studio-core has
27 tests, 3 new.

Open: every open runs both generation nodes again. `evaluateAll` on mount posts two jobs per
refresh — free against the mock, billed against a provider.

### Run in the node toolbar, for generation nodes

Asked for a Run button in the node toolbar, for generation nodes only. The studio now renders the
library's `Toolbar`, and only manual node types get a toolbar entry (`node-toolbar.tsx`), so a math
node shows none.

- **One node at a time**, as the inspector's Run is. `evaluate` starts a node on the inputs it has
  now, so Run on two selected nodes that form a chain would pay for the second on the picture the
  first is about to replace. Two selected nodes show no button; the header's Run orders a batch.
- **It spins while its node runs, and a press on a running node does nothing.** `evaluate` on a
  running node cancels the run and starts it again, and a double click lands its second press
  before the spinner has had a frame.
- **An entry per type, not one render function for the whole toolbar.** With the latter, every
  selection pays for the toolbar's bounds work on each pan frame, not only a selection that holds
  a generation node.

Also: generation nodes lost their accent glow. `accentHeader` is off on the canvas, and the five AI
definitions no longer set `color`. A node saved with a colour keeps it.

Verified by a browser script, 8 of 8, with jobs held three seconds so the running state could be
seen. Nothing selected: no button. A lone generation node: Run, visible. A double click: one job,
`aria-busy` during it and gone after. A selected Clamp: no button. Two generation nodes selected
with Cmd+A: no button. No page or console errors. `tsc` is clean for studio.

Open: tall nodes added from the library overlap. Placement assumes 180 px for a node with no stated
height, and a generation node is about 520, so the second lands 204 px below the first.

### The sidebar becomes a strip of tools

Asked to replace the node library's sidebar with a dropdown on a vertical toolbar. The sidebar is
gone, and the canvas has its width.

- **A vertical toolbar halfway down the canvas's left edge**, level with the header's inset. Its +
  opens a menu with a submenu per category, because as one list the catalog is taller than a
  laptop screen. Its search opens a palette that matches through `registry.search`, so "prompt"
  finds the generators by socket name, and Enter adds the highlighted node.
- **Home leads the header**, where the sidebar's toggle was. **The appearance menu keeps the
  bottom-left corner**, now in a floating footer of the content pane.
- **The bands over the canvas take presses only on their controls.** v2's floating pane turns its
  toolbar row's pointer events back on, so the header already swallowed presses across its whole
  width. One rule in `globals.css` turns the row off again.

Gaps in v2, for its own agent: a `ToolbarGroup` in a vertical toolbar stays a row (stacked here
with an inline `flexDirection: column`); in a vertical toolbar, ArrowDown on a menu trigger opens
the menu instead of moving to the next tool; and `.kui-pane-header[data-float] > *` outranks the
toolbar row's own `pointer-events: none`.

Verified by a browser script, 21 of 21, light and dark. No sidebar. The strip is vertical,
stacked, level with home and centred. Appearance sits bottom-left. Presses beside the bands'
controls reach the canvas, and home and appearance still take theirs. ArrowUp walks the strip.
+ › AI › Generate image and a search for "clamp" plus Enter each add their node. The palette
reopens on the whole catalog. No page or console errors. `tsc` is clean for studio.

### + opens the palette, and ⌘K does too

Asked: search did the same job as the + menu, so + opens the search palette, the search button
goes, and ⌘K opens it. The palette's list is in sections by category, not submenus.

- **The strip holds one button.** With no group left, the inline `flexDirection: column` went too.
- **⌘K and Ctrl-K open and close it**, from the canvas or a field. The listener is on the document
  in the capture phase, so the canvas's key handling cannot take the chord first.
- **The query clears as the palette opens, not as it closes.** Cleared on close, the list refilled
  while the panel was still leaving, under the words that had narrowed it.

v2 fixed the three toolbar gaps as `140b252`, but the vendored tarball predates it. Studio keeps
its `globals.css` rule until the tarball is rebuilt.

Verified by a browser script, 24 of 24, light and dark. The strip holds only +, level with home.
+ and ⌘K both open the palette with its field focused, on all 27 nodes in five sections. "prompt"
leaves only the sections that match, and a query matching nothing says so. Escape and a second
⌘K close it, and the next open starts on the whole catalog. "clamp" plus Enter adds a Clamp from
a palette opened in the name field, without touching the name, and a click on a row adds that
node. The bands still pass presses through. No page or console errors. `tsc` is clean for studio.

Under software GL a close can take over a second, because the palette's blur covers the canvas.
The script waits for the palette's state instead of sleeping.

---

## 2026-09-12, the ultracode audit and its fixes

152 agents over three rounds: seven dimension finders (correctness, performance, security, data
integrity, React and Next, conventions, library integration), a merge pass, then three independent
verifiers per finding — refute, reproduce, judge impact — with two of three needed to confirm.
**75 findings confirmed, 6 rejected.** Six agents in round two died on the session limit, so the
second gap sweep never ran; another pass has that ground left to cover.

### The critical one, and it was mine

**The strict-mode fix from the build was wrong.** Clearing `disposed` was not enough: `dispose`
also emptied the queue of stale nodes, and `markDirty` stops at a node whose record already reads
dirty — so the marks could never be made again. In development, where React disposes and revives
every effect, **a saved graph opened with nothing evaluating and Run doing nothing.** My smoke test
missed it because it only ran a single source node; nothing was ever wired.

`dispose` now keeps the queue and demotes an abandoned run back to dirty. Two tests pin it, and a
second smoke test (`chain.mjs`) wires 2 + 3 → Add so the case cannot go unnoticed again.

### Fixed

- **Nodes added by the consumer never ran** (library): the store marked a node stale only if it
  already existed, so a node from the library, an undone delete or an agent edit sat idle — and
  whatever it fed read `undefined`, fell back to the socket default, and reported success.
- **A widget override froze evaluation for a node** (library): the veto was per entity and an
  override whose value already matched could never retire, so later inspector, undo and agent
  edits to that node were all read as echoes. Now decided per socket, and a spent record retires.
- **A widget's baseline ignored the socket default** (library), so the first drag on an untouched
  slider snapped back mid-gesture.
- **Leaving the editor dropped unsaved edits**: the flush read the canvas after React had already
  detached it. The document is now snapshotted while the canvas is alive.
- **Opening a graph saved it**: the first-run guard counted effect runs, which strict mode and
  Fast Refresh both defeat. It compares against what the server holds instead.
- **Two tabs overwrote each other.** Every save carries the revision it was based on, and the
  server refuses a stale write with 409 rather than applying it. Verified: correct revision saves
  and bumps, the same revision twice is refused.
- **A blank name discarded the document it arrived with** — name and document are judged separately
  now.
- **The dev server was open to the whole network**, unauthenticated. It binds loopback (`pnpm
  dev:lan` is the opt-in), and a middleware refuses unknown Hosts (DNS rebinding) and cross-site
  writes (CSRF). Verified with forged Host and cross-site requests.
- **The inspector committed a graph operation per pointer move and per keystroke** — about 120 full
  rebuilds for a two-second drag. Values commit when the edit ends. The canvas widget echo became a
  real debounce, and the canvas sits behind a memo boundary so typing a name no longer re-renders
  it.
- **The regex option on Replace could freeze the tab** (34 characters, about two minutes) and the
  freeze was saved with the graph. Matching is literal; the option returns when text can run in a
  worker with a time limit.
- Prototype-named ids (`__proto__`) could reach object keys and the expression parser's tables;
  both are guarded now, and stored documents are validated rather than trusted.
- Template kept mangling whitespace; `Length` counted code units; `toFixed` could throw from a
  wired input; wrong argument counts answered `NaN`; `-0` and `0` shared a cache key.
- Delete asks first, "New graph" cannot double-fire, the list refreshes on return, dates are the
  reader's, a failed migration closes its connection, uploads check size before buffering, and the
  list counts nodes in SQL instead of parsing every document.

### Deferred at first, then asked for anyway

Everything that had been left undone was fixed the same morning, on the owner's instruction: "fix
whatever you can, and run build."

- **The library was built** (`pnpm --filter @kushagradhawan/kookie-flow build`). `dist` has its
  declarations again, so the docs site picks up the engine fix — and it still serves.
- **The data directory is `STUDIO_DATA_DIR`**, defaulting to `.data` beside the app, and the
  migrations are traced into the standalone output. A standalone server no longer starts against a
  database with no tables, and nothing that matters sits where the next build would delete it.
- **Writes are durable**: bytes flushed before the rename, the directory flushed after it, and a
  file of the wrong length under a content hash is rewritten rather than trusted for good.
- **Files stream, with ranges.** A plain request gets `accept-ranges`, a range gets 206 with
  `content-range`, an impossible one gets 416 — which is what lets a video be seeked without
  fetching the whole thing, or holding it in memory to answer.
- **Save status left React state.** It lives in a store that one small component subscribes to, so
  a save no longer re-renders the editor at all.
- **Moving the view is saved**, reported from inside the canvas once it settles, so panning still
  costs nothing while it happens.
- **Pasted nodes are stripped** of the catalog's sockets, sizes and labels before they join the
  graph, so a paste cannot freeze the catalog into a saved document.
- **"One wire per input" is one function** (`replacedWires`), used by both the canvas and the op
  compiler, with its own test.

### Verified after the fixes

- `tsc` clean: app, studio-core, library. Tests: library 747, studio-core 24.
- Both browser suites pass, including the wired chain: computes on open, cascades on edit, a node
  added from the library evaluates, undo steps back.
- API: stale revision 409, malformed document 400, blank name keeps the document, forged Host 403,
  cross-site write 403, upload → blob 200 with ranges (206 and 416), unsupported type 415,
  traversal key 404.
- Pan, reload, same view. The docs site serves against the rebuilt `dist`.

### Still undone

- **The audit's second gap sweep** never ran — six agents hit the session limit. Worth repeating
  once there is more code to look at.
- **Dragging a wire between two sockets** is not covered end to end. The rule it exercises is unit
  tested, and the library's own harness covers the gesture.
- **The phases after this one**: GPU image ops, AI nodes and jobs, the agent, logic and control
  flow, video, templates, sign-in and credits.

### Note on the library's `dist`

The package's watch build cleans `dist` and re-emits the JavaScript before the declarations, so a
type-check landing in that window sees the whole library as `any` — which is how a green check
turned red mid-session. The app and studio-core now type-check against the library's source, so
neither depends on that timing. `dist` is what the docs site reads, and a real build is what fills
it in.

---

## 2026-09-12 → 13, the build

### State

Phase 1 (shell) is working in a real browser. Phase 2 (logic) has started: values, math and text
nodes run. No git commits; everything is on disk on `main`, alongside the owner's uncommitted docs
work, which was not touched.

Run it: `pnpm --filter studio dev`, then http://localhost:3002. No keys and no database server
needed; the database is embedded (`apps/studio/.data/pg`) and files go to `apps/studio/.data/blobs`.

### Built

- `packages/studio-core` (AGPL-3.0-only). It has no React and no DOM.
  - `defineNode` and the node registry. One definition gives the canvas its entity types, search,
    and (later) agent tools.
  - `GraphOp` compiler: add, remove, connect, disconnect, set values, set label, move. It validates
    against a working copy, refuses loops and type mismatches, and replaces the wire an input
    already holds.
  - `createOnEvaluate`: looks up the node, coerces inputs to socket types, and caches results by
    input identity. A cancelled run is never cached.
  - `describeGraph`: the compact text form the agent will read.
  - Nodes: number, slider, text, seed, toggle, color; add, subtract, multiply, divide, power, min,
    max, remap, clamp, round, expression (a safe parser, no `eval`); template, join, replace, length,
    number-to-text.
  - 11 unit tests.
- `apps/studio` (AGPL-3.0-only), Next 15.
  - Graph list at `/`, editor at `/g/[id]`.
  - Node library (searchable), inspector (every input as a control, status, outputs, run, delete),
    top bar (name, save state, undo, redo, run, run all, panes, appearance).
  - Autosave, debounced, with a `sendBeacon` flush when the tab closes.
  - Copy, paste and duplicate (mod+C/V/D). Delete, select-all and undo come from the library.
  - Drizzle schema for graphs, assets and jobs, with `workspace_id` on every table. The migration is
    generated in `drizzle/`. PGlite is used when `DATABASE_URL` is unset; the same schema runs on
    Postgres.
  - Content-addressed local storage and `/api/blob/<key>`. `/api/assets` accepts uploads.
  - Dark mode with a pre-paint script, the same mechanism as the docs.

### Verified

- `tsc` clean for `studio-core`, `studio` and the library. Tests: studio-core 11/11, library 743/743.
- Browser smoke test (Playwright, scratchpad):
  - Create a graph from the list and add three nodes from the library; the autosave row has 3.
  - Click a node and the inspector shows it. Set its value to 7 through the inspector, press Run,
    and the inspector reads "Done, out 7". The saved row has `{"value":7}`.
  - Copy and paste makes 4 nodes; delete brings it back to 3.

### Library changes (packages/kookie-flow)

- **Fixed: the evaluation engine never came back from React strict mode.** Strict mode runs the
  flow's cleanup, which disposes the engine, and then runs its effects again. `setHandlers` now
  clears `disposed`. Before this, every strict-mode development build had an engine that answered
  nothing: Run did nothing, and there was no error. A test pins it (`evaluation.test.ts`, "comes
  back when handlers arrive after a dispose").
- **Not done yet**, both from the plan:
  - The preview band accepting a `MediaRef` object. This comes with phase 3, when there are pictures
    to show.
  - Exporting `useGraph`'s reducers. Not needed so far: the op compiler emits change batches that
    `useGraph` applies.

### Found, and how it was handled

- **Selection is not reported through `onEntitiesChange`.** It lives in the flow store, so the
  inspector showed nothing when a node was clicked. A `SelectionBridge` inside the canvas subscribes
  to the store and hands selection to an `EditorBus`, which tells the panes once per frame.
- **A paste lands in the store but is not reported to a controlled owner**, so the next prop sync
  removed it. The studio's paste now reports the added entities and edges itself.
- **The library's tsup watcher (running for about 2 days) stopped rebuilding `dist`.** The studio
  now compiles the library from `src` through a webpack alias plus tsconfig paths. Library edits
  show up in the studio with no watcher involved. **The docs site still reads `dist`**, so it will
  not have the strict-mode fix until that watcher is restarted.
- **Importing the library's root entry from server code fails to build**, because the entry carries
  React components. `studio-core` now restates the one pure function it needed (socket
  compatibility) instead of importing it.
- **The first request after a cold dev-server start failed with "ArrayBuffer is not detachable".**
  Cause: the embedded database opened inside the page render. Fixed: the database now opens at
  server start (`instrumentation.ts` → `instrumentation-node.ts`). The Node-only import sits inside
  an inline `NEXT_RUNTIME === 'nodejs'` test. An early return instead let the edge compile try to
  bundle Drizzle's migrator, which failed on `node:crypto`.
- **Three visual defects from the screenshots**, all fixed:
  - Inspector labels sat beside their inputs, because `FieldItem` is the inline checkbox row. Fixed
    with plain `Field`.
  - Nodes added from the library piled up 40px apart. Placement now searches a grid for free space.
  - The minimap was large and bright in the bottom-left. It is now 160×112 in the bottom-right.

### Verified after the fixes

- The first request after a cold restart returns 200.
- Undo, step by step: paste 3→4, delete 4→3, undo 3→4, undo 4→3.
- Light and dark screenshots: canvas and chrome both follow the theme, labels sit above inputs,
  and new nodes form a column.
- `tsc` is clean for `studio`, `studio-core` and the library.

### Open

- Wiring by dragging between sockets is not in the smoke test yet.
- The minimap's viewport rectangle runs past the minimap's top edge when the view is larger than
  the content. This is the library's minimap, seen in the screenshots and not changed.
- An ultracode audit of the app is running; its fixes land after this entry.
