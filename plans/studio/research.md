# Studio: stack research

> Researched 2026-09-12. Prices and statuses change; re-check a row before building on it.

Studio is an AGPL app in `apps/studio`. It is a node graph that mixes AI generation, deterministic image and
video ops, and logic, and an agent builds and runs graphs the way a coding agent uses tools. 2D only:
images and video.

Not for profit. Credits are pass-through model cost at 50% markup; after Stripe's ~3% that nets about 45% of
provider cost. It covers the fixed floor of roughly $25–45/month (Vercel Pro, Neon, R2, domain) at ~$90/mo
of generations, and the floor plus a $200/mo Claude Code plan at ~$530/mo. Any surplus funds the tooling
that builds it and discounts. No seat fee. The no-auth phase is for the owner only; launch ships with auth
and credits.

---

## 1. Decisions

| Area | Pick | Instead of | Why |
|---|---|---|---|
| App | Next.js in `apps/studio`, `output: standalone` for self-hosters | — | Same library, same kookie-ui tarball, one Docker image |
| Database | Postgres + Drizzle. Neon hosted, any Postgres self-hosted | Supabase | Supabase egress is $0.09/GB (bad for video), image transforms cap at 2500px, Realtime has no merge, self-host is the whole stack |
| Auth (before launch) | Better Auth: organization + api-key plugins | Supabase Auth, Clerk | MIT, runs on our Postgres, has Stripe/Polar/Autumn plugins. Vercel acquired it 2026-07-07, still MIT |
| Files | Cloudflare R2, presigned direct uploads, content-addressed keys | Vercel Blob, Supabase Storage | Zero egress. Blob does not cache files over 512 MB |
| Model providers | fal first; direct Google and OpenAI adapters; own registry | Vercel AI SDK as the core | fal publishes an OpenAPI schema per endpoint, so nodes can be generated. AI SDK is too thin for utility models |
| Provider jobs (v1) | Route submits with a webhook URL; webhook writes the result to Postgres and copies to R2 | An orchestrator on day one | The browser walks the graph in v1, so the server only needs to hold long jobs |
| Server graph runs (v2) | Vercel Workflow SDK, Postgres World for self-hosters | Trigger.dev, Inngest | Apache-2.0, webhooks suspend without compute, runs in the Next app. Trigger.dev's self-host needs two large containers and lacks checkpoints; Inngest's server is SSPL |
| Redis | None | Upstash | Postgres covers job state and caching. Add only for high-rate limiting or cross-instance pub/sub |
| Graph sync (later) | Yjs document per graph, driven by the same op reducer | Convex, Zero, Liveblocks | A graph is a live document, not relational rows. Convex is FSL, InstantDB is shutting down, Liveblocks self-host is Enterprise |
| Billing (before launch) | Credit ledger in Postgres: reserve, commit, refund. Stripe Checkout top-ups | Stripe credit grants | Stripe grants only apply at invoice time, so they cannot gate a generation. Autumn (Apache) or Lago (AGPL) if we want it bought |
| Agent loop | Anthropic SDK directly on a Next route, Claude Opus 5, graph-edit tools execute in the browser | Vercel AI SDK 7, client-only loop, Claude Agent SDK | The agent runs on one model provider, so AI SDK's provider layer buys nothing. New Claude API features (fallbacks, task budgets, compaction, caching controls) are usable the day they ship. The browser tool round trip is about the same amount of code either way. Keys stay on the server, and the same tools serve MCP later |
| Image ops | One shader per op, run in a worker. WebGL2 first; WebGPU when the server executor makes WGSL the shared source | WebGPU-first with WebGL2 fallback, main-thread WebGL, CPU | Never blocks the canvas. WebGL2 is 96% support, one path, and matches the three.js canvas; WebGPU-first means two shader paths from day one. Spike: three.js TSL (emits both) vs TypeGPU (WGSL only) |
| Video ops | Mediabunny + WebCodecs in a worker; native ffmpeg on the server | ffmpeg.wasm, Remotion | ffmpeg.wasm is ~10x slower and stalled. Remotion's license conflicts with AGPL |

---

## 2. Where things run

