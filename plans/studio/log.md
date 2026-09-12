# Studio: build log

> Newest first. What was built, what was verified, what went wrong and what is open. The plan is
> [plan.md](./plan.md); the stack reasons are [research.md](./research.md).

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
