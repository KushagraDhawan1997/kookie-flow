# Completed Phases (1–9.5)

> Back to [PLAN.md](./PLAN.md)

All phases below are complete. Summaries are condensed — see git history for full implementation details.

---

## Phase 1: Core Renderer ✅

**Goal:** Render static nodes and edges

- Project structure (monorepo, build, types)
- `<KookieFlow>` component, `<Grid>` shader, `<Nodes>` InstancedMesh, `<Edges>` line segments
- `<DOMLayer>` for labels, Zustand store

## Phase 2: Camera Controls ✅

**Goal:** Pan and zoom

- Pointer event handling: middle-click drag, space+drag, scroll wheel zoom
- Touch: pinch-to-zoom, two-finger pan
- `fitView()` with options (padding, nodes filter, zoom constraints)
- Zoom limits, imperative API via ref

## Phase 3: Selection ✅

**Goal:** Select nodes and edges

- Click to select, Ctrl+click additive, box select, Ctrl+A, Escape deselect
- Visual feedback (border color), selection state in store

## Phase 3.5: Performance Foundations ✅

**Goal:** O(log n) or better for all hot paths

- Quadtree spatial index for hit testing (hover, click, box select)
- Selection as `Set<string>` for O(1)
- Node map for O(1) lookup by ID
- Benchmarks: 10k nodes <1ms hit testing, zero array allocations on selection change

## Phase 4: Node Dragging ✅

**Goal:** Move nodes around

- Single and multi-node drag with relative position maintenance
- Snap to grid, auto-scroll near viewport edges (RAF-based, proportional speed)
- Batch `updateNodePositions()` with incremental quadtree updates
- Ref-based DOM label updates (zero React re-renders during drag)

## Phase 4.5: Edge Curves ✅

**Goal:** Render edges as curves with shader control

- Edge types: `straight`, `bezier`, `step`, `smoothstep`
- Mesh-based (triangle strip ribbon) for full shader control
- `defaultEdgeType` prop and per-edge type override
- 64 segments × 6 verts = 384 verts/edge, single draw call maintained
- Enables future effects: glow, animated flow, gradients, dashes, arrows, pulses

## Phase 5: Edge Connections ✅

**Goal:** Connect nodes via sockets

- `Sockets.tsx`: InstancedMesh with SDF circles, hollow/filled states
- `ConnectionLine.tsx`: WebGL dashed bezier, pre-allocated buffers (zero GC in hot paths)
- Socket hit detection, type colors from `socketTypes` config
- Fixed-size dash pattern (16px cycle) regardless of curve length

## Phase 5.5: Connection Validation & Edge Selection ✅

**Goal:** Validation feedback and edge interactivity

- `connectionMode` prop: `"strict"` | `"loose"`
- `isValidConnection` prop: custom validation function
- Invalid feedback: red line, red socket highlight
- Edge hit testing (point-to-bezier distance), click to select, Ctrl+click additive
- `edgesSelectable` prop, `onEdgeClick` callback, Delete key for edges

## Phase 6: Core Operations & Event Plugins ✅

**Goal:** Optimized core operations + event-handling plugins

**Architecture:** Core handles performance-critical structural operations. Plugins are thin event wrappers. Users call the same optimized core methods.

**Core additions:**
- `cloneElements()` — pre-allocated ID pool, single-pass edge remapping
- `addElements()` — batch state update + batch quadtree insert
- `deleteElements()`, `deleteSelected()`
- `copySelectedToInternal()`, `pasteFromInternal()`, `cutSelectedToInternal()`
- `toObject()`, `getSelectedNodes()`, `getConnectedEdges()`
- `preserveExternalConnections` option for paste

**Plugins (`@kushagradhawan/kookie-flow/plugins`):**

| Plugin                 | What it does                               |
| ---------------------- | ------------------------------------------ |
| `useClipboard`         | Thin wrapper for internal clipboard        |
| `useKeyboardShortcuts` | Configurable key bindings with mod support |
| `useContextMenu`       | Right-click + long-press handling          |

