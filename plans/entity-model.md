# Entity Model

> Back to [PLAN.md](./PLAN.md)

---

## Core Concept

One primitive: **Entity**. Spatial presence and graph participation are orthogonal, composable traits.

```
Entity
├── position, width?, height?    (always — everything lives on the canvas)
├── inputs[], outputs[]          (optional — graph participation via sockets)
│   └── Socket
│       ├── name, type, id
│       ├── widget?              (inline DOM control — slider, text, select, etc.)
│       ├── preview?             (planned — inline or block data visualization)
│       └── row?                 (planned — custom row component escape hatch)
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

---

## Built-in Entity Types

| Type      | What It Renders                                      | Sockets?             | Status      | Type guard        |
| --------- | ---------------------------------------------------- | -------------------- | ----------- | ----------------- |
| (default) | Standard node (header + sockets + widgets + preview) | Yes (inputs/outputs) | Implemented | (no guard needed) |
| `text`    | Rich text block                                      | Optional             | Implemented | `isTextEntity()`  |
| `frame`   | Spatial container / group                            | Optional             | Implemented | `isFrameEntity()` |
| `comment` | Sticky note annotation                               | No                   | Implemented | `isCommentEntity()` |
| `reroute` | Edge waypoint                                        | Yes (passthrough)    | Implemented | `isRerouteEntity()` |
| `image`   | Image on canvas                                      | Optional             | In Progress | `isImageEntity()` |
| `draw`    | Shapes, SVG paths, freeform drawing                  | Optional             | Planned     | (not yet)         |
| `video`   | Video on canvas                                      | Optional             | Planned     | (not yet)         |
| `mesh`    | 3D object on canvas                                  | Optional             | Planned     | (not yet)         |

`BuiltInEntityType` union: `'frame' | 'comment' | 'reroute' | 'draw' | 'text' | 'image' | 'video' | 'mesh'`. Default entities use a custom `type` string and don't appear in this union.

`image`, `video`, `mesh` entities ARE the visual — they don't preview themselves. Preview is for default-type nodes (and custom consumer types) that _produce_ visual output. The standalone `image` entity and a node with `preview: true` on an image socket are different things that share the same `ImageTextureManager` infrastructure.

---

## Entity Type Customization (Three Levels)

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

**Level 2: Custom Row / Preview Components (15% of nodes).** Consumer overrides specific parts while Kookie Flow handles everything else.

```tsx
const CompareNode: EntityTypeDefinition = {
  type: 'compare',
  inputs: [
    { name: 'reference', type: 'image', row: ReferenceImageRow },
  ],
  outputs: [
    { name: 'images', type: 'image', preview: { component: ImageGridPreview } },
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

---

## Socket Row Composition

Every node is a vertical stack of **socket rows**. Each row is a container with optional slots:

```
[dot]  [label?]  [preview?]  [widget?]
```

The library handles layout, spacing, socket positioning, connection logic, and hide-when-connected behavior. The consumer controls which slots are active:

```typescript
// Geometry node — label + slider widget (implemented)
{ name: 'factor', type: 'float', widget: 'slider', min: 0, max: 1 }

// Minimal — just a connectable dot (implemented)
{ name: 'value', type: 'float', label: false }

// AI node — label + inline preview + upload widget (planned — preview/row not yet on Socket type)
{ name: 'image', type: 'image', preview: 'inline', widget: 'file-upload' }

// Full override — consumer provides custom row component (planned)
{ name: 'reference', type: 'image', row: ReferenceImageRow }
```

`widget` = how the user provides/edits a socket's value (DOM, interactive). **Implemented.**
`preview` = how the user sees a socket's value (WebGL default, visual). **Planned** — not yet on the Socket interface.
`row` = escape hatch, consumer replaces the entire row content. **Planned** — not yet on the Socket interface.

---

## Preview System _(Planned)_

> Not yet implemented. See [Phases: Upcoming](./phases-upcoming.md) Phase 15.

Preview lives on **sockets**, not on the entity. It's the visual counterpart to `widget`: widget is "how you edit a value" (DOM), preview is "how you see a value" (WebGL default).

**Two forms:**

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

---

## What Kookie Flow Does NOT Do

- **No evaluation logic** — the library orchestrates (ordering, propagation, scheduling) but never computes. Consumer provides `onEvaluate`.
- **No persistence** — serialization via `toObject()`. Storage is the consumer's responsibility. Socket values (runtime state) are separate from entity data (config) and not serialized by default.
- **No AI integration** — Kookie AI builds on top of Kookie Flow, not inside it
- **No heavy media embeds** — PDF, spreadsheet, iframe are consumer entity types via `entityTypes`
