# Kookie Flow

WebGL-native node graph library. React Flow's ergonomics, GPU-rendered for performance at scale.

## Why?

React Flow struggles not because of node count, but because each node is 20+ DOM elements, each edge is SVG path recalculation, and React reconciles thousands of components on every pan/zoom.

**Kookie Flow renders everything in WebGL.** Nodes are instanced meshes. Edges are GPU line segments. Text and widgets stay in DOM (where they belong). The result: 10,000+ nodes at 60fps.

## Architecture

```
┌─────────────────────────────────────────┐
│  DOM Layer (text, widgets)              │
├─────────────────────────────────────────┤
│  WebGL Canvas                           │
│  ├── Instanced nodes (1 draw call)      │
│  ├── Edges (batched geometry)           │
│  ├── Grid (shader-based)                │
│  └── Selection, minimap                 │
└─────────────────────────────────────────┘
```

### Three Node Tiers

1. **Visual nodes** — Fully WebGL, optimized for AI/3D tools (image outputs, mesh viewers, no DOM)
2. **Hybrid nodes** — WebGL container, DOM portal for custom React content
3. **DOM escape hatch** — Full flexibility when needed

## Installation

```bash
npm install @kushagradhawan/kookie-flow
# or
pnpm add @kushagradhawan/kookie-flow
```

### Peer Dependencies

```bash
npm install react react-dom three @react-three/fiber @react-three/drei
```

## Quick Start

```tsx
import { KookieFlow, useGraph } from '@kushagradhawan/kookie-flow';

function App() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } = useGraph({
    initialNodes: [
      { id: '1', type: 'default', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
      { id: '2', type: 'default', position: { x: 250, y: 0 }, data: { label: 'Node 2' } },
    ],
    initialEdges: [
      { id: 'e1-2', source: '1', target: '2' },
    ],
  });

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <KookieFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        showGrid
      />
    </div>
  );
}
```

## Features

### Camera Controls
- **Wheel zoom** — Zoom towards cursor position
- **Middle-click drag** — Pan the canvas
- **Space + drag** — Alternative pan method
- **Pinch-to-zoom** — Touch gesture support
- **Two-finger pan** — Touch gesture support

### Selection & Interaction
- **Click to select** — Single node selection
- **Ctrl+click** — Add to selection
- **Box select** — Drag on empty space to select multiple nodes
- **Keyboard shortcuts** — Ctrl+A select all, Escape deselect
- **Node dragging** — Move selected nodes with snap-to-grid support

### Edge Rendering
- **Curve types** — Straight, bezier, step, smoothstep
- **Mesh-based rendering** — Custom shaders for future effects (glow, animation)
- **Per-edge type override** — Mix edge types in the same graph

### Performance Optimizations
- **Instanced rendering** — All nodes in a single draw call
- **Frustum culling** — Only render visible nodes/edges
- **Quadtree spatial indexing** — O(log n) hit testing for 10,000+ nodes
- **Pre-allocated GPU buffers** — Zero GC pressure during pan/zoom
- **Dirty flags** — Skip unnecessary updates
- **Safari optimizations** — MSAA disabled, simplified shaders

### DOM Layer
- **Text labels** — Crisp text that stays readable at any zoom
- **LOD (Level of Detail)** — Labels hide when zoomed out
- **GPU-accelerated transforms** — translate3d/matrix3d for smooth panning
- **Ref-based updates** — Zero React re-renders during drag

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `nodes` | `Node[]` | `[]` | Array of node objects |
| `edges` | `Edge[]` | `[]` | Array of edge objects |
| `onNodesChange` | `function` | - | Callback when nodes change |
| `onEdgesChange` | `function` | - | Callback when edges change |
| `onConnect` | `function` | - | Callback when connection is made |
| `showGrid` | `boolean` | `true` | Show background grid |
| `showStats` | `boolean` | `false` | Show FPS stats |
| `minZoom` | `number` | `0.1` | Minimum zoom level |
| `maxZoom` | `number` | `4` | Maximum zoom level |
| `scaleTextWithZoom` | `boolean` | `false` | Scale text with zoom (true) or keep crisp (false) |
| `defaultEdgeType` | `'straight' \| 'bezier' \| 'step' \| 'smoothstep'` | `'bezier'` | Default edge curve type |
| `snapToGrid` | `boolean` | `false` | Snap nodes to grid when dragging |
| `snapGrid` | `[number, number]` | `[20, 20]` | Grid snap size [x, y] |

## Performance Comparison

| Scenario | React Flow | Kookie Flow |
|----------|------------|-------------|
| Simple nodes @ 60fps | ~1,000 | ~50,000 |
| Styled nodes (shadows) @ 60fps | ~200 | ~30,000 |
| Nodes with blur @ 60fps | ~50 | ~10,000 |

## Roadmap

- [x] Project setup
- [x] Core WebGL renderer (nodes, edges, grid)
- [x] Pan/zoom camera controls
- [x] Touch gesture support
- [x] DOM text labels with LOD
- [x] Safari performance optimizations
- [x] Viewport frustum culling
- [x] Node selection (single, multi, box)
- [x] Node dragging with snap-to-grid
- [x] Quadtree spatial indexing (O(log n) hit testing)
- [x] Edge curve types (bezier, step, smoothstep)
- [ ] Socket system (typed connections)
- [ ] Edge connection UX
- [ ] Hybrid node portals
- [ ] Minimap
- [ ] Image texture previews
- [ ] 3D mesh previews

## Development

```bash
# Install dependencies
pnpm install

# Start development
pnpm dev

# Build
pnpm build
```

## License

MIT © [Kushagra Dhawan](https://github.com/KushagraDhawan1997)
