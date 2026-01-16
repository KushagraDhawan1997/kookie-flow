# Kookie Flow — Implementation Plan

> WebGL-native node graph library. React Flow's ergonomics, GPU-rendered for performance at scale.

This document is the source of truth for building Kookie Flow. It is written for LLM consumption—structured, explicit, and unambiguous.

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

### Phase 4: Node Dragging
**Goal:** Move nodes around

- [ ] Drag selected nodes
- [ ] Multi-node drag (maintain relative positions)
- [ ] Snap to grid (optional)
- [ ] Drag boundaries (optional)
- [ ] Undo/redo support (optional, phase 6)

### Phase 5: Edge Connections
**Goal:** Connect nodes via sockets

- [ ] Render sockets (instanced circles)
- [ ] Socket hit detection
- [ ] Connection line while dragging
- [ ] Valid/invalid connection feedback
- [ ] Socket type validation
- [ ] Auto-scroll when near edges
- [ ] Delete edge (click + delete key)

### Phase 6: Full Interactivity
**Goal:** Complete editing UX

- [ ] Delete nodes (delete key)
- [ ] Copy/paste nodes (Ctrl+C/V)
- [ ] Duplicate (Ctrl+D)
- [ ] Undo/redo (Ctrl+Z/Y)
- [ ] Keyboard shortcuts
- [ ] Context menu (right-click)
- [ ] Touch interactions

### Phase 7: Advanced Features
**Goal:** Feature parity with React Flow

- [ ] Minimap
- [ ] Bezier edges (curved)
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

### Phase 9: Performance & Polish
**Goal:** Production ready

- [ ] Spatial indexing (quadtree) for hit testing
- [ ] Virtual DOM pooling for labels
- [ ] GPU-based hit testing (color picking)
- [ ] Memory management (dispose textures)
- [ ] Performance profiling
- [ ] Accessibility (keyboard navigation, ARIA)
- [ ] Documentation site
- [ ] Examples gallery

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

---

## File Structure

```
packages/kookie-flow/
├── src/
│   ├── index.ts                    # Public exports
│   │
│   ├── components/
│   │   ├── KookieFlow.tsx          # Main component
│   │   ├── context.tsx             # FlowProvider, hooks
│   │   ├── Grid.tsx                # Infinite grid shader
│   │   ├── Nodes.tsx               # Instanced node renderer
│   │   ├── Sockets.tsx             # Instanced socket renderer [TODO]
│   │   ├── Edges.tsx               # Edge line renderer
│   │   ├── SelectionBox.tsx        # Box select overlay [TODO]
│   │   ├── ConnectionLine.tsx      # Temp edge while connecting [TODO]
│   │   ├── DOMLayer.tsx            # Text/widget overlay
│   │   ├── Minimap.tsx             # Overview panel [TODO]
│   │   └── index.ts
│   │
│   ├── core/
│   │   ├── store.ts                # Zustand store
│   │   ├── constants.ts            # Colors, defaults
│   │   ├── spatial.ts              # Quadtree for hit testing [TODO]
│   │   └── index.ts
│   │
│   ├── hooks/
│   │   ├── useGraph.ts             # External state management
│   │   ├── useViewport.ts          # Viewport controls [TODO]
│   │   ├── useSelection.ts         # Selection management [TODO]
│   │   ├── useKeyboard.ts          # Keyboard shortcuts [TODO]
│   │   └── index.ts
│   │
│   ├── types/
│   │   └── index.ts                # All TypeScript types
│   │
│   └── utils/
│       ├── geometry.ts             # Position/bounds math [TODO]
│       ├── connections.ts          # Connection validation [TODO]
│       └── index.ts
│
├── package.json
├── tsconfig.json
└── tsup.config.ts
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

### Next Immediate Tasks
1. Implement node dragging
2. Add connection line while dragging from socket
3. Build minimap component
4. Add edge selection

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

*Last updated: January 2025*
