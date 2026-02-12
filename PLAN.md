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
├── inputs[], outputs[]          (optional — graph participation via sockets)
│   └── Socket
│       ├── name, type, id
│       ├── widget?              (inline DOM control — slider, text, select, etc.)
│       ├── preview?             (inline or block data visualization — WebGL or custom)
│       └── row?                 (custom row component — full escape hatch)
├── parentId                     (optional — spatial hierarchy)
├── type                         (determines rendering + behavior)
└── data                         (type-specific payload)
    ├── status                   (optional — 'error' | 'warning' | 'running' | 'success')
    └── statusMessage            (optional — human-readable status text)
```

### Two Independent Layers

| Layer                 | Controls                           | Example                              |
| --------------------- | ---------------------------------- | ------------------------------------ |
| **Spatial hierarchy** | Parent/child, containment, z-order | A Frame contains nodes visually      |
| **Graph topology**    | Sockets, edges, data resolution    | Node A's output feeds Node B's input |

These coexist but don't implicitly affect each other. Dragging a node out of a frame doesn't disconnect its edges. Deleting an edge doesn't move the node.

### What a Connection Means

At the Kookie Flow level, an edge is **purely structural metadata**:

> "Socket A on Entity X is linked to Socket B on Entity Y."

Kookie Flow:

- **Stores** the edge: `{ source, sourceSocket, target, targetSocket }`
- **Renders** the visual curve between the two sockets
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

| Type      | What It Renders                                      | Sockets?             | Status      | Notes                              |
| --------- | ---------------------------------------------------- | -------------------- | ----------- | ---------------------------------- |
| `default` | Standard node (header + sockets + widgets + preview) | Yes (inputs/outputs) | Implemented | The classic node graph node        |
| `text`    | Rich text block                                      | Optional             | Implemented | MSDF display, hidden textarea edit |
| `frame`   | Spatial container / group                            | Optional             | Implemented | Parent for other entities          |
| `comment` | Sticky note annotation                               | No                   | Implemented | Annotation only                    |
| `reroute` | Edge waypoint                                        | Yes (passthrough)    | Implemented | Graph routing                      |
| `draw`    | Shapes, SVG paths, freeform drawing                  | Optional             | Planned     | Contains shapes as `data.shapes[]` |
| `image`   | Image on canvas                                      | Optional             | In Progress | Three.js texture on quad           |
| `video`   | Video on canvas                                      | Optional             | Planned     | DOM overlay, lazy-loaded           |
| `mesh`    | 3D object on canvas                                  | Optional             | Planned     | Three.js scene-in-scene            |

`image`, `video`, `mesh` entities ARE the visual — they don't preview themselves. Preview is for `default` nodes (and custom consumer types) that _produce_ visual output. The standalone `image` entity and a node with `preview: true` on an image socket are different things that share the same `ImageTextureManager` infrastructure.

### Entity Type Customization (Three Levels)

**Level 1: Pure Declaration (80% of nodes).** Consumer declares sockets with optional widgets and previews. Kookie Flow renders everything.

```tsx
const GenerateImageNode: EntityTypeDefinition = {
  type: 'generate-image',
  inputs: [
    { name: 'prompt', type: 'string', widget: 'textarea', rows: 3 },
    { name: 'model', type: 'string', widget: 'select', options: ['DALL-E 3', 'SDXL'] },
  ],
  outputs: [
    { name: 'image', type: 'image', preview: true },
  ],
};
```

**Level 2: Custom Row / Preview Components (15% of nodes).** Consumer overrides specific parts — a socket row, or the block preview content — while Kookie Flow handles everything else.

```tsx
const CompareNode: EntityTypeDefinition = {
  type: 'compare',
  inputs: [
    { name: 'reference', type: 'image', row: ReferenceImageRow },  // custom row component
  ],
  outputs: [
    { name: 'images', type: 'image', preview: { component: ImageGridPreview } },  // custom preview
  ],
};
```

**Level 3: Full Escape Hatch (5% of nodes).** Consumer provides a `component` and owns the interior.

```tsx
const WildNode: EntityTypeDefinition = {
  type: 'wild',
  inputs: [{ name: 'In', type: 'any' }],
  outputs: [{ name: 'Out', type: 'any' }],
  component: ({ id, data, selected, onChange }) => (
    <div className="my-wild-layout">
      <MyEntirelyCustomThing data={data} onChange={onChange} />
    </div>
  ),
};
```

Kookie Flow still handles: entity frame/border, socket hit testing, edge connections, selection, dragging, status rendering. Consumer controls what's inside.

### Socket Row Composition

Every node is a vertical stack of **socket rows**. Each row is a container with optional slots:

```
[dot]  [label?]  [preview?]  [widget?]
```

The library handles layout, spacing, socket positioning, connection logic, and hide-when-connected behavior. The consumer controls which slots are active:

```typescript
// Geometry node — label + slider widget
{ name: 'factor', type: 'float', widget: 'slider', min: 0, max: 1 }

// AI node — label + inline preview + upload widget
{ name: 'image', type: 'image', preview: 'inline', widget: 'file-upload' }

// Minimal — just a connectable dot
{ name: 'value', type: 'float', label: false }

// Full override — consumer provides custom row component
{ name: 'reference', type: 'image', row: ReferenceImageRow }
```

`widget` = how the user provides/edits a socket's value (DOM, interactive).
`preview` = how the user sees a socket's value (WebGL default, visual).
`row` = escape hatch, consumer replaces the entire row content (library still handles the socket dot and connections).

### Preview System _(Planned)_

> Not yet implemented. Preview lives on **sockets**, not on the entity. It's the visual counterpart to `widget`: widget is "how you edit a value" (DOM), preview is "how you see a value" (WebGL default).

**Preview is a socket-level opt-in.** The consumer adds `preview: true` (or `preview: { height: 300 }`) to any socket. The library handles rendering, positioning within the entity body, LOD, culling, and texture management.

```typescript
// Consumer opts in — library handles everything
outputs: [{ name: 'image', type: 'image', preview: true }]

