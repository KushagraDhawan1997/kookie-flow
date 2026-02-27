# Technical Decisions

> Back to [PLAN.md](./PLAN.md)

---

## Why R3F over raw WebGL or Pixi.js

| Option           | Pros                                                 | Cons                                                |
| ---------------- | ---------------------------------------------------- | --------------------------------------------------- |
| **Raw WebGL**    | Full control, smaller bundle                         | Massive effort, reinvent everything                 |
| **Pixi.js**      | Great 2D perf, batching                              | No 3D, would need second renderer for mesh previews |
| **Three.js/R3F** | Mature, great tooling, 3D support, React integration | Slight overhead, 3D concepts leak into 2D           |

**Decision:** R3F. The 3D mesh preview feature is a key differentiator. Same WebGL context means no separate canvas per preview. The overhead is minimal and the ecosystem is excellent.

## Why Zustand over Context/Redux

- Fine-grained subscriptions with `subscribeWithSelector`
- No provider nesting required
- Works outside React (imperative API)
- Tiny bundle size (~1KB)
- React Flow uses it, familiar to target users

## Why Instanced MSDF for Text

**Initial approach (Phase 7A):** DOM text overlays. With LOD and culling, aimed for ~50-100 visible labels.

**Problem discovered:** At 1000+ nodes with socket/edge labels enabled, DOM causes 30-40fps drop even with ref-based updates, RAF throttling, and viewport culling. The composite layer overhead of hundreds of DOM elements is unavoidable.

**WebGL text options evaluated:**

| Option                    | Pros                                   | Cons                                            |
| ------------------------- | -------------------------------------- | ----------------------------------------------- |
| **troika-three-text**     | Easy API, SDF quality                  | 1 draw call per Text instance → 500+ kills perf |
| **Thomas**                | R3F-native, claims instancing          | Last release June 2023, risky dependency        |
| **three-msdf-text-utils** | Good shader, maintained                | No instancing (1 mesh per label)                |
| **Canvas-to-texture**     | Simple                                 | Blurry on zoom, expensive updates               |
| **Custom instanced MSDF** | 1 draw call for ALL text, full control | Engineering effort                              |

**Decision:** Custom instanced MSDF (Phase 7.5). One `InstancedMesh` where each instance = one glyph quad. 80,000 glyphs = 1 draw call = 60fps.

**What stays in DOM:** Interactive widgets (inputs, dropdowns), custom node content (escape hatch). These are few in number and viewport-culled to ~50-100 max.

## Why Instanced MSDF + Hidden Textarea for Text Entities

Text **labels** and text **entities** both use instanced MSDF — same pipeline, same draw call batching, same BMFont metrics.

**Original decision (10A–10F):** Canvas2D → Texture for rendering + contenteditable for editing. In practice there was a visible shift when entering/exiting edit mode due to subtle CSS vs Canvas2D glyph positioning differences.

**Revised decision (10G):** Instanced MSDF for rendering + hidden textarea for editing. The hidden textarea pattern (Figma, Monaco, Google Docs) eliminates the contenteditable overlay entirely. All visual rendering (text, cursor, selection) happens in WebGL. The DOM `<textarea>` is invisible (1×1px, opacity 0) and only captures keyboard input, IME composition, and clipboard operations.

**Key insight — no font matching needed:** Since the textarea is invisible, there's no need to match two rendering engines. MSDF rendering uses BMFont glyph metrics for display. `text-cursor-layout.ts` uses the same BMFont metrics for cursor positioning and hit testing. One set of measurements, zero mismatch.

| Option | Pros | Cons |
|--------|------|------|
| **Canvas2D + contenteditable** (original) | Same browser font engine | Metric mismatch, rasterized, texture memory |
| **MSDF + contenteditable** | Crisp at any zoom, 1 draw call | Two layout engines = font matching nightmare |
| **MSDF + hidden textarea** (chosen) | Crisp, 1 draw call, zero visual shift | Must reimplement cursor/selection in WebGL |
| **DOM** (like comments) | Perfect text, native everything | Z-index: DOM always above WebGL. Dealbreaker |

## Coordinate System

**Y-down** (matching DOM/Canvas2D conventions):

- Node position (0,0) is top-left of node
- Positive Y goes down
- Matches user mental model from DOM
- Camera offset negates position for Three.js (Y-up)

## Why "Optimized Core + Thin Plugins"

**The problem with generic plugins:**

- `entity.data` is user-defined — can contain functions, images, backend refs, anything
- Serialization is app-specific — we can't know what fields matter
- History/undo is app-specific — full snapshots don't scale, action-based needs data knowledge

**Our approach:**

| Layer            | What it handles                                                       | Example                                                 |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| **Core (store)** | Structural operations — cloning, ID remapping, batch insert, quadtree | `store.cloneElements()`, `store.addElements()`          |
| **Plugins**      | Event wiring — thin wrappers that call core methods                   | `useClipboard()` calls `store.copySelectedToInternal()` |
| **User code**    | Data transformation — what to copy, how to serialize, backend sync    | `transformData: (d) => ({ prompt: d.prompt })`          |

**Key principles:**

1. **Optimize what we can** — Structural operations (ID generation, edge remapping, batch updates) are universal. We optimize these in core.
2. **Don't pretend on what we can't** — Data transformation is app-specific. User provides callbacks, we call them efficiently.
3. **Internal clipboard is free** — Same-tab copy/paste needs no serialization. We just hold references and clone on paste.
4. **Same primitives for everyone** — Custom users call the same optimized methods our plugins use.

**Why no `useHistory` plugin:** Full state snapshots don't scale (10k nodes × 50 undo steps = 500MB). Action-based undo requires knowing all possible data mutations. Better to document patterns and let users implement what fits their scale/needs.

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
- Update the relevant plan document's phase tracking

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
| Edges.useFrame   | 27.4% | Expected — rebuilds edge geometry  |
| bufferSubData    | 19.3% | GPU upload for edge/socket buffers |

**Key findings:** 120fps maintained with 1000 nodes during drag. Quadtree is O(log n). Pan/zoom has no geometry rebuilds. Edge rebuild is expected when nodes move.

**Future optimizations (if scaling to 10k+ nodes):**

1. Throttle edge updates (every 2nd/3rd frame)
2. GPU-based node positions (positions in texture, read in vertex shader)
3. Partial edge updates (only edges connected to moved nodes)
4. LOD for edges (simplify curves at low zoom)
