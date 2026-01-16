# CLAUDE.md - Kookie Flow

## Performance > Everything

**This is the #1 priority. Nothing else matters if performance suffers.**

Before writing ANY code, ask yourself:

1. Does this trigger React re-renders during pan/zoom/drag? **UNACCEPTABLE.**
2. Does this allocate memory in hot paths (event handlers, render loops)? **UNACCEPTABLE.**
3. Is this O(n) when it could be O(log n) or O(1)? **UNACCEPTABLE.**

### Rules (never violate these)

| Rule                                          | Why                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Zero React re-renders during interactions** | Use refs for all position/transform updates. React state only for element creation/removal. |
| **RAF-throttled DOM updates**                 | Never update DOM synchronously in event handlers. Schedule via `requestAnimationFrame`.     |
| **Pre-allocated buffers**                     | GPU buffers sized once at init. No allocations during render.                               |
| **Dirty flags over subscriptions**            | Don't re-render on every state change. Track what changed, update only that.                |
| **Spatial indexing for hit testing**          | Quadtree for O(log n). Never iterate all nodes in event handlers.                           |
| **Ref-based position updates**                | `element.style.transform` via refs, not React props.                                        |

### Correct Pattern

```typescript
// ✅ CORRECT: Ref-based updates, RAF throttling
const labelsRef = useRef<Map<string, HTMLDivElement>>(new Map());
const rafIdRef = useRef<number>(0);

const updatePositions = useCallback(() => {
  rafIdRef.current = 0;
  const { nodes } = store.getState();
  labelsRef.current.forEach((el, id) => {
    const node = nodes.find((n) => n.id === id);
    if (node) el.style.transform = `translate3d(${node.x}px, ${node.y}px, 0)`;
  });
}, [store]);

// Subscribe triggers RAF, not direct update
store.subscribe(() => {
  if (rafIdRef.current === 0) {
    rafIdRef.current = requestAnimationFrame(updatePositions);
  }
});

// React state ONLY for element count changes
if (state.nodes.length !== nodes.length) setNodes(state.nodes);
```

```typescript
// ❌ WRONG: React props for positions = re-renders every frame
{nodes.map(node => (
  <Label key={node.id} x={node.position.x} y={node.position.y} />  // NEVER DO THIS
))}
```

---

## Do Not Build

Never run build commands like `npm run build` or `pnpm build`—watchers are already running.

---

## WebGL & R3F Guidelines

### Coordinate System

- **World space:** Y-down (matches DOM), origin at top-left
- **Screen space:** Pixels from viewport top-left
- **Camera:** Orthographic, looking at Z=0 plane
- **Transform:** `screenPos = (worldPos + viewport.offset) * viewport.zoom`

### Shader Development

- WebGL Y-axis is up, but our world uses Y-down
- Negate Y when converting world → GL coordinates
- Instance matrices should position node centers, not corners
- SDF functions expect coordinates centered at (0,0)

### GPU Buffer Management

- Always use `useMemo` for geometry/material creation
- Instance attributes should use `Float32Array`, not regular arrays
- Pre-allocate GPU buffers and reuse them (avoid GC pressure)
- Use dirty flags to skip unnecessary updates
- Set `needsUpdate = true` only when data actually changes

### Culling & Visibility

- Implement viewport frustum culling to only render visible elements
- Scale culling padding with zoom level: `padding / viewport.zoom`
- Account for Bezier curve bulge when culling edges

---

## State Management (Zustand)

- Use `subscribeWithSelector` for fine-grained updates
- Selection as `Set<string>` for O(1) operations
- Node map for O(1) lookup by ID
- Never create new arrays/objects in selectors during hot paths

---

## TypeScript & Types

- Avoid `any` and `as` assertions. Prefer proper typing.
- Use explicit types for public API surfaces.
- Leverage inference for internals.
- No non-null assertions (`!`) unless unavoidable.
- Update types in `src/types/index.ts` first when adding features.

---

## Component Design

- Prefer small, focused components.
- Function components + hooks only.
- Good props design: avoid > 7-8 props.
- No business logic in JSX.
- Keep state local where possible.

---

## Error Handling

- No empty `catch` blocks.
- Surface meaningful errors to users.
- Log technical details centrally.
- Use Error Boundaries for isolation.

---

## Comments & Documentation

- Comment "why", not "what".
- Document tricky hooks/components.
- Update PLAN.md's phase tracking when adding features.

---

## Debugging

- Check browser console for Three.js warnings
- Use React DevTools to verify state updates
- R3F has `<Stats>` component for FPS monitoring
- Three.js inspector browser extension helps with scene debugging

---

## When In Doubt

- Prefer explicit, declarative, readable code.
- Follow established patterns in the codebase.
- If unsure whether something impacts performance, it probably does. Ask first.
- Align with React best practices and the patterns established in PLAN.md.
