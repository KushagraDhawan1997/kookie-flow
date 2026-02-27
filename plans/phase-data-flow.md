# Phase 8.5: Data Flow & Evaluation Plumbing

> Back to [PLAN.md](./PLAN.md)

**Status:** Planned

---

**Goal:** Reactive data plumbing layer on top of the graph engine. The library orchestrates evaluation — ordering, value propagation, dirty tracking, status lifecycle, cancellation. The consumer provides one function: given inputs, return outputs.

**Design principle:** The library owns the plumbing, not the computation. It never knows what "blur an image" means. But it absolutely knows "this entity's inputs changed, someone should re-evaluate it, and the result goes to these downstream entities."

---

## Socket Values Store

Socket values live in a **separate store**, not on entity data. Entity data is configuration (what the entity IS). Socket values are runtime state (what it computed). Different lifecycles, different serialization needs.

```typescript
// Separate from entity data — not serialized with toObject()
socketValues: Map<string, unknown>  // key: 'entityId:socketId'

// Library resolves the effective input value:
// Connected → upstream output value
// Not connected → widget value (from entity data / defaultValue)
resolvedInput = isConnected(socket) ? socketValues.get(upstreamKey) : widgetValue
```

Consumer's `onEvaluate` always receives resolved values — it never thinks about where a value came from.

---

## Hybrid Evaluation Model

Nodes declare their evaluation mode on the entity type:

```typescript
entityTypes={{
  'math/add': {
    evaluation: 'reactive',  // auto-evaluate when inputs change
    inputs: [...],
    outputs: [...],
  },
  'ai/generate': {
    evaluation: 'manual',    // wait for explicit trigger
    inputs: [...],
    outputs: [...],
  },
}}
```

**Reactive nodes** auto-evaluate when their resolved inputs change. **Manual nodes** are gates — dirty propagation reaches them, marks them dirty, but evaluation waits for explicit trigger. When a manual node is triggered, downstream reactive nodes cascade automatically until the next manual gate.

```
[Slider changed] → [Add: reactive ⚡] → [Multiply: reactive ⚡] → [Generate: manual 🔴] → [Upscale: reactive]
                     auto-evaluates        auto-evaluates           marked dirty, STOPS     waiting for Generate
```

User clicks "Run" on Generate:

```
[Generate: manual ▶️] → [Upscale: reactive ⚡]
 evaluates                auto-evaluates
```

---

## Consumer API

The consumer provides one function:

```typescript
<KookieFlow
  onEvaluate={async (entityId, entityType, inputs, ctx) => {
    // inputs: resolved values for all input sockets
    // ctx.signal: AbortSignal (cancelled if inputs change mid-evaluation)
    // ctx.progress: (n: number) => void (0-1, drives progress indicator)

    switch (entityType) {
      case 'math/add':
        return { result: inputs.a + inputs.b };

      case 'ai/generate':
        ctx.progress(0);
        const image = await generateImage(inputs.prompt, {
          model: inputs.model,
          signal: ctx.signal,
          onProgress: ctx.progress,
        });
        return { image };

      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }
  }}
/>
```

Imperative API for manual triggers:

```typescript
const flowRef = useRef<KookieFlowInstance>(null);

flowRef.current.evaluate('entity-123');      // evaluate one entity
flowRef.current.evaluateDirty();             // evaluate all dirty entities
flowRef.current.evaluateAll();               // re-evaluate entire graph
flowRef.current.setSocketValue(entityId, socketId, value);  // inject value
flowRef.current.getSocketValue(entityId, socketId);         // read value
```

---

## Status Lifecycle

The library auto-manages entity status during evaluation:

| Phase | Status set by library | Visual |
|---|---|---|
| Inputs changed, not yet evaluated | `dirty` | Subtle stale indicator |
| `onEvaluate` called | `running` | Pulsing accent border animation |
| `onEvaluate` returns | `success` | Brief green flash, then clears |
| `onEvaluate` throws | `error` + `statusMessage` | Red border, persists |
| Evaluation cancelled (inputs changed) | Back to `dirty` | Stale indicator |

Consumer can override or supplement:

```typescript
onStatusChange={(entityId, status, message) => {
  // Custom UI: toast, sidebar panel, logging, etc.
}}
```

---

## What the Library Auto-Manages

| Concern | How |
|---|---|
| **Value resolution** | Connected → upstream value. Unconnected → widget/default value. |
| **Dirty tracking** | Widget change, connection change, upstream output change → mark dirty + downstream. |
| **Evaluation scheduling** | Topo-ordered via `executionLevels()`. Parallel where possible via `getReadyEntities()`. |
| **Value propagation** | After evaluation, store outputs → move to downstream inputs → trigger reactive cascade. |
| **Status lifecycle** | Auto-set `dirty` → `running` → `success`/`error` on entities. |
| **Cancellation** | Inputs change mid-evaluation → abort via `AbortSignal` → re-evaluate with new inputs. |
| **Widget visibility** | Input socket connected → hide widget. Disconnected → show widget. |
| **Preview updates** | Output socket value arrives → preview re-renders with new data. |
| **Muted nodes** | Muted entities skipped in evaluation. Inputs pass through (bypass). |

## What the Consumer Provides

1. **`onEvaluate` callback** — given entity + resolved inputs, return outputs.
2. **`evaluation` on entity type** — `'reactive'` or `'manual'` per type.
3. **When to trigger manual nodes** — via imperative API (`evaluate()`, `evaluateDirty()`).

---

## Tasks

- [ ] Socket values store (`socketValues: Map<string, unknown>`, separate from entity data)
- [ ] Value resolution logic (connected → upstream value, unconnected → widget/default value)
- [ ] `evaluation` field on `EntityTypeDefinition` (`'reactive' | 'manual'`, default: `'reactive'`)
- [ ] `onEvaluate` callback prop with `(entityId, entityType, inputs, ctx)` signature
- [ ] Evaluation context: `AbortSignal` for cancellation, `progress()` for progress reporting
- [ ] Reactive cascade: widget change → evaluate reactive entities → stop at manual gates
- [ ] Manual trigger: `evaluate(entityId)`, `evaluateDirty()`, `evaluateAll()` on imperative API
- [ ] Dirty tracking: automatic marking on input change, connection change, upstream output change
- [ ] Value propagation: after evaluation, store outputs → feed downstream inputs
- [ ] `dirty` status added to `EntityStatus` type, with GPU-rendered visual indicator
- [ ] Status lifecycle: auto-set `dirty` → `running` → `success`/`error` during evaluation
- [ ] `onStatusChange` callback for consumer-side status handling
- [ ] Cancellation: abort in-flight evaluation when inputs change, re-evaluate with new values
- [ ] `setSocketValue()`, `getSocketValue()` on imperative API
- [ ] Muted entity bypass in evaluation (inputs pass through to outputs)
- [ ] Tests for evaluation lifecycle, dirty propagation, reactive/manual hybrid, cancellation
