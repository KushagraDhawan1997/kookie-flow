# Kookie UI GL — Plan

A WebGL component library for R3F scenes, starting with MSDF text rendering extracted from kookie-flow.

---

## Current State (kookie-flow)

### What exists today

The MSDF text pipeline in kookie-flow is a full GPU-accelerated text rendering system:

| Layer | Files | Domain-coupled? |
|-------|-------|-----------------|
| **MSDF Shader** | `src/utils/msdf-shader.ts` | No — pure GLSL |
| **Font metrics & atlas** | `src/core/embedded-font.ts`, `public/fonts/*-msdf.{png,json}` | No — static assets |
| **Glyph layout** | `measureText`, `wrapTextMSDF`, kerning map in layout utils | No — pure functions |
| **Buffer population** | `populateGlyphBuffers` | No — pure function writing to Float32Arrays |
| **Font context** | `src/components/FontContext.tsx` | Lightly — font preset system, but mostly generic |
| **Text weight renderer** | `TextWeightRenderer` component | Lightly — generic instanced mesh renderer |
| **Multi-weight orchestrator** | `MultiWeightTextRenderer` | Lightly — coordinates multiple weight renderers |
| **Text entry collection** | `collectTextEntries` | **Yes** — reads entities, sockets, edges, selection, theme |
| **Text entities** | `TextEntities` component | **Yes** — specific to text node type |

### Technique: MSDF (Multi-channel Signed Distance Field)

- Font atlas: BMFont JSON metrics + MSDF PNG texture (RGB channels encode signed distance)
- Fragment shader: sample RGB → median → `smoothstep` with `fwidth` → resolution-independent anti-aliasing
- Rendering: one `InstancedMesh` per font weight, one quad per glyph
- Buffers: pre-allocated `Float32Array` for matrices (4x4), UV offsets, colors, opacity
- Kerning: precomputed packed map `(first << 16) | second → amount`
- Word-wrap: whitespace-boundary breaking with character-level fallback, results cached
- Anchoring: pre-measure text width, offset start position (left/center/right)

### Why it's fast

- **One draw call per font weight** — all text batched into shared `InstancedMesh`
- **Zero allocations in hot paths** — pre-allocated buffers, dirty flags
- **No React re-renders** — positions updated via refs + `useFrame`, not props
- **Caching** — truncation cache (1000 entries), word-wrap cache (500 entries)
- **Frustum culling** — only process visible text

---

## Target: `<TextGL>` Component

### Desired API

```tsx
import { TextGLProvider, TextGL } from '@kookie-ui/gl'

function Scene() {
  return (
    <Canvas>
      <TextGLProvider font={googleSansFont}>
        <TextGL
          text="Hello world"
          fontSize={14}
          color="#ffffff"
          position={[100, 200, 0]}
          anchor="center"
          fontWeight="semibold"
        />
        <TextGL
          text="Wrapped text in a box"
          fontSize={12}
          color="#aaaaaa"
          position={[0, 50, 0]}
          maxWidth={200}
          lineHeight={1.4}
          opacity={0.8}
        />
      </TextGLProvider>
    </Canvas>
  )
}
```

All `<TextGL>` children batched into shared instanced meshes internally — declarative API, imperative performance.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `text` | `string` | required | Text content |
| `fontSize` | `number` | `14` | Size in world units |
| `color` | `string` | `'#000000'` | Hex or rgb color |
| `position` | `[number, number, number]` | `[0,0,0]` | World position |
| `anchor` | `'left' \| 'center' \| 'right'` | `'left'` | Horizontal alignment |
| `fontWeight` | `'regular' \| 'semibold' \| 'bold'` | `'regular'` | Weight (must be loaded) |
| `maxWidth` | `number` | `undefined` | Enables word-wrap |
| `lineHeight` | `number` | `1.2` | Line height multiplier |
| `maxHeight` | `number` | `undefined` | Clip overflow |
| `opacity` | `number` | `1` | Alpha |
| `visible` | `boolean` | `true` | Toggle rendering |

---

## Extraction Plan

### Phase 1 — Pure utilities (no React)

Extract domain-free code into a standalone module:

- **Shader source** — vertex + fragment GLSL strings
- **Font types** — `BMFont`, `Glyph`, `KerningMap`, `FontMetrics` interfaces
- **Layout functions** — `measureText`, `wrapTextMSDF`, `computeKerningMap`
- **Buffer population** — `populateGlyphBuffers` (text entries → typed arrays)
- **Font loading** — parse BMFont JSON, load atlas texture

