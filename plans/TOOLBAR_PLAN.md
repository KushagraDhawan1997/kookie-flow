# Toolbar Plan

## What

A floating toolbar that appears when a selection is made. One toolbar per selection — single entity or multi-select. Positioned relative to the selection's screen-space bounding box, follows during pan/zoom.

## Decisions Made

### Name: `Toolbar`
- Simple, no prefix needed — there's only one, context is obvious

### Rendering: Pure DOM
- Toolbar renders once per selection (single element, not hundreds of instances)
- No perf benefit from WebGL for a single floating div
- Avoids sync complexity of keeping a WebGL bg quad + DOM content aligned
- Same ref-based `translate3d` positioning as existing labels — proven pattern

### Visual: Kookie UI Card
- Uses Kookie UI's `Card` component as the container
- Consumer can pass Card props (variant, size, etc.) for full control
- Card handles all visuals — no custom shadows or backdrop filters needed
- Looks consistent across KookieFlow variants

### Selection model
- Toolbar belongs to the **selection**, not an individual entity
- Single entity selected = one toolbar
- Multi-select = one toolbar, centered on the selection bounding box
- Mixed-type multi-select: show only built-in defaults that apply to all selected types, or nothing

### Toolbar content: layered API
- kookie-flow ships built-in toolbar widgets for its own entity types
- Consumer opts in to which built-ins to show
- Consumer can add custom controls on top
- For custom entity types, toolbar is fully consumer-defined

### Positioning
- Auto-flip with collision awareness (check if toolbar clips above viewport, flip below)
- No Radix Popover — it expects a static DOM anchor, bad fit for a virtual anchor that moves every frame
- Simple manual collision detection is sufficient

### Hide during interactions
- Hidden during drag, pan, zoom, connection draw, selection box

### Render callback shape
```tsx
interface ToolbarRenderProps {
  /** All selected entities */
  entities: Entity[];
  /** Update one entity's data */
  update: (entityId: string, data: Partial<EntityData>) => void;
  /** The selection's screen-space bounding box */
  bounds: { x: number; y: number; width: number; height: number };
}
```
- `update` wraps `onEntitiesChange` internally — consumer just calls `update(id, { fontSize: 24 })`

## Built-in toolbar widgets

kookie-flow ships pre-built widgets for properties it knows about:

| Entity type | Available widgets |
|---|---|
| `text` | `fontSize`, `fontFamily`, `fontWeight`, `textColor`, `textAlign`, `lineHeight`, `letterSpacing` |
| `image` | `objectFit`, `aspectLock` |
| `comment` | `backgroundColor`, `textColor`, `fontSize` |
| default (any type) | `color` (node accent color) |

## API

### `toolbar` field on `EntityTypeDefinition`

```tsx
toolbar:
  | true                          // all built-in defaults for this entity type
  | false                         // no toolbar
  | string[]                      // pick specific built-in defaults
  | {
      defaults?: true | string[]; // which built-ins to include
      extra?: ToolbarRenderFn;    // custom controls appended after defaults
    }
  | ToolbarRenderFn               // full override — no built-ins, consumer owns everything
```

### Entity types drive toolbar content

The `type` field on each entity maps to `entityTypes[type].toolbar`. Different types = different toolbars, even if they render identically as nodes.

```tsx
const entityTypes = {
  // Built-in type: opt into specific default widgets
  text: {
    toolbar: ['fontSize', 'fontFamily', 'textAlign', 'textColor'],
  },

  // Built-in type: all defaults
  image: {
    toolbar: true,
  },

  // Custom type: built-in defaults + custom extras
  generator: {
    label: 'Generator',
    toolbar: {
      defaults: ['color'],
      extra: ({ entities, update }) => (
        <button onClick={() => update(entities[0].id, { bypass: true })}>
          Bypass
        </button>
      ),
    },
  },

  // Custom type: fully custom toolbar, no built-ins
  filter: {
    label: 'Filter',
    toolbar: ({ entities, update }) => (
      <select onChange={(e) => update(entities[0].id, { mode: e.target.value })}>
        <option>Fast</option>
        <option>Quality</option>
      </select>
    ),
  },

  // Custom type: no toolbar
  output: {
    label: 'Output',
    toolbar: false,
  },
};
```

### Usage

```tsx
const entities = [
  {
    id: 'gen-1',
    type: 'generator',        // matches entityTypes['generator']
    position: { x: 0, y: 0 },
    data: { label: 'Gen 1', bypass: false },
    inputs: [{ id: 'in-0', name: 'Prompt', type: 'string' }],
    outputs: [{ id: 'out-0', name: 'Image', type: 'image' }],
  },
  {
    id: 't1',
    type: 'text',
    position: { x: 300, y: 0 },
    data: { content: 'Hello', fontSize: 16 },
  },
];

<KookieFlow entities={entities} entityTypes={entityTypes} ...>
  <Toolbar />  {/* enables the feature — content resolved from entityTypes */}
</KookieFlow>
```

Select `gen-1` → toolbar shows color picker (built-in) + Bypass button (custom extra).
Select `t1` → toolbar shows fontSize, fontFamily, textAlign, textColor widgets.
Select entity with no `toolbar` defined → no toolbar appears.

## Architecture

### Injection point
`KookieFlow` passes `{children}` through to `DOMLayer`, which renders them inside a `pointer-events: none` overlay div. `<Toolbar />` lives here — no new injection points needed.

### Positioning implementation
- Subscribe to Zustand store for `selectedEntityIds`, `entityMap`, `viewport`
- Compute screen-space bounding box of selection
- Position toolbar centered above selection (auto-flip below if near top edge)
- Ref-based `translate3d` updates via microtask batching (same pattern as `CrispLabelsContainer`)
- `pointer-events: auto` on the toolbar div so controls are interactive

### Show/hide logic
- Visible when 1+ entities are selected and at least one has a toolbar defined
- Hidden during drag, pan, zoom, connection draw, selection box
- Hidden when selection is off-screen (frustum culling)
- Animate in/out with CSS transition (opacity + slight translateY)

## Not Started Yet
- Type definitions (ToolbarRenderProps, toolbar field on EntityTypeDefinition)
- Built-in widget components (fontSize, textAlign, objectFit, etc.)
- Toolbar container component (positioning, show/hide, Card wrapper)
- Demo page integration
