# Kookie Flow — Implementation Plan

> Open Canvas with Native Node Abilities. Figma-like freeform canvas merged with a native graph engine. GPU-rendered for performance at scale.

This document is the source of truth for building Kookie Flow. It is written for LLM consumption—structured, explicit, and unambiguous.

---

## ⚠️ PERFORMANCE IS EVERYTHING ⚠️

**This is the #1 priority. Nothing else matters if performance suffers.**

Before writing ANY code, ask yourself:

1. Does this trigger React re-renders during pan/zoom/drag? **UNACCEPTABLE.**
2. Does this allocate memory in hot paths (event handlers, render loops)? **UNACCEPTABLE.**
3. Is this O(n) when it could be O(log n) or O(1)? **UNACCEPTABLE.**

### Rules (never violate these):

| Rule                                          | Why                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Zero React re-renders during interactions** | Use refs for all position/transform updates. React state only for element creation/removal. |
| **RAF-throttled DOM updates**                 | Never update DOM synchronously in event handlers. Schedule via `requestAnimationFrame`.     |
| **Pre-allocated buffers**                     | GPU buffers sized once at init. No allocations during render.                               |
| **Dirty flags over subscriptions**            | Don't re-render on every state change. Track what changed, update only that.                |
| **Spatial indexing for hit testing**          | Quadtree for O(log n). Never iterate all nodes in event handlers.                           |
| **Ref-based position updates**                | `element.style.transform` via refs, not React props.                                        |

### Performance Architecture Pattern

```typescript
// ✅ CORRECT: Ref-based updates, RAF throttling
const labelsRef = useRef<Map<string, HTMLDivElement>>(new Map());
const rafIdRef = useRef<number>(0);

const updatePositions = useCallback(() => {
  rafIdRef.current = 0;
  const { nodes } = store.getState();
  labelsRef.current.forEach((el, id) => {
    const node = nodes.find((n) => n.id === id);
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

## Core Concept: The Entity Model

One primitive: **Entity**. Spatial presence and graph participation are orthogonal, composable traits.

```
Entity
├── position, size, rotation     (always — everything lives on the canvas)
├── ports[]                      (optional — graph participation)
├── parentId                     (optional — spatial hierarchy)
├── type                         (determines rendering + behavior)
├── data                         (type-specific payload)
│   ├── status                   (optional — 'error' | 'warning' | 'running' | 'success')
│   └── statusMessage            (optional — human-readable status text)
└── preview                      (optional — data visualization config)
```

### Two Independent Layers

| Layer                 | Controls                           | Example                              |
| --------------------- | ---------------------------------- | ------------------------------------ |
| **Spatial hierarchy** | Parent/child, containment, z-order | A Frame contains nodes visually      |
| **Graph topology**    | Ports, edges, data resolution      | Node A's output feeds Node B's input |

These coexist but don't implicitly affect each other. Dragging a node out of a frame doesn't disconnect its edges. Deleting an edge doesn't move the node.

### What a Connection Means

At the Kookie Flow level, an edge is **purely structural metadata**:

> "Port A on Entity X is linked to Port B on Entity Y."

Kookie Flow:
- **Stores** the edge: `{ source, sourcePort, target, targetPort }`
- **Renders** the visual curve between the two ports
- **Validates** compatibility (if `connectionMode="strict"` or `isValidConnection` provided)
- **Notifies** via `onConnect`, `onEdgesChange`

Kookie Flow does **not**: evaluate what the connection means, move data through it, trigger computation, or resolve values. The consumer's resolution engine walks the graph and decides.

### Entity Status

The consumer sets status, Kookie Flow renders it:

```tsx
entity.data.status = 'error' | 'warning' | 'running' | 'success' | undefined;
entity.data.statusMessage = 'Missing required input: Model';
```

| Status      | Visual                            |
| ----------- | --------------------------------- |
| `undefined` | Normal rendering                  |
| `error`     | Red border + status message bar   |
| `warning`   | Amber border + status message bar |
| `running`   | Pulse/spinner indicator           |
| `success`   | Green flash (transient)           |

### Built-in Entity Types

| Type      | What It Renders                                      | Ports?               | Notes                              |
| --------- | ---------------------------------------------------- | -------------------- | ---------------------------------- |
| `default` | Standard node (header + sockets + widgets + preview) | Yes (inputs/outputs) | The classic node graph node        |
| `draw`    | Shapes, SVG paths, freeform drawing                  | Optional             | Contains shapes as `data.shapes[]` |
| `text`    | Rich text block                                      | Optional             | MSDF for display, DOM for editing  |
| `image`   | Image on canvas                                      | Optional             | Three.js texture on quad           |
| `video`   | Video on canvas                                      | Optional             | DOM overlay, lazy-loaded           |
| `mesh`    | 3D object on canvas                                  | Optional             | Three.js scene-in-scene            |
| `frame`   | Spatial container / group                            | Optional             | Parent for other entities          |
| `comment` | Sticky note annotation                               | No                   | Annotation only                    |
| `reroute` | Edge waypoint                                        | Yes (passthrough)    | Graph routing                      |

`image`, `video`, `mesh` entities ARE the visual — they don't preview themselves. Preview is for `default` nodes (and custom consumer types) that *produce* visual output.

### Entity Type Customization (Three Levels)

**Level 1: Pure Declaration (80% of nodes).** Consumer declares ports, widgets, and preview. Kookie Flow renders everything.

```tsx
const Gen3DNode = {
  inputs: [
    { id: 'prompt', name: 'Prompt', type: 'string' },
    { id: 'model', name: 'Model', type: 'enum', options: ['shap-e', 'point-e', 'meshy'] },
  ],
  outputs: [{ id: 'mesh', name: 'Mesh', type: 'mesh' }],
  preview: { source: 'mesh', type: '3d' },
};
```

**Level 2: Slots (15% of nodes).** Consumer injects custom UI between Kookie Flow's building blocks.

```tsx
const Gen3DNode = {
  inputs: [...],
  outputs: [...],
  preview: { source: 'mesh', type: '3d' },
  Content: ({ entity, slots }) => (
    <>
      {slots.preview}
      <button onClick={() => generate(entity)}>Generate</button>
      <ProgressBar value={entity.data.progress} />
      {slots.widgets}
    </>
  ),
};
```

Available slots: `slots.preview`, `slots.widgets`, `slots.outputs`, `slots.inputs`. Consumer controls layout. Kookie Flow still owns preview lifecycle, widget rendering, port positioning, hit testing.

**Level 3: Full Escape Hatch (5% of nodes).** Consumer owns the interior.

```tsx
const WildNode = {
  inputs: [{ id: 'in', name: 'In', type: 'any' }],
  outputs: [{ id: 'out', name: 'Out', type: 'any' }],
  render: 'custom',
  Component: ({ entity, ports }) => (
    <div className="my-wild-layout">
      {ports.input('in')}
      <MyEntirelyCustomThing />
      {ports.output('out')}
    </div>
  ),
};
```

Kookie Flow still handles: entity frame/border, port hit testing, edge connections, selection, dragging, status rendering. Consumer controls what's inside.

### Preview System

Every `default` node can visualize data on its output ports. The preview system is **built-in**.

| `preview.type` | Renderer                    | How              | Loaded              |
| -------------- | --------------------------- | ---------------- | ------------------- |
| `image`        | Three.js CanvasTexture      | Textured quad    | Always              |
| `3d`           | Three.js scene-in-scene     | DOM overlay      | Lazy (on first use) |
| `video`        | `<video>` element           | DOM overlay      | Lazy (on first use) |

Display mode (zoomed out / idle): thumbnail drawn in WebGL (nearly free). Interactive mode (zoomed in / active): live renderer mounted as DOM overlay. 200 video entities = ~5 live `<video>` elements.

Consumers can register additional preview renderers:

```tsx
<KookieFlow
  previewRenderers={{
    audio: AudioPreviewRenderer,
    chart: ChartPreviewRenderer,
  }}