```
Browser                                        Server (Next.js)                 Outside
───────                                        ────────────────                 ───────
canvas (kookie-flow, main thread)              /api/agent  (AI SDK loop)        Claude
store + op reducer ◄── agent edit tools ────── /api/jobs   submit ───────────►  fal / Google / OpenAI
evaluator walks graph                          /api/hooks  webhook ◄──────────  (webhook)
  ├─ logic nodes: inline                       Postgres: graphs, jobs, assets
  ├─ image ops: GPU worker (WGSL)              R2: outputs, uploads
  ├─ video ops: media worker (Mediabunny)
  └─ AI nodes: POST /api/jobs, await result
```

**v1:** the browser is the executor. It owns the GPU, so deterministic ops are free and instant. An AI node
posts a job and waits; the job survives tab close because the webhook stores the result, and reopening
picks it up.

**v2:** headless runs (published apps, API, MCP, agents with no tab) need the same graph to run on the
server. Workflow SDK walks it; AI nodes are steps that suspend on webhooks; image ops run the same WGSL
through Dawn (`webgpu` npm); video ops use Mediabunny server or native ffmpeg (LGPL build) on Vercel Sandbox
or Modal.

---

## 3. Deterministic media

**Image ops** (noise, aberration, LUT, blur, displace, blend, mask, dither, halftone, crop/resize):

- One worker owns one GPU device. The main thread never touches it.
- Node thumbnails come back as transferred `ImageBitmap`s. The preview band already accepts
  `kind: 'bitmap'`, so no library change is needed to show them.
- Large viewers: hand a `<canvas>` to the worker with `transferControlToOffscreen`; one WebGPU device draws
  many canvases with no copy. Position with ref transforms.
- Textures cannot cross threads. The only bridge is ImageBitmap or VideoFrame transfer.
- Preview is pull-based: evaluate only nodes feeding something visible, at on-screen size. Coalesce param
  changes to one run per frame; cancel stale runs with a generation counter.
- Final render: full resolution, rgba16float, same shaders.

**Staying identical across browser and server:**

1. Spatial params in normalised units (blur radius as a fraction of width), so preview matches final.
2. Linear light, premultiplied alpha; convert only at decode and encode.
3. Integer-hash noise (PCG with a seed), never `sin`/`fract`.
4. GPU floats are not bit-exact across vendors. "Identical" means within 1 code value per 8-bit channel,
   checked by golden-image tests.
5. Cache key = hash(op id, op version, canonical params, input content hashes, output format, proxy level).
6. AI outputs are stored assets, never recomputed, so everything downstream hashes stably.

**Video ops:**

- Container ops (trim, concat, speed, frame extract, mux, convert): Mediabunny in a worker.
- Per-frame effects: `VideoDecoder` → `importExternalTexture` → WGSL → `VideoEncoder`. 1080p is roughly
  10–25 ms per frame on desktop, most of it encode.
- Long, 4K, HEVC/ProRes, or batch: server only.
- Timeline uses rational timestamps and constant frame rate on both sides.

**Licenses:** Mediabunny MPL-2.0, sharp Apache-2.0, ffmpeg LGPL (GPL with x264; both AGPL-compatible via
GPLv3). No Remotion, no Diffusion Studio (watermarks). Avoid server HEVC encoding.

---

## 4. Agent

**One schema per node type** (Zod → JSON Schema). It produces widgets, validation, agent tool arguments, the
published app's form, and the MCP tool input. Writing a node means writing this once.

**One op reducer**, shared by UI, agent, and later Yjs and the server:
`add_node`, `remove_node`, `connect`, `disconnect`, `set_params`, `group`, `run`. Each op carries the graph
version. One agent turn is one undo transaction, so "undo what the agent did" is one keystroke.

**Tools:**

| Tool | Runs | Returns |
|---|---|---|
| `search_nodes(query)` | server | matching node types with schemas; the catalog is never dumped into context |
| `read_graph(focus?)` | browser | compact text: short ids, non-default params, edges as `a.out -> b.in`; focused nodes in full |
| `apply_ops(ops[])` | browser | diff + validation errors |
| `estimate(nodeIds)` | server | credits/time per node |
| `run(nodeIds)` | browser | run ids; cached nodes skipped |
| `inspect(nodeId)` | server | downscaled image, or a few frames of a video, as image parts |

**Loop:** plan → show cost → approve (a confirmation step before any tool that spends) → run → inspect → fix. Only
downstream nodes re-run.

**Context rules:** direct whole-graph JSON generation fails (36% pass in the ComfyAgent comparison); editing
through small ops with validation, plus a skeleton-then-params order, reaches 87%. For bulk edits, a
sandboxed `execute(script)` over a typed graph SDK beats hundreds of tool calls.

**External agents (v2):**

- Remote MCP server (spec 2026-07-28, stateless, OAuth) exposing the same ops with a `graph_id` handle.
- MCP Apps (`ui://`) view to show the graph or an app form inside Claude and ChatGPT.
- Every published app becomes an MCP tool automatically. No competitor does this.
- WebMCP: `document.modelContext.registerTool` with the same definitions. Chrome origin trial 149–156, no
  mainstream agent consumes it yet. Cheap to add, low priority.

---

## 5. Logic

Logic is what turns a generator into a pipeline. It sits in eight families.

| Family | Nodes | Why it matters |
|---|---|---|
| Values | number, seed, seeded random, math expression, remap, clamp, colour math | Drives every param; seeds make runs reproducible |
| Text | template (`{subject} in {style}`), concat, split, regex, JSON extract | Prompt construction is most of the logic in AI graphs |
| Lists | list, range, CSV/import, zip, cartesian product, pick, filter, sort, reduce | Variants: 5 products × 4 aspect ratios × 3 styles |
| Iteration | for-each over a subgraph, collect | Runs a chain per item; batching across modalities is a gap Flora leaves (100 items, one modality) |
| Control | if / switch, gate, loop-until (max N) | Nobody ships real branching on outputs |
| AI as logic | classify, extract, vision judge (score), rank best-of-N, prompt rewrite | The bridge: an AI's answer becomes a value that decides |
| Measure | image stats (brightness, palette, aspect, sharpness), detection counts, video duration, scene cuts | Deterministic facts that feed decisions, free |
| Time | frame index, curves, keyframes, noise over time | Drives image ops per frame, so deterministic ops become animation |

Plus **subgraphs**: a group with exposed inputs becomes a node. A template is a subgraph; an app is a
subgraph with a form; an MCP tool is an app. One concept, four surfaces.

**Pipelines this enables:**

- *Product shots:* product photo → background removal (AI) → for-each [1:1, 4:5, 9:16] → smart crop (det) →
  backdrop (AI) → composite (det) → headline (det) → judge (AI) → loop-until score ≥ 7, max 3.
- *Ad variants:* CSV of headlines × styles → cartesian → generate (AI) → palette distance to brand colours
  (measure) → filter → contact sheet (det).
- *Short film:* brief → shot list (AI extract → list) → for-each: keyframe (AI) → image-to-video (AI) → trim
  to shot length (det) → crossfade concat (det) → grain + LUT (det).
- *Generative texture:* perlin noise (det) → displacement (det) → use as control image (AI) → animate noise
  over time → per-frame displacement → video, zero model cost after the first frame.

### Library work this needs

The evaluator today is a DAG with reactive and manual gates. Logic needs, in `packages/kookie-flow`:

1. **Inactive branches.** An `if` output that is not taken marks downstream `skipped`, not `error` or
   `dirty`.
2. **Subgraphs.** A node whose body is a graph, with exposed sockets. Required by for-each, loop-until,
   templates and apps.
3. **Iteration.** for-each runs its body per item and collects outputs into a list; loop-until re-runs its
   body with a max count. Cycles stay out of the top-level graph; loops live inside a node.
4. **List sockets.** A `list<image>` type and the rule for connecting a list to a single input (implicit map
   vs error).
5. **Content-hash caching** hooks, so unchanged nodes skip on re-run.

These are orchestration, not computation, so they belong in the library under its own rule.

---

## 6. Build order

1. `apps/studio` shell, node schema system, op reducer, local persistence (IndexedDB).
2. Logic families: values, text, lists. Engine: list sockets.
3. GPU worker + first 10 image ops; bitmap previews.
4. fal adapter from OpenAPI schemas, `/api/jobs` + webhooks, R2, Postgres.
5. Agent: search, read, apply, run, inspect.
6. Engine: subgraphs, branches, iteration. Then control and AI-as-logic nodes.
7. Video worker (Mediabunny), video ops, time nodes.
8. Templates and app mode.
9. Before launch: Better Auth (organization + api-key plugins), credit ledger (reserve, commit, refund),
   Stripe Checkout top-ups with a $10 minimum, BYOK as an option, provider spending caps, 30-day output
   retention on the free tier. Every table carries `workspace_id` from step 1, so this is config, not
   migration.