// With explicit height
outputs: [{ name: 'image', type: 'image', preview: { height: 300 } }]

// Consumer overrides the preview content entirely
outputs: [{ name: 'images', type: 'image', preview: { component: MultiImageGrid } }]
```

**Two forms of preview:**

| Form       | Where                     | Size             | Use case                              |
| ---------- | ------------------------- | ---------------- | ------------------------------------- |
| `'inline'` | Inside the socket row     | Small thumbnail  | Input socket showing what's flowing in |
| `true`     | Block region in node body | Configurable     | Output socket showing produced data    |

**Default rendering by socket type:**

| Socket type | Default renderer          | Technique          | Loaded              |
| ----------- | ------------------------- | ------------------ | ------------------- |
| `image`     | WebGL textured quad       | ImageTextureManager | Always (shared w/ image entities) |
| `mesh`      | Three.js scene-in-scene  | Render-to-texture  | Lazy (on first use) |
| `video`     | `<video>` element        | DOM overlay        | Lazy (on first use) |

The socket type defines the default renderer. The consumer doesn't choose the rendering strategy — the library does. The consumer overrides with `preview: { component: Custom }` only when they want something non-default (e.g., image grid, LLM text output, charts).

**Shared infrastructure:** Block previews for `image` sockets use the same `ImageTextureManager` as standalone image entities — same LOD pipeline, same texture caching, same ref-counting. Different rendering component (`preview-layer.tsx` vs `image-entities.tsx`), shared utility.

**The library provides the highway, not the car.** Kookie Flow imposes structure (socket rows, preview slot positioning, entity layout). It ships default WebGL renderers for common types. But the preview area is a slot the consumer can fill with anything: one image, four images, DOM content, a 3D viewport, scrollable text. The library lays down the highway — the consumer decides what car to drive.

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

// Simple geometry node — pure declaration, label + widget per socket
const AddNode = defineNode({
  type: 'math/add',
  label: 'Add',
  inputs: [
    Input.float('a', { default: 0, widget: 'slider', min: -10, max: 10 }),
    Input.float('b', { default: 0, widget: 'number' }),
  ],
  outputs: [
    Output.float('result'),
  ],
});

// AI node — output with block preview, input with upload widget
const GenerateImageNode = defineNode({
  type: 'ai/generate-image',
  label: 'Generate Image',
  inputs: [
    Input.string('prompt', { widget: 'textarea', rows: 3 }),
    Input.string('model', { widget: 'select', options: ['DALL-E 3', 'SDXL', 'Midjourney'] }),
  ],
  outputs: [
    Output.image('image', { preview: true }),  // block preview, WebGL default
  ],
});

// Image-to-image — input preview + output preview
const Img2ImgNode = defineNode({
  type: 'ai/img2img',
  label: 'Image to Image',
  inputs: [
    Input.image('image', { widget: 'file-upload', preview: 'inline' }),  // small thumbnail in row
    Input.string('prompt', { widget: 'textarea' }),
    Input.float('strength', { widget: 'slider', min: 0, max: 1 }),
  ],
  outputs: [
    Output.image('result', { preview: true }),
  ],
});

// Custom preview content — consumer provides component for the preview area
const MultiGenNode = defineNode({
  type: 'ai/multi-gen',
  label: 'Multi Generate',
  inputs: [
    Input.string('prompt', { widget: 'textarea' }),
  ],
  outputs: [
    Output.image('images', { preview: { height: 400, component: ImageGridPreview } }),
  ],
});

// Custom row — consumer overrides entire socket row
const ReferenceNode = defineNode({
  type: 'ai/reference',
  label: 'Reference Image',
  inputs: [
    Input.image('reference', { row: ReferenceImageRow }),  // full row override
    Input.float('weight', { widget: 'slider', min: 0, max: 1 }),
  ],
  outputs: [
    Output.image('result', { preview: true }),
  ],
});

// Full escape hatch — consumer owns entire interior
const CustomNode = defineNode({
  type: 'custom/wild',
  inputs: [{ name: 'In', type: 'any' }],
  outputs: [{ name: 'Out', type: 'any' }],
  component: ({ id, data, selected, onChange }) => (
    <div className="my-wild-layout">
      <MyEntirelyCustomThing data={data} onChange={onChange} />
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

**Current status:** Phases 1-8 complete. All sub-phases complete including Phase 7E (Connection Events) with demo and docs.

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
// In constants.ts — DEFAULT_SOCKET_TYPES grouped by similarity, scale-10 tokens
export const DEFAULT_SOCKET_TYPES = {
  // Numeric — blue
  float: { name: 'Float', color: '--blue-10', widget: 'slider', min: 0, max: 1, step: 0.01 },
  int:   { name: 'Integer', color: '--blue-10', widget: 'number', min: 0, max: 100, step: 1 },
  // Text — amber
  string: { name: 'String', color: '--amber-10', widget: 'text' },
  enum:   { name: 'Enum', color: '--amber-10', widget: 'select' }, // options per-socket
  // Toggle — orange
  boolean: { name: 'Boolean', color: '--orange-10', widget: 'checkbox' },
  // Color — pink
  color: { name: 'Color', color: '--pink-10', widget: 'color' },
  // Media — purple (connection-only, no widget)
  image: { name: 'Image', color: '--purple-10' },
  mask:  { name: 'Mask', color: '--purple-10' },
  // 3D — violet
  mesh: { name: 'Mesh', color: '--violet-10' },
  // Signal — cyan
  signal: { name: 'Signal', color: '--cyan-10' },
  // ML pipeline — teal
  latent: { name: 'Latent', color: '--teal-10' },
  model:  { name: 'Model', color: '--teal-10' },
  conditioning: { name: 'Conditioning', color: '--teal-10' },
  clip: { name: 'CLIP', color: '--teal-10' },
  vae:  { name: 'VAE', color: '--teal-10' },
  // Wildcard — gray
  any: { name: 'Any', color: '--gray-10' },
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
      isValid: boolean; // Did it land on a valid socket?
      source: {
        // Where the drag started
        nodeId: string;
        socketId: string;
        isInput: boolean;
      };
      position: XYPosition; // World coordinates of drop point
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
      setNodes((nodes) => [
        ...nodes,
        {
          id,
          position: state.position,
          data: { label: 'New Node' },
          inputs: [{ id: 'in', name: 'Input', type: 'any' }],
        },
      ]);

      // Connect source to new node
      const edge = state.source.isInput
        ? {
            source: id,
            sourceSocket: 'out',
            target: state.source.nodeId,
            targetSocket: state.source.socketId,
          }
        : {
            source: state.source.nodeId,
            sourceSocket: state.source.socketId,
            target: id,
            targetSocket: 'in',
          };

      setEdges((edges) => [...edges, { id: `edge-${Date.now()}`, ...edge }]);
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

- [x] Types: Add `OnConnectStartParams`, `ConnectionEndState` interfaces
- [x] Types: Add `onConnectStart`, `onConnectEnd` to `KookieFlowProps`
- [x] Store: `screenToWorld()` already exists as utility (no new store method needed)
- [x] InputHandler: Fire `onConnectStart` when connection begins
- [x] InputHandler: Fire `onConnectEnd` with position and validity
- [x] Props: Thread callbacks through component layers
- [x] Demo: Add "add node on edge drop" example
- [x] Docs: Update README with connection events

### Phase 8: Graph Engine ✅ COMPLETE

**Goal:** Make Kookie Flow understand graph topology — who connects to whom, what order to traverse, where the cycles are.

**Core Data Structure: Adjacency Index**

Maintained incrementally alongside the entity/edge arrays in the Zustand store:

```typescript
interface AdjacencyIndex {
  outgoing: Map<string, Map<string, Edge[]>>; // entityId → portId → edges leaving
  incoming: Map<string, Map<string, Edge[]>>; // entityId → portId → edges arriving
  byEntity: Map<string, Edge[]>; // all edges touching an entity
  topologyVersion: number; // incremented ONLY on edge/entity add/remove
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
flow.topologicalSort(); // flat execution order — O(V+E), cached
flow.executionLevels(); // grouped by level (parallel execution) — O(V+E), cached
flow.getReadyEntities(completed); // what can start next given completed set — O(k)
flow.getExecutionOrder('output-1'); // subgraph needed for one specific node
```

**Cycle Detection & Prevention:**

```typescript
flow.hasCycles(); // O(1) if topo sort cached
flow.findCycles(); // string[][] (node IDs per cycle)
flow.wouldCreateCycle(src, tgt); // O(k) DFS, called every pointer move during connection drag
// Automatic prevention: <KookieFlow allowCycles={false} /> rejects cycle-creating connections
```

**Dirty Propagation:**

```typescript
flow.getAffectedEntities('node-3'); // downstream in topo order — O(k)
flow.getAffectedEntities(['node-3', 'node-7']); // batch, deduplicated
```

**Node Muting/Bypass:**

```typescript
flow.muteEntity('filter-1'); // logically bypass, inputs pass through to outputs
flow.unmuteEntity('filter-1');
// Visual: dimmed, dashed edges. Topo sort skips muted nodes.
```

**Graph Mutations:**

```typescript
flow.insertOnEdge('edge-5', newNode); // A→B becomes A→new→B
flow.bypassEntity('filter-1'); // A→filter→B becomes A→B
flow.collapseToSubgraph([...ids]); // create compound node
flow.expandSubgraph('group-1'); // inverse
```

**Graph Validation:**

```typescript
flow.validate(); // all structural issues
flow.isGraphComplete(); // all required ports connected?
flow.getCompatiblePorts(src, port); // valid targets during connection drag
```

**Performance:**

| Operation                   | When                           | Cost                        |
| --------------------------- | ------------------------------ | --------------------------- |
| Add/remove edge             | User connects/disconnects      | 3 Map ops + version++       |
| `getIncomers`/`getOutgoers` | Connection drag, validation    | O(1)                        |
| `topologicalSort()`         | Consumer evaluates graph       | O(V+E), cached              |
| `wouldCreateCycle()`        | Every pointer move during drag | O(k), early termination     |
| `getAffectedEntities()`     | Consumer re-evaluates          | O(k), uses cached topo sort |

**Tasks:**

- [x] Adjacency index (incremental, maintained alongside store)
- [x] Graph queries (getIncomers, getOutgoers, walkUpstream, walkDownstream)
- [x] Edge queries (getConnectedEdges, getInputEdges, getOutputEdges)
- [x] Structural queries (getRoots, getLeaves, getConnectedComponents via Union-Find)
- [x] Topological sort + execution levels (Kahn's algorithm, cached)
- [x] Cycle detection + `wouldCreateCycle` for connection validation
- [x] `allowCycles` prop with automatic prevention
- [x] Dirty propagation (getAffectedEntities)
- [x] Node muting/bypass (muteEntity, unmuteEntity, isMuted)
- [x] Graph mutations (insertOnEdge, bypassEntity, collapseToSubgraph, expandSubgraph)
- [x] Graph validation (validate, isGraphComplete, getCompatiblePorts)
- [x] `getReadyEntities` for parallel execution scheduling
- [x] Tests for all graph operations

### Phase 9: Entity Model Refactor

**Goal:** Rename nodes→entities in API, make ports optional, add entity status rendering.

- [x] Rename `nodes` → `entities` in all types, store, components, props
- [x] Rename `onNodesChange` → `onEntitiesChange`
- [x] Rename `nodeTypes` → `entityTypes`
- [x] Make `inputs`/`outputs` (ports) optional on all entity types
- [x] Add `data.status` and `data.statusMessage` to entity data
- [x] Status rendering: red/amber border, pulse indicator, green flash
- [x] Add `frame` as proper built-in type (upgrade from current `group`)
- [x] Ensure draw, text, image, video, mesh entity types are structurally supported

### Phase 9.5: Selection Box + Resize Handles

**Goal:** Standardized selection indicator and resize interaction across all entity types. All entities are resizable by default.

Currently selection is handled per-renderer (border color changes in the SDF node body shader). This phase extracts selection into a universal, consistent visual system that works for every entity type — including ones with no visible body (text, image). It also makes `entity.height` a first-class stored value rather than a computed-only field.

**Selection box:**

- [x] Selection box renderer: instanced mesh for selection outlines (lightweight SDF outline, no fill)
- [x] Selection outline renders at constant screen-space thickness (zoom-independent)
- [x] Multi-select: selection box visible on all selected entities
- [x] Remove per-renderer selection visuals (node body `aSelected`/`aHovered` border color change → universal box)
- [x] Hover indicator also moves to selection box layer (thin outline on hover)

**Resize handles:**

- [x] All entities are resizable by default (X and Y)
- [x] Corner handle interaction: drag to resize both width and height
- [x] Edge handle interaction: drag to resize single axis
- [x] `resizable` property on Entity: `boolean | { width?: boolean; height?: boolean }` for opt-out
- [x] Emit `EntityChange` of type `'dimensions'` on resize

**Height as first-class stored value:**

- [x] `entity.height` becomes a persisted field (currently computed-only for default nodes)
- [x] Socket layout computation becomes a **minimum height constraint**, not the actual height
- [x] Render height: `entity.height ?? computedMinHeight` — explicit height takes precedence
- [x] Same for width: `entity.width ?? DEFAULT_ENTITY_WIDTH`, with min width from content
- [x] When user resizes via handles, explicit `entity.width`/`entity.height` are written
- [x] "Fit to content" action: clears explicit height, reverts to computed minimum

**Minimum size constraints:**

- [x] Default entities: min height = socket layout computed height, min width = reasonable minimum
- [x] Frame entities: absolute minimum (e.g. 100x60)
- [ ] Text entities: depends on sizing mode (Phase 10)
- [x] Comment entities: absolute minimum (e.g. 80x40)
- [x] Constraints enforced during resize drag (clamped before committing)

**Implementation notes (completed Feb 2026):**

Files created:

- `components/entity-selection.tsx` — Two instanced meshes: (1) SDF outline-only rounded-rect for selection/hover outlines with per-instance `aSize`, `aType`, `aOutlineWidth`, `aPadding`; (2) SDF filled rounded-rect for 8 resize handles per selected entity. Both use screen-space constant rendering (`size / viewport.zoom`). Dirty flag pattern with store subscriptions (`selectedEntityIds`, `hoveredEntityId`, `entities`, `viewport`). Pre-allocated buffers with 1.5x growth. Handles hidden during drag/connect/box-select via `getInteractionMode()` side-channel.
- `components/interaction-state.ts` — Side-channel module (`getInteractionMode()`/`setInteractionMode()`) for communicating interaction state to renderers without Zustand state changes.

Files modified:

- `types/index.ts` — Added `resizable?: boolean | { width?: boolean; height?: boolean }` to Entity interface.
- `core/constants.ts` — Added `MIN_ENTITY_WIDTH`, `MIN_ENTITY_HEIGHT`, `MIN_FRAME_WIDTH/HEIGHT`, `MIN_COMMENT_WIDTH/HEIGHT`, `RESIZE_HANDLE_SIZE`, `RESIZE_HANDLE_HIT_TOLERANCE`, `SELECTION_OUTLINE_WIDTH`, `SELECTION_OUTLINE_PADDING`, `HOVER_OUTLINE_WIDTH`.
- `core/theme-colors.ts` — Added `entitySelection` semantic colors (selected, hover, handleFill, handleBorder).
- `components/nodes.tsx` — Removed `aSelected`/`aHovered` attributes, `uHoveredColor`/`uSelectedColor`/`uHoveredBorderColor`/`uSelectedBorderColor` uniforms, selection/hover border logic from SDF shader. Status border rendering preserved.
- `core/store.ts` — Added `updateEntityDimensions(id, width, height, position?)` (mutates entity, updates entityMap, quadtree, socket quadtree, bumps positionVersion, populates `_movedEntityIds`). Added `fitEntityToContent(id)`. Fixed `setEntities` to bump `positionVersion`.
- `components/kookie-flow.tsx` — Full resize interaction: `getResizeHandleAt()` hit testing, resize state machine in pointer handlers, per-handle resize math (8 directions with min-size clamping and snap-to-grid), cursor feedback (`nwse-resize`/`nesw-resize`/`ns-resize`/`ew-resize`), `setInteractionMode()` calls at all transitions. Emits both position + dimensions `EntityChange` on resize end. Also fixed: drag end now emits position changes via `onEntitiesChange`.
- `components/edges.tsx` — Fixed stale `entityMapRef`: now reads `entityMap` from `store.getState()` in useFrame instead of caching as ref (was only updating on `entities.length` change, missed same-length `setEntities` calls).
- `index.ts` — Exported new constants.

Bugs found and fixed during implementation:

1. **DOM/socket/edge desync during resize**: `updateEntityDimensions` initially didn't bump `positionVersion`, populate `_movedEntityIds`, or update socket quadtree for width changes. Edges/sockets/widgets depend on these signals. Fixed by adding all three.
2. **Position jumps on mouse release (top/left handles)**: Resize end only emitted 'dimensions' change. External state (via controlled component pattern) only updated dimensions, then FlowSync synced stale positions back. Fixed by emitting both position and dimensions changes.
3. **Move-then-resize causes jump to original position**: Drag end never emitted position changes to `onEntitiesChange`. External state retained original positions. Any subsequent `onEntitiesChange` round-trip overwrote the store. Fixed by emitting position changes on drag end.
4. **`setEntities` missing positionVersion bump**: When FlowSync calls `setEntities` with same-length entities but different positions, edges (subscribing to `entities.length` + `positionVersion`) never detected the change. Fixed.
5. **Edges permanently stuck after resize-then-move**: `entityMapRef` in edges.tsx was only updated when `entities.length` changed. `setEntities` creates a new Map without changing count. All entity lookups returned stale data. Fixed by reading entityMap from `store.getState()` in useFrame.

Performance: No regressions. Resize has same per-frame cost as drag (O(1) entity update + O(k) edge updates via `_movedEntityIds`). Net savings from removing 2 per-instance attributes + 2 store subscriptions from nodes.tsx. EntitySelection outline rendering is O(selected + hovered), not O(total entities).

### Phase 10: Text Entity

**Goal:** Standalone text entity — plain text on canvas with word wrap, auto-sizing, and Figma-quality inline editing. No visual container (no rounded rect body), just text within a bounding box. The editing experience must be seamless — entering and exiting edit mode should be invisible to the user.

Architecture note: Text, Image, Video, and Mesh follow a "standalone vs. embedded" pattern. A Text entity exists independently on canvas. The same `TextEntityData` interface is reused when text appears as a shape inside a Draw entity (`data.shapes[{ type: 'text', ...TextEntityData }]`). This phase covers the standalone entity only.

#### Rendering Architecture: Instanced MSDF (revised from Canvas2D → Texture)

**Original decision (10A–10F):** Canvas2D rasterization → `THREE.CanvasTexture` → WebGL quad. This was superseded by instanced MSDF rendering in the 10B/10C rewrite.

**Why MSDF won (revised):** The original concern was font matching between MSDF display and contenteditable editing. Phase 10G solves this by eliminating the contenteditable overlay entirely — the hidden textarea pattern (Figma, Monaco, Google Docs) makes all visual rendering happen in WebGL via the same MSDF pipeline. No DOM text is ever visible, so there's zero font mismatch.

**Current architecture:**
- **Display:** Instanced MSDF rendering via `text-entities.tsx` — single draw call for all text entities, crisp at any zoom, uses the same `text-layout.ts` glyph pipeline as labels
- **Editing:** Hidden `<textarea>` captures keyboard/IME/clipboard natively. All visual rendering (text, cursor, selection) in WebGL. Zero visual shift entering/exiting edit mode
- **Word wrap:** `wrapTextMSDF()` in `text-layout.ts` using BMFont glyph metrics — same measurements for display and editing cursor positioning
- **Z-order:** MSDF quads participate in scene draw order like any other entity
- **Graph participation:** Text entities can have optional `inputs`/`outputs` sockets, making them first-class graph participants (e.g., a prompt text feeding into a model node). Sockets are vertically centered within the text entity bounds via bidirectional `centerOffset = (entityHeight - computedHeight) / 2` in all rendering paths (sockets, edges, labels, widgets)

**Why not DOM?** DOM elements in `DOMLayer` always render on top of the WebGL canvas. A DOM-based text entity can never appear behind a WebGL-rendered node. Z-ordering is broken — dealbreaker for a freeform canvas where entities overlap.

#### Implementation Checklist

**10A: Types & Entity Plumbing** ✅
- [x] Expanded `TextEntityData` in `types/index.ts` with `content` (required), `fontSize`, `fontFamily`, `fontWeight`, `textColor`, `textAlign`, `lineHeight`, `letterSpacing`
- [x] Added `isTextEntity()` type guard
- [x] Skip `entity.type === 'text'` in `nodes.tsx` render loop
- [x] Added `'data'` change type to `EntityChange` union for text content updates
- [x] Added text constants to `constants.ts` (DEFAULT_TEXT_WIDTH/HEIGHT, MIN_TEXT_WIDTH/HEIGHT, etc.)

**10B: Text Utilities (`text-texture.ts`, `text-layout.ts`)** ✅
- [x] `TextStyleConfig` interface — single source of truth for text style resolution
- [x] `resolveTextStyle(data, defaults?)` resolves entity data + theme defaults
- [x] `wrapTextMSDF()` — word wrap using BMFont glyph widths, paragraph splitting, whitespace trimming
- [x] `measureTextBlockMSDF()` — text measurement via MSDF glyph metrics
- [x] `calculateTextAutoHeightMSDF()` — auto-height calculation for text entities
- [x] `populateMultiLineGlyphBuffers()` — character-walking logic for instanced MSDF rendering
- [x] Placeholder rendering ("Type something...") for empty content

**10C: Text Entities WebGL Renderer (`text-entities.tsx`)** ✅
- [x] Instanced MSDF rendering — single `InstancedMesh` per font weight, single draw call
- [x] Pre-allocated `Float32Array` GPU buffers (instance matrices, UV offsets, colors, opacities)
- [x] Viewport frustum culling
- [x] Crisp at any zoom (resolution-independent SDF rendering)
- [x] Proper Y-flip: `mesh.position.set(x + w/2, -(y + h/2), 0)`
- [x] Dirty flag pattern with store subscription (entities, viewport, selection, hidden, editing)
- [x] Keeps rendering during editing — reads live `editingContent` from store (10G)

**10D: Sizing Logic (auto-height only for v1)** ✅
- [x] `calculateTextAutoHeight(content, style, entityWidth)` utility
- [x] Text entities created with `resizable: { width: true, height: false }` — only E/W handles
- [x] Auto-height on resize: width changes → content reflows → height auto-adjusts
- [x] `getMinSize` text case: `MIN_TEXT_WIDTH=40`, `MIN_TEXT_HEIGHT=20`

**10E: Inline Editing (contenteditable)** ✅ → superseded by 10G
- [x] Added `editingEntityId: string | null` to Zustand store (not interaction-state.ts — needs React re-render)
- [x] Timer-based double-click detection in InputHandler (300ms, 5px tolerance)
- [x] `TextEditOverlay` component in DOMLayer (contenteditable div)
- Note: contenteditable caused visible shift entering/exiting edit mode due to CSS vs BMFont metric mismatch. Replaced by hidden textarea pattern in 10G.

**10F: Integration & Polish** ✅
- [x] `T` key creates text entity at viewport center, immediately enters edit mode
- [x] Escape guard: exits text editing before deselecting
- [x] Empty placeholder ("Type something...") at 30% opacity
- [x] Keyboard guard: `isContentEditable` check prevents Delete/Backspace from deleting entity while editing
- [x] Copy/paste works automatically (TextEntityData is plain serializable data)
- [x] Exports: `isTextEntity`, `resolveTextStyle`, `TextStyleConfig`
- [x] Demo page: two sample text entities (one with content, one empty placeholder)

**10G: WebGL-Native Text Editing (Hidden Textarea Pattern)** ✅
- [x] Zustand store: `editingContent`, `editingCursor`, `startEditing()`, `stopEditing()` actions
- [x] `text-cursor-layout.ts` — character position mapping with bidirectional content offset ↔ wrapped line mapping:
  - `buildCharPositionsForEntity()` — builds `CharPositionTable` from entity data using same BMFont metrics as MSDF renderer
  - `getCursorXY()` — cursor position from content offset
  - `getSelectionRects()` — one rectangle per selected visual line
  - `hitTestCharOffset()` — click world coordinates to content offset
  - `contentOffsetToLineColumn()` / `lineColumnToContentOffset()` — for arrow key navigation across wrapped lines
  - Handles `\n` paragraph breaks and trimmed whitespace during word-wrap
- [x] `text-edit-cursor.tsx` — WebGL cursor and selection rendering inside R3F Canvas:
  - Cursor: single `Mesh` with flat color shader, 1.5px wide, 530ms blink interval
  - Selection: `InstancedMesh` (max 50 instances) with accent color at 30% opacity
  - Render order: selection=3, cursor=4
  - `useFrame` reads from store via dirty flags — no React re-renders
  - Blink resets on cursor movement
- [x] `text-edit-overlay.tsx` — rewritten from contenteditable to hidden textarea:
  - Invisible `<textarea>` (opacity 0, 1×1px, pointerEvents none) captures keyboard/IME/clipboard natively
  - Module-level `getEditingTextarea()` accessor for InputHandler sync
  - `onInput` → store sync (editingContent + editingCursor + auto-height)
  - `onSelect` → cursor position sync
  - ArrowUp/Down intercepted for wrapped line navigation (textarea sees flat text)
  - Escape commits and exits, blur commits with RAF delay for click-to-position timing
- [x] `text-entities.tsx` — keeps rendering during editing:
  - Removed `if (editingEntityId === entity.id) continue` skip
  - Reads live `editingContent` from store for edited entity
  - Subscribes to `editingContent` and `editingCursor` for dirty flagging
- [x] `kookie-flow.tsx` — click-to-position and integration:
  - Click on already-editing text entity → `hitTestCharOffset` → reposition cursor
  - Click on different entity while editing → `stopEditing()`
  - `<TextEditCursor />` mounted in Canvas between TextEntities and RerouteNodes
  - All `setEditingEntityId` calls migrated to `startEditing()`/`stopEditing()`

**10H: Text Editing Polish & Performance** ✅
- [x] Perf: numeric kerning map keys — `(first << 16) | second` eliminates string allocation per char per frame
- [x] Perf: skip redundant `updateEntityDimensions` in useFrame for the entity being edited (already maintained by `handleInput`)
- [x] Multi-click selection in edit mode: double-click → word, triple-click → visual line, quad-click → entire block
- [x] Drag-to-select: click and drag within editing text entity to create selection
- [x] Home/End navigate wrapped (visual) lines, not content lines; Ctrl+Up/Down passes through for paragraph nav
- [x] Overflow clipping: fixed-height entities clip text at entity bounds (line-level skip in `populateMultiLineGlyphBuffers`)
- [x] Edge-to-edge selection rects (Figma-style): full entity width, logical line Y positioning
- [x] `'data'` entity change type handled in `useGraph` hook and store's `applyEntityChanges` — text edits persist
- [x] Break long words that exceed entity width (`overflow-wrap: break-word`) — `breakWordByChars` helper in `wrapTextMSDF`

**10I: Socket Positioning & Graph Participation** ✅
- [x] Text entities can have optional `inputs`/`outputs` for graph participation
- [x] Bidirectional vertical centering: `centerOffset = (entityHeight - computedHeight) / 2` applied in sockets, edges, connection-line, text-renderer, dom-layer, widgets-layer
- [x] Headerless entity types (text, comment, reroute) use `padding` instead of `marginTop` in `socket-layout-cache.ts`
- [x] Render tree reorder: `<TextEntities />` moved before `<Edges />` and `<Sockets />` so auto-sizing runs first in `useFrame` order
- [x] `_movedEntityIds` race condition fix: `updateEntityDimensions` now accumulates (doesn't clear) the set, so multiple auto-size calls in the same frame all appear in the fast-path set
- [x] Demo: text entity connections wired as string→string (valid type match)

**10-Later: Deferred**
- Auto-width mode (width grows with content, no wrap)
- Style runs (bold/italic/underline within text)
- Emoji support (limited to MSDF atlas character set for now)
- Font selection UI
- Nested text inside Draw entities (`data.shapes[{ type: 'text' }]`)
- IME popup positioning (currently shows near 0,0 instead of cursor position)
- Double-click on empty canvas to create text entity

### Phase 11: Image Entity

**Goal:** Image on canvas done really well. Proper loading, resolution management, LOD.

Architecture note: Same "standalone vs. embedded" pattern as Text. `ImageEntityData` is reused when an image appears as a shape inside a Draw entity. The `ImageTextureManager` is shared infrastructure — standalone image entities and node preview blocks both use it.

- [x] Image entity type: image rendered as Three.js textured quad (`image-entities.tsx`)
- [x] Async image loading via `ImageTextureManager` (`image-loader.ts`)
- [x] Resolution management: thumbnail at zoom-out, full res when zoomed in (LOD threshold at 256px screen width)
- [x] Memory management: ref-counted textures, disposed when no longer referenced
- [x] Viewport frustum culling (skip off-screen images)
- [x] Object-fit modes: contain, cover, fill
- [ ] Drag-and-drop from filesystem
- [ ] Paste from clipboard
- [ ] Resizable via Phase 9.5 infrastructure (drag handles, aspect ratio lock option)
- [ ] Optional ports for graph participation (source node with image output)

### Phase 12: 3D Mesh Entity

**Goal:** 3D object on canvas. Orbit controls, proper lighting.

Architecture note: Same "standalone vs. embedded" pattern. `MeshEntityData` reused inside Draw entities.

- [ ] Mesh entity type: Three.js scene-in-scene
- [ ] Orbit controls (rotate, zoom, pan within the entity bounds)
- [ ] Default lighting setup (ambient + directional)
- [ ] Display mode: static thumbnail (rendered to texture)
- [ ] Interactive mode: live Three.js scene as DOM overlay
- [ ] glTF/GLB loading
- [ ] Resizable via Phase 9.5 infrastructure
- [ ] Optional ports for graph participation
- [ ] Lazy loading: Three.js scene only mounted when needed

### Phase 13: Video Entity

**Goal:** Video on canvas. Playback controls, lazy loading.

Architecture note: Same "standalone vs. embedded" pattern. `VideoEntityData` reused inside Draw entities.

- [ ] Video entity type: `<video>` element as DOM overlay
- [ ] Display mode: poster frame / thumbnail in WebGL
- [ ] Interactive mode: live `<video>` with playback controls
- [ ] Lazy loading: video element mounted only when visible + active
- [ ] Multiple video entities: only ~5 live `<video>` elements at a time
- [ ] Resizable via Phase 9.5 infrastructure
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

**Goal:** Socket-level data visualization inside nodes. The library provides structure and default renderers; the consumer fills the slot.

Preview is the visual counterpart to widget: `widget` = "how you edit a value" (DOM), `preview` = "how you see a value" (WebGL default). Both live on sockets.

**Two forms:**
- **Inline** (`preview: 'inline'`): small thumbnail inside the socket row. Useful for input sockets.
- **Block** (`preview: true` or `preview: { height }` or `preview: { component }`): large region in the node body below the socket. Useful for output sockets.

**Tasks:**

- [ ] `preview` field on Socket type: `boolean | 'inline' | { height?: number; component?: React.ComponentType }`
- [ ] `preview-layer.tsx`: R3F component that renders block previews for entities with preview-enabled sockets
- [ ] Shared `ImageTextureManager` between `image-entities.tsx` (standalone) and `preview-layer.tsx` (embedded)
- [ ] Preview region layout: socket layout cache accounts for preview height, pushes subsequent sockets down
- [ ] Default image preview renderer: WebGL textured quad positioned within entity bounds, using `ImageTextureManager`
- [ ] Inline preview rendering: small thumbnail in socket row (DOM-based or WebGL, TBD)
- [ ] Consumer override: `preview: { component: CustomPreview }` for custom content (image grid, text output, charts, etc.)
- [ ] Preview data flow: preview reads from socket's value in entity data (source of truth TBD with execution model)
- [ ] SDF clipping: preview clipped to entity bounds with rounded corners (shader mask)
- [ ] Preview visibility: block previews always show (unlike input widgets which hide when connected)
- [ ] DOM fallback: `widget: 'image-preview'` for consumers who prefer DOM-based image display over WebGL

### Phase 16: Entity Type Customization

**Goal:** Three-level customization system for consumer entity types. The library provides structure; the consumer decides what goes in it.

**Level 1: Pure Declaration (80% of nodes)**
- [ ] Rendering pipeline for `EntityTypeDefinition`: sockets → rows → widgets → previews from config
- [ ] Auto-generated widgets from socket declarations (type-to-widget mapping)
- [ ] `preview: true` on sockets triggers default WebGL renderer (via Phase 15)
- [ ] `preview: 'inline'` renders small thumbnail in socket row

**Level 2: Custom Row / Preview Components (15% of nodes)**
- [ ] `row` field on Socket: `React.ComponentType<RowProps>` — consumer replaces entire row content
- [ ] Row component receives: `{ value, onChange, connected, socketId, entityId }` — library handles socket dot + connections
- [ ] `preview: { component: CustomPreview }` — consumer fills the block preview slot with custom content
- [ ] Preview component receives: `{ value, entityId, width, height }` — library handles positioning + culling

**Level 3: Full Escape Hatch (5% of nodes)**
- [ ] `component` field on `EntityTypeDefinition`: consumer owns the entire interior
- [ ] Library still handles: entity frame, socket hit testing, edge connections, selection, dragging, status rendering

**Design principle:** Kookie Flow imposes a socket + row pattern. It provides the highway (structure, layout, rendering pipeline). The consumer drives whatever car they want (custom rows, custom previews, DOM content, WebGL content). The library brings order to chaos.

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

### Why Instanced MSDF + Hidden Textarea for Text Entities (revised)

Text **labels** (node headers, socket names, edge labels) and text **entities** (standalone text blocks) now both use instanced MSDF — same pipeline, same draw call batching, same BMFont metrics.

**Original decision (10A–10F):** Canvas2D → Texture for rendering + contenteditable for editing. Chosen because both use the browser's font engine, so line breaks match. However, in practice there was a visible shift when entering/exiting edit mode due to subtle differences in CSS vs Canvas2D glyph positioning.

**Revised decision (10G):** Instanced MSDF for rendering + hidden textarea for editing. The hidden textarea pattern (used by Figma, Monaco, Google Docs) eliminates the contenteditable overlay entirely. All visual rendering — text, cursor, selection — happens in WebGL. The DOM `<textarea>` is invisible (1×1px, opacity 0) and only captures keyboard input, IME composition, and clipboard operations.

**Key insight — no font matching needed:** Since the textarea is invisible, there's no need to match two rendering engines. MSDF rendering uses BMFont glyph metrics for display. `text-cursor-layout.ts` uses the same BMFont metrics for cursor positioning and hit testing. One set of measurements, zero mismatch.

**Options evaluated:**

| Option | Pros | Cons |
|--------|------|------|
| **Canvas2D + contenteditable** (original) | Same browser font engine for both | Subtle metric mismatch causes visible shift, rasterized (not crisp at all zooms), texture memory per entity |
| **MSDF + contenteditable** | Crisp at any zoom, 1 draw call | Two different layout engines = font matching nightmare, visible shift |
| **MSDF + hidden textarea** (chosen) | Crisp at any zoom, 1 draw call, zero visual shift, no DOM ever visible | Must reimplement cursor/selection in WebGL, arrow key navigation for wrapped lines, limited to atlas character set |
| **DOM** (like comments) | Perfect text, native everything | Z-index: DOM always above WebGL. Dealbreaker for freeform canvas |

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
│   │   ├── KookieFlow.tsx          # Main component + InputHandler
│   │   ├── context.tsx             # FlowProvider, hooks
│   │   ├── Grid.tsx                # Infinite grid shader
│   │   ├── Nodes.tsx               # Instanced node renderer
│   │   ├── Sockets.tsx             # Instanced socket renderer
│   │   ├── Edges.tsx               # Edge line renderer
│   │   ├── SelectionBox.tsx        # Box select overlay
│   │   ├── ConnectionLine.tsx      # Temp dashed edge while connecting
│   │   ├── DOMLayer.tsx            # Interactive widgets overlay (inputs only)
│   │   ├── TextRenderer.tsx        # Instanced MSDF text (all labels)
│   │   ├── text-entities.tsx       # Instanced MSDF text entities
│   │   ├── text-edit-overlay.tsx   # Hidden textarea for text editing input capture
│   │   ├── text-edit-cursor.tsx    # WebGL cursor line + selection rectangles
│   │   ├── Minimap.tsx             # Overview panel
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
│       ├── text-layout.ts          # MSDF glyph positioning, text measurement, word wrap
│       ├── text-cursor-layout.ts   # Character position mapping, hit testing, cursor geometry
│       ├── text-texture.ts         # Text style resolution, auto-height calculation
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
- [x] Socket type colors regrouped by similarity using scale-10 tokens (9 visual groups: blue, amber, orange, pink, purple, violet, cyan, teal, gray)
- [x] Scale-10 theme tokens (`--color-10`) added to ThemeTokens, fallbacks, and DOM reader
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

**Phase 8: Graph Engine**

- [x] Adjacency index with incremental O(1) updates, maintained alongside store
- [x] Graph queries: `getIncomers`, `getOutgoers`, `getNodeEdges`, `getInputEdges`, `getOutputEdges`, `getEdgesBetween`
- [x] Traversal: `walkUpstream`, `walkDownstream` (iterator-based, O(k))
- [x] Structural queries: `getRoots`, `getLeaves`, `getConnectedComponents` (Union-Find), `areConnected`
- [x] Topological sort + execution levels (Kahn's algorithm, cached against `topologyVersion`)
- [x] Cycle detection: `hasCycles`, `cycleNodeIds`, `wouldCreateCycle()` (O(k) DFS)
- [x] `allowCycles` prop on `<KookieFlow>` with automatic prevention during connection drag
- [x] Dirty propagation: `getAffectedEntities()` returns downstream in topo order
- [x] Node muting: `muteEntity()`, `unmuteEntity()`, `isMuted()` — muted nodes skipped in topo sort
- [x] Graph mutations: `insertOnEdge()`, `bypassEntity()`, `collapseToSubgraph()`, `expandSubgraph()`
- [x] Graph validation: `validate()`, `isGraphComplete()`, `getCompatiblePorts()`
- [x] `getReadyEntities()` for parallel execution scheduling
- [x] `getExecutionOrder()` for single-node subgraph
- [x] Comprehensive test suite (71+ tests) in `graph.test.ts`

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

**Phase 9.5: Selection Box + Resize Handles**

- [x] `EntitySelection` component: instanced mesh for universal selection outlines (SDF outline, no fill, zoom-independent thickness)
- [x] Hover indicator on selection box layer (gray outline on hover, accent outline on selected)
- [x] Removed per-renderer selection visuals from `nodes.tsx` shader
- [x] Resize handles: 8 handles per selected entity (NW, N, NE, E, SE, S, SW, W), constant screen-space size
- [x] `resizable` property on Entity (`boolean | { width?: boolean; height?: boolean }`)
- [x] `updateEntityDimensions()` store action (fast-path O(1), bumps positionVersion, updates quadtree + socket quadtree)
- [x] `fitEntityToContent()` store action (clears explicit width/height)
- [x] Full resize interaction in InputHandler (8-direction resize math, min-size clamping, snap-to-grid, cursor feedback)
- [x] Interaction mode side-channel (`interaction-state.ts`) for hiding handles during drag/connect/box-select
- [x] Position + dimensions `EntityChange` emission on resize end; position emission on drag end
- [x] Fixed `setEntities` to bump `positionVersion` (prevents stale edge state on external sync)
- [x] Fixed stale `entityMapRef` in edges.tsx (read from `store.getState()` in useFrame)

> **Note:** Full styling plan and remaining tasks tracked in [STYLING.md](./STYLING.md)

### Next Immediate Tasks

**Phase 7E: Connection Events** (core implemented, demo/docs remaining)

- [x] `onConnectStart` callback when connection drag begins
- [x] `onConnectEnd` callback with drop position and validity
- Enables "add node on edge drop" pattern
- Remaining: demo example, README docs

**Phase 10: Text Entity** ✅ (Instanced MSDF + Hidden Textarea)

- Rendering: Instanced MSDF via `text-entities.tsx` — single draw call, crisp at any zoom
- Editing: Hidden textarea + WebGL cursor/selection (Figma pattern) — zero visual shift
- Sizing: Auto-height mode (v1). Auto-width and fixed modes deferred
- Polish (10H): Multi-click word/line/block selection, drag-to-select, Home/End on wrapped lines, overflow clipping, edge-to-edge selection rects, numeric kerning keys, entity data change persistence
- Key files: `text-entities.tsx`, `text-edit-overlay.tsx`, `text-edit-cursor.tsx`, `text-cursor-layout.ts`, `text-layout.ts`
- Implementation order: 10A → 10B → 10D → 10C → 10E → 10F → 10G → 10H

**Phase 11: Image Entity** (in progress)

- [x] Standalone image entity: Three.js textured quad, `ImageTextureManager`, LOD, frustum culling
- [ ] Drag-and-drop, paste, resize, optional ports
- Shared `ImageTextureManager` will also power node preview blocks (Phase 15)

**Phase 11+: Remaining entity types**

- 3D Mesh → Video → Draw → Preview System → Entity Type Customization
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
