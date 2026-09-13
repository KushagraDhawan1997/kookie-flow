# Changelog

Dates are the day the work landed. Versions before 1.0 make no compatibility promise: the API is
still moving, and a `!` on a heading means something that was there changed shape.

## Unreleased

### Added

- **`accentHeader` is an aura, not a stripe.** The accent used to be a solid 1.5px line along the
  top edge, which read as trim on a glass card. Now the rim glows in the accent, brightest at
  top-centre and fading over the shoulders, and the glass beneath carries a faint reflection of it —
  diffusing wider and dimmer as it travels down, broken by the same grain the controls wear. An
  entity's own `color` draws its aura in its hue. Nothing moves: no geometry, no hit box, one
  shader branch per accented fragment.
- **An edge starts at the socket's rim, not its centre.** It leaves along the socket's own axis —
  an output to the right, an input to the left — for a short straight leader before the curve
  begins, and a connected socket drops the ring of canvas colour that used to separate the two, so
  the wire and the plug are one shape. Before this an edge ran *through* the dot it named: on a
  hollow socket you could see the wire inside the ring's hole, and the punch that hid the crossing
  made the wire look like it stopped a pixel short of its own socket.
- **A socket leans toward the pointer.** Bring the cursor near one with no drag in progress and the
  dot moves toward it, up to five world px, thickening its ring and lighting its own hue as it goes.
  The whole thing is one uniform and a vertex offset, so a pointer crossing the canvas costs no
  buffer traffic and no React work; the socket's hit test does not move with the lean.
- **Sockets are magnetic.** A wire dragged near a socket is drawn to it: the socket wakes at two
  and a half radii (its ring thickens), recognises the wire at one (the hole closes and the dot
  swells), and the wire's tip is held back from the cursor by a spring that tightens as the gap
  closes — so the grab is felt in the drag rather than shown as a highlight. At fusing distance the
  socket and the tip are blended as one distance field, so they bulge together and merge instead of
  overlapping. A release anywhere inside the pull connects, which means a connection no longer has
  to land on a six-pixel dot. A socket that cannot take the wire does the opposite: it keeps its
  hole, drains its colour and pulls nothing, so refusal is felt too (`src/gl/magnet.ts`).
- **A select's list and a colour widget's picker are drawn in WebGL.** Releasing on a select opens
  a list off the trigger's own box — glass over a blurred copy of the frame beneath it, scaling with
  the node, flipping above the trigger when the bottom of the screen is near, scrolling past eight
  rows, driven by arrows, Home/End, PageUp/Down, Enter, Escape and type-ahead from the canvas's own
  keyboard. Pressing a colour widget opens a saturation square, a hue strip and a hex readout in the
  same panel. Neither borrows a DOM element at any point. The platform's `<select>` popup used to
  open wherever the platform chose (the top-left of the window, on a scaled canvas) and could not be
  styled; `<input type="color">` had the same popup.
- **The on-node controls are KookieUI v2's `material="regular"`**, measured against real v2
  controls rendered beside them (`harness/spikes/glass-compare.mjs`). A field is v2's `.kui-field`:
  the fill at the control alpha, the conic ring one pixel inside the edge, a pool that is a whisper
  along the bottom, and grain. It has no wash. A checkbox is flat, as v2's is: a solid fill, a 1px
  edge, and when checked the accent with a light tick. A slider has v2's 5px track and white grip,
  and its readout sits past the track's end instead of on it. The chevron is v2's thin 7px glyph
  at partial ink. The list is a squircle floating-rows surface with 12px of inset, round 30px rows,
  the tick in a leading gutter in the accent, the floating wash and pool, and `--shadow-3`. A
  pressed mark and grip squash, and the chevron turns over while its list is open. A select's list
  opens with the chosen row over the trigger and that row's label on the trigger's own label, is at
  least 112px wide, and is capped by the screen rather than by a row count — v2's own placement.
