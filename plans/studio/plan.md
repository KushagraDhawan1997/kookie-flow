# Studio: build plan

> Written 2026-09-12. Companion to [research.md](./research.md), which holds the stack decisions and
> their reasons. This file is the order of work, the shape of the code, and the rules for building
> unattended.

---

## 1. Shape

Two new workspace members, both AGPL-3.0-only. The library stays MIT.

```
packages/studio-core/     no React, no DOM. Runs in the browser, in workers, on the server.
  nodes/                  node definitions: sockets, widgets, run function, cost, description
  registry.ts             the catalog; search; EntityTypeDefinition for the canvas
  ops.ts                  GraphOp -> library changes; validation
  document.ts             FlowObject + meta; serialise, load, migrate
  cache.ts                content hashes, cache keys
  values.ts               MediaRef and the other socket value shapes
  providers/              fal adapter, model registry, schema import

apps/studio/              Next 15, App Router, kookie-ui, kookie-flow
  src/app/                routes
  src/editor/             canvas page: panels, chat, inspector, node library
  src/runtime/            onEvaluate, GpuClient, MediaClient, JobsClient, AssetClient
  src/workers/            gpu.worker.ts (WebGL2 + OffscreenCanvas), media.worker.ts (Mediabunny)
  src/server/             db (Drizzle), storage, jobs, agent, providers
  drizzle/                schema + migrations
  LICENSE                 AGPL-3.0
```

`studio-core` exists because the agent tools, the MCP server (later) and the server executor
(later) all need the catalog and the op compiler without importing a Next app.

### One node definition, five uses

```ts
defineNode({
  type: 'image/blur',
  label: 'Blur',
  category: 'image',
  description: 'Gaussian blur. Radius is a fraction of the image width.',   // read by the agent
  inputs: {
    image: socket('image'),
    radius: socket('float', { widget: 'slider', min: 0, max: 0.2, step: 0.001, default: 0.02 }),
  },
  outputs: { image: socket('image') },
  evaluation: 'reactive',                 // 'manual' for anything that costs money
  where: 'gpu',                           // 'inline' | 'gpu' | 'media' | 'server'
  run: (inputs, ctx) => ctx.gpu.run('blur', { radius: inputs.radius }, [inputs.image]),
});
```

From that one object: the canvas's `EntityTypeDefinition` (sockets, widgets, preview band,
evaluation mode), validation, the agent's tool schema, the published app's form (later), the MCP
tool (later).

### Values on sockets

| Socket type | Value |
|---|---|
| `image`, `video`, `mask` | `MediaRef`: `{ kind, id, hash, width, height, url?, preview? }`. GPU-resident images stay in the worker; `id` names the texture, `preview` is a small transferred `ImageBitmap` for the band |
| `text` | string |
| `float`, `int`, `seed` | number |
| `bool` | boolean |
| `color` | `#rrggbb` string |
| `list<T>` | array — phase 6, needs a library change |

Every media value is content-addressed. The `hash` of a GPU result is the hash of its cache key
(op id, version, params, input hashes, size); the hash of a file is sha-256 of its bytes. Equal hash
means equal pixels, so a re-run with unchanged inputs returns the cached value and the canvas does
nothing.

### The canvas is controlled

`useGraph` owns entities and edges and their history. A `GraphOp` (`add_node`, `remove_node`,
`connect`, `disconnect`, `set_params`, `move`) compiles to the library's own `EntityChange` and
`EdgeChange` batches and goes through the same `onEntitiesChange` / `onEdgesChange` as a drag does.
That is what gives the agent undo for free: a turn's ops are applied in one tick, and `useGraph`
records one undo step for one tick. The store is never written directly.

Widget values live where the library keeps them, `entity.data.values[socketId]`. Runtime outputs
live in the evaluation engine (`setSocketValue` / `getSocketValue`), never on entity data, so a run
never re-renders React.

### Where a node runs

