# Phase 10: Text Entity ✅

> Back to [PLAN.md](./PLAN.md)

---

**Goal:** Standalone text entity — plain text on canvas with word wrap, auto-sizing, and Figma-quality inline editing. No visual container (no rounded rect body), just text within a bounding box.

Architecture note: Text, Image, Video, and Mesh follow a "standalone vs. embedded" pattern. A Text entity exists independently on canvas. The same `TextEntityData` interface is reused when text appears as a shape inside a Draw entity (`data.shapes[{ type: 'text', ...TextEntityData }]`). This phase covers the standalone entity only.

## Rendering Architecture: Instanced MSDF + Hidden Textarea

- **Display:** Instanced MSDF rendering via `text-entities.tsx` — single draw call for all text entities, crisp at any zoom, uses the same `text-layout.ts` glyph pipeline as labels
- **Editing:** Hidden `<textarea>` captures keyboard/IME/clipboard natively. All visual rendering (text, cursor, selection) in WebGL. Zero visual shift entering/exiting edit mode
- **Word wrap:** `wrapTextMSDF()` in `text-layout.ts` using BMFont glyph metrics — same measurements for display and editing cursor positioning
- **Z-order:** MSDF quads participate in scene draw order like any other entity
- **Graph participation:** Text entities can have optional `inputs`/`outputs` sockets

**Why not DOM?** DOM elements in `DOMLayer` always render on top of the WebGL canvas. A DOM-based text entity can never appear behind a WebGL-rendered node. Z-ordering is broken — dealbreaker for a freeform canvas.

---

## Key Files

| File | Purpose |
|---|---|
| `text-entities.tsx` | Instanced MSDF renderer (single draw call for all text entities) |
| `text-edit-overlay.tsx` | Hidden textarea for keyboard/IME/clipboard capture |
| `text-edit-cursor.tsx` | WebGL cursor line + selection rectangles |
| `text-cursor-layout.ts` | Character position mapping, hit testing, cursor geometry |
| `text-layout.ts` | MSDF glyph positioning, text measurement, word wrap |
| `text-texture.ts` | Text style resolution, auto-height calculation |

---

## Implementation Checklist

### 10A: Types & Entity Plumbing ✅

- `TextEntityData` with `content`, `fontSize`, `fontFamily`, `fontWeight`, `textColor`, `textAlign`, `lineHeight`, `letterSpacing`
- `isTextEntity()` type guard
- Skip `entity.type === 'text'` in `nodes.tsx` render loop
- `'data'` change type in `EntityChange` union
- Text constants in `constants.ts`

### 10B: Text Utilities ✅

- `TextStyleConfig` interface — single source of truth for style resolution
- `resolveTextStyle(data, defaults?)` — entity data + theme defaults
- `wrapTextMSDF()` — word wrap using BMFont glyph widths
- `measureTextBlockMSDF()` — text measurement via MSDF glyph metrics
- `calculateTextAutoHeightMSDF()` — auto-height calculation
- `populateMultiLineGlyphBuffers()` — character-walking for instanced rendering
- Placeholder rendering ("Type something...") at 30% opacity

### 10C: WebGL Renderer ✅

- Instanced MSDF rendering — single `InstancedMesh` per font weight
- Pre-allocated `Float32Array` GPU buffers
- Viewport frustum culling
- Dirty flag pattern with store subscription
- Keeps rendering during editing (reads live `editingContent` from store)

### 10D: Sizing Logic ✅

- `calculateTextAutoHeight()` utility
- Text entities created with `resizable: { width: true, height: false }` (E/W handles only)
- Auto-height on resize: width changes → content reflows → height auto-adjusts

### 10E: Inline Editing (contenteditable) ✅ → superseded by 10G

- `editingEntityId: string | null` in Zustand store
- Timer-based double-click detection (300ms, 5px tolerance)
- Note: contenteditable caused visible shift. Replaced by hidden textarea in 10G.

### 10F: Integration & Polish ✅

- `T` key creates text entity at viewport center, immediately enters edit mode
- Escape guard: exits editing before deselecting
- Keyboard guard: `isContentEditable` check prevents Delete from deleting entity while editing

### 10G: WebGL-Native Text Editing (Hidden Textarea) ✅

- **Store:** `editingContent`, `editingCursor`, `startEditing()`, `stopEditing()` actions
- **Cursor layout (`text-cursor-layout.ts`):**
  - `buildCharPositionsForEntity()` → `CharPositionTable` from BMFont metrics
  - `getCursorXY()` — cursor position from content offset
  - `getSelectionRects()` — one rect per selected visual line
  - `hitTestCharOffset()` — click world coords → content offset
  - `contentOffsetToLineColumn()` / `lineColumnToContentOffset()` — arrow key navigation
- **WebGL cursor (`text-edit-cursor.tsx`):**
  - Cursor: single `Mesh`, 1.5px wide, 530ms blink
  - Selection: `InstancedMesh` (max 50), accent color 30% opacity
  - `useFrame` reads from store via dirty flags
- **Hidden textarea (`text-edit-overlay.tsx`):**
  - Invisible `<textarea>` (opacity 0, 1×1px, pointerEvents none)
  - `getEditingTextarea()` accessor for InputHandler sync
  - ArrowUp/Down intercepted for wrapped line navigation
  - Escape commits and exits, blur commits with RAF delay

### 10H: Text Editing Polish ✅

- Numeric kerning map keys — `(first << 16) | second` eliminates string allocation per char per frame
- Multi-click: double→word, triple→line, quad→block
- Drag-to-select within editing entity
- Home/End navigate wrapped lines, Ctrl+Up/Down for paragraph nav
- Overflow clipping for fixed-height entities
- Edge-to-edge selection rects (Figma-style)
- `'data'` entity changes handled in `useGraph` + `applyEntityChanges`
- `breakWordByChars` for long words exceeding entity width

### 10I: Socket Positioning & Graph Participation ✅

- Optional `inputs`/`outputs` for graph participation
- Bidirectional vertical centering: `centerOffset = (entityHeight - computedHeight) / 2`
- Headerless entity types use `padding` instead of `marginTop` in `socket-layout-cache.ts`
- Render tree reorder: `<TextEntities />` before `<Edges />` and `<Sockets />`
- `_movedEntityIds` accumulation fix for multiple auto-size calls per frame

### 10J: Text Sizing Modes ✅

- `TextSizingMode`: `'auto-width'` | `'auto-height'` | `'fixed'`
- `calculateTextAutoSizeMSDF()` for auto-width mode (no wrapping)
- `resizableForSizingMode()` — maps mode to `resizable` property
- Mode-aware dimension logic in text-entities.tsx useFrame
- `sizingMode` segmented control in toolbar
- `applyEntityChanges` auto-derives `resizable` from `sizingMode`

---

## Deferred (10-Later)

- Style runs (bold/italic/underline within text)
- Emoji support (limited to MSDF atlas character set)
- Font selection UI
- Nested text inside Draw entities
- IME popup positioning (currently shows near 0,0)