- **Controls animate the way v2's do.** Colour and movement keep separate clocks: a hover colour
  arrives in 80ms and leaves in 220ms, a press lands at once, and a mark or a grip squashes into a
  press on v2's stiff spring and recovers on its lively one (both fitted to the stylesheet's own
  `linear()` tables, within half a percent). The tick draws on over 380ms and clears at once. Each
  transition is interpolated in the shader from a start time per instance — no React and no buffer
  traffic per frame (`src/gl/motion.ts`).
- **Reduced motion is honoured.** With the system setting on, every control state and the list's
  entrance land immediately, as v2 does with `transition: none`.
- **Keyboard focus is visible on the canvas.** Moving the keyboard onto a node's controls rings the
  GL control: a mark or a trigger takes v2's ring landing from 6px out to 2px, a slider's grip takes
  it on the thumb, and a field rings the moment it has the caret. The colour is `--focus-ring`,
  accent-solid in light and accent-11 in dark.
- **The controls follow v2's other axes.** Hover only fires on a pointer that can hover; a
  checkbox's corner and a slider track's corner follow the radius level (both square at `none`); a
  control prints its value at the size's own type step; a number is centred; high contrast turns a
  lit list row into a solid accent with contrast ink, re-solves the track and the mark's edge.
- **`src/gl/`**: the shapes, the glass material, easing, transitions and the backdrop copy, with no
  import of the store or a component, so the control kit can be lifted into its own package later.

- **Align and distribute.** `alignSelection(edge)` and `distributeSelection(axis)` on the ref, Alt+A,
  D, W, S, H and V to line a selection up and Alt+Shift+H and V to space it evenly, and an `arrange`
  toolbar widget. Moves are reported as a drag is, a frame carries its contents, and the toolbar's
  render props gain `align` and `distribute` for a custom toolbar.
- **Cmd/Ctrl-click takes a node back out of a selection**, and Cmd/Ctrl-dragging a node that is not
  selected adds it and moves the whole selection.
- **Stroke styling.** `strokeColor` and `strokeWidth` toolbar widgets for ink (a width change re-fits
  the stroke's box), and a `penStyle` prop for what the pen draws with.

### Fixed

- **A click on the canvas drew the browser's focus ring around all of it.** The canvas focuses
  itself on every press so its keys work, and focus set by script counts as keyboard focus, so an
  app shell showed a ring around its whole content pane after any click. A press no longer draws
  it. Tab still does, so a keyboard user arriving on the canvas sees where focus went.
- **Media controls show what a press will do.** The cursor was the plain arrow over all of a media
  node's chrome, so the strip that moves a model — as opposed to the body that turns it — could
  only be found by being told about it. It is now a pointer on the corner button and a clip's bar,
  a grab on a model's body that closes while it turns, and a move cursor on the strip along a
  model's top; a preview band answers the same way.
- **The wire a drag draws started at the socket's centre.** Moving a resting edge to the rim left
  the DRAGGED wire untouched — a different mesh with its own geometry code — so a drag still ran a
  line out of the middle of the dot, visible through the hole of the hollow socket it was leaving.
  It now starts on the rim and leaves along the socket's axis for the same six-px leader, with the
  curve's control points taken from the leader's end so the opening segment cannot collapse.
- **A socket being dragged out of keeps no punch ring.** The 1.5px ring of canvas colour that makes
  a passing ribbon read as behind a socket was still drawn on the socket a wire was leaving, which
  cut the new wire off from the dot it was welded to. A drag's source socket now reads as connected
  for as long as the drag lasts: solid dot, no ring.
- **Every socket wore its halo at rest.** "There is no pointer" was carried to the shader as NaN and
  tested with `x == x`, which a GLSL compiler may fold to true — and does. At rest each socket
  measured its proximity against a NaN pointer, came out at full strength, and lit its halo with no
  cursor on the page; a real pointer anywhere on the canvas hid the bug by making the number real.
  Pointer presence is now a separate float uniform, and the pointer itself is never NaN on the GPU.
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
