# Studio: build log

> Newest first. What was built, what was verified, what went wrong and what is open. The plan is
> [plan.md](./plan.md); the stack reasons are [research.md](./research.md).

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