**Not plugins:** `useHistory` (no universal solution), browser clipboard (requires user's serialization logic). Patterns documented instead.

## Phase 7A: Edge Enhancements ✅

**Goal:** Complete edge feature set

- Edge labels: DOM-based in `EdgeLabelsContainer`, positioned via `getEdgePointAtT()`
- Edge markers: triangle geometry in edge draw call, direction from curve tangent
- Socket labels: DOM-based in `SocketLabelsContainer`
- `showSocketLabels`, `showEdgeLabels` props (zero overhead when false)

## Phase 7.5: WebGL Text Rendering (MSDF) ✅

**Goal:** GPU-rendered instanced MSDF for 10k+ node performance

One `InstancedMesh` where each instance = one glyph quad. 80,000 glyphs = 1 draw call = 60fps.

- `TextRenderer.tsx`: instanced mesh with MSDF material
- `msdf-shader.ts`: vertex/fragment shaders with `fwidth()` AA
- `text-layout.ts`: character positioning from BMFont metrics
- Replaced `CrispLabelsContainer`, `SocketLabelsContainer`, `EdgeLabelsContainer`
- LOD: zoom-based thresholds per label type
- `textRenderMode` prop (`"dom"` | `"webgl"`)
- Google Sans MSDF atlas (Regular + SemiBold weights)

## Phase 7B: Minimap ✅

**Goal:** Overview navigation panel

- Canvas 2D for efficient rendering of 10k+ rectangles
- Simplified node rectangles, viewport indicator (draggable)
- Click to pan, drag to move viewport
- `zoomable` prop: minimap zooms with main canvas
- HiDPI support, configurable position/size/colors

## Phase 7C: Grouping & Annotations ✅

**Goal:** Organizational features

- `parentId` + `collapsed` on Entity interface
- `GroupNodeData`, `CommentNodeData`, `RerouteNodeData` types with guards
- `collapsedGroupIds: Set<string>` in store
- Group actions: `getGroupChildren`, `getGroupDescendants`, `toggleGroupCollapse`, etc.
- Grouping utilities: hierarchy traversal, visibility checks, auto-sizing, cycle detection
- `RerouteNodes.tsx`: InstancedMesh for waypoint circles
- `CommentsContainer`: DOM-based sticky notes in DOMLayer

## Phase 7D: Socket Widgets ✅

**Goal:** Input widgets on sockets that auto-hide when connected

**Widget resolution:** socket definition → socketType config → library defaults (3-tier cascade).

**Built-in widgets:** Slider, Number, Select, Checkbox, Text, Color — all Kookie UI size 2.

**Layout:** 40px row height (`--space-7`), 32px widget height (`--space-6`). Vertical stack: Header → Outputs → Inputs.

**Key details:**
- `resolveWidgetConfig()` utility for 3-tier config merge
- `WidgetsLayer.tsx` in DOM layer with viewport culling
- Custom widgets: register globally via `widgetTypes` prop or inline per-socket
- Values in `entity.data.values` (socketId → value), `onWidgetChange` callback
- Zoom behavior: widgets hide below `minWidgetZoom` threshold (default 0.4)

## Phase 7E: Connection Events ✅

**Goal:** Callbacks for connection lifecycle

- `onConnectStart(event, { nodeId, socketId, isInput })` — when drag begins
- `onConnectEnd(event, { isValid, source, position })` — when drag ends
- Enables "add node on edge drop" pattern
- No hot path impact — callbacks only fire on pointer up/down

## Phase 8: Graph Engine ✅

**Goal:** Graph topology understanding

**Adjacency index:** maintained incrementally — 3 Map ops per edge add/remove. Pan/zoom/drag = 0 graph recomputation.

| Operation | Cost |
|---|---|
| `getIncomers`/`getOutgoers` | O(1) |
| `topologicalSort()` | O(V+E), cached against `topologyVersion` |
| `wouldCreateCycle()` | O(k), early termination |
| `getAffectedEntities()` | O(k), uses cached topo sort |

**Features:**
- Graph queries: neighbors, traversal (iterator-based), edge queries
- Structural: `getRoots`, `getLeaves`, `getConnectedComponents` (Union-Find)
- Topo sort + execution levels (Kahn's algorithm, cached)
- Cycle detection + `allowCycles` prop
- Dirty propagation: `getAffectedEntities()`
- Node muting: `muteEntity()`, `unmuteEntity()`
- Graph mutations: `insertOnEdge`, `bypassEntity`, `collapseToSubgraph`, `expandSubgraph`
- Validation: `validate()`, `isGraphComplete()`, `getCompatiblePorts()`
- 71+ tests in `graph.test.ts`

## Phase 9: Entity Model Refactor ✅

**Goal:** Rename nodes→entities, make ports optional, add status rendering

- Renamed `nodes` → `entities`, `onNodesChange` → `onEntitiesChange`, `nodeTypes` → `entityTypes`
- Made `inputs`/`outputs` optional on all entity types
- Added `data.status` and `data.statusMessage` with GPU-rendered visuals
- `frame` as proper built-in type (from `group`)

## Phase 9.5: Selection Box + Resize Handles ✅

**Goal:** Universal selection indicator and resize interaction

**Selection box:**
- `entity-selection.tsx`: instanced mesh for SDF outline-only rounded-rects
- Constant screen-space thickness (zoom-independent)
- Hover indicator on same layer (gray outline hover, accent outline selected)
- Removed per-renderer selection visuals from `nodes.tsx` shader (net savings: 2 attributes + 2 subscriptions)

**Resize handles:**
- 8 handles per selected entity (NW, N, NE, E, SE, S, SW, W), constant screen-space size
- `resizable` property: `boolean | { width?: boolean; height?: boolean }`
- `updateEntityDimensions()` store action (O(1), bumps positionVersion, updates quadtree + socket quadtree)
- `fitEntityToContent()` store action
- Full resize math in InputHandler (8 directions, min-size clamping, snap-to-grid, cursor feedback)
- `interaction-state.ts` side-channel for hiding handles during interactions

**Bugs found and fixed:**
1. DOM/socket/edge desync during resize — `updateEntityDimensions` needed positionVersion bump, `_movedEntityIds` population, socket quadtree update
2. Position jumps on mouse release (top/left handles) — needed both position + dimensions changes emitted
3. Move-then-resize jump — drag end never emitted position changes to `onEntitiesChange`
4. `setEntities` missing positionVersion bump — same-length entity arrays with different positions undetected
5. Edges stuck after resize-then-move — stale `entityMapRef` in edges.tsx, fixed by reading from `store.getState()` in useFrame

**Performance:** No regressions. O(1) entity update + O(k) edge updates via `_movedEntityIds`. EntitySelection rendering is O(selected + hovered), not O(total).

### Styling & Theme Integration ✅

- Size tiers (`'1'`-`'5'`) matching Kookie UI Card
- Visual variants: `surface`, `outline`, `soft`, `classic`, `ghost`
- Border radius: `none`, `small`, `medium`, `large`, `full`
- 26 accent colors from Kookie UI palette
- `useThemeTokens()` hook, fallback tokens for standalone mode
- Shadow SDF for `classic` variant