10. After launch: server executor, MCP, Yjs.

---

## Sources

Backend: [Supabase pricing](https://supabase.com/pricing) ·
[Supabase transforms](https://supabase.com/docs/guides/storage/serving/image-transformations) ·
[Neon pricing](https://neon.com/pricing) · [Better Auth + Vercel](https://vercel.com/blog/vercel-acquires-better-auth) ·
[Convex license](https://raw.githubusercontent.com/get-convex/convex-backend/main/LICENSE.md) ·
[InstantDB joins OpenAI](https://www.instantdb.com/essays/instant_team_joins_openai) ·
[R2 pricing](https://developers.cloudflare.com/r2/pricing/) ·
[Vercel Blob](https://vercel.com/docs/vercel-blob/usage-and-pricing) ·
[Stripe credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits) ·
[Autumn](https://github.com/useautumn/autumn) · [Lago](https://github.com/getlago/lago) ·
[Vercel limits](https://vercel.com/docs/functions/limitations)

Jobs and providers: [Workflow SDK Postgres World](https://workflow-sdk.dev/worlds/postgres) ·
[Workflow hooks](https://workflow-sdk.dev/docs/foundations/hooks) ·
[Workflow pricing](https://vercel.com/docs/workflows/pricing) ·
[Trigger.dev self-host](https://trigger.dev/docs/self-hosting/overview) ·
[Inngest self-host](https://www.inngest.com/docs/self-hosting) ·
[fal queue](https://fal.ai/docs/model-endpoints/queue) · [Replicate → Cloudflare](https://blog.cloudflare.com/ai-platform/) ·
[AI SDK video](https://ai-sdk.dev/docs/ai-sdk-core/video-generation) ·
[AA image leaderboard](https://artificialanalysis.ai/text-to-image/arena/leaderboard-text) ·
[AA video leaderboard](https://artificialanalysis.ai/video/leaderboard/text-to-video)

Media: [WebGPU status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status) ·
[caniuse WebGPU](https://caniuse.com/webgpu) · [texture sharing](https://github.com/gpuweb/gpuweb/issues/4244) ·
[TypeGPU](https://github.com/software-mansion/TypeGPU) · [three WebGPURenderer](https://threejs.org/manual/en/webgpurenderer.html) ·
[Mediabunny](https://github.com/Vanilagy/mediabunny) · [ffmpeg.wasm perf](https://ffmpegwasm.netlify.app/docs/performance/) ·
[Remotion license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) ·
[frame pipeline costs](https://webrtchacks.com/video-frame-processing-on-the-web-webassembly-webgpu-webgl-webcodecs-webnn-and-webtransport/) ·
[node-webgpu](https://github.com/dawn-gpu/node-webgpu) · [ffmpeg legal](https://www.ffmpeg.org/legal.html) ·
[Nuke architecture](https://learn.foundry.com/nuke/developers/113/ndkdevguide/2d/architecture.html)

Agent and competitors: [WebMCP draft](https://webmachinelearning.github.io/webmcp/) ·
[Chrome WebMCP](https://developer.chrome.com/docs/ai/webmcp) · [MCP 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/) ·
[MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) · [AI SDK 7](https://vercel.com/blog/ai-sdk-7) ·
[AI SDK client tools](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage) · [tldraw agent](https://tldraw.dev/starter-kits/agent) ·
[workflow generation study](https://arxiv.org/html/2607.15845v1) · [Krea Node Agent](https://www.krea.ai/blog/ai-workflow-agent) ·
[Code Mode](https://blog.cloudflare.com/code-mode-mcp/) · [Flora Router](https://docs.flora.ai/nodes/router-node.md) ·
[Flora Batch](https://docs.flora.ai/nodes/batch-node.md) · [FAUNA](https://docs.flora.ai/editor/fauna.md) ·
[Weavy iterators](https://help.weavy.ai/en/articles/12343281-iterators) · [Comfy App Mode](https://blog.comfy.org/p/from-workflow-to-app-introducing) ·
[Runway changelog](https://runway.com/changelog)
