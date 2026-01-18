# Kookie Flow — Implementation Plan

> WebGL-native node graph library. React Flow's ergonomics, GPU-rendered for performance at scale.

This document is the source of truth for building Kookie Flow. It is written for LLM consumption—structured, explicit, and unambiguous.

---

## ⚠️ PERFORMANCE IS EVERYTHING ⚠️

**This is the #1 priority. Nothing else matters if performance suffers.**

Before writing ANY code, ask yourself:
1. Does this trigger React re-renders during pan/zoom/drag? **UNACCEPTABLE.**
2. Does this allocate memory in hot paths (event handlers, render loops)? **UNACCEPTABLE.**
3. Is this O(n) when it could be O(log n) or O(1)? **UNACCEPTABLE.**

### Rules (never violate these):

| Rule | Why |
|------|-----|
| **Zero React re-renders during interactions** | Use refs for all position/transform updates. React state only for element creation/removal. |
| **RAF-throttled DOM updates** | Never update DOM synchronously in event handlers. Schedule via `requestAnimationFrame`. |
| **Pre-allocated buffers** | GPU buffers sized once at init. No allocations during render. |
| **Dirty flags over subscriptions** | Don't re-render on every state change. Track what changed, update only that. |
| **Spatial indexing for hit testing** | Quadtree for O(log n). Never iterate all nodes in event handlers. |
| **Ref-based position updates** | `element.style.transform` via refs, not React props. |

### Performance Architecture Pattern

```typescript
// ✅ CORRECT: Ref-based updates, RAF throttling
const labelsRef = useRef<Map<string, HTMLDivElement>>(new Map());
const rafIdRef = useRef<number>(0);

const updatePositions = useCallback(() => {
  rafIdRef.current = 0;
  const { nodes } = store.getState();
  labelsRef.current.forEach((el, id) => {
    const node = nodes.find(n => n.id === id);
    if (node) el.style.transform = `translate3d(${node.x}px, ${node.y}px, 0)`;
  });
}, [store]);

// Subscribe triggers RAF, not direct update
store.subscribe(() => {
  if (rafIdRef.current === 0) {
    rafIdRef.current = requestAnimationFrame(updatePositions);
  }
});

// React state ONLY for element count changes
if (state.nodes.length !== nodes.length) setNodes(state.nodes);
```

```typescript
// ❌ WRONG: React props for positions = re-renders every frame
{nodes.map(node => (
  <Label key={node.id} x={node.position.x} y={node.position.y} />  // NEVER DO THIS
))}
```