/>
```

### What Kookie Flow Does NOT Do

- **No execution engine** — provides topo sort, execution levels, dirty propagation, but does NOT evaluate nodes or run computations
- **No data flow** — edges are structural. What flows through them is the consumer's responsibility
- **No persistence** — serialization via `toObject()`. Storage is the consumer's responsibility
- **No AI integration** — Kookie AI builds on top of Kookie Flow, not inside it
- **No heavy media embeds** — PDF, spreadsheet, iframe are consumer entity types via `entityTypes`

---

## Rendering Strategy

### What Renders in WebGL

| Element          | Technique                       | Draw Calls                  |
| ---------------- | ------------------------------- | --------------------------- |
| Node backgrounds | InstancedMesh + SDF shader      | 1                           |
| Node headers     | InstancedMesh (same as above)   | 0 (merged)                  |
| Sockets          | InstancedMesh (circles)         | 1                           |
| Edges            | BufferGeometry line segments    | 1                           |
| Grid             | Full-screen quad + shader       | 1                           |
| Selection box    | Quad with dashed shader         | 1                           |
| Image previews   | Texture atlas + instanced quads | 1                           |
| 3D mesh previews | Standard Three.js meshes        | N (one per visible preview) |

**Total for 10,000 nodes:** ~5-10 draw calls

### What Renders in DOM

| Element             | Why DOM                                    |
| ------------------- | ------------------------------------------ |
| Node title text     | Font flexibility, accessibility, selection |
| Socket labels       | Same                                       |
| Input widgets       | Native form elements, focus management     |
| Custom node content | User flexibility (escape hatch)            |

### Level of Detail (LOD)

Text rendering follows zoom-based LOD:

```typescript
const MIN_TEXT_ZOOM = 0.3; // Below this, hide all text
const MIN_LABEL_SIZE = 8; // Minimum screen-space font size

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

### Phase 2: Camera Controls ✅ COMPLETE

**Goal:** Pan and zoom

- [x] Pointer event handling on canvas
- [x] Pan: middle-click drag or space+drag
- [x] Zoom: scroll wheel with center point
- [x] Touch support: pinch-to-zoom, two-finger pan
- [x] `fitView()` implementation (with options: padding, nodes filter, zoom constraints)
- [x] Zoom limits (min/max)
- [x] Imperative API via ref (`fitView`, `getViewport`, `setViewport`, `zoomIn`, `zoomOut`, `setCenter`, etc.)
- [ ] Smooth animated transitions (optional, deferred)

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

### Phase 6: Core Operations & Event Plugins ✅ COMPLETE

**Goal:** Optimized core operations for clipboard/history patterns + event-handling plugins

**Architecture Principle:** Core handles all performance-critical operations (cloning, batch updates, ID generation). Plugins are thin wrappers for event handling. Users who need custom behavior call the same optimized core methods.

**Why this design:**

- `node.data` is user-defined and can contain anything (functions, images, backend refs)
- Serialization, history snapshots, and data transformation are inherently app-specific
- We can optimize the _structural_ operations (cloning, ID remapping, batch insert)
- We cannot optimize the _data_ operations (what to copy, how to serialize)
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
store.copySelectedToInternal(): void  // stores nodes + ALL connected edges
store.pasteFromInternal(options?: {
  offset?: { x, y },
  transformData?: (data: T) => T,
  preserveExternalConnections?: boolean,  // default: false - reconnect to existing nodes
}): void
store.cutSelectedToInternal(): void

// Serialization (for user's custom browser clipboard / persistence)
store.toObject(): { nodes, edges, viewport }
store.getSelectedNodes(): Node[]
store.getConnectedEdges(nodeIds: string[]): Edge[]
```

**Plugins (`@kushagradhawan/kookie-flow/plugins`):**

| Plugin                 | What it does                                                             | Exposes                        |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------ |
| `useClipboard`         | Thin wrapper for internal clipboard                                      | `copy()`, `paste()`, `cut()`   |
| `useKeyboardShortcuts` | Event listeners, modifier detection (`mod` = Cmd/Ctrl), focus management | Config object for key bindings |
| `useContextMenu`       | Right-click + long-press listening, hit testing                          | `{ contextMenu, closeMenu }`   |

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
      status: 'idle', // reset transient state
      backendId: null, // clear backend reference
    }),
  });
};
```

**Custom browser clipboard (user implements):**

```typescript
const copyToBrowser = async () => {
  const nodes = store.getSelectedNodes();
  const edges = store.getConnectedEdges(nodes.map((n) => n.id));

  // User decides what to serialize
  const payload = {
    nodes: nodes.map((n) => ({
      ...n,
      data: { prompt: n.data.prompt }, // only serializable fields
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

  const redo = () => {
    /* inverse of undo */
  };

  return { push, undo, redo, canUndo: past.current.length > 0 };
}
```

**Tasks:**

- [x] Core: `cloneElements()` with pre-allocated ID pool, single-pass edge remapping
- [x] Core: `addElements()` with batch state update + batch quadtree insert
- [x] Core: `deleteElements()`, `deleteSelected()`
- [x] Core: `copySelectedToInternal()`, `pasteFromInternal()`, `cutSelectedToInternal()`
- [x] Core: `toObject()`, `getSelectedNodes()`, `getConnectedEdges()`
- [x] Core: `preserveExternalConnections` option for paste (reconnect to existing nodes)
- [x] Plugin: `useClipboard` (thin wrapper with per-paste option override)
- [x] Plugin: `useKeyboardShortcuts`
- [x] Plugin: `useContextMenu` (right-click + long-press)
- [x] Docs: Pattern for browser clipboard
- [x] Docs: Pattern for simple undo/redo
- [x] Docs: Pattern for efficient undo/redo (structural sharing)

### Phase 7A: Edge Enhancements ✅ COMPLETE

**Goal:** Complete edge feature set

- [x] Edge labels (text on edges, positioned at midpoint)
- [x] Edge markers (arrows at endpoints)
- [x] Socket labels (text next to sockets)
- [x] `showSocketLabels` prop (toggle socket label visibility)
- [x] `showEdgeLabels` prop (toggle edge label visibility)

**Implementation notes:**

- Edge labels: DOM-based in `EdgeLabelsContainer` (consistent with node labels)
  - Positioned via `getEdgePointAtT()` utility for accurate curve sampling
  - Supports string or full `EdgeLabelConfig` with position, colors, fontSize
  - Ref-based updates, RAF throttling, viewport culling
- Edge markers: Triangle geometry in `Edges.tsx` (same draw call as edges)
  - `markerStart` and `markerEnd` props on Edge
  - Direction from curve tangent at endpoint
  - Configurable width/height, color inherits from edge
  - Screen-space sized (scales with zoom)
- Socket labels: DOM-based in `SocketLabelsContainer`
  - Ref-based updates, RAF throttling, viewport culling
  - Positioned adjacent to socket circles (left for inputs, right for outputs)
  - Same performance patterns as node/edge labels
- Visibility props use conditional rendering (zero overhead when disabled)
- All respect edge selection state and colors

### Phase 7.5: WebGL Text Rendering (MSDF) ✅ COMPLETE

**Goal:** Replace DOM text with GPU-rendered instanced MSDF for 10k+ node performance

**Problem:**

- DOM labels cause 30-40fps drop at scale (1000+ nodes with socket/edge labels)
- Each DOM element = composite layer overhead
- troika-three-text = 1 draw call per Text instance (500+ = performance death)
- No maintained R3F library does instanced MSDF properly

**Solution: Custom Instanced MSDF Renderer**

One `InstancedMesh` where each instance = one glyph quad:

```
"Node 1" = 6 glyph instances (N, o, d, e, space, 1)
10,000 labels × ~8 glyphs avg = 80,000 glyph instances
= 1 draw call
= 60fps
```

