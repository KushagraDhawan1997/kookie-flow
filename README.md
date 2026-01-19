# Kookie Flow

WebGL-native node graph library for React.

## Why?

I love WebGL and I love node-based editors. DOM-based solutions like React Flow exist and work great for many use cases, but I wanted to explore what a canvas-first approach could look like.

**Kookie Flow renders geometry in WebGL.** Nodes are instanced meshes (1 draw call). Edges are batched GPU geometry. Text is rendered via MSDF shaders. Interactive widgets stay in DOM where they belong.

The result: 10,000 nodes at 80-120fps during aggressive pan/zoom.

## Architecture

```
┌─────────────────────────────────────────┐
│  DOM Layer (interactive widgets)        │
├─────────────────────────────────────────┤
│  WebGL Canvas                           │
│  ├── Instanced nodes (1 draw call)      │
│  ├── Edges (batched geometry)           │
│  ├── MSDF text (instanced glyphs)       │
│  ├── Grid (shader-based)                │
│  └── Selection box                      │
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

### Socket System
- **Typed sockets** — Input/output sockets with type-based colors
- **Socket labels** — Labels displayed next to sockets (toggleable via `showSocketLabels`)
- **Connection validation** — Strict or loose mode for socket type compatibility
- **Custom validation** — `isValidConnection` callback for custom rules

### Edge Rendering
- **Curve types** — Straight, bezier, step, smoothstep
- **Mesh-based rendering** — Custom shaders for future effects (glow, animation)
- **Per-edge type override** — Mix edge types in the same graph
- **Edge labels** — Text labels positioned along edges (toggleable via `showEdgeLabels`)
- **Edge markers** — Arrows at edge endpoints (start/end)

### Performance Optimizations
- **Instanced rendering** — All nodes in a single draw call
- **Frustum culling** — Only render visible nodes/edges
- **Quadtree spatial indexing** — O(log n) hit testing for 10,000+ nodes
- **Pre-allocated GPU buffers** — Zero GC pressure during pan/zoom
- **Dirty flags** — Skip unnecessary updates
- **Safari optimizations** — MSAA disabled, simplified shaders

### Text Rendering
- **WebGL mode** — MSDF (Multi-channel Signed Distance Field) text via instanced glyphs, single draw call for all labels
- **DOM mode** — Traditional DOM text for maximum compatibility
- **LOD (Level of Detail)** — Labels hide when zoomed out (configurable thresholds)
- **Selective updates** — Text only rebuilds when nodes/edges/viewport change, not on hover

### Plugins
- **useClipboard** — Copy, paste, cut operations with internal clipboard
- **useKeyboardShortcuts** — Configurable key bindings with `mod` (Cmd/Ctrl) support
- **useContextMenu** — Right-click and long-press menu handling

```tsx
import { useClipboard, useKeyboardShortcuts } from '@kushagradhawan/kookie-flow/plugins';

const { copy, paste, cut } = useClipboard();
useKeyboardShortcuts({
  bindings: {
    'mod+c': copy,
    'mod+v': paste,
    'mod+x': cut,
  },
});
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `nodes` | `Node[]` | `[]` | Array of node objects |
| `edges` | `Edge[]` | `[]` | Array of edge objects |
| `onNodesChange` | `function` | - | Callback when nodes change |
| `onEdgesChange` | `function` | - | Callback when edges change |
| `onConnect` | `function` | - | Callback when connection is made |
| `onNodeClick` | `function` | - | Callback when node is clicked |
| `onEdgeClick` | `function` | - | Callback when edge is clicked |
| `showGrid` | `boolean` | `true` | Show background grid |
| `showStats` | `boolean` | `false` | Show FPS stats |
| `textRenderMode` | `'dom' \| 'webgl'` | `'dom'` | Text rendering mode (WebGL = MSDF, DOM = traditional) |
| `showSocketLabels` | `boolean` | `true` | Show socket labels |
| `showEdgeLabels` | `boolean` | `true` | Show edge labels |
| `minZoom` | `number` | `0.1` | Minimum zoom level |
| `maxZoom` | `number` | `4` | Maximum zoom level |
| `scaleTextWithZoom` | `boolean` | `false` | Scale text with zoom (true) or keep crisp (false) |
| `defaultEdgeType` | `'straight' \| 'bezier' \| 'step' \| 'smoothstep'` | `'bezier'` | Default edge curve type |
| `connectionMode` | `'strict' \| 'loose'` | `'loose'` | Socket type validation mode |
| `edgesSelectable` | `boolean` | `true` | Allow edge selection |
| `snapToGrid` | `boolean` | `false` | Snap nodes to grid when dragging |
| `snapGrid` | `[number, number]` | `[20, 20]` | Grid snap size [x, y] |

## Performance

Tested on 16" MacBook Pro M4 Pro:

| Scenario | Performance |
|----------|-------------|
| 10,000 nodes, aggressive pan/zoom | 80-120 fps |
| 10,000 nodes with all labels (WebGL mode) | 60+ fps |
| 50,000 simple nodes | ~30 fps |

## Roadmap

- [x] Project setup
- [x] Core WebGL renderer (nodes, edges, grid)
- [x] Pan/zoom camera controls
- [x] Touch gesture support
- [x] Safari performance optimizations
- [x] Viewport frustum culling
- [x] Node selection (single, multi, box)
- [x] Node dragging with snap-to-grid
- [x] Quadtree spatial indexing (O(log n) hit testing)
- [x] Edge curve types (bezier, step, smoothstep)
- [x] Socket system (typed connections)
- [x] Edge connection UX with validation feedback
- [x] Edge selection and interaction
- [x] Clipboard operations (copy/paste/cut)
- [x] Keyboard shortcuts plugin
- [x] Context menu plugin
- [x] Edge labels and markers
- [x] Socket labels with visibility toggle
- [x] WebGL text rendering (MSDF)
- [ ] Minimap
- [ ] Hybrid node portals
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