**If you're unsure whether something impacts performance, it probably does. Ask first.**

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Architecture Overview](#architecture-overview)
3. [Rendering Strategy](#rendering-strategy)
4. [Component Breakdown](#component-breakdown)
5. [API Design](#api-design)
6. [Implementation Phases](#implementation-phases)
7. [Technical Decisions](#technical-decisions)
8. [File Structure](#file-structure)
9. [Current Status](#current-status)

---

## Problem Statement

### Why React Flow Is Slow

React Flow renders each node as 20+ DOM elements:
- Container div
- Header div
- Body div
- Handle elements (2+ per node)
- Custom content wrapper
- Various style containers

Each edge is an SVG `<path>` element with bezier recalculation on every frame.

**On pan/zoom:**
1. React reconciles all visible node components
2. CSS transforms update for every node
3. SVG paths recalculate for every edge
4. Browser compositor manages hundreds of layers

**Result:** ~500-1000 nodes max at 60fps with optimizations. With blur/shadows: ~50-100 nodes.

### The Kookie Flow Solution

Render geometry in WebGL. Keep text/widgets in DOM.

**On pan/zoom:**
1. Update one uniform (camera matrix)
2. GPU renders all nodes in 1-2 draw calls
3. Single DOM container transforms for text layer

**Result:** 10,000-50,000 nodes at 60fps. With blur/shadows: 10,000+ nodes.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    <KookieFlow>                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ DOM Layer (pointer-events: none except on widgets)    │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │ Transform Container (synced with camera)        │  │  │
│  │  │                                                 │  │  │
│  │  │   [Node Labels]  - position: absolute           │  │  │
│  │  │   [Socket Labels] - position: absolute          │  │  │
│  │  │   [Widgets]      - pointer-events: auto         │  │  │
│  │  │   [Custom Content Portals]                      │  │  │
│  │  │                                                 │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ WebGL Canvas (R3F)                                    │  │
│  │                                                       │  │
│  │   <OrthographicCamera>     - 2D projection            │  │
│  │   <Grid>                   - Infinite shader grid     │  │
│  │   <Edges>                  - Batched line geometry    │  │
│  │   <Nodes>                  - InstancedMesh            │  │
│  │   <Sockets>                - InstancedMesh            │  │
│  │   <SelectionBox>           - Shader quad              │  │
│  │   <ConnectionLine>         - Temp edge while dragging │  │
│  │   <Previews>               - Image/mesh textures      │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                    Zustand Store                            │
│  - nodes[], edges[], viewport, selection, connectionState   │
└─────────────────────────────────────────────────────────────┘
```

### Coordinate System

- **World space:** Y-down (matches DOM), origin at top-left
- **Screen space:** Pixels from viewport top-left
- **Camera:** Orthographic, looking at Z=0 plane
- **Transform:** `screenPos = (worldPos + viewport.offset) * viewport.zoom`

---

## Rendering Strategy

### What Renders in WebGL

| Element | Technique | Draw Calls |
|---------|-----------|------------|
| Node backgrounds | InstancedMesh + SDF shader | 1 |
| Node headers | InstancedMesh (same as above) | 0 (merged) |
| Sockets | InstancedMesh (circles) | 1 |
| Edges | BufferGeometry line segments | 1 |
| Grid | Full-screen quad + shader | 1 |
| Selection box | Quad with dashed shader | 1 |
| Image previews | Texture atlas + instanced quads | 1 |
| 3D mesh previews | Standard Three.js meshes | N (one per visible preview) |

**Total for 10,000 nodes:** ~5-10 draw calls

### What Renders in DOM

| Element | Why DOM |
|---------|---------|
| Node title text | Font flexibility, accessibility, selection |
| Socket labels | Same |
| Input widgets | Native form elements, focus management |
| Custom node content | User flexibility (escape hatch) |

### Level of Detail (LOD)

Text rendering follows zoom-based LOD:

```typescript
const MIN_TEXT_ZOOM = 0.3;  // Below this, hide all text
const MIN_LABEL_SIZE = 8;   // Minimum screen-space font size

// In DOMLayer:
if (viewport.zoom < MIN_TEXT_ZOOM) {
  return null; // Don't render text layer at all
}

// Per-node:
const screenSize = node.height * viewport.zoom;
if (screenSize < MIN_LABEL_SIZE * 2) {
  return null; // Node too small for readable text
}
```

---

## Component Breakdown

### Core Components

#### `<KookieFlow>` — Main container
```typescript
interface KookieFlowProps {
  nodes: Node[];
  edges: Edge[];
  nodeTypes?: Record<string, NodeTypeDefinition>;
  socketTypes?: Record<string, SocketType>;
  onNodesChange?: (changes: NodeChange[]) => void;
  onEdgesChange?: (changes: EdgeChange[]) => void;
  onConnect?: (connection: Connection) => void;
  onNodeClick?: (node: Node) => void;
  onEdgeClick?: (edge: Edge) => void;
  onPaneClick?: () => void;
  defaultViewport?: Viewport;
  minZoom?: number;
  maxZoom?: number;
  showGrid?: boolean;
  showMinimap?: boolean;
  snapToGrid?: boolean;
  snapGrid?: [number, number];
  selectionMode?: 'single' | 'multi';
  connectionMode?: 'strict' | 'loose';
  children?: ReactNode;
}
```

#### `<Nodes>` — Instanced node renderer
- Uses `THREE.InstancedMesh` with custom shader
- Per-instance attributes: position, size, color, selected, headerHeight
- SDF-based rounded rectangles with border
- Updates instance matrices only when nodes change

#### `<Sockets>` — Instanced socket renderer
- Circles at input/output positions
- Per-instance attributes: position, color, hovered, connected
- Hit testing via raycaster or color picking

#### `<Edges>` — Batched edge renderer
- Line segments or bezier curves
- Color-coded by socket type
- Selected state with glow/thickness change
- Animated flow (optional, via shader)

#### `<Grid>` — Infinite grid shader
- Single full-screen quad
- Fragment shader draws grid lines
- Scales with zoom level
- Accent lines every N units

#### `<DOMLayer>` — Text and widget overlay
- Absolutely positioned over canvas
- Single transform container synced with camera
- Renders only visible nodes' text/widgets
- Pooling for performance (optional)

#### `<SelectionBox>` — Box selection overlay
- Rendered during drag-select
- Dashed border shader
- Calculates intersecting nodes on release

#### `<ConnectionLine>` — Temporary edge while connecting
- Follows mouse from source socket
- Snaps to valid target sockets
- Color indicates validity

#### `<Minimap>` — Overview panel
- Renders to separate small canvas or viewport region
- Simplified node representation (just rectangles)
- Viewport indicator rectangle
- Click to pan, drag to move viewport

### State Management

Using Zustand with `subscribeWithSelector` for fine-grained updates:

```typescript
interface FlowState {
  // Data
  nodes: Node[];
  edges: Edge[];

  // Viewport
  viewport: Viewport;

  // Interaction state
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  hoveredNodeId: string | null;
  hoveredSocketId: string | null;

  // Connection state
  connectionSource: { nodeId: string; socketId: string } | null;

  // Drag state
  dragState:
    | { type: 'none' }
    | { type: 'pan'; startViewport: Viewport }
    | { type: 'node'; nodeIds: string[]; startPositions: Map<string, XYPosition> }
    | { type: 'select'; startPoint: XYPosition };

  // Actions
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  updateNodePosition: (id: string, position: XYPosition) => void;
  // ... more actions
}
```

---

## API Design

### Defining Node Types

```typescript
import { defineNode, Input, Output } from '@kushagradhawan/kookie-flow';

// Simple node definition
const AddNode = defineNode({
  type: 'math/add',
  label: 'Add',
  inputs: [
    Input.float('a', { default: 0 }),
    Input.float('b', { default: 0 }),
  ],
  outputs: [
    Output.float('result'),
  ],
});

// Node with preview
const ImageLoadNode = defineNode({
  type: 'image/load',
  label: 'Load Image',
  inputs: [
    Input.string('path', { widget: 'file-picker' }),
  ],
  outputs: [
    Output.image('image'),
  ],
  preview: {
    type: 'image',
    source: 'image', // Output to preview
  },
});

// Node with custom widget
const TextPromptNode = defineNode({
  type: 'text/prompt',
  label: 'Text Prompt',
  inputs: [
    Input.string('prompt', {
      widget: 'custom',
      defaultHeight: 100,
    }),
  ],
  outputs: [
    Output.string('text'),
  ],
  // Custom React component for the input widget
  Widget: ({ value, onChange }) => (
    <textarea
      value={value.prompt}
      onChange={e => onChange({ prompt: e.target.value })}
    />
  ),
});

// Full custom node (DOM escape hatch)
const CustomNode = defineNode({
  type: 'custom/wild',
  render: 'dom', // Entire node is DOM
  Component: ({ node, inputs, outputs }) => (
    <div className="my-custom-node">
      <inputs.Handle id="in" />
      <MyComplexComponent />
      <outputs.Handle id="out" />
    </div>
  ),
});
```

### Socket Type System

```typescript
// Define socket types with colors and validation
const socketTypes = {
  float: {
    color: '#6bcfff',
    validate: (value: unknown) => typeof value === 'number',
  },
  int: {
    color: '#6bcfff',
    validate: (value: unknown) => Number.isInteger(value),
  },
  image: {
    color: '#c7a0dc',
    // Images can connect to masks (implicit conversion)
    compatibleWith: ['mask'],
  },
  mask: {
    color: '#ffffff',
  },
  any: {
    color: '#808080',
    // Can connect to anything
    compatibleWith: '*',
  },
};

<KookieFlow socketTypes={socketTypes} />
```

### Using the Graph

```typescript
import { KookieFlow, useGraph } from '@kushagradhawan/kookie-flow';

function App() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    removeNode,
    getNode,
  } = useGraph({
    initialNodes: [...],
    initialEdges: [...],
  });

  const handleAddNode = () => {
    addNode({
      id: crypto.randomUUID(),
      type: 'math/add',
      position: { x: 100, y: 100 },
      data: {},
    });
  };

  return (
    <KookieFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
    >
      {/* Overlay UI */}
      <Panel position="top-left">
        <button onClick={handleAddNode}>Add Node</button>
      </Panel>
    </KookieFlow>
  );
}
```

### Imperative API (Ref)

```typescript
const flowRef = useRef<KookieFlowInstance>(null);

// Imperative methods
flowRef.current.fitView({ padding: 50 });
flowRef.current.setCenter(0, 0, { zoom: 1 });
flowRef.current.zoomIn();
flowRef.current.zoomOut();
flowRef.current.getViewport();
flowRef.current.setViewport({ x: 0, y: 0, zoom: 1 });
flowRef.current.getNodes();
flowRef.current.getEdges();
flowRef.current.getSelectedNodes();
flowRef.current.deleteElements({ nodes: ['1'], edges: ['e1'] });

<KookieFlow ref={flowRef} ... />
```

---

## Implementation Phases

### Phase 1: Core Renderer ✅ SCAFFOLDED
**Goal:** Render static nodes and edges

- [x] Project structure (monorepo, build, types)
- [x] Basic `<KookieFlow>` component
- [x] `<Grid>` with shader
- [x] `<Nodes>` with InstancedMesh (needs testing)
- [x] `<Edges>` with line segments (needs testing)
- [x] `<DOMLayer>` for labels
- [x] Zustand store
- [ ] **TODO:** Test and fix shaders
- [ ] **TODO:** Verify instancing works correctly

### Phase 2: Camera Controls
**Goal:** Pan and zoom

- [ ] Pointer event handling on canvas
- [ ] Pan: middle-click drag or space+drag
- [ ] Zoom: scroll wheel with center point
- [ ] Touch support: pinch-to-zoom, two-finger pan
- [ ] `fitView()` implementation
- [ ] Zoom limits (min/max)
- [ ] Smooth animated transitions (optional)

### Phase 3: Selection ✅ COMPLETE
**Goal:** Select nodes and edges

- [x] Click to select single node
- [x] Ctrl+click to add to selection
- [x] Box select (drag on empty space)
- [x] Select all (Ctrl+A)
- [x] Deselect (Escape or click empty)
- [ ] Edge selection (deferred to Phase 5)
- [x] Visual feedback (border color change)
- [x] Selection state in store

### Phase 3.5: Performance Foundations ✅ COMPLETE
**Goal:** Ensure O(log n) or better for all hot paths before adding more features

**Critical (blocks scale):**
- [x] Quadtree spatial index for hit testing (hover, click, box select)
- [x] Selection as `Set<string>` - avoid creating new node arrays on select
- [x] Node map for O(1) lookup by ID
- [ ] Numeric ID interning for O(1) comparisons in render loops (deferred)

**Important (improves responsiveness):**
- [ ] Partial GPU buffer updates (only changed indices) (deferred)
- [ ] Separate dirty flags for hover vs selection vs position changes (deferred)

**Benchmarks to hit:**
- 10,000 nodes: <1ms hit testing ✓
- 10,000 nodes: <16ms full render cycle
- Selection change: zero array allocations ✓

### Phase 4: Node Dragging ✅ COMPLETE
**Goal:** Move nodes around

- [x] Drag selected nodes
- [x] Multi-node drag (maintain relative positions)
- [x] Snap to grid (optional)
- [x] Auto-scroll when dragging near viewport edges
- [ ] Drag boundaries (optional, deferred)
- [ ] Undo/redo support (optional, phase 6)

**Implementation notes:**
- `updateNodePositions()` in store for efficient batch updates during drag
- Quadtree updated incrementally (not full rebuild) on position change
- DOM labels use ref-based position updates (zero React re-renders during drag)
- Both `CrispLabelsContainer` and `ScaledContainer` follow identical performant architecture
- Auto-scroll: RAF-based loop triggers when pointer within 50px of viewport edge
- Auto-scroll speed proportional to edge proximity (faster = closer to edge)
- Container rect cached at drag start to avoid layout queries in RAF loop
- Object reuse for lastScreenPos to avoid allocations in pointer move handler

### Phase 4.5: Edge Curves ✅ COMPLETE
**Goal:** Render edges as curves with full shader control for effects

**Edge Types:**
- `straight` - direct line (fastest)
- `bezier` - smooth S-curve (React Flow default)
- `step` - orthogonal right-angle path
- `smoothstep` - bezier with constrained curvature

**Implementation (mesh-based for effects):**
- [x] Triangle strip (ribbon) geometry following bezier path
- [x] Custom `ShaderMaterial` for full effect control
- [x] Configurable line width via uniform
- [x] Anti-aliasing via SDF in fragment shader
- [x] Pre-allocated buffers with dirty flags
- [x] Single draw call (all edges batched into one mesh)
- [x] `EdgeType` added to types
- [x] `defaultEdgeType` prop on `<KookieFlow>`
- [x] Per-edge `type` override support

**Why mesh-based over LineSegments:**
- `GL_LINES` = 1px, no AA, no custom shaders
- Mesh ribbons = any width, AA, full shader control
- Enables: glow, animated flow, gradients, dashes, arrows, pulses

**Performance notes:**
- 64 segments × 6 vertices per segment = 384 vertices per edge
- 10,000 edges = 3.84M vertices (~46MB) - still fine for GPU
- Single draw call maintained
- Dirty flag skips recalculation when edges unchanged
- Adaptive bezier control points for natural curves (no forced S-curves)

**Future effects (enabled by this architecture):**
- Animated flow: UV scrolling in fragment shader
- Glow: SDF distance + blur
- Gradients: vertex colors or UV-based
- Dashed lines: `fract()` on UV
- Arrows: SDF or texture at endpoints
- Pulse/highlight: uniform animation

### Phase 5: Edge Connections ✅ COMPLETE
**Goal:** Connect nodes via sockets

- [x] Render sockets (instanced circles)
- [x] Socket hit detection
- [x] Connection line while dragging (dashed bezier with fixed-size dashes)
- [x] Socket fill state (hollow = no connection, filled = connected)
- [x] Edges connect to actual socket positions (not node centers)
- [x] Socket type colors (uses socketTypes config)

**Implementation notes:**
- `Sockets.tsx`: InstancedMesh with SDF circles, hollow/filled state via uniform
- `ConnectionLine.tsx`: WebGL dashed bezier, pre-allocated Float32Array buffers
- `connections.ts`: Socket compatibility utilities
- `geometry.ts`: Socket hit detection, position calculations
- Fixed-size dash pattern (16px cycle) regardless of curve length
- Zero allocations in useFrame (single-pass geometry + length calculation)

### Phase 5.5: Connection Validation & Edge Selection ✅ COMPLETE
**Goal:** Complete connection UX with validation feedback and edge interactivity

**Connection Validation:**
- [x] `connectionMode` prop: `"strict"` | `"loose"` (default: `"loose"`)
- [x] `isValidConnection` prop: custom validation function (overrides mode)
- [x] Connection line color inherits source socket type color
- [x] Invalid connection feedback: line turns red, target socket shows red highlight
- [x] Enforce socket type compatibility when `connectionMode="strict"`

**Edge Selection & Interaction:**
- [x] Edge hit testing (point-to-bezier distance check)
- [x] Click to select edge (single selection pool with nodes)
- [x] Ctrl+click to add edge to selection
- [x] Selected edge visual: selection highlight color (indigo)
- [x] `edgesSelectable` prop (default: `true`)
- [x] `onEdgeClick` callback
- [x] Delete selected edges (Delete key, shared with nodes)

**Implementation notes:**
- `validateConnection()` in `connections.ts`: mode-based validation with custom override
- `areTypesCompatible()`: socket type compatibility checking with explicit compatibleWith support
- `getEdgeAtPosition()` in `geometry.ts`: bezier/step/straight distance calculation with viewport-scaled tolerance
- Edge colors from source socket type, selection uses indigo highlight
- `ConnectionLine.tsx`: cached socket lookup for O(1) in hot path

**API:**
```typescript
<KookieFlow
  // Connection validation
  connectionMode="strict"  // "strict" | "loose"
  isValidConnection={(connection, socketTypes) => boolean}  // custom override

  // Edge interaction
  edgesSelectable={true}
  onEdgeClick={(edge: Edge, event: MouseEvent) => void}
/>
```

**Deferred:**
- [x] Auto-scroll when dragging near viewport edges

### Phase 6: Core Operations & Event Plugins
**Goal:** Optimized core operations for clipboard/history patterns + event-handling plugins

**Architecture Principle:** Core handles all performance-critical operations (cloning, batch updates, ID generation). Plugins are thin wrappers for event handling. Users who need custom behavior call the same optimized core methods.

**Why this design:**
- `node.data` is user-defined and can contain anything (functions, images, backend refs)
- Serialization, history snapshots, and data transformation are inherently app-specific
- We can optimize the *structural* operations (cloning, ID remapping, batch insert)
- We cannot optimize the *data* operations (what to copy, how to serialize)
- Internal clipboard (same tab) works without serialization - just hold references

**Core additions (in store):**

```typescript
// Optimized cloning - pre-allocated ID pool, single-pass, edge refs remapped
store.cloneElements(nodes, edges, {
  offset?: { x: number, y: number },
  transformData?: (data: T) => T,     // optional: user transforms their data
  generateId?: () => string,           // optional: custom ID generation
}): { nodes: Node[], edges: Edge[], idMap: Map<string, string> }

// Batch insert - single state update, single quadtree update
store.addElements({ nodes, edges }): void

// Batch delete with callback
store.deleteElements({ nodeIds, edgeIds }): void
store.deleteSelected(): void

// Internal clipboard (no serialization, holds references)
store.copySelectedToInternal(): void
store.pasteFromInternal(options?: {
  offset?: { x, y },
  transformData?: (data: T) => T,
}): void
store.cutSelectedToInternal(): void

// Serialization (for user's custom browser clipboard / persistence)
store.toObject(): { nodes, edges, viewport }
store.getSelectedNodes(): Node[]
store.getConnectedEdges(nodeIds: string[]): Edge[]
```

**Plugins (`@kushagradhawan/kookie-flow/plugins`):**

| Plugin | What it does | Exposes |
|--------|--------------|---------|
| `useClipboard` | Thin wrapper for internal clipboard | `copy()`, `paste()`, `cut()` |
| `useKeyboardShortcuts` | Event listeners, modifier detection (`mod` = Cmd/Ctrl), focus management | Config object for key bindings |
| `useContextMenu` | Right-click + long-press listening, hit testing | `{ contextMenu, closeMenu }` |

**NOT included as plugins:**
| Feature | Why not |
|---------|---------|
| `useHistory` | No universal solution - full snapshots don't scale, action-based requires knowing user's data shape. Document patterns instead. |
| Browser clipboard | Requires serialization of user's data. Provide `toObject()` + document patterns. |

**Example usage:**

```typescript
import { KookieFlow, useFlowStore } from '@kushagradhawan/kookie-flow';
import { useClipboard, useKeyboardShortcuts, useContextMenu } from '@kushagradhawan/kookie-flow/plugins';

function Editor() {
  const store = useFlowStore();
  const { copy, paste, cut } = useClipboard();
  const { contextMenu, closeMenu } = useContextMenu();

  useKeyboardShortcuts({
    'mod+c': copy,
    'mod+v': paste,
    'mod+x': cut,
    'mod+a': () => store.selectAll(),
    'delete': () => store.deleteSelected(),
    'escape': () => store.clearSelection(),
  });

  return (
    <>
      <KookieFlow nodes={nodes} edges={edges} ... />

      {contextMenu && (
        <MyContextMenu target={contextMenu.target} position={contextMenu.position} onClose={closeMenu} />
      )}
    </>
  );
}
```

**Custom paste with data transformation:**

```typescript
const paste = () => {
  store.pasteFromInternal({
    offset: { x: 100, y: 100 },
    transformData: (data) => ({
      ...data,
      status: 'idle',      // reset transient state
      backendId: null,     // clear backend reference
    }),
  });
};
```

**Custom browser clipboard (user implements):**

```typescript
const copyToBrowser = async () => {
  const nodes = store.getSelectedNodes();
  const edges = store.getConnectedEdges(nodes.map(n => n.id));

  // User decides what to serialize
  const payload = {
    nodes: nodes.map(n => ({
      ...n,
      data: { prompt: n.data.prompt },  // only serializable fields
    })),
    edges,
  };

  await navigator.clipboard.writeText(JSON.stringify(payload));
};

const pasteFromBrowser = async () => {
  const text = await navigator.clipboard.readText();
  const { nodes, edges } = JSON.parse(text);

  // Use optimized core method for cloning
  const cloned = store.cloneElements(nodes, edges, {
    offset: { x: 50, y: 50 },
  });

  store.addElements(cloned);
};
```

**Custom undo/redo (user implements):**

```typescript
function useSimpleHistory(maxSize = 50) {
  const store = useFlowStore();
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);

  const push = () => {
    past.current.push(store.toObject());
    if (past.current.length > maxSize) past.current.shift();
    future.current = [];
  };

  const undo = () => {
    if (past.current.length === 0) return;
    future.current.push(store.toObject());
    const snapshot = past.current.pop()!;
    store.setNodes(snapshot.nodes);
    store.setEdges(snapshot.edges);
  };

  const redo = () => { /* inverse of undo */ };

  return { push, undo, redo, canUndo: past.current.length > 0 };
}
```

**Tasks:**
- [ ] Core: `cloneElements()` with pre-allocated ID pool, single-pass edge remapping
- [ ] Core: `addElements()` with batch state update + batch quadtree insert
- [ ] Core: `deleteElements()`, `deleteSelected()`
- [ ] Core: `copySelectedToInternal()`, `pasteFromInternal()`, `cutSelectedToInternal()`
- [ ] Core: `toObject()`, `getSelectedNodes()`, `getConnectedEdges()`
- [ ] Plugin: `useClipboard` (thin wrapper)
- [ ] Plugin: `useKeyboardShortcuts`
- [ ] Plugin: `useContextMenu` (right-click + long-press)
- [ ] Docs: Pattern for browser clipboard
- [ ] Docs: Pattern for simple undo/redo
- [ ] Docs: Pattern for efficient undo/redo (structural sharing)

### Phase 7: Advanced Features
**Goal:** Feature parity with React Flow

- [ ] Minimap
- [ ] Edge labels
- [ ] Edge markers (arrows)
- [ ] Node grouping/frames
- [ ] Collapsed groups
- [ ] Comments/sticky notes
- [ ] Reroute nodes

### Phase 8: Visual Previews
**Goal:** The differentiator

- [ ] Image texture previews in nodes
- [ ] Texture atlas for multiple images
- [ ] 3D mesh previews (same WebGL context)
- [ ] Video/animation previews
- [ ] Preview caching

### Phase 9: Polish & Production
**Goal:** Production ready

- [ ] GPU-based hit testing (color picking) - alternative to quadtree if needed
- [ ] Virtual DOM pooling for labels (if DOM becomes bottleneck)
- [ ] Memory management (dispose textures)
- [ ] Performance profiling & benchmarks
- [ ] Accessibility (keyboard navigation, ARIA)
- [ ] Documentation site
- [ ] Examples gallery

> **Note:** Core performance work (quadtree, selection optimization) moved to Phase 3.5

---

## Technical Decisions

### Why R3F over raw WebGL or Pixi.js

| Option | Pros | Cons |
|--------|------|------|
| **Raw WebGL** | Full control, smaller bundle | Massive effort, reinvent everything |
| **Pixi.js** | Great 2D perf, batching | No 3D, would need second renderer for mesh previews |
| **Three.js/R3F** | Mature, great tooling, 3D support, React integration | Slight overhead, 3D concepts leak into 2D |

**Decision:** R3F. The 3D mesh preview feature is a key differentiator. Same WebGL context means no separate canvas per preview. The overhead is minimal and the ecosystem is excellent.

### Why Zustand over Context/Redux

- Fine-grained subscriptions with `subscribeWithSelector`
- No provider nesting required
- Works outside React (imperative API)
- Tiny bundle size (~1KB)
- React Flow uses it, familiar to target users

### Why DOM for Text

WebGL text options:
1. **troika-three-text:** SDF, good quality, but struggles at 500+ instances
2. **Canvas-to-texture:** Blurry on zoom, expensive updates
3. **Custom instanced SDF:** Best performance, massive engineering effort

**Decision:** DOM for text. With LOD (hide text when zoomed out), we only render ~50-100 text elements max. DOM text is crisp, accessible, supports any font, and works with browser devtools.

### Coordinate System

**Y-down** (matching DOM/Canvas2D conventions):
- Node position (0,0) is top-left of node
- Positive Y goes down
- Matches user mental model from DOM
- Camera offset negates position for Three.js (Y-up)

### Why "Optimized Core + Thin Plugins"

**The problem with generic plugins:**
- `node.data` is user-defined - can contain functions, images, backend refs, anything
- Serialization is app-specific - we can't know what fields matter
- History/undo is app-specific - full snapshots don't scale, action-based needs data knowledge
- No single implementation works for simple apps AND complex apps AND high-scale apps

**Our approach:**

| Layer | What it handles | Example |
|-------|-----------------|---------|
| **Core (store)** | Structural operations - cloning, ID remapping, batch insert, quadtree | `store.cloneElements()`, `store.addElements()` |
| **Plugins** | Event wiring - thin wrappers that call core methods | `useClipboard()` calls `store.copySelectedToInternal()` |
| **User code** | Data transformation - what to copy, how to serialize, backend sync | `transformData: (d) => ({ prompt: d.prompt })` |

**Key principles:**
1. **Optimize what we can** - Structural operations (ID generation, edge remapping, batch updates) are universal. We optimize these in core.
2. **Don't pretend on what we can't** - Data transformation is app-specific. User provides callbacks, we call them efficiently.
3. **Internal clipboard is free** - Same-tab copy/paste needs no serialization. We just hold references and clone on paste.
4. **Same primitives for everyone** - Custom users call the same optimized methods our plugins use.

**Why no `useHistory` plugin:**
- Full state snapshots: 10k nodes × 50 undo steps = 500MB memory
- Action-based undo: requires knowing all possible data mutations
- Structural sharing: complex, app-specific (what counts as "changed"?)
- Better to document patterns and let users implement what fits their scale/needs

---

## File Structure

```
packages/kookie-flow/
├── src/
│   ├── index.ts                    # Public exports (core only)
│   │
│   ├── components/
│   │   ├── KookieFlow.tsx          # Main component
│   │   ├── context.tsx             # FlowProvider, hooks
│   │   ├── Grid.tsx                # Infinite grid shader
│   │   ├── Nodes.tsx               # Instanced node renderer
│   │   ├── Sockets.tsx             # Instanced socket renderer
│   │   ├── Edges.tsx               # Edge line renderer
│   │   ├── SelectionBox.tsx        # Box select overlay
│   │   ├── ConnectionLine.tsx      # Temp dashed edge while connecting
│   │   ├── DOMLayer.tsx            # Text/widget overlay
│   │   ├── Minimap.tsx             # Overview panel [TODO]
│   │   └── index.ts
│   │
│   ├── core/
│   │   ├── store.ts                # Zustand store
│   │   ├── constants.ts            # Colors, defaults
│   │   ├── spatial.ts              # Quadtree for hit testing
│   │   ├── serialization.ts        # Node/edge serialization utilities
│   │   └── index.ts
│   │
│   ├── hooks/
│   │   ├── useGraph.ts             # External state management
│   │   ├── useViewport.ts          # Viewport controls [TODO]
│   │   ├── useSelection.ts         # Selection management [TODO]
│   │   └── index.ts
│   │
│   ├── plugins/
│   │   ├── index.ts                # All plugins export
│   │   ├── useContextMenu.ts       # Right-click / long-press menu state
│   │   ├── useClipboard.ts         # Thin wrapper for internal clipboard
│   │   └── useKeyboardShortcuts.ts # Configurable key bindings
│   │
│   ├── types/
│   │   └── index.ts                # All TypeScript types
│   │
│   └── utils/
│       ├── geometry.ts             # Position/bounds math, socket hit detection
│       ├── connections.ts          # Connection validation, socket compatibility
│       └── index.ts
│
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

### Package Exports

```json
// package.json exports field
{
  "exports": {
    ".": "./dist/index.js",
    "./plugins": "./dist/plugins/index.js",
    "./plugins/*": "./dist/plugins/*.js"
  }
}
```

Users can import:
```typescript
// Core - includes optimized store methods
import { KookieFlow, useFlowStore } from '@kushagradhawan/kookie-flow';

// All plugins
import { useClipboard, useKeyboardShortcuts, useContextMenu } from '@kushagradhawan/kookie-flow/plugins';

// Individual plugin (smallest bundle)
import { useClipboard } from '@kushagradhawan/kookie-flow/plugins/useClipboard';
```

---

## Current Status

### Completed
- [x] Monorepo structure (pnpm + Turborepo)
- [x] Package configuration (tsup, TypeScript, exports)
- [x] Type definitions (Node, Edge, Socket, etc.)
- [x] Zustand store with basic actions
- [x] `<KookieFlow>` main component shell
- [x] `<Grid>` shader (SDF grid lines)
- [x] `<Nodes>` instanced mesh (SDF rounded rectangles)
- [x] `<Edges>` line segment renderer
- [x] `<DOMLayer>` text positioning with LOD
- [x] `useGraph` hook for external state
- [x] Demo app structure (apps/docs)
- [x] README with usage examples
- [x] Camera pan/zoom controls (wheel zoom, middle-click pan, space+drag)
- [x] Touch gesture support (pinch-to-zoom, two-finger pan)
- [x] Safari performance optimizations
- [x] Viewport frustum culling for nodes/edges
- [x] Pre-allocated GPU buffers with dirty flags
- [x] DOM layer synchronization with viewport
- [x] Click-to-select nodes with Ctrl+click for additive selection
- [x] Box selection (drag on empty space)
- [x] Keyboard shortcuts (Ctrl+A select all, Escape deselect)
- [x] `<SelectionBox>` component with animated dashed border
- [x] Hit testing utilities (screenToWorld, getNodeAtPosition, getNodesInBox)
- [x] Quadtree spatial index for O(log n) hit testing
- [x] Selection using `Set<string>` for O(1) operations
- [x] Node map for O(1) lookup by ID
- [x] Fixed edge buffer capacity bug (attributes not attached on resize)
- [x] Node dragging (single and multi-node)
- [x] Snap-to-grid support
- [x] Efficient batch position updates with incremental quadtree updates
- [x] Ref-based DOM label updates (zero React re-renders during drag)
- [x] Edge curve types (bezier, step, smoothstep) via tessellation
- [x] `defaultEdgeType` prop and per-edge type override
- [x] Mesh-based edges with custom ShaderMaterial (enables future effects)
- [x] Adaptive bezier control points (no forced S-curves for close nodes)
- [x] Socket rendering (InstancedMesh with SDF circles, hollow/filled states)
- [x] Socket hit detection for connection initiation
- [x] Connection line while dragging (dashed bezier, WebGL)
- [x] Edges connect to actual socket positions
- [x] Socket fill state based on connection status
- [x] Pre-allocated buffers in ConnectionLine (zero GC in hot paths)
- [x] `connectionMode` prop ("strict" | "loose") for type validation
- [x] `isValidConnection` callback for custom validation
- [x] Connection line color inherits source socket type
- [x] Invalid connection feedback (red line, red socket highlight)
- [x] Edge hit testing (point-to-bezier distance with viewport scaling)
- [x] Edge click-to-select (unified selection pool with nodes)
- [x] Ctrl+click additive edge selection
- [x] Selected edge visual (indigo highlight)
- [x] `edgesSelectable` prop (default: true)
- [x] `onEdgeClick` callback
- [x] Delete selected edges (Delete/Backspace key)
- [x] Cached socket lookup in ConnectionLine for O(1) hot path
- [x] Auto-scroll when dragging nodes near viewport edges (RAF-based, proportional speed)

### Next Immediate Tasks

**Phase 6: Core Operations & Event Plugins**
1. Core: `cloneElements()` with pre-allocated ID pool, single-pass edge remapping
2. Core: `addElements()` with batch state update + batch quadtree insert
3. Core: `deleteElements()`, `deleteSelected()`
4. Core: `copySelectedToInternal()`, `pasteFromInternal()`, `cutSelectedToInternal()`
5. Core: `toObject()`, `getSelectedNodes()`, `getConnectedEdges()`
6. Plugin: `useClipboard` (thin wrapper)
7. Plugin: `useKeyboardShortcuts`
8. Plugin: `useContextMenu` (right-click + long-press)
9. Docs: Pattern for browser clipboard
10. Docs: Pattern for undo/redo

---

## Notes for LLM Implementers

### When Modifying Shaders
- WebGL Y-axis is up, but our world uses Y-down
- Negate Y when converting world → GL coordinates
- Instance matrices should position node centers, not corners
- SDF functions expect coordinates centered at (0,0)

### When Adding Features
- Update types in `src/types/index.ts` first
- Add to store if it's interactive state
- Export from appropriate index.ts files
- Add to this PLAN.md's phase tracking

### When Debugging
- Check browser console for Three.js warnings
- Use React DevTools to verify state updates
- R3F has `<Stats>` component for FPS monitoring
- Three.js inspector browser extension helps with scene debugging

### Performance Considerations
- Always use `useMemo` for geometry/material creation
- Instance attributes should use `Float32Array`, not regular arrays
- Pre-allocate GPU buffers and reuse them (avoid GC pressure)
- Use dirty flags to skip unnecessary updates
- Implement viewport frustum culling to only render visible elements
- Use `translate3d` / `matrix3d` for DOM transforms (GPU acceleration)
- Disable MSAA on Safari (`antialias: false`)
- DOM layer should skip render when zoom < threshold (LOD)
- Avoid RAF batching on input handlers (causes latency)
- Use `frameloop="always"` with dirty flags instead of `frameloop="demand"`

---

*Last updated: January 2026*