**Build Step (MSDF Atlas Generation):**

- [x] Add `msdf-bmfont-xml` as dev dependency
- [x] Generate MSDF atlas from Google Sans font (Regular + SemiBold weights)
- [x] Output: `google-sans-*-msdf.png` (atlas textures) + `GoogleSans-*.json` (glyph metrics)
- [x] Add build script: `pnpm generate:fonts`
- [x] Include pre-generated atlas in package for zero-config usage

**Core Component: `<TextRenderer>`**

- [ ] Single `InstancedMesh` with MSDF shader material
- [ ] Per-glyph instance attributes:
  - `position` (vec3): world position of glyph quad
  - `uvOffset` (vec4): glyph location in atlas (x, y, width, height)
  - `scale` (float): font size multiplier
  - `color` (vec3): text color
- [ ] Pre-allocated buffers (max glyph capacity, dirty flags)
- [ ] Text layout engine: character positioning, word boundaries
- [ ] Anchor points: left, center, right alignment

**MSDF Shader:**

- [ ] Vertex shader: billboard quads from instance attributes
- [ ] Fragment shader: MSDF sampling with `median(r, g, b)` technique
- [ ] Anti-aliasing via `fwidth()` for screen-space smoothing
- [ ] Color uniform with per-instance override
- [ ] Alpha threshold for crisp edges

**Integration with Existing Systems:**

- [ ] `<NodeLabels>` → feeds entries to TextRenderer (replaces `CrispLabelsContainer`)
- [ ] `<SocketLabels>` → feeds entries to TextRenderer (replaces `SocketLabelsContainer`)
- [ ] `<EdgeLabels>` → feeds entries to TextRenderer (replaces `EdgeLabelsContainer`)
- [ ] Subscribe to store for position updates (same pattern as current DOM labels)
- [ ] Viewport culling: skip glyphs outside frustum
- [ ] LOD: hide all text below `MIN_TEXT_ZOOM` threshold

**LOD Strategy:**

```typescript
const MIN_TEXT_ZOOM = 0.3; // Below this, hide ALL text
const MIN_SOCKET_ZOOM = 0.5; // Below this, hide socket labels
const MIN_EDGE_ZOOM = 0.4; // Below this, hide edge labels
// Node headers visible longest (most important)
```

**API:**

```typescript
// Internal usage (components feed text entries)
<TextRenderer
  entries={[
    { id: 'node-1-header', text: 'Add', position: [x, y, 0], fontSize: 14, color: '#fff', anchor: 'left' },
    { id: 'node-1-in-0', text: 'A', position: [sx, sy, 0], fontSize: 10, color: '#888', anchor: 'right' },
    // ...
  ]}
  font={fontAtlas}     // Pre-loaded MSDF atlas + metrics
  visible={zoom > MIN_TEXT_ZOOM}
/>

// Props on <KookieFlow> remain the same
<KookieFlow
  showSocketLabels={true}   // Now GPU-rendered
  showEdgeLabels={true}     // Now GPU-rendered
  // Node headers always shown (controlled by LOD internally)
/>
```

**Performance Targets:**

- 10,000 nodes with all labels: 60fps
- Single draw call for all text
- Zero GC pressure (pre-allocated buffers, no per-frame allocations)
- <1ms for full text buffer rebuild

**Tasks:**

- [x] Build: Add `msdf-bmfont-xml`, create font generation script
- [x] Build: Generate Google Sans MSDF atlas (Regular + SemiBold), include in package
- [x] Core: `TextRenderer.tsx` - instanced mesh with MSDF material
- [x] Core: `msdf-shader.ts` - vertex/fragment shaders
- [x] Core: `text-layout.ts` - character positioning from metrics
- [x] Core: Glyph buffer management (pre-allocated, dirty flags)
- [x] Integration: Replace `CrispLabelsContainer` with TextRenderer entries
- [x] Integration: Replace `SocketLabelsContainer` with TextRenderer entries
- [x] Integration: Replace `EdgeLabelsContainer` with TextRenderer entries
- [x] LOD: Zoom-based visibility thresholds per label type
- [x] Culling: Skip glyphs outside viewport bounds
- [x] Test: Verify 10k nodes at 60fps with all labels enabled

**What Stays in DOM:**

