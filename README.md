# Kookie Flow

> **Not ready for use.** This is an active experiment — APIs are unstable, features are incomplete, and breaking changes happen without notice. If you're curious, feel free to look around, but don't depend on this for anything real yet.

WebGL-native node graph library for React.

[![In Development](https://img.shields.io/badge/status-in%20development-orange)](https://github.com/KushagraDhawan1997/kookie-flow)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why?

I love WebGL and I love node-based editors. DOM-based solutions like React Flow exist and work great for many use cases, but I wanted to explore what a canvas-first approach could look like.

**Kookie Flow renders geometry in WebGL.** Entities are instanced meshes (1 draw call). Edges are batched GPU geometry. Text is rendered via MSDF shaders. Interactive widgets stay in DOM where they belong.

The result: 10,000 entities at 80-120fps during aggressive pan/zoom.

## Architecture

```
┌─────────────────────────────────────────┐
│  DOM Layer (widgets, hidden textarea)   │
├─────────────────────────────────────────┤
│  WebGL Canvas                           │
│  ├── Instanced entities (1 draw call)   │
│  ├── Text entities (instanced MSDF)     │
│  ├── Text cursor & selection (WebGL)    │
│  ├── Edges (batched geometry)           │
│  ├── MSDF labels (instanced glyphs)     │
│  ├── Grid (shader-based)                │
│  └── Selection box                      │
└─────────────────────────────────────────┘
```

### Entity Model

Entities are the fundamental building blocks. Every object on the canvas is an entity — graph nodes with ports, frames, comments, images, text blocks, 3D meshes, and more.

1. **Graph entities** — Entities with `inputs`/`outputs` sockets that participate in the graph
2. **Spatial entities** — Entities without ports (frames, comments, images) that exist on the canvas
3. **Hybrid entities** — Any entity type can optionally have ports. A text entity can be a standalone annotation *or* a prompt source with output sockets wired into the graph. Everything is a node.

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

### Optional: Kookie UI Integration

For full theming support with design tokens:

```bash
npm install @kushagradhawan/kookie-ui
```

## Quick Start

```tsx
import { KookieFlow, useGraph } from '@kushagradhawan/kookie-flow';

function App() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities: [
      { id: '1', type: 'default', position: { x: 0, y: 0 }, data: { label: 'Entity 1' } },
      { id: '2', type: 'default', position: { x: 250, y: 0 }, data: { label: 'Entity 2' } },
    ],
    initialEdges: [
      { id: 'e1-2', source: '1', target: '2' },
    ],
  });

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <KookieFlow
        entities={entities}
        edges={edges}
        onEntitiesChange={onEntitiesChange}
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

### Imperative API (Ref)

Access viewport and selection methods via ref:

```tsx
import { KookieFlow, KookieFlowInstance } from '@kushagradhawan/kookie-flow';
import { useRef } from 'react';

function App() {
  const flowRef = useRef<KookieFlowInstance>(null);

  return (
    <>
      <button onClick={() => flowRef.current?.fitView()}>Fit All</button>
      <button onClick={() => {
        const selected = flowRef.current?.getSelectedEntities().map(n => n.id);
        flowRef.current?.fitView({ entities: selected, padding: 100 });
      }}>Fit Selection</button>
      <button onClick={() => flowRef.current?.zoomIn()}>Zoom In</button>
      <button onClick={() => flowRef.current?.setCenter(0, 0, { zoom: 1 })}>Reset</button>

      <KookieFlow ref={flowRef} entities={entities} edges={edges} />
    </>
  );
}
```

**Available methods:**

| Method | Description |
|--------|-------------|
| `fitView(options?)` | Fit viewport to show all/specific entities |
| `getViewport()` | Get current `{ x, y, zoom }` |
| `setViewport(viewport)` | Set viewport directly |
| `zoomIn(step?)` | Zoom in (default step: 0.25) |
| `zoomOut(step?)` | Zoom out (default step: 0.25) |
| `setCenter(x, y, options?)` | Center on a world position |
| `getEntities()` | Get all entities |
| `getEdges()` | Get all edges |
| `getSelectedEntities()` | Get selected entities |
| `getSelectedEdges()` | Get selected edges |

**fitView options:**

```tsx
flowRef.current?.fitView({
  padding: 50,            // Padding around content (default: 50)
  entities: ['a', 'b'],   // Specific entity IDs to fit (default: all)
  minZoom: 0.1,           // Min zoom constraint
  maxZoom: 1,             // Max zoom constraint (default: 1, won't zoom past 100%)
});
```

### Selection & Interaction
- **Click to select** — Single entity selection
- **Ctrl+click** — Add to selection
- **Box select** — Drag on empty space to select multiple entities
- **Keyboard shortcuts** — Ctrl+A select all, Escape deselect, T create text entity
- **Entity dragging** — Move selected entities with snap-to-grid support
- **Double-click** — Enter inline editing on text entities
- **Entity resizing** — 8-direction resize handles with min-size clamping

### Socket System
- **Typed sockets** — Input/output sockets with type-based colors
- **Socket labels** — Labels displayed next to sockets (toggleable via `showSocketLabels`)
- **Connection validation** — Strict or loose mode for socket type compatibility
- **Custom validation** — `isValidConnection` callback for custom rules

### Connection Events

Track the full connection lifecycle with `onConnectStart` and `onConnectEnd`:

```tsx
import type { ConnectionEndState } from '@kushagradhawan/kookie-flow';

<KookieFlow
  onConnectStart={(event, params) => {
    // params: { entityId, socketId, isInput }
    console.log('Drag started from', params.socketId);
  }}
  onConnectEnd={(event, state) => {
    // state: { isValid, source: { entityId, socketId, isInput }, position: { x, y } }
    if (!state.isValid) {
      // Dropped on empty canvas — create an entity at the drop position
      const id = `entity-${Date.now()}`;
      addEntity({
        id,
        type: 'default',
        position: state.position,
        data: { label: 'New Entity' },
        inputs: [{ id: 'in', name: 'Input', type: 'any' }],
      });
      addEdge({
        id: `edge-${id}`,
        source: state.source.entityId,
        sourceSocket: state.source.socketId,
        target: id,
        targetSocket: 'in',
      });
    }
  }}
/>
```

`onConnect` fires only on successful connections. `onConnectEnd` fires every time (success or fail), giving you the drop position in world coordinates — useful for "add entity on edge drop" patterns.

### Entity Status

Entities support visual status feedback via `data.status`:

```tsx
const entities = [
  { id: '1', data: { label: 'Processing', status: 'running' } },   // Pulsing indigo border
  { id: '2', data: { label: 'Failed', status: 'error' } },         // Solid red border
  { id: '3', data: { label: 'Warning', status: 'warning' } },      // Solid amber border
  { id: '4', data: { label: 'Done', status: 'success' } },         // Pulsing green flash
];
```

Statuses: `'error'` | `'warning'` | `'running'` | `'success'`. Add `data.statusMessage` for a human-readable message.

### Socket Widgets

Input widgets on sockets that auto-hide when connected:

```tsx
const entity = {
  id: 'processor',
  inputs: [
    { id: 'strength', name: 'Strength', type: 'float', min: 0, max: 1 },
    { id: 'steps', name: 'Steps', type: 'int', min: 1, max: 100 },
    { id: 'method', name: 'Method', type: 'enum', options: ['nearest', 'bilinear'] },
    { id: 'enabled', name: 'Enabled', type: 'boolean' },
    // Stacked layout with multi-line textarea
    { id: 'prompt', name: 'Prompt', type: 'string', layout: 'stacked', widget: 'textarea', rows: 3 },
  ],
};
```

**Built-in widgets:** slider, number, select, checkbox, text, color, textarea

**Layout modes:**
- `inline` (default) — Label on left, widget on right
- `stacked` — Label above widget, widget spans full width

**Variable height:** Use `rows` prop to specify number of rows (e.g., `rows: 3` for 3-line textarea)

**Widget control props:**
```tsx
<KookieFlow
  showWidgets={true}           // Toggle widget visibility (default: true)
  defaultEntityWidth={240}     // Default entity width when entity.width not specified
  socketLabelWidth={96}        // Width reserved for socket labels before widget
  onWidgetChange={(entityId, socketId, value) => {
    console.log(`Widget changed: ${entityId}.${socketId} = ${value}`);
  }}
/>
```

**Custom widget components:**
```tsx
const CustomSlider = ({ value, onChange, min, max }) => (
  <input type="range" value={value} onChange={e => onChange(+e.target.value)} min={min} max={max} />
);

<KookieFlow
  widgetTypes={{ slider: CustomSlider }}  // Override built-in widgets
/>
```

### Entity Types

**Built-in types:**

| Type | Description | Has Ports |
|------|-------------|-----------|
| `default` | Standard graph node with sockets | Yes (optional) |
| `frame` | Spatial container / group with collapsible children | No |
| `comment` | Sticky note annotation | No |
| `reroute` | Edge waypoint for cleaner routing | No |
| `text` | Text block with inline editing | Optional |
| `draw` | Shapes, SVG paths, freeform drawing | Optional |
| `image` | Image display | Optional |
| `video` | Video display | Optional |
| `mesh` | 3D mesh viewer | Optional |

```tsx
// Frame entity with children
const entities = [
  {
    id: 'frame-1',
    type: 'frame',
    position: { x: 0, y: 0 },
    data: { label: 'My Frame' },
    collapsed: false, // Toggle to hide children
  },
  {
    id: 'child-1',
    parentId: 'frame-1', // Child of the frame
    position: { x: 20, y: 40 },
    data: { label: 'Child Entity' },
  },
];

// Text entity — standalone annotation
const textNote = {
  id: 'note-1',
  type: 'text',
  position: { x: 0, y: 0 },
  width: 240,
  data: { content: 'Double-click to edit this text' },
  resizable: { width: true, height: false }, // Auto-height
};

// Text entity with ports — participates in the graph
const promptNode = {
  id: 'prompt-1',
  type: 'text',
  position: { x: 0, y: 0 },
  width: 240,
  data: { content: 'A photorealistic mountain landscape' },
  outputs: [{ id: 'prompt-out', name: 'Prompt', type: 'string' }],
  resizable: { width: true, height: false },
};

// Comment entity
const comment = {
  id: 'comment-1',
  type: 'comment',
  position: { x: 300, y: 0 },
  data: {
    content: 'This is a sticky note',
    backgroundColor: '#FFF9C4',
    textColor: '#424242',
  },
};

// Reroute entity (edge waypoint)
const reroute = {
  id: 'reroute-1',
  type: 'reroute',
  position: { x: 150, y: 100 },
  data: {},
};
```

### Edge Rendering
- **Curve types** — Straight, bezier, step, smoothstep
- **Mesh-based rendering** — Custom shaders for future effects (glow, animation)
- **Per-edge type override** — Mix edge types in the same graph
- **Edge labels** — Text labels positioned along edges (toggleable via `showEdgeLabels`)
- **Edge markers** — Arrows at edge endpoints (start/end)

### Performance Optimizations
- **Instanced rendering** — Entities, text labels, and text entities each in a single draw call
- **Frustum culling** — Only render visible entities/edges/text
- **Quadtree spatial indexing** — O(log n) hit testing for 10,000+ entities
- **Pre-allocated GPU buffers** — Zero GC pressure during pan/zoom
- **O(1) index lookups** — Entity map for instant ID-based access
- **Dirty flags** — Skip unnecessary updates per frame
- **Zero React re-renders** — All position/transform updates via refs during interactions
- **Safari optimizations** — MSAA disabled, simplified shaders

### Text Rendering
- **WebGL mode** — MSDF (Multi-channel Signed Distance Field) text via instanced glyphs, single draw call for all labels
- **DOM mode** — Traditional DOM text for maximum compatibility
- **LOD (Level of Detail)** — Labels hide when zoomed out (configurable thresholds)
- **Selective updates** — Text only rebuilds when entities/edges/viewport change, not on hover

### Text Entities

Text entities are standalone text blocks on the canvas with Figma-quality inline editing. All rendering happens in WebGL — no DOM overlay is ever visible.

- **MSDF rendering** — Instanced glyph rendering, crisp at any zoom level
- **Inline editing** — Double-click to edit. Hidden `<textarea>` captures keyboard, IME, and clipboard natively while cursor and selection render in WebGL (same pattern as Figma/Monaco)
- **Word wrap** — Automatic word wrapping using BMFont glyph metrics
- **Auto-height** — Height adjusts to fit content. Width is user-resizable.
- **Click-to-position** — Click within text to reposition the cursor
- **Selection** — Shift+click and keyboard selection with visual highlight rectangles
- **Arrow key navigation** — Full support for navigating across word-wrapped lines
- **Optional ports** — Add `inputs`/`outputs` to make text entities participate in the graph
- **`T` shortcut** — Press T to create a new text entity at viewport center

```tsx
// Text entity with custom styling
const text = {
  id: 'styled-text',
  type: 'text',
  position: { x: 0, y: 0 },
  width: 300,
  data: {
    content: 'Hello world',
    fontSize: 18,
    lineHeight: 1.6,
    letterSpacing: 0.5,
    textAlign: 'center',    // 'left' | 'center' | 'right'
    textColor: '#E0E0E0',
  },
  resizable: { width: true, height: false },
};
```

### Font Configuration

Built-in font presets for WebGL text rendering:

```tsx
<KookieFlow
  textRenderMode="webgl"
  font="inter"  // 'google-sans' | 'inter' | 'roboto' | 'source-serif' | 'system'
/>
```

Custom MSDF fonts with your own atlas:

```tsx
<KookieFlow
  textRenderMode="webgl"
  font={{
    name: 'my-font',
    weights: {
      regular: { metrics: myMetrics, atlasUrl: '/fonts/my-font.png' },
      semibold: { metrics: mySemiboldMetrics, atlasUrl: '/fonts/my-font-semibold.png' },
    },
  }}
/>
```

### Minimap

Overview navigation panel with viewport indicator:

```tsx
<KookieFlow
  showMinimap
  minimapProps={{
    position: 'bottom-right',
    zoomable: true, // minimap zooms with main canvas
  }}
/>
```

### Theming & Styling

Full Kookie UI design system integration:

```tsx
import { Theme } from '@kushagradhawan/kookie-ui';

<Theme accentColor="indigo" grayColor="slate" radius="medium">
  <KookieFlow
    size="2"
    variant="surface"
    entities={entities}
    edges={edges}
  />
</Theme>
```

**Styling props:**
- `size` — Entity sizing tier ('1' - '5')
- `variant` — Visual style ('surface', 'outline', 'soft', 'classic', 'ghost')
- `radius` — Border radius ('none', 'small', 'medium', 'large', 'full')
- `header` — Header position ('none', 'inside', 'outside')
- `accentHeader` — Tint header with accent color (boolean)

**Per-entity color override:**
```tsx
const entities = [
  { id: '1', color: 'violet', ... },  // 26 accent colors supported
  { id: '2', color: 'cyan', ... },
];
```

**Widget theming with per-entity colors:**
```tsx
import { Theme } from '@kushagradhawan/kookie-ui';

<KookieFlow
  ThemeComponent={Theme}  // Enable per-entity accent colors for widgets
  entities={entities}
  edges={edges}
/>
```

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
| `entities` | `Entity[]` | `[]` | Array of entity objects |
| `edges` | `Edge[]` | `[]` | Array of edge objects |
| `onEntitiesChange` | `function` | - | Callback when entities change |
| `onEdgesChange` | `function` | - | Callback when edges change |
| `onConnect` | `function` | - | Callback when connection is made |
| `onConnectStart` | `function` | - | Callback when connection drag starts |
| `onConnectEnd` | `function` | - | Callback when connection drag ends (success or fail) |
| `onEntityClick` | `function` | - | Callback when entity is clicked |
| `onEdgeClick` | `function` | - | Callback when edge is clicked |
| `onWidgetChange` | `function` | - | Callback when widget value changes |
| `showGrid` | `boolean` | `true` | Show background grid |
| `showMinimap` | `boolean` | `false` | Show minimap overview |
| `minimapProps` | `MinimapProps` | - | Minimap configuration |
| `showStats` | `boolean` | `false` | Show FPS stats |
| `textRenderMode` | `'dom' \| 'webgl'` | `'dom'` | Text rendering mode |
| `font` | `FontPreset \| FontConfig` | `'google-sans'` | Font for WebGL text rendering |
| `showSocketLabels` | `boolean` | `true` | Show socket labels |
| `showEdgeLabels` | `boolean` | `true` | Show edge labels |
| `showWidgets` | `boolean` | `true` | Show widgets on unconnected inputs |
| `size` | `'1' - '5'` | `'2'` | Entity size tier |
| `variant` | `string` | `'surface'` | Entity visual variant |
| `radius` | `string` | `'medium'` | Border radius style |
| `header` | `'none' \| 'inside' \| 'outside'` | `'none'` | Header position |
| `accentHeader` | `boolean` | `false` | Tint header with accent color |
| `minZoom` | `number` | `0.1` | Minimum zoom level |
| `maxZoom` | `number` | `4` | Maximum zoom level |
| `defaultEdgeType` | `string` | `'bezier'` | Default edge curve type |
| `connectionMode` | `'strict' \| 'loose'` | `'loose'` | Socket type validation mode |
| `edgesSelectable` | `boolean` | `true` | Allow edge selection |
| `snapToGrid` | `boolean` | `false` | Snap entities to grid when dragging |
| `snapGrid` | `[number, number]` | `[20, 20]` | Grid snap size [x, y] |
| `socketTypes` | `Record<string, SocketType>` | - | Custom socket type definitions |
| `entityTypes` | `Record<string, EntityTypeDefinition>` | - | Custom entity type definitions |
| `widgetTypes` | `Record<string, Component>` | - | Custom widget components |
| `defaultEntityWidth` | `number` | `240` | Default entity width when not specified |
| `socketLabelWidth` | `number` | `96` | Width reserved for socket labels |
| `ThemeComponent` | `Component` | - | Kookie UI Theme for per-entity colors |
| `isValidConnection` | `function` | - | Custom connection validation |

## Performance

Tested on 16" MacBook Pro M4 Pro:

| Scenario | Performance |
|----------|-------------|
| 10,000 entities, aggressive pan/zoom | 80-120 fps |
| 10,000 entities with all labels (WebGL mode) | 60+ fps |
| 50,000 simple entities | ~30 fps |

## Roadmap

- [x] Project setup
- [x] Core WebGL renderer (entities, edges, grid)
- [x] Pan/zoom camera controls
- [x] Touch gesture support
- [x] Safari performance optimizations
- [x] Viewport frustum culling
- [x] Entity selection (single, multi, box)
- [x] Entity dragging with snap-to-grid
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
- [x] Minimap
- [x] Kookie UI theme integration
- [x] Per-entity color overrides
- [x] Socket widgets (slider, number, select, checkbox, text, color, textarea)
- [x] Configurable socket layouts (inline, stacked)
- [x] Variable row heights (rows prop)
- [x] Imperative API via ref (fitView, viewport controls)
- [x] Frame entities with collapsible children
- [x] Comment/sticky note entities
- [x] Reroute entities (edge waypoints)
- [x] Connection events (onConnectStart, onConnectEnd)
- [x] Graph engine (topology, cycles, execution levels)
- [x] Entity model refactor (nodes->entities, status rendering)
- [x] Text entities (MSDF rendering, word wrap, auto-height)
- [x] WebGL-native text editing (hidden textarea, cursor, selection)
- [ ] Image entities (texture previews)
- [ ] 3D mesh entity previews
- [ ] Hybrid entity portals

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
