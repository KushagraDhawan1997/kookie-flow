# Changelog

Dates are the day the work landed. Versions before 1.0 make no compatibility promise: the API is
still moving, and a `!` on a heading means something that was there changed shape.

## Unreleased

### Fixed

- An alignment guide no longer stays on the canvas after the drag that drew it.
- Past about 2,500 entities nodes no longer vanish behind the camera: the depth ladder squeezes
  instead of running off it.
- `font="system"` text sits on its line rather than a line above it.
- Video controls draw where they respond, and a model's move strip draws along its top.
- Models and model previews render upright.
- `collapseToSubgraph()` and `expandSubgraph()` report what they changed, so a controlled consumer
  keeps the result.
- Dropping a file makes an entity without `onFileDrop`, rather than the browser opening the file.
- `toImage()` matches the screen: no washed-out colours, no darkened translucent edges.
- A paste aimed at a rich-text editor inside the canvas is left to the editor.
- A `mod+v` binding from `useKeyboardShortcuts` no longer stops a pasted picture from arriving.
- Deleting a wired node is one undo step, not two.
- Drawing no longer rebuilds the whole graph for every point of a stroke.
- A deleted entity's evaluation outputs are released.
- A type table that turns a manual type reactive runs the entities it was holding.
- `autoLayout()` places what follows a loop behind it, whatever order the entities came in.
- A consumer's own `status: 'success'` no longer looks like a selection.
- Several model previews on screen no longer rebuild their framebuffers every pass or leave one
  black.
- Pausing one copy of a shared video pauses it, and a video that failed to load no longer keeps a
  working one from playing.
- Ink, pictures and text are no longer sent to `onEvaluate`.
- An input change during a manual run marks what that run feeds.
- Ink with no colour of its own follows a theme change.
- `UseGraphOptions`, `UseGraphHistoryOptions` and `UseGraphReturn` are exported.
- At KookieUI v2's default `full` radius the minimap is a rounded panel rather than a pill, and a
  multi-row text area keeps a one-row corner, as v2's own text area does, rather than a stadium.

## 0.1.0 — 2026-09-11

The release where the library stopped having holes in it. Everything below was either missing or
advertised-but-unimplemented before this version.

### The data core

- **`onEvaluate`** — one function from the consumer; the library decides when to call it, with
  what, and what to do with the answer. Marks downstream stale on any input change, runs reactive
  entities as their inputs settle, stops at manual gates, aborts a run whose inputs changed and
  discards its result, and holds a chain at a failed node rather than running on stale output.
- **Status on the node** — the card's own outline IS the progress: it sweeps from top-centre to
  `ctx.progress`, travels as a short arc when nothing is reported, completes and dissolves when
  done, dims the card when stale, and turns the graph's invalid red with a message underneath when
  it fails. The drawn sweep eases toward the reported number, so reporting in tenths still reads
  as one continuous motion, and a travelling arc takes its phase from the run rather than from the
  clock.
- **`evaluate`, `evaluateDirty`, `evaluateAll`, `setSocketValue`, `getSocketValue`,
  `getEvaluationStatus`** on the instance ref.

### Media

- **Video and mesh entities**, drawn as quads in the scene rather than as DOM over it — so a node
  in front of a video covers it, which no DOM overlay can do.
- **Controls, on by default.** A video carries play, pause and a scrub track under the pointer;
  a model turns when you drag it, with a strip along its top that moves it. `controls: false` and
  `orbit: false` opt out.
- **The squircle reaches media.** An image, a video and a model take the same corner profile as a
  node body.
- **Paste and drop.** A screenshot, a picture, a clip, a `.glb` or a URL becomes an entity where
  the view is centred, or where it was dropped. Anything that is not media is left to the page,
  and a paste made while the host app has focus is never taken. `onFileDrop` still wins where the
  app wants to upload first.

### Nodes

- **`entityTypes` fills in what a node leaves unsaid** — sockets, size, label. The node always
  wins, and an empty socket list is a statement rather than a gap. Resolution happens once, where
  entities enter the store, so a socket the node never mentioned is clickable on the first frame.
- **The preview slot.** `entity.preview` names an output socket and the library draws whatever is
  sitting on it: a picture, a video, a model, or a bitmap handed straight over. The value comes
  from the engine, so a run filling it costs no React render.
- **Ink.** `D` picks up a pen; a drag leaves a stroke; one stroke is one entity, selectable and
  undoable like anything else.
- **`header="none"` means no title**, and the title's band is sized to its line rather than to a
  socket row.

### The board

- **Undo and redo** — `useGraph({ history: true })`. A drag is one step however many frames it
  took; a selection is not a step at all. Cmd/Ctrl+Z, bound only while the graph has focus.
- **Alignment guides** while dragging, with the small snap that goes with them, and **auto-pan**
  when a node — or a wire — reaches the edge of the canvas.
- **`autoLayout()`** puts every node in a column behind whatever feeds it. **`toImage()`** returns
  a PNG of what is on screen. **`toObject()`** returns the graph as data, with view state stripped
  and pending widget edits folded in. **`collapseToSubgraph()` / `expandSubgraph()`** fold a set of
  nodes into one and back.
- **Keyboard.** Shift+arrows move the selection, Alt for a ten-step, reported to the consumer
  exactly as a drag is.

### Type and theme

- **`font="system"` draws text** instead of nothing at all: the atlas is built at mount from the
  platform's own font, rasterised and turned into a signed distance field.
- **The bundled face is Inter**, in its own chunk, so a board that supplies its own font never
  downloads it.
- **`--scale` reaches the graph.** The probe that measures v2's `calc(Npx * var(--scale))` lengths
  now lives inside the theme root, where a product's scale is declared.
- **The checkbox mark and the slider track** come from `--mark-N` and `--slider-track-N` rather
  than from numbers in the shader, and a socket label is truncated against the width the consumer
  actually set.

### Notes for consumers

- The CommonJS build inlines the font atlas rather than splitting it into a chunk, because a CJS
  require cannot fetch one. An ESM consumer gets the split; a CJS consumer gets a larger entry.
- `EntityTypeDefinition.component` and the old `preview: { type, source }` shape are gone. Use
  `entity.preview` for a preview band.
- **!** `'google-sans'` is gone from `FontPreset`, and the default `font` is `'inter'`. TypeScript
  rejects the old name; plain JS gets a warning and Inter.
- **!** `header` defaults to `'inside'`, and `'none'` now means no title at all.
- **!** `EntityTypeDefinition` is no longer generic. Drop the type argument.
- **!** Node corners and padding read KookieUI v2's surface tokens. Unset, `radius` follows the
  size tier, which is the `'small'` surface radius at size `'2'`.

## 0.0.1-alpha.0 — 2026-09-10

The first published shape: a WebGL canvas, instanced nodes and edges, GL widgets, the theme
bridge onto KookieUI v2, and the harness that pins all of it.