- Input widgets (text fields, sliders, dropdowns) — interactive, few in number
- Custom node content (user's React components) — escape hatch
- Tooltips (if added later)

**References:**

- [msdf-bmfont-xml](https://github.com/soimy/msdf-bmfont-xml) — Atlas generation
- [three-msdf-text-utils](https://github.com/leochocolat/three-msdf-text-utils) — Shader reference
- [CSS-Tricks: WebGL Text](https://css-tricks.com/techniques-for-rendering-text-with-webgl/) — MSDF technique overview
- [Three.js Forum: 10k Labels](https://discourse.threejs.org/t/performant-approach-for-displaying-text-labels-10000/21863) — LOD strategy

### Phase 7B: Minimap ✅ COMPLETE

**Goal:** Overview navigation panel

- [x] Minimap component (Canvas 2D, renders to corner)
- [x] Simplified node rectangles (solid color, selected highlight)
- [x] Viewport indicator rectangle (draggable)
- [x] Click to pan, drag to move viewport
- [x] Configurable position (corner) and size
- [x] `zoomable` prop: minimap zooms with main canvas (alternative mode)

**Implementation notes:**

- Canvas 2D for efficient rendering of 10k+ rectangles (single draw call equivalent)
- RAF-throttled updates via store subscription
- HiDPI support (`devicePixelRatio` scaling)
- Two modes: standard (fixed overview) and zoomable (mirrors main viewport)
- Interactive: click to pan, drag viewport indicator (or anywhere in zoomable mode)

### Styling & Theme Integration

**Goal:** Kookie UI design system integration

See **[STYLING.md](./STYLING.md)** for full implementation plan and milestone tracking.

**Summary:**

- Size tiers (`'1'`-`'5'`) matching Kookie UI Card
- Visual variants: `surface`, `outline`, `soft`, `classic`, `ghost`
- Border radius styles: `none`, `small`, `medium`, `large`, `full`
- 26 accent colors from Kookie UI palette
- Theme token reading via `useThemeTokens()` hook
- Fallback tokens for standalone mode (no Kookie UI dependency)

**Current status:** Phases 1-7D complete. Phase 7C (Grouping & Annotations) complete. Phase 7E (Connection Events) next.

### Phase 7C: Grouping & Annotations ✅

**Goal:** Organizational features

- [x] Node grouping/frames (parent-child relationship)
- [x] Collapsed groups (hide children, show summary)
- [x] Comments/sticky notes (text-only nodes)
- [x] Reroute nodes (edge waypoints)

**Implementation Summary:**

1. **Types (`src/types/index.ts`):**
   - Added `parentId?: string` and `collapsed?: boolean` to `Node` interface
   - Added `GroupNodeData`, `CommentNodeData`, `RerouteNodeData` types
   - Added `GroupNode`, `CommentNode`, `RerouteNode` type aliases
   - Added `isGroupNode()`, `isCommentNode()`, `isRerouteNode()` type guards
   - Added `reroutes?: string[]` to `Edge` interface for waypoint support
   - Added `collapse` and `parent` node change types

2. **Store (`src/core/store.ts`):**
   - Added `collapsedGroupIds: Set<string>` for O(1) collapse state lookup
   - Added group actions: `getGroupChildren`, `getGroupDescendants`, `toggleGroupCollapse`, `expandGroup`, `collapseGroup`, `isGroupCollapsed`, `getGroupBounds`, `setNodeParent`, `moveGroup`
   - Updated `rebuildDerivedState` to filter collapsed children from quadtrees

3. **Grouping Utilities (`src/utils/grouping.ts`):**
   - `getGroupChildren()`, `getGroupDescendants()` - hierarchy traversal
   - `isNodeHidden()`, `getVisibleNodes()` - visibility checks
   - `calculateGroupBounds()` - auto-size from children
   - `getParentChain()`, `isDescendantOf()` - relationship queries
   - `calculateDescendantPositions()` - batch move support
   - `wouldCreateCycle()` - cycle detection for parent assignment
   - `sortByDepth()` - topological ordering

4. **Rendering:**
   - `Nodes.tsx`: Skip comment/reroute types and collapsed children
   - `RerouteNodes.tsx`: New component for waypoint circles (InstancedMesh)
   - `DOMLayer.tsx`: `CommentsContainer` for sticky note rendering

5. **Imperative API:**
   - Extended `KookieFlowInstance` with group methods: `getGroupChildren`, `getGroupDescendants`, `toggleGroupCollapse`, `expandGroup`, `collapseGroup`, `isGroupCollapsed`, `getGroupBounds`

### Phase 7D: Socket Widgets

**Goal:** Input widgets on sockets that auto-hide when connected

When a socket is unconnected, show a UI widget (slider, dropdown, checkbox, etc.) so users can set default values. When the socket gets a connection, the widget hides automatically (value comes from upstream node).

**Architecture Overview:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Widget Resolution Flow                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Socket Definition          SocketType Config         Library Defaults  │
│  (per-socket)               (via socketTypes prop)    (built-in)        │
│       │                            │                        │           │
│       ▼                            ▼                        ▼           │
│  ┌─────────┐                ┌─────────────┐          ┌─────────────┐    │
│  │ widget  │───overrides───▶│   widget    │──falls───▶│   widget    │   │
│  │ min/max │                │   min/max   │  back to  │   min/max   │   │
│  │ options │                │   options   │           │   (none)    │   │
│  └─────────┘                └─────────────┘           └─────────────┘   │
│       │                            │                        │           │
│       └────────────────────────────┴────────────────────────┘           │
│                                    │                                    │
│                                    ▼                                    │
│                           Final Widget Config                           │
│                                    │                                    │
│                                    ▼                                    │
│                    ┌───────────────────────────────┐                    │
│                    │  Is socket connected?         │                    │
│                    └───────────────────────────────┘                    │
│                          │                │                             │
│                         YES              NO                             │
│                          │                │                             │
│                          ▼                ▼                             │
│                    ┌─────────┐    ┌─────────────────┐                   │
│                    │  Hide   │    │  Render Widget  │                   │
│                    │ Widget  │    │  (DOM Layer)    │                   │
│                    └─────────┘    └─────────────────┘                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Type Definitions:**

```typescript
// Built-in widget types
type WidgetType = 'slider' | 'number' | 'select' | 'checkbox' | 'text' | 'color';

// Widget configuration (merged from socket + type defaults)
interface WidgetConfig {
  type: WidgetType | false; // false = explicitly disable widget
  min?: number; // For slider/number
  max?: number; // For slider/number
  step?: number; // For slider/number
  options?: string[]; // For select
  placeholder?: string; // For text
}

// Extended Socket type
interface Socket {
  id: string;
  name: string;
  type: string; // Maps to SocketType for defaults

  // Widget overrides (optional - falls back to SocketType defaults)
  widget?: WidgetType | false; // Override widget type or disable
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  defaultValue?: unknown; // Initial value
}

// Extended SocketType (in socketTypes config)
interface SocketType {
  name: string;
  color: string;
  compatibleWith?: string[] | '*';

  // Default widget for this socket type (NEW)
  widget?: WidgetType;
  min?: number;
  max?: number;
  step?: number;
}

// Values stored in node.data
interface NodeData {
  label?: string;
  values?: Record<string, unknown>; // socketId → current value
  [key: string]: unknown;
}
```

**Library Default Widget Mappings:**

```typescript
// In constants.ts - extend DEFAULT_SOCKET_TYPES
export const DEFAULT_SOCKET_TYPES = {
  float: {
    name: 'Float',
    color: '--teal-9',
    widget: 'slider',
    min: 0,
    max: 1,
  },
  int: {
    name: 'Integer',
    color: '--blue-9',
    widget: 'number',
    step: 1,
  },
  boolean: {
    name: 'Boolean',
    color: '--orange-9',
    widget: 'checkbox',
  },
  string: {
    name: 'String',
    color: '--green-9',
    widget: 'text',
  },
  enum: {
    name: 'Enum',
    color: '--amber-9',
    widget: 'select', // options provided per-socket
  },
  // Types with no default widget (connection-only)
  image: { name: 'Image', color: '--purple-9' },
  mesh: { name: 'Mesh', color: '--pink-9' },
  any: { name: 'Any', color: '--gray-9' },
};
```

**Consumer Usage Examples:**

```typescript
// Example 1: Uses library defaults
const node: Node = {
  id: 'sampler',
  type: 'default',
  position: { x: 0, y: 0 },
  data: {
    label: 'Sampler',
    values: { 'in-0': 0.5 }  // Current value
  },
  inputs: [
    { id: 'in-0', name: 'Strength', type: 'float' },
    // → renders slider 0-1 (from float defaults)
  ],
};

// Example 2: Override config on socket
const node: Node = {
  id: 'processor',
  inputs: [
    {
      id: 'in-0',
      name: 'Steps',
      type: 'int',
      min: 1,           // Override default
      max: 100,         // Override default
      defaultValue: 20,
    },
    // → renders number input 1-100
  ],
};

// Example 3: Override widget type on socket
const node: Node = {
  id: 'mixer',
  inputs: [
    {
      id: 'in-0',
      name: 'Factor',
      type: 'float',
      widget: 'number',  // Use number instead of slider
    },
  ],
};

// Example 4: Disable widget
const node: Node = {
  id: 'passthrough',
  inputs: [
    {
      id: 'in-0',
      name: 'Input',
      type: 'float',
      widget: false,  // No widget, connection only
    },
  ],
};

// Example 5: Enum/select with options
const node: Node = {
  id: 'converter',
  inputs: [
    {
      id: 'in-0',
      name: 'Method',
      type: 'enum',
      options: ['nearest', 'bilinear', 'bicubic'],
      defaultValue: 'bilinear',
    },
  ],
};

// Example 6: Override type-level defaults globally
<KookieFlow
  socketTypes={{
    float: {
      name: 'Float',
      color: '--teal-9',
      widget: 'number',  // Change all floats to number inputs
      min: -1000,
      max: 1000,
    },
  }}
/>
```

**Custom Widget Components:**

```typescript
// Widget component props (passed by library)
interface WidgetProps<T = unknown> {
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;            // True when socket is connected
  socket: Socket;               // Full socket definition
  node: Node;                   // Parent node
  config: ResolvedWidgetConfig; // Merged config (socket + type defaults)
}

// Option A: Register custom widgets globally
<KookieFlow
  widgetTypes={{
    // Custom widget type
    colorPicker: ({ value, onChange, disabled }) => (
      <ColorPicker value={value} onChange={onChange} disabled={disabled} />
    ),

    // Override built-in
    slider: ({ value, onChange, config }) => (
      <MyFancySlider
        value={value}
        onChange={onChange}
        min={config.min}
        max={config.max}
      />
    ),
  }}
/>

// Then use by name
{ type: 'color', widget: 'colorPicker' }

// Option B: Inline component on socket (one-off)
const node: Node = {
  inputs: [
    {
      id: 'in-0',
      name: 'Color',
      type: 'color',
      widget: {
        component: ({ value, onChange, disabled }) => (
          <MySpecialColorWheel value={value} onChange={onChange} disabled={disabled} />
        ),
      },
    },
  ],
};

// Option C: Both (inline overrides registered)
// Registered widgets checked first, then inline component
```

**Value Management:**

```typescript
// Values live in node.data.values (consumer's state)
interface NodeData {
  label?: string;
  values?: Record<string, unknown>;  // socketId → value
}

// KookieFlow calls onNodesChange when widget value changes
<KookieFlow
  nodes={nodes}
  onNodesChange={(changes) => {
    // changes includes: { type: 'data', id: nodeId, data: { values: {...} } }
  }}
/>

// Or dedicated callback for widget changes
<KookieFlow
  onWidgetChange={(nodeId, socketId, value) => {
    // Consumer updates their state
  }}
/>
```

**Widget Resolution Function:**

```typescript
// In utils/widgets.ts
export function resolveWidgetConfig(
  socket: Socket,
  socketTypes: Record<string, SocketType>
): ResolvedWidgetConfig | null {
  const socketType = socketTypes[socket.type];

  // Check if explicitly disabled
  if (socket.widget === false) return null;

  // Determine widget type (socket → type → null)
  const widgetType = socket.widget ?? socketType?.widget ?? null;
  if (!widgetType) return null;

  // Merge config (socket overrides type defaults)
  return {
    type: widgetType,
    min: socket.min ?? socketType?.min,
    max: socket.max ?? socketType?.max,
    step: socket.step ?? socketType?.step,
    options: socket.options,
    defaultValue: socket.defaultValue,
  };
}
```

**DOM Layer Integration:**

```typescript
// In DOMLayer.tsx or new WidgetsLayer.tsx
function SocketWidget({ socket, node, isConnected }: Props) {
  const config = resolveWidgetConfig(socket, socketTypes);

  // No widget configured
  if (!config) return null;

  // Socket is connected - hide widget
  if (isConnected) return null;

  // Check for custom component (registered or inline)
  const CustomComponent = widgetTypes[config.type] ?? socket.widget?.component;
  if (CustomComponent) {
    return <CustomComponent value={...} onChange={...} disabled={false} />;
  }

  // Built-in widgets
  switch (config.type) {
    case 'slider':
      return <Slider value={...} min={config.min} max={config.max} />;
    case 'number':
      return <NumberInput value={...} step={config.step} />;
    case 'select':
      return <Select value={...} options={config.options} />;
    case 'checkbox':
      return <Checkbox checked={...} />;
    case 'text':
      return <TextInput value={...} placeholder={config.placeholder} />;
    case 'color':
      return <ColorInput value={...} />;
  }
}
```

**Widget Layout (Fixed to Size 2):**

All widgets use Kookie UI components at size 2. No size prop exposed - keeps things simple.

```
Node layout (vertical stack): Header → Outputs → Inputs
┌──────────────────────────────────────────────────────┐
│  [Node Title]                             (accent)   │  40px header (if inside)
├──────────────────────────────────────────────────────┤
│                                [Output Label] [●]    │  40px output row
│                                [Output Label] [●]    │  (right-aligned, no widget)
├──────────────────────────────────────────────────────┤
│  [●] [Input Label] [═══32px Widget═══]               │  40px input row
│  [●] [Input Label] [═══32px Widget═══]               │  (widget fills width)
│  [●] [Input Label]                                   │  (no widget if connected)
└──────────────────────────────────────────────────────┘
```

**Row height token: `--space-7` (40px)**
**Widget height: `--space-6` (32px)**

From Kookie UI `base-button.css`:

```css
&:where(.rt-r-size-2) {
  --base-button-height: var(--space-6); /* 32px at 100% scaling */
}
```

All size 2 components (Button, Slider, Select, etc.) are 32px tall, centered in 40px rows with 4px breathing room above/below.

**Implementation:**

```typescript
function SocketWidget({ socket, node, isConnected }: Props) {
  // Fixed to size 2 - no size prop needed
  return (
    <Slider
      size="2"
      value={...}
      min={config.min}
      max={config.max}
    />
  );
}
```

**Zoom Behavior:**

Widgets scale with zoom (CSS transform on DOM layer container):

- Widgets shrink/grow naturally with the node
- Below `minWidgetZoom` threshold (default: 0.4), widgets hide entirely
- No counter-scaling - keeps visual integrity with node content

**Performance Considerations:**

- Widgets render in DOM layer (interactive elements need native inputs)
- Only render widgets for visible, unconnected sockets
- Viewport culling: skip widgets outside frustum
- Ref-based position updates (same pattern as labels)
- Use Kookie UI components (already optimized)
- Memoize widget resolution (socketTypes rarely changes)

**API Summary:**

```typescript
interface KookieFlowProps {
  // Existing
  nodes: Node[];
  edges: Edge[];
  socketTypes?: Record<string, SocketType>;
  onNodesChange?: (changes: NodeChange[]) => void;

  // New for widgets
  widgetTypes?: Record<string, React.ComponentType<WidgetProps>>;
  onWidgetChange?: (nodeId: string, socketId: string, value: unknown) => void;
  showWidgets?: boolean; // Default: true, toggle all widgets
}
```

**Prerequisites (see STYLING.md):**

Before implementing widgets, complete token alignment work:

- STYLING.md Milestone 3: Typography tokens (`--font-size-N`, `--line-height-N`)
- STYLING.md Milestone 3.5: Socket layout tokenization (`--space-7` for 40px row height, `--space-6` for 32px widget height)

This ensures widgets fit naturally in socket rows and scale properly.

**Tasks:**

- [x] Types: Extend `Socket` with widget config fields
- [x] Types: Extend `SocketType` with default widget config
- [x] Types: Add `WidgetProps`, `WidgetConfig`, `ResolvedWidgetConfig`
- [x] Core: Update `DEFAULT_SOCKET_TYPES` with widget defaults
- [x] Core: `resolveWidgetConfig()` utility function
- [x] Core: Track connected sockets in store for widget visibility
- [x] Components: Built-in widgets (Slider, NumberInput, Select, Checkbox, TextInput, ColorInput)
- [x] Components: `WidgetsLayer.tsx` in DOM layer
- [x] Components: Widget positioning (adjacent to socket, inside node bounds)
- [x] Integration: `widgetTypes` prop for custom/override widgets
- [x] Integration: `onWidgetChange` callback
- [x] Integration: Value storage in `node.data.values` (reads from node.data.values, callback notifies)
- [x] Performance: Viewport culling for widgets
- [x] Performance: Memoized widget resolution
- [x] Docs: Widget usage examples (added to demo page)
- [x] Docs: Custom widget component guide (demo shows all widget types + inline override)

### Phase 7E: Connection Events

**Goal:** Callbacks for connection lifecycle (enables "add node on edge drop" pattern)

Currently `onConnect` only fires when a connection succeeds. Users need events for:
1. When connection drag starts (to show UI hints, prepare node creation)
2. When connection drag ends (regardless of success, to create nodes on empty drop)

**New Callbacks:**

```typescript
interface KookieFlowProps {
  // Existing
  onConnect?: (connection: Connection) => void;

  // NEW: Connection lifecycle
  onConnectStart?: (
    event: PointerEvent,
    params: {
      nodeId: string;
      socketId: string;
      isInput: boolean;
    }
  ) => void;

  onConnectEnd?: (
    event: PointerEvent,
    connectionState: {
      isValid: boolean;           // Did it land on a valid socket?
      source: {                   // Where the drag started
        nodeId: string;
        socketId: string;
        isInput: boolean;
      };
      position: XYPosition;       // World coordinates of drop point
    }
  ) => void;
}
```

**Use Case: Add Node on Edge Drop**

```tsx
<KookieFlow
  onConnectEnd={(event, state) => {
    // Only act when dropped on empty canvas (not a valid connection)
    if (!state.isValid) {
      const id = `node-${Date.now()}`;

      // Add new node at drop position
      setNodes(nodes => [...nodes, {
        id,
        position: state.position,
        data: { label: 'New Node' },
        inputs: [{ id: 'in', name: 'Input', type: 'any' }],
      }]);

      // Connect source to new node
      const edge = state.source.isInput
        ? { source: id, sourceSocket: 'out', target: state.source.nodeId, targetSocket: state.source.socketId }
        : { source: state.source.nodeId, sourceSocket: state.source.socketId, target: id, targetSocket: 'in' };

      setEdges(edges => [...edges, { id: `edge-${Date.now()}`, ...edge }]);
    }
  }}
/>
```

**Implementation:**

1. **Types (`src/types/index.ts`):**
   - Add `OnConnectStartParams` interface
   - Add `ConnectionState` interface for `onConnectEnd`
   - Add `onConnectStart` and `onConnectEnd` to `KookieFlowProps`

2. **Store (`src/core/store.ts`):**
   - Add `screenToWorld(screenX, screenY): XYPosition` helper (already have inverse)

3. **InputHandler (`src/components/kookie-flow.tsx`):**
   - Fire `onConnectStart` when `connectionDraft` is created (in `handlePointerDown`)
   - Fire `onConnectEnd` in `handlePointerUp` before canceling draft, with:
     - `isValid`: whether connection succeeded
     - `source`: the original socket info from `connectionDraft`
     - `position`: world coords from pointer position

4. **Props threading:**
   - Thread `onConnectStart` and `onConnectEnd` through component layers

**Performance Notes:**
- No hot path impact - callbacks only fire on pointer up/down
- `screenToWorld` is O(1) - simple math with viewport
- No new store state needed - uses existing `connectionDraft`

**Tasks:**

- [ ] Types: Add `OnConnectStartParams`, `ConnectionState` interfaces
- [ ] Types: Add `onConnectStart`, `onConnectEnd` to `KookieFlowProps`
- [ ] Store: Add `screenToWorld()` helper function
- [ ] InputHandler: Fire `onConnectStart` when connection begins
- [ ] InputHandler: Fire `onConnectEnd` with position and validity
- [ ] Props: Thread callbacks through component layers
- [ ] Demo: Add "add node on edge drop" example
- [ ] Docs: Update README with connection events

### Phase 8: Graph Engine

**Goal:** Make Kookie Flow understand graph topology — who connects to whom, what order to traverse, where the cycles are.

**Core Data Structure: Adjacency Index**

Maintained incrementally alongside the entity/edge arrays in the Zustand store:

```typescript
interface AdjacencyIndex {
  outgoing: Map<string, Map<string, Edge[]>>;   // entityId → portId → edges leaving
  incoming: Map<string, Map<string, Edge[]>>;   // entityId → portId → edges arriving
  byEntity: Map<string, Edge[]>;                // all edges touching an entity
  topologyVersion: number;                       // incremented ONLY on edge/entity add/remove
}
```

**Key invariant:** Pan, zoom, drag, widget change = 0 graph recomputation. Only adding/removing edges or entities changes topology. Update cost: 3 Map ops per edge add/remove.

**Graph Queries** (all use adjacency index, no iteration over all edges):

```typescript
// Direct neighbors — O(1)
flow.getIncomers('node-5')
flow.getOutgoers('node-5')

// Recursive traversal — O(k), iterator-based, consumer can break early
for (const id of flow.walkUpstream('node-5')) { ... }
for (const id of flow.walkDownstream('node-5')) { ... }

// Edge queries — O(1)
flow.getConnectedEdges('node-5')
flow.getInputEdges('node-5')
flow.getOutputEdges('node-5')

// Structural queries
flow.getRoots()                      // entities with no incoming edges
flow.getLeaves()                     // entities with no outgoing edges
flow.getConnectedComponents()        // independent subgraphs (Union-Find)
```

**Topological Sort & Execution Levels** (Kahn's algorithm, cached against topologyVersion):

```typescript
flow.topologicalSort()               // flat execution order — O(V+E), cached
flow.executionLevels()               // grouped by level (parallel execution) — O(V+E), cached
flow.getReadyEntities(completed)     // what can start next given completed set — O(k)
flow.getExecutionOrder('output-1')   // subgraph needed for one specific node
```

**Cycle Detection & Prevention:**

```typescript
flow.hasCycles()                     // O(1) if topo sort cached
flow.findCycles()                    // string[][] (node IDs per cycle)
flow.wouldCreateCycle(src, tgt)      // O(k) DFS, called every pointer move during connection drag
// Automatic prevention: <KookieFlow allowCycles={false} /> rejects cycle-creating connections
```

**Dirty Propagation:**

```typescript
flow.getAffectedEntities('node-3')   // downstream in topo order — O(k)
flow.getAffectedEntities(['node-3', 'node-7']) // batch, deduplicated
```

**Node Muting/Bypass:**

```typescript
flow.muteEntity('filter-1')          // logically bypass, inputs pass through to outputs
flow.unmuteEntity('filter-1')
// Visual: dimmed, dashed edges. Topo sort skips muted nodes.
```

**Graph Mutations:**

```typescript
flow.insertOnEdge('edge-5', newNode) // A→B becomes A→new→B
flow.bypassEntity('filter-1')       // A→filter→B becomes A→B
flow.collapseToSubgraph([...ids])    // create compound node
flow.expandSubgraph('group-1')      // inverse
```

**Graph Validation:**

```typescript
flow.validate()                      // all structural issues
flow.isGraphComplete()               // all required ports connected?
flow.getCompatiblePorts(src, port)   // valid targets during connection drag
```

**Performance:**

| Operation | When | Cost |
| --- | --- | --- |
| Add/remove edge | User connects/disconnects | 3 Map ops + version++ |
| `getIncomers`/`getOutgoers` | Connection drag, validation | O(1) |
| `topologicalSort()` | Consumer evaluates graph | O(V+E), cached |
| `wouldCreateCycle()` | Every pointer move during drag | O(k), early termination |
| `getAffectedEntities()` | Consumer re-evaluates | O(k), uses cached topo sort |

**Tasks:**

- [ ] Adjacency index (incremental, maintained alongside store)
- [ ] Graph queries (getIncomers, getOutgoers, walkUpstream, walkDownstream)
- [ ] Edge queries (getConnectedEdges, getInputEdges, getOutputEdges)
- [ ] Structural queries (getRoots, getLeaves, getConnectedComponents via Union-Find)
- [ ] Topological sort + execution levels (Kahn's algorithm, cached)
- [ ] Cycle detection + `wouldCreateCycle` for connection validation
- [ ] `allowCycles` prop with automatic prevention
- [ ] Dirty propagation (getAffectedEntities)
- [ ] Node muting/bypass (muteEntity, unmuteEntity, isMuted)
- [ ] Graph mutations (insertOnEdge, bypassEntity, collapseToSubgraph, expandSubgraph)
- [ ] Graph validation (validate, isGraphComplete, getCompatiblePorts)
- [ ] `getReadyEntities` for parallel execution scheduling
- [ ] Tests for all graph operations

### Phase 9: Entity Model Refactor

**Goal:** Rename nodes→entities in API, make ports optional, add entity status rendering.

- [ ] Rename `nodes` → `entities` in all types, store, components, props
- [ ] Rename `onNodesChange` → `onEntitiesChange`
- [ ] Rename `nodeTypes` → `entityTypes`
- [ ] Make `inputs`/`outputs` (ports) optional on all entity types
- [ ] Add `data.status` and `data.statusMessage` to entity data
- [ ] Status rendering: red/amber border, pulse indicator, green flash
- [ ] Add `frame` as proper built-in type (upgrade from current `group`)
- [ ] Ensure draw, text, image, video, mesh entity types are structurally supported

### Phase 10: Text Entity

**Goal:** Rich text block entity done really well. Accessibility, keyboard navigation, screen reader support.

- [ ] Text entity type: rich text blocks on canvas
- [ ] MSDF rendering for display mode (read-only, GPU-rendered)
- [ ] DOM contenteditable overlay for edit mode (on double-click / focus)
- [ ] Keyboard navigation: Tab between entities, Enter to edit, Escape to exit
- [ ] Screen reader: ARIA labels, live regions for status changes
- [ ] Copy/paste text content
- [ ] Text as shape type inside draw entities (`data.shapes[]`)
- [ ] Font selection (within supported MSDF fonts)

### Phase 11: Image Entity

**Goal:** Image on canvas done really well. Proper loading, resolution management, LOD.

- [ ] Image entity type: image rendered as Three.js textured quad
- [ ] Async image loading with placeholder/skeleton
- [ ] Resolution management: thumbnail at zoom-out, full res when zoomed in
- [ ] Drag-and-drop from filesystem
- [ ] Paste from clipboard
- [ ] Image resize handles
- [ ] Optional ports for graph participation (source node with image output)
- [ ] Memory management: dispose textures when off-screen

### Phase 12: 3D Mesh Entity

**Goal:** 3D object on canvas. Orbit controls, proper lighting.

- [ ] Mesh entity type: Three.js scene-in-scene
- [ ] Orbit controls (rotate, zoom, pan within the entity bounds)
- [ ] Default lighting setup (ambient + directional)
- [ ] Display mode: static thumbnail (rendered to texture)
- [ ] Interactive mode: live Three.js scene as DOM overlay
- [ ] glTF/GLB loading
- [ ] Optional ports for graph participation
- [ ] Lazy loading: Three.js scene only mounted when needed

### Phase 13: Video Entity

**Goal:** Video on canvas. Playback controls, lazy loading.

- [ ] Video entity type: `<video>` element as DOM overlay
- [ ] Display mode: poster frame / thumbnail in WebGL
- [ ] Interactive mode: live `<video>` with playback controls
- [ ] Lazy loading: video element mounted only when visible + active
- [ ] Multiple video entities: only ~5 live `<video>` elements at a time
- [ ] Optional ports for graph participation
- [ ] Seek, play/pause, volume controls

### Phase 14: Draw Entity

**Goal:** Shapes, SVG paths, freeform drawing. The most complex rendering work.

- [ ] Draw entity type: contains shapes as `data.shapes[]`
- [ ] Shape primitives: rect, ellipse, path (Three.js ShapeGeometry + SDF shaders)
- [ ] SVG path support (THREE.SVGLoader → ShapePath → ShapeGeometry)
- [ ] Text as shape type within draw entities
- [ ] Freeform drawing (capture points → line geometry)
- [ ] Boolean path operations via CSG library (three-csg-ts or three-bvh-csg)
- [ ] Shape manipulation: resize handles, rotation
- [ ] Optional ports for graph participation
- [ ] Fill, stroke, gradients, opacity per shape

### Phase 15: Preview System

**Goal:** Built-in preview renderers for default nodes and consumer entity types.

- [ ] `PreviewRenderer` interface: `thumbnail()` + `mount()`
- [ ] Image preview renderer (Three.js CanvasTexture on quad)
- [ ] 3D preview renderer (Three.js scene-in-scene, lazy-loaded)
- [ ] Video preview renderer (`<video>` DOM overlay, lazy-loaded)
- [ ] Display/interactive mode switching (thumbnail when idle, live when active)
- [ ] `previewRenderers` extension point for consumer-provided renderers
- [ ] Preview caching (thumbnail textures cached, regenerated on data change)
- [ ] `usePreview()` hook for Level 3 customization escape hatch
- [ ] `slots.preview` for Level 2 customization

### Phase 16: Entity Type Customization

**Goal:** Three-level customization system for consumer entity types.

- [ ] Level 1: Pure declaration rendering (ports + widgets + preview from config)
- [ ] Level 2: Slots system (`slots.preview`, `slots.widgets`, `slots.outputs`, `slots.inputs`)
- [ ] Level 3: Full escape hatch (`render: 'custom'`, `Component` prop)
- [ ] `usePreview()` hook for Level 3
- [ ] Auto-generated widgets from input declarations (Level 1)
- [ ] Preview ownership: always Kookie Flow's responsibility regardless of level

### Phase 17: Polish & Production

**Goal:** Production ready

- [ ] GPU-based hit testing (color picking) - alternative to quadtree if needed
- [ ] Virtual DOM pooling for labels (if DOM becomes bottleneck)
- [ ] Memory management (dispose textures)
- [ ] Performance profiling & benchmarks
- [ ] Accessibility (keyboard navigation, ARIA) — started in Phase 10
- [ ] Documentation site
- [ ] Examples gallery

> **Note:** Core performance work (quadtree, selection optimization) moved to Phase 3.5

---

## Technical Decisions

### Why R3F over raw WebGL or Pixi.js

| Option           | Pros                                                 | Cons                                                |
| ---------------- | ---------------------------------------------------- | --------------------------------------------------- |
| **Raw WebGL**    | Full control, smaller bundle                         | Massive effort, reinvent everything                 |
| **Pixi.js**      | Great 2D perf, batching                              | No 3D, would need second renderer for mesh previews |
| **Three.js/R3F** | Mature, great tooling, 3D support, React integration | Slight overhead, 3D concepts leak into 2D           |

**Decision:** R3F. The 3D mesh preview feature is a key differentiator. Same WebGL context means no separate canvas per preview. The overhead is minimal and the ecosystem is excellent.

### Why Zustand over Context/Redux

- Fine-grained subscriptions with `subscribeWithSelector`
- No provider nesting required
- Works outside React (imperative API)
- Tiny bundle size (~1KB)
- React Flow uses it, familiar to target users

### Why Instanced MSDF for Text

**Initial approach (Phase 7A):** DOM text overlays. With LOD and culling, aimed for ~50-100 visible labels.

**Problem discovered:** At 1000+ nodes with socket/edge labels enabled, DOM causes 30-40fps drop even with:

- Ref-based updates (no React re-renders)
- RAF throttling
- Viewport culling

The composite layer overhead of hundreds of DOM elements is unavoidable.

**WebGL text options evaluated:**

| Option                    | Pros                                   | Cons                                            |
| ------------------------- | -------------------------------------- | ----------------------------------------------- |
| **troika-three-text**     | Easy API, SDF quality                  | 1 draw call per Text instance → 500+ kills perf |
| **Thomas**                | R3F-native, claims instancing          | Last release June 2023, risky dependency        |
| **three-msdf-text-utils** | Good shader, maintained                | No instancing (1 mesh per label)                |
| **Canvas-to-texture**     | Simple                                 | Blurry on zoom, expensive updates               |
| **Custom instanced MSDF** | 1 draw call for ALL text, full control | Engineering effort                              |

**Decision:** Custom instanced MSDF (Phase 7.5). One `InstancedMesh` where each instance = one glyph quad. 80,000 glyphs = 1 draw call = 60fps.

**What stays in DOM:**

- Interactive widgets (inputs, dropdowns) — require native elements
- Custom node content — user escape hatch
- These are few in number and viewport-culled to ~50-100 max

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

| Layer            | What it handles                                                       | Example                                                 |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| **Core (store)** | Structural operations - cloning, ID remapping, batch insert, quadtree | `store.cloneElements()`, `store.addElements()`          |
| **Plugins**      | Event wiring - thin wrappers that call core methods                   | `useClipboard()` calls `store.copySelectedToInternal()` |
| **User code**    | Data transformation - what to copy, how to serialize, backend sync    | `transformData: (d) => ({ prompt: d.prompt })`          |

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
│   │   ├── DOMLayer.tsx            # Interactive widgets overlay (inputs only)
│   │   ├── TextRenderer.tsx        # Instanced MSDF text (all labels)
│   │   ├── Minimap.tsx             # Overview panel [TODO]
│   │   └── index.ts
│   │
│   ├── core/
│   │   ├── store.ts                # Zustand store
│   │   ├── constants.ts            # Colors, defaults
│   │   ├── spatial.ts              # Quadtree for hit testing
│   │   ├── serialization.ts        # Node/edge serialization utilities
│   │   ├── theme-colors.ts         # Semantic color configuration
│   │   └── index.ts
│   │
│   ├── hooks/
│   │   ├── useGraph.ts             # External state management
│   │   ├── useThemeTokens.ts       # CSS variable token reading
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
│       ├── text-layout.ts          # MSDF glyph positioning, text measurement
│       ├── msdf-shader.ts          # MSDF vertex/fragment shaders
│       ├── style-resolver.ts       # Node size/variant/radius resolution
│       └── index.ts
│
├── fonts/
│   ├── google-sans-regular-msdf.png   # MSDF atlas texture (Regular weight)
│   ├── google-sans-semibold-msdf.png  # MSDF atlas texture (SemiBold weight)
│   ├── GoogleSans-Regular.json        # Glyph metrics (Regular)
│   └── GoogleSans-SemiBold.json       # Glyph metrics (SemiBold)
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
import {
  useClipboard,
  useKeyboardShortcuts,
  useContextMenu,
} from '@kushagradhawan/kookie-flow/plugins';

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
- [x] Core: `cloneElements()` with pre-allocated ID pool, single-pass edge remapping
- [x] Core: `addElements()` with batch state update + batch quadtree insert
- [x] Core: `deleteElements()`, `deleteSelected()`
- [x] Core: `copySelectedToInternal()`, `pasteFromInternal()`, `cutSelectedToInternal()`
- [x] Core: `toObject()`, `getSelectedNodes()`, `getConnectedEdges()`
- [x] Plugin: `useClipboard` (thin wrapper for internal clipboard)
- [x] Plugin: `useKeyboardShortcuts` (configurable key bindings with mod support)
- [x] Plugin: `useContextMenu` (right-click + long-press handling)
- [x] Package exports for `@kushagradhawan/kookie-flow/plugins`
- [x] `preserveExternalConnections` option for paste (reconnect cloned nodes to existing external nodes)
- [x] Edge labels (DOM-based, midpoint positioning via `getEdgePointAtT()`)
- [x] Edge markers (arrow triangles in edge geometry, direction from tangent)
- [x] `EdgeLabelConfig`, `EdgeMarker`, `EdgeMarkerType` types
- [x] `getEdgePointAtT()`, `getEdgeEndpoints()` utilities for edge curve sampling
- [x] Socket labels (DOM-based, positioned adjacent to socket circles)
- [x] `showSocketLabels` prop (default: true, zero overhead when false)
- [x] `showEdgeLabels` prop (default: true, zero overhead when false)
- [x] WebGL text rendering (MSDF) via `TextRenderer.tsx`
- [x] MSDF shader material with instanced glyphs
- [x] Text layout engine (`text-layout.ts`) for glyph positioning
- [x] LOD thresholds per label type (node headers, socket labels, edge labels)
- [x] `textRenderMode` prop ("dom" | "webgl") for render mode selection
- [x] Socket label vertical alignment fix (centered with socket circles)
- [x] Minimap component (Canvas 2D, corner positioning)
- [x] Minimap node rendering (solid rectangles, selected highlight)
- [x] Minimap viewport indicator (draggable rectangle)
- [x] Minimap click-to-pan and drag-to-move-viewport
- [x] Minimap `zoomable` prop (minimap zooms with main canvas)
- [x] Minimap configurable: position, size, colors, interactive mode
- [x] Kookie UI theme integration (`useThemeTokens()` hook, `ThemeContext`)
- [x] Styling props: `size`, `variant`, `radius` (wired to shader)
- [x] Styling props: `header`, `accentHeader` (wired to shader)
- [x] Per-node `color` override (wired to shader via per-instance attributes)
- [x] Shadow SDF for `classic` variant (with geometry expansion for unclipped shadows)
- [x] 26 accent colors support (`AccentColor` type)
- [x] Style resolution (`resolveNodeStyle()`, `style-resolver.ts`)
- [x] Semantic color tokenization (grid, edges, sockets, selection box, text)
- [x] Fallback tokens for standalone mode (no Kookie UI required)
- [x] Typography tokens (`--font-size-N`, `--line-height-N`) in ThemeTokens
- [x] Socket layout tokenization (`--space-6`, `--space-7` for row/widget heights)
- [x] `ResolvedSocketLayout` interface and `resolveSocketLayout()` function
- [x] `calculateMinNodeHeight()` for automatic node height calculation
- [x] Socket widgets infrastructure (types, built-in widgets, WidgetsLayer)
- [x] Built-in widgets: SliderWidget, NumberWidget, SelectWidget, CheckboxWidget, TextWidget, ColorWidget
- [x] Imperative API via ref (`KookieFlowInstance` type)
- [x] `fitView()` with options (padding, nodes filter, minZoom, maxZoom)
- [x] `getViewport()`, `setViewport()`, `zoomIn()`, `zoomOut()`, `setCenter()`
- [x] `getNodes()`, `getEdges()`, `getSelectedNodes()`, `getSelectedEdges()`

**Phase 7C: Grouping & Annotations**
- [x] Node grouping/frames (`parentId`, `collapsed` on Node interface)
- [x] Group types: `GroupNode`, `CommentNode`, `RerouteNode` with type guards
- [x] Store: `collapsedGroupIds: Set<string>`, group actions (`toggleGroupCollapse`, `expandGroup`, `collapseGroup`, etc.)
- [x] Grouping utilities (`getGroupChildren`, `getGroupDescendants`, `isNodeHidden`, `calculateGroupBounds`)
- [x] `Nodes.tsx`: Skip collapsed children, comment, and reroute nodes
- [x] `RerouteNodes.tsx`: InstancedMesh renderer for waypoint circles
- [x] `CommentsContainer`: DOM-based sticky note rendering in DOMLayer
- [x] Edge interface: `reroutes?: string[]` for waypoint support
- [x] Imperative API: Group methods on `KookieFlowInstance`

> **Note:** Full styling plan and remaining tasks tracked in [STYLING.md](./STYLING.md)

### Next Immediate Tasks

**Phase 7E: Connection Events** (next up)
- `onConnectStart` callback when connection drag begins
- `onConnectEnd` callback with drop position and validity
- Enables "add node on edge drop" pattern

**Phase 8: Graph Engine** (first major new work)
- Adjacency index, topo sort, execution levels, cycle detection
- Pure data structure work, zero rendering changes
- See Phase 8 section for full spec

**Phase 9+: Entity pivot** (after graph engine)
- Entity model refactor → Text → Image → 3D Mesh → Video → Draw → Preview System → Customization
- Each entity type done well before moving to the next

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

### Profiling Results (January 2026)

**Test: Dragging 1000 nodes simultaneously**

| Component        | CPU % | Notes                              |
| ---------------- | ----- | ---------------------------------- |
| Quadtree updates | 0.0ms | Sub-millisecond, not a bottleneck  |
| Edges.useFrame   | 27.4% | Expected - rebuilds edge geometry  |
| bufferSubData    | 19.3% | GPU upload for edge/socket buffers |

**Key findings:**

- **120fps maintained** with 1000 nodes during drag - acceptable performance
- **Quadtree is O(log n)** and verified working via console.log (too fast to register in profiler)
- **Pan/zoom has no geometry rebuilds** - `uZoom` uniform handles zoom in shaders
- **Edge rebuild is expected** - when nodes move, edges must recalculate control points

**Future optimizations (if scaling to 10k+ nodes):**

1. **Throttle edge updates** - Skip frames during rapid drag (every 2nd/3rd frame)
2. **GPU-based node positions** - Store positions in texture, read in vertex shader
3. **Partial edge updates** - Only rebuild edges connected to moved nodes
4. **LOD for edges** - Simplify curves at low zoom levels

---

_Last updated: February 2026_