| `where` | Runs in | Examples |
|---|---|---|
| `inline` | `onEvaluate` on the main thread, synchronous, microseconds | number, seed, template, math, if |
| `gpu` | `gpu.worker.ts`, WebGL2 on an OffscreenCanvas, one context, texture cache | blur, noise, aberration, blend |
| `media` | `media.worker.ts`, Mediabunny + WebCodecs | trim, concat, frame, export |
| `server` | `POST /api/jobs`, provider queue, result copied to storage | every AI node |

The evaluator (library) decides when; `onEvaluate` (app) looks the node up and dispatches on
`where`. Cancellation is `ctx.signal` end to end: a changed input aborts the worker call, or
cancels the provider job.

### Server

- **Database.** Drizzle. `DATABASE_URL` set: Postgres (Neon hosted). Unset: embedded PGlite in
  `apps/studio/.data/pg`, kept as a `globalThis` singleton so dev reloads do not reopen it. Same
  schema, same queries, so single-user self-hosting needs no database server at all.
- **Tables.** `graphs (id, workspace_id, name, doc jsonb, updated_at)`, `assets (id, workspace_id,
  hash, mime, bytes, width, height, key)`, `jobs (id, workspace_id, graph_id, node_id, provider,
  provider_id, status, input jsonb, output jsonb, cost, created_at, updated_at)`. `workspace_id` is
  on every table from day one and is a constant until auth lands.
- **Storage.** `Storage` interface: `put(hash, bytes, mime)`, `url(key)`. `local` writes
  `apps/studio/.data/blobs/<hash>` and serves it at `/api/blob/<hash>`. `r2` uses presigned PUTs
  and a public bucket URL. Chosen by env.
- **Jobs.** `POST /api/jobs` submits to the provider and stores `provider_id`. `GET /api/jobs/:id`
  returns the row and, if still pending, asks the provider for status first. So dev works with no
  public URL; the fal webhook at `/api/hooks/fal` is an optimisation for production. A finished job
  fetches the provider's file, hashes it, stores it, and writes the `MediaRef` into `output`.
- **Providers.** `Provider` interface: `submit`, `status`, `cancel`, `fetchResult`, `estimate`,
  `verifyWebhook`. fal first. Model entries are generated from fal's per-endpoint OpenAPI schema
  with a small hand-written map from schema fields to sockets. `MOCK_PROVIDERS=1` returns generated
  placeholder images after a delay so the whole pipeline runs with no key and no cost.

### Agent

Anthropic SDK, `claude-opus-5`, adaptive thinking, server-side `fallbacks: "default"`, prompt
caching on the system prompt and tool list. No wrapper framework.

The loop is client-driven and the client owns the message history:

1. `POST /api/agent/step` with messages. The route streams the model's turn as SSE.
2. Server tools (`search_nodes`, `estimate`, `inspect`) execute inside the route and the loop
   continues there.
3. Browser tools (`read_graph`, `apply_ops`, `run`) end the step. The client executes them against
   the live graph, appends the `tool_result`s, and calls step again.

| Tool | Where | Returns |
|---|---|---|
| `search_nodes(query)` | server | node types with schemas; the catalog is never dumped into context |
| `read_graph(focus?)` | browser | compact text: short ids, non-default params, edges as `a.out -> b.in` |
| `apply_ops(ops[])` | browser | applied ops, diff, validation errors |
| `run(nodeIds)` | browser | job ids; nodes whose cache hits are reported as skipped |
| `estimate(nodeIds)` | server | credits and time per node |
| `inspect(nodeId)` | server | the output downscaled to 768px as an image block; a few frames for video |

`inspect` is what closes the loop: the agent looks at what it made and fixes it. Opus 5 reads
images inside `tool_result`.

### Library changes (packages/kookie-flow)

Small, early:

1. `classifyPreviewValue` accepts an object carrying `preview: string | ImageBitmap`, so a
   `MediaRef` on an output socket draws its own band. Today only a bare string or bitmap draws.
2. The reducers inside `useGraph` become pure exported functions, `applyEntityChanges(entities,
   changes)` and `applyEdgeChanges(edges, changes)`, with the hook calling them. No behaviour change;
   the server and MCP apply ops to a `FlowObject` through the same code.