These are pure functions with zero React or R3F dependency. They can be tested in isolation.

### Phase 2 — Instancing manager (React + R3F)

The core architecture challenge: bridging declarative `<TextGL>` components with batched instanced rendering.

**Pattern: Provider + registration (like R3F `<Instances>`)**

```
TextGLProvider
  ├── Maintains registry of all TextGL children
  ├── Owns InstancedMesh(es) — one per font weight
  ├── On any child update: re-populate buffers, set dirty flags
  └── useFrame: if dirty, update GPU buffers

TextGL (child)
  ├── On mount: register with provider (text, position, style)
  ├── On prop change: notify provider of update
  ├── On unmount: deregister
  └── Renders nothing to the scene directly
```

Key decisions:
- **Buffer sizing** — start with a capacity, grow by 2x when exceeded (amortized)
- **Update granularity** — full repopulate vs. patching individual entries. Full repopulate is simpler and fast enough for <10k glyphs. Patching needed beyond that.
- **Sort order** — Z-index or registration order? Registration order is simplest.

### Phase 3 — Font pipeline

Users need to go from `.ttf`/`.otf` → MSDF atlas + metrics JSON.

Options:
1. **CLI tool** wrapping `msdf-atlas-gen` — user runs `kookie-gl font generate ./MyFont.ttf`
2. **Pre-built font packs** — ship common fonts (Inter, Geist, system fonts) as npm packages
3. **Runtime generation** — too slow, not viable for production

Recommended: ship a few pre-built packs + CLI for custom fonts.

### Phase 4 — Integrate back into kookie-flow

Replace kookie-flow's internal MSDF system with the extracted library. The flow-specific collection layer (`collectTextEntries`) stays in kookie-flow, but it feeds `TextEntry` objects to the library's rendering system.

---

## Architecture Challenges

### Batching vs. declarative API

The tension: React wants `<TextGL text="..." />` per string. Performance wants one buffer for everything. Resolution: the Provider pattern above — children register data, provider owns the mesh.

### Y-axis convention

- kookie-flow: Y-down (DOM-like)
- Three.js standard: Y-up
- Decision needed: should the library default to Y-up (Three.js convention) and let kookie-flow flip? Probably yes — a general-purpose library should follow R3F norms.

### Dynamic text & buffer resizing

When text content changes, glyph count changes. The buffer may need to grow. Strategy:
- Track total glyph capacity across all registered entries
- If new total exceeds buffer size, reallocate at 2x
- Reuse shrunk buffers (don't shrink eagerly — hysteresis)

### Font weight multiplexing

One `InstancedMesh` per weight (separate atlas texture). Provider needs to:
- Track which weights are in use
- Lazily create meshes only for weights that have entries
- Tear down meshes when a weight is no longer used

---

## Package Structure

```
@kookie-ui/gl
├── src/
│   ├── text/
│   │   ├── core/           # Phase 1: pure utilities
│   │   │   ├── shader.ts        # MSDF vertex + fragment GLSL
│   │   │   ├── layout.ts        # measureText, wrapText, kerning
│   │   │   ├── buffers.ts       # populateGlyphBuffers
│   │   │   ├── font-loader.ts   # parse BMFont JSON, load atlas
│   │   │   └── types.ts         # BMFont, Glyph, FontMetrics, TextEntry
│   │   ├── TextGLProvider.tsx    # Phase 2: instancing manager
│   │   ├── TextGL.tsx            # Phase 2: declarative component
│   │   └── index.ts
│   ├── fonts/               # Phase 3: pre-built font packs
│   │   ├── google-sans/
│   │   ├── inter/
│   │   └── geist/
│   └── index.ts
├── package.json
│   peerDependencies:
│     react, @react-three/fiber, three
└── tsconfig.json
```

---

## Open Questions

1. **Scope of `@kookie-ui/gl`** — just text, or plan for other GL primitives too (`BadgeGL`, `PanelGL`, rounded rect backgrounds)?
2. **Outline / stroke support** — the current shader has outline uniforms but they're not exposed. Include in v1?
3. **Text selection / interaction** — any need for hit-testing on individual text elements?
4. **Accessibility** — how to handle a11y for GL-rendered text? Hidden DOM mirror?
5. **Animation** — should `<TextGL>` props be spring-animatable (e.g. via `@react-spring/three`)?