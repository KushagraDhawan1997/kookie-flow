# Agent build plan (phase 5, drafted 2026-09-17)

Built 2026-09-17 against the scripted agent and mock jobs; see "Status" at the end. Originally: This is the order of work and what each step needs. Read `vision.md` first: the agent
asks, drafts cheaply, lets you pick, then makes the final; it works above graphs; everything it
makes is a workflow. Precedents are in `research-graph-agents.md` (Krea Node Agent's plan-first,
FAUNA's assist mode, Lovart's visible steps).

## What already exists

- `studio-core`: the node registry with descriptions written for the agent; `GraphOp` and
  `compileOps` (add, remove, connect, set values, move) with validation errors; `describeGraph`
  (compact text of a graph, with a focus list); `estimateModelMicros`; `nextNodeId`.
- `apps/studio/server`: jobs (`findOrSubmit`, `refresh`, `cancel`) with a fal adapter and a mock
  provider; the ledger with `hold` and `settle` per job; sessions and workspaces.
- Editor: `ShellInspector` on the right holds the Inspector, which quotes a run's price.
- Home: the box, model and effort menu, starters. All mock.

## Steps, in order. Each ends green: tsc, vitest, and the thing works in the mock preview.

### 1. Agent models and prices (`studio-core/agent-models.ts`)

- One registry: gateway slug (`anthropic/claude-opus-5`, `openai/gpt-5.6-sol`…), name, maker,
  token prices in micros, image input yes/no, and how Studio's effort scale maps onto the
  provider's setting (Anthropic effort and adaptive thinking; OpenAI reasoning effort).
- Prices checked against the gateway's `GET /v1/models` at build time, not fetched at run time.
- `auto`: Sonnet 5 for planning and edits, Opus 5 or GPT-6 Astra when effort is High or Max.
- Move `apps/studio/src/app/agent-models.ts` onto this, so the menu and the server share one list.

### 2. The step route (`POST /api/agent/step`)

- AI SDK 7 `streamText` with `stopWhen` on a step budget; model from the gateway by slug;
  `providerOptions` from step 1. `STUDIO_AGENT=mock` answers with scripted turns so the whole
  loop runs with no key and no cost.
- Tools (JSON Schema from the registry, no provider-specific tool types):
  - server: `search_nodes`, `estimate`, `inspect`, `list_graphs`, `create_graph`
  - browser (no `execute`, so they end the step): `read_graph`, `apply_ops`, `run`
- Charging: a `turn` row (new table) holds the estimate before the call and settles on the usage
  the SDK reports; ledger entries get a `turnId` beside `jobId`. One price, with the fee, as
  everywhere else. Billing lists a turn as "Agent · <model>".
- Conversation stored per graph (`conversations` table: graph id, messages as the SDK's message
  JSON). Home's box creates a graph and posts the first message, then opens `/g/[id]`.

### 3. The panel

- `ShellInspector` gets two tabs, Agent and Inspect. The Agent tab is a Composer at the bottom and
  the transcript above it, with the model and effort menu from Home.
- The client owns the loop: send, stream, execute browser tools against the live graph, append
  results, send again. `apply_ops` goes through `compileOps` and the `useGraph` reducers in one
  tick, so a turn is one undo step. `run` goes through the existing jobs path.
- A tool call renders as one line ("Added 3 nodes", "Ran GPT Image 2.5 · $0.03"), not JSON.

### 4. The harness (the system prompt and the rules around it)

- Ask first when the brief is short: what it is, for whom, mock or real, style. At most one round.
- Plan before spending: the agent calls `estimate` and the panel shows the plan as steps with
  models and prices and a Run button (Krea, FAUNA assist). Nothing runs until pressed; a setting
  turns that off per graph (FAUNA auto).
- Drafts cheap, final dear: low quality or 480p for drafts, the chosen setting for the final.
- Build as a cluster: new work goes in a labelled group placed clear of what is there
  (`move` ops from a layout helper), never scattered.
- Same graph or new: extend when the ask names what is on the canvas; new graph when it does not.
  The agent says which it chose in one line.
- `inspect` after every `run`: look, then fix or stop. Cap at two fix rounds per step.

### 5. Pick and switch (the minimum of phase 6)

- `logic/pick`: N image inputs, one output, an index the person sets by clicking a draft in the
  panel or on the node. Downstream stays `skipped` until picked (library change 3).
- `logic/gate`: passes its input when on. Enough for drafts → pick → final. The rest of phase 6
  (lists, for-each) waits.

### 6. Inspect

- Server reads the job's output, downscales to 768 px (a few frames for video), returns it as a
  multimodal tool result. A model without image input gets the describe node's text instead.

### 7. Verify

- Unit: tool schemas, op compilation from agent output, effort mapping, turn charging.
- Preview: mock agent builds the concept starter end to end (ask → drafts → pick → final) with
  the mock provider, and the ledger shows the turns and the runs. Then one real run with the
  gateway key on a $1 budget.

## Needs from the owner

- `AI_GATEWAY_API_KEY`, with a payment method on the Vercel team. In `apps/studio/.env.local`; added 2026-09-17.
- A yes on step 4's rules where they are judgement calls (one round of questions, two fix rounds).

## Risks

- **Agent output that will not compile into ops.** `compileOps` errors go back as the tool result
  and the model retries; the tests in step 7 cover the common shapes.
- **Cost runaway.** Step budget, the plan-before-spend gate, and a per-turn hold that fails the
  turn when the balance is short.
- **Gateway lag on a new model.** The registry is a list; a missing model is a missing row, not a
  failure.

## Status (2026-09-17)

Built and verified end to end in the isolated preview with `STUDIO_AGENT=mock` and mock jobs: an ask
from Home opens a graph with the panel on the agent; it reads the graph, builds Brief → two drafts →
Pick → Final as one laid-out cluster, prices the drafts, waits for Run, runs, looks at a draft, asks
which one; "the second one" sets the Pick, prices and runs the final, looks, and ends. The
conversation survives switching to Inspect and a reload. No console errors.

Where things are:
- `studio-core/src/agent/`: models and prices (gateway list prices), tool specs, catalog, cluster
  layout, instructions, and ops applied to a stored document.
- `studio-core/src/nodes/logic.ts`: `logic/pick`, `logic/gate`. `source/image` holds an attached picture.
- `apps/studio/src/server/agent/`: gateway or mock model, tools (server tools run there; `inspect`
  turns into a picture there), conversation storage, the mock script.
- `apps/studio/src/app/api/agent/`: `step` (hold, stream, settle), `[graphId]` (load, start over).
- `apps/studio/src/editor/agent/`: host (browser tools, run waits and refuses a node behind an
  unchosen pick), session (the chat outside React), panel.
- Tables `agent_turns`, `conversations`; ledger `turn_id`. Billing lists turns as "Agent · model".

Real models, 2026-09-17: all seven slugs answer through the gateway with the real tools and provider
options, no warnings; a picture tool result round-trips on Claude and GPT. In the browser (mock jobs,
billing off), Sonnet 5 and GPT-5.6 Sol each ran the whole loop: build, price, approve, run, look, pick,
final. Checked against the docs: `gateway.caching: 'auto'` is a real option; Haiku 4.5 takes neither
adaptive thinking nor effort, so it gets a thinking budget; thinking counts against the output cap, so
the cap is 16k/32k/64k by effort (Anthropic advises 64k at max) while the hold assumes 8k.

What the first real run found, and fixed: the model guessed socket names (the catalog index now lists
them, and errors name the right ones); a batch applied in part left ops naming nodes that never landed
(apply_ops and create_graph are now all or nothing); `run` restarted a free node it was given with the
drafts, which cancelled them and waited for good (it now starts only paid nodes, in order); a focused
read printed a wired input as `undefined` (it names the wire); the panel showed nothing while the model
thought (it says Thinking); pictures went to the model at full size (shrunk to 1024px in the browser
and stored).

The owner's first real run with billing on charged three drafts and a turn correctly, then refused the
next turn for a $73 hold (pictures counted as bytes; fixed, see log.md). Not yet verified: attaching a
picture in the browser, and create_graph from a real model. Not built: clicking a draft to pick it (the Pick
node's menu and the agent do it), auto mode (always asks before a run), labelled groups for clusters.