Later, for phase 6 (logic):

3. `skipped` status: an untaken branch marks downstream skipped, not dirty or error.
4. `list<T>` socket types and the connection rule for list-to-scalar.
5. Subgraph evaluation: a node whose body is a graph, with exposed sockets. for-each and loop-until
   are built on it. Cycles stay out of the top-level graph.

---

## 2. Phases

Each phase ends green: `tsc`, unit tests, and the app boots and does the thing in a real browser.

| # | Phase | Delivers | Needs |
|---|---|---|---|
| 1 | Shell | `apps/studio` + `packages/studio-core`; turbo wiring; AGPL licences; theme mechanism copied from docs; `/` graph list, `/g/[id]` editor; node library, inspector, top bar; PGlite + Drizzle; autosave; local storage adapter | — |
| 2 | Logic | `defineNode`, registry, `GraphOp` compiler, `onEvaluate` dispatch, cache; nodes: number, seed, text, template, concat, math expr, remap, clamp, color; library change 2 | — |
| 3 | GPU | `gpu.worker.ts` (WebGL2, OffscreenCanvas, texture cache, readback); `GpuClient`; nodes: upload, resize, crop, blur, levels, noise, chromatic aberration, blend, mask, grain, vignette, dither, stats; previews via library change 1; golden-image tests | — |
| 4 | AI | jobs table + routes, fal adapter, schema import, mock mode, asset copy; nodes: text-to-image, edit-image, upscale, remove-background, image-to-video, describe (Claude vision), judge | `FAL_KEY`, `ANTHROPIC_API_KEY` to test for real; mock otherwise |
| 5 | Agent | `/api/agent/step`, tools, chat panel, streaming, one undo step per turn, inspect | `ANTHROPIC_API_KEY` |
| 6 | Control | library changes 3–5; nodes: if, switch, gate, list, range, zip, cartesian, pick, filter, for-each, loop-until, rank | — |
| 7 | Video | `media.worker.ts`, Mediabunny; nodes: trim, concat, speed, frame, per-frame effect, export; time nodes | — |
| 8 | Templates | subgraph as a node, template gallery, app mode (form from exposed inputs) | — |
| 9 | Launch | Better Auth, credit ledger, Stripe top-ups, BYOK, R2, Neon, Vercel, spending caps, retention | accounts and keys |
| 10 | After | server executor (Workflow SDK), MCP server, MCP Apps view, Yjs | — |

Phases 1–3 need no keys or accounts. Phase 4 and 5 are built against mock mode without keys and
switched to real providers once keys exist.

---

## 3. Unattended rules

- Branch `studio`. Commit at each green phase. Never push. Never deploy.
- Never run a build; the watchers do that. Verify with `tsc --noEmit`, `vitest`, and the running dev
  server (Playwright screenshot for anything visual).
- Keys go in `apps/studio/.env.local`, which is gitignored. Never in code, never in a commit.
- No spend without a key; with a key, mock mode is the default and real calls are opt-in per run
  until phase 5 is green.
- The library's rules apply to the app: no React re-renders during interaction, no work on the main
  thread that a worker can do, no per-frame allocation.
- Stop and leave a note in `plans/studio/log.md` rather than guess when a decision is the owner's:
  a paid account, a licence question, a schema the provider does not document.

---

## 4. Keys and accounts

| Key | Where to get it | Needed for | When |
|---|---|---|---|
| `FAL_KEY` | fal.ai → dashboard → Keys | real AI nodes | phase 4; mock mode until then |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | the agent, describe and judge nodes | phase 4–5 |
| `DATABASE_URL` | neon.com → new project → connection string | hosted database | phase 9; PGlite until then |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` | Cloudflare → R2 → bucket + API token | hosted storage | phase 9; local files until then |
| Vercel project | vercel.com | hosted app | phase 9 |
| Stripe keys | stripe.com | credits | phase 9 |

All go in `apps/studio/.env.local`. The two API keys should be set to a low spending cap on the
provider's side before they are used.
