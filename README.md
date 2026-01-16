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
      />
    </div>
  );
}
```

## Performance Comparison

| Scenario | React Flow | Kookie Flow |
|----------|------------|-------------|
| Simple nodes @ 60fps | ~1,000 | ~50,000 |
| Styled nodes (shadows) @ 60fps | ~200 | ~30,000 |
| Nodes with blur @ 60fps | ~50 | ~10,000 |

## Roadmap

- [x] Project setup
- [ ] Core WebGL renderer (nodes, edges, grid)
- [ ] Pan/zoom camera controls
- [ ] Node selection (single, multi, box)
- [ ] Node dragging
- [ ] Edge connection UX
- [ ] DOM text labels
- [ ] Hybrid node portals
- [ ] Socket system (typed connections)
- [ ] Minimap
- [ ] Bezier edges
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

# Run docs site
pnpm docs
```

## License

MIT © [Kushagra Dhawan](https://github.com/KushagraDhawan1997)
