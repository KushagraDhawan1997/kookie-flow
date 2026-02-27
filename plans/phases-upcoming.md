# Upcoming Phases (11–17)

> Back to [PLAN.md](./PLAN.md)

---

## Phase 11: Image Entity (In Progress)

**Goal:** Image on canvas done really well. Proper loading, resolution management, LOD.

Architecture note: Same "standalone vs. embedded" pattern as Text. `ImageEntityData` is reused when an image appears as a shape inside a Draw entity. The `ImageTextureManager` is shared infrastructure — standalone image entities and node preview blocks both use it.

### Done

- [x] Image entity type: Three.js textured quad (`image-entities.tsx`)
- [x] Async image loading via `ImageTextureManager` (`image-loader.ts`)
- [x] Resolution management: thumbnail at zoom-out, full res when zoomed in (LOD threshold at 256px screen width)
- [x] Memory management: ref-counted textures, disposed when no longer referenced
- [x] Viewport frustum culling
- [x] Object-fit modes: contain, cover, fill
- [x] Drag-and-drop from filesystem (`onFileDrop` callback prop)
- [x] Optional ports for graph participation

### Remaining

- [ ] Paste from clipboard
- [ ] Resizable via Phase 9.5 infrastructure (drag handles, aspect ratio lock option)

---

## Phase 12: 3D Mesh Entity (Planned)

**Goal:** 3D object on canvas. Orbit controls, proper lighting.

Architecture note: Same "standalone vs. embedded" pattern. `MeshEntityData` reused inside Draw entities.

- [ ] Mesh entity type: Three.js scene-in-scene
- [ ] Orbit controls (rotate, zoom, pan within entity bounds)
- [ ] Default lighting setup (ambient + directional)
- [ ] Display mode: static thumbnail (rendered to texture)
- [ ] Interactive mode: live Three.js scene as DOM overlay
- [ ] glTF/GLB loading
- [ ] Resizable via Phase 9.5 infrastructure
- [ ] Optional ports for graph participation
- [ ] Lazy loading: Three.js scene only mounted when needed

---

## Phase 13: Video Entity (Planned)

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

---

## Phase 14: Draw Entity (Planned)

**Goal:** Shapes, SVG paths, freeform drawing. The most complex rendering work.

- [ ] Draw entity type: contains shapes as `data.shapes[]`
- [ ] Shape primitives: rect, ellipse, path (Three.js ShapeGeometry + SDF shaders)
- [ ] SVG path support (THREE.SVGLoader → ShapePath → ShapeGeometry)
- [ ] Text as shape type within draw entities
- [ ] Freeform drawing (capture points → line geometry)
- [ ] Boolean path operations via CSG library
- [ ] Shape manipulation: resize handles, rotation
- [ ] Optional ports for graph participation
- [ ] Fill, stroke, gradients, opacity per shape

---

## Phase 15: Preview System (Planned)

**Goal:** Socket-level data visualization inside nodes. The library provides structure and default renderers; the consumer fills the slot.

Preview is the visual counterpart to widget: `widget` = "how you edit a value" (DOM), `preview` = "how you see a value" (WebGL default). Both live on sockets.

**Two forms:**
- **Inline** (`preview: 'inline'`): small thumbnail inside the socket row
- **Block** (`preview: true` or `preview: { height }` or `preview: { component }`): large region in node body

### Tasks

- [ ] `preview` field on Socket: `boolean | 'inline' | { height?: number; component?: React.ComponentType }`
- [ ] `preview-layer.tsx`: R3F component for block previews
- [ ] Shared `ImageTextureManager` between `image-entities.tsx` and `preview-layer.tsx`
- [ ] Preview region layout: socket layout cache accounts for preview height
- [ ] Default image preview: WebGL textured quad using `ImageTextureManager`
- [ ] Inline preview: small thumbnail in socket row
- [ ] Consumer override: `preview: { component: Custom }` for custom content
- [ ] SDF clipping: preview clipped to entity bounds with rounded corners
- [ ] Preview visibility: always show (unlike widgets which hide when connected)

---

## Phase 16: Entity Type Customization (Planned)

**Goal:** Three-level customization system for consumer entity types.

**Level 1: Pure Declaration (80% of nodes)**
- [ ] Rendering pipeline for `EntityTypeDefinition`: sockets → rows → widgets → previews from config
- [ ] Auto-generated widgets from socket declarations
- [ ] `preview: true` triggers default WebGL renderer (via Phase 15)

**Level 2: Custom Row / Preview Components (15% of nodes)**
- [ ] `row` field on Socket: consumer replaces entire row content
- [ ] `preview: { component: Custom }` — consumer fills preview slot
- [ ] Row/preview components receive standardized props from library

**Level 3: Full Escape Hatch (5% of nodes)**
- [ ] `component` field on `EntityTypeDefinition`: consumer owns entire interior
- [ ] Library still handles: frame, socket hit testing, edges, selection, dragging, status

---

## Phase 17: Polish & Production (Planned)

**Goal:** Production ready

- [ ] GPU-based hit testing (color picking) — alternative to quadtree if needed
- [ ] Virtual DOM pooling for labels (if DOM becomes bottleneck)
- [ ] Memory management (dispose textures)
- [ ] Performance profiling & benchmarks
- [ ] Accessibility (keyboard navigation, ARIA)
- [ ] Documentation site
- [ ] Examples gallery
