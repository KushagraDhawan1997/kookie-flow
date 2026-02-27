# Architecture

> Back to [PLAN.md](./PLAN.md)

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
│  - entities[], edges[], viewport, selection, connectionState│
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

Top-level component. Accepts entities, edges, callbacks, config props. Houses both the R3F Canvas and the DOM overlay layer.

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
  entities: Entity[];
  edges: Edge[];

  // Viewport
  viewport: Viewport;

  // Interaction state
  selectedEntityIds: Set<string>;
  selectedEdgeIds: Set<string>;
  hoveredEntityId: string | null;
  hoveredSocketId: string | null;

  // Connection state
  connectionSource: { entityId: string; socketId: string } | null;

  // Drag state
  dragState:
    | { type: 'none' }
    | { type: 'pan'; startViewport: Viewport }
    | { type: 'entity'; entityIds: string[]; startPositions: Map<string, XYPosition> }
    | { type: 'select'; startPoint: XYPosition };

  // Actions
  setEntities: (entities: Entity[]) => void;
  setEdges: (edges: Edge[]) => void;
  updateEntityPosition: (id: string, position: XYPosition) => void;
  // ... more actions
}
```

---

## File Structure

```
packages/kookie-flow/
├── src/
│   ├── index.ts                    # Public exports
│   │
│   ├── components/
│   │   ├── kookie-flow.tsx         # Main component + InputHandler
│   │   ├── context.tsx             # FlowProvider, hooks
│   │   ├── grid.tsx                # Infinite grid shader
│   │   ├── nodes.tsx               # Instanced entity renderer (exports as Entities)
│   │   ├── sockets.tsx             # Instanced socket renderer
│   │   ├── edges.tsx               # Edge line renderer
│   │   ├── selection-box.tsx       # Box select overlay
│   │   ├── connection-line.tsx     # Temp dashed edge while connecting
│   │   ├── entity-selection.tsx    # Selection outlines + resize handles (instanced)
│   │   ├── interaction-state.ts    # Side-channel for interaction mode (drag/connect/etc.)
│   │   ├── dom-layer.tsx           # DOM overlay (widgets, comments, toolbar children)
│   │   ├── widgets-layer.tsx       # Socket widget positioning + rendering
│   │   ├── text-renderer.tsx       # Instanced MSDF text (all labels)
│   │   ├── text-entities.tsx       # Instanced MSDF text entities
│   │   ├── text-edit-overlay.tsx   # Hidden textarea for text editing input capture
│   │   ├── text-edit-cursor.tsx    # WebGL cursor line + selection rectangles
│   │   ├── image-entities.tsx      # Image entity renderer (Three.js textured quads)
│   │   ├── reroute-nodes.tsx       # Reroute waypoint circles (instanced)
│   │   ├── minimap.tsx             # Overview panel
│   │   ├── toolbar.tsx             # Floating toolbar for selected entities
│   │   ├── error-boundary.tsx      # Canvas error boundary
│   │   ├── widgets/                # Built-in widget components
│   │   │   ├── SliderWidget.tsx
│   │   │   ├── NumberWidget.tsx
│   │   │   ├── SelectWidget.tsx
│   │   │   ├── CheckboxWidget.tsx
│   │   │   ├── TextWidget.tsx
│   │   │   ├── TextareaWidget.tsx
│   │   │   ├── ColorWidget.tsx
│   │   │   └── index.ts
│   │   └── index.ts
│   │
│   ├── contexts/
│   │   ├── FontContext.tsx         # MSDF font atlas provider
│   │   ├── StyleContext.tsx        # Entity style resolution provider
│   │   ├── ThemeContext.tsx        # Kookie UI theme integration
│   │   └── index.ts
│   │
│   ├── core/
│   │   ├── store.ts                # Zustand store (~2400 lines)
│   │   ├── graph.ts                # Graph engine (topo sort, cycles, traversal, mutations)
│   │   ├── graph.test.ts           # Graph engine tests (71+ tests)
│   │   ├── constants.ts            # Colors, sizes, defaults
│   │   ├── spatial.ts              # Quadtree for hit testing
│   │   ├── embedded-font.ts        # Embedded MSDF font atlas data
│   │   ├── theme-colors.ts         # Semantic color configuration
│   │   └── index.ts
│   │
│   ├── hooks/
│   │   ├── use-graph.ts            # External state management
│   │   ├── useThemeTokens.ts       # CSS variable token reading
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
│       ├── grouping.ts             # Entity hierarchy/grouping logic
│       ├── socket-layout-cache.ts  # Socket position caching
│       ├── socket-types.ts         # Socket type resolution
│       ├── widgets.ts              # Widget configuration/resolution
│       ├── style-resolver.ts       # Entity size/variant/radius resolution
│       ├── accent-colors.ts        # Accent color theme configuration
│       ├── color.ts                # Color parsing/conversion utilities
│       ├── text-layout.ts          # MSDF glyph positioning, text measurement, word wrap
│       ├── text-cursor-layout.ts   # Character position mapping, hit testing, cursor geometry
│       ├── text-texture.ts         # Text style resolution, auto-height calculation
│       ├── msdf-shader.ts          # MSDF vertex/fragment shaders
│       ├── image-loader.ts         # Image loading + ImageTextureManager
│       ├── image-decode-worker.ts  # Web Worker for image decoding
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
{
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    },
    "./plugins": {
      "import": { "types": "./dist/plugins/index.d.ts", "default": "./dist/plugins/index.js" },
      "require": { "types": "./dist/plugins/index.d.cts", "default": "./dist/plugins/index.cjs" }
    }
  }
}
```

```typescript
// Core
import { KookieFlow, useFlowStore } from '@kushagradhawan/kookie-flow';

// All plugins
import { useClipboard, useKeyboardShortcuts, useContextMenu } from '@kushagradhawan/kookie-flow/plugins';
```
