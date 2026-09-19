# Harness plan: the V6 (drafted 2026-09-18, nothing built)

The order of work for making the agent's harness so efficient that a mid or small model does the job
for almost nothing (`vision.md`, "Efficiency: the V6"). Research is in `research-harness.md`. This
plan is built on that research **and on Studio's own numbers**, which overruled the research in two
places. Nothing here is built yet; each step ends green (tsc, vitest) and is measured before and
after.

## What the owner's real sessions say (database copy, 2026-09-17 sessions)

Two conversations, 34 agent steps, read from a copy of `.data/pg` (never the live directory: PGlite
is one process at a time).

| | GPT-5.6 Sol, 22 steps | Sonnet 5, 12 steps |
| --- | --- | --- |
| Model cost | $0.167 | $0.095 |
| Output tokens | 38% of cost | 34% |
| Cache writes (new transcript, mostly pictures) | 31% | 57% |
| Cache reads (old transcript, every step) | 19% | 9% |
| Uncached input (one cache miss) | 18% | 0% |

- **The agent is 37% of everything spent so far**: $0.39 on agent steps against $0.67 on renders. A
  low-quality draft costs about half a cent; the session that makes three of them costs 17–25 cents
  in agent steps. For image work the harness's own tokens *are* the bill. (Video flips this: a clip is
  20–40 cents.) The research's "renders dominate, tokens are cheap" is wrong for Studio today.
- **About one model call per tool call.** A browser tool ends the step, so 24 tool calls was about 24
  model calls, each re-reading the transcript. The mix in the longer session: `inspect` 10,
  `read_graph` 3, `estimate` 3, `run` 3, `apply_ops` 3, `search_nodes` 2.
- **One step was 23% of a session**: the build. 28 ops, 9,166 characters of tool input plus about
  4,000 of reasoning: 3,141 output tokens, $0.041.
- **One cache miss was 18% of a session** ($0.031): a step that read nothing from the cache for no
  visible reason.
- **Looks are heavy.** Each `inspect` added 3,200–4,700 tokens to the transcript on GPT-5.6 Sol,
  about three times what the provider's own formula predicts for a 1024px picture. Every later step
  re-reads them.
- **28 paid-path failures were knowable in advance**: 24 × "prompt is empty", 4 × "too small: the
  model wants at least 655,360 pixels". Both are thrown by the provider layer after the person has
  approved.
- **Holds are 28× the charge**: $11.14 held for $0.39 charged; the average hold is $0.33 for a step
  that costs a cent. Harmless with money in the account, a refusal with little.
- The static prefix is small: about 2,400 tokens on OpenAI, 5,800 on Anthropic. Caching it is right
  but is not where the money is. The transcript is.

So the order is not "prune first" (what I said after the research) and not "bench first" (what I said
before it). It is: **cut round trips and the big output step, because that is where the money
measurably goes; build the bench so the rest can be judged; then everything else.**

## What the bench measured (2026-09-18, 274 trials, $3.65)

Built and run: `apps/studio/bench/` — 20 scenes, the app's own instructions, tools, provider options
and caps, answered from a document, with pictures from the store so a look costs real image tokens
and no render is paid for. Three repeats a scene, so a scene passes only if all three pass.

| Model, effort | pass^3 | $/scene | calls | runs asked | ops refused |
| --- | --- | --- | --- | --- | --- |
| GPT-5.6 Luna, low | 41% | $0.0013 | 4.8 | 0.1 | 0 |
| GPT-5.6 Sol, low | 41% | $0.0198 | 6.9 | 1.1 | 0 |
| Claude Haiku 4.5, low | 29% | $0.0256 | 6.5 | 1.1 | 31 |
| Claude Sonnet 5, low | 24% | $0.0161 | 4.3 | 0.4 | 0 |
| Claude Sonnet 5, medium | 12% | $0.0161 | 4.2 | — | — |
| GPT-5.6 Luna, medium | 35% | $0.0022 | 6.2 | — | — |
| Claude Opus 5 | no data | — | — | — | — |

307 trials in the end, $3.67. Luna's medium run finished after the table above was first written and
changed nothing: 35% at medium against 41% at low, on 1.7× the money.

1. **The harness is the ceiling, not the model.** The same two failures lead for every model: no pick
   node (25) and never ran it (24). The concept scene — the vision's own drafts → pick → final — was
   built correctly in **0 of 12** attempts by any model. The instructions say to do it; nobody does.
2. **The cheap engine already competes.** Luna at $0.0013 a scene matches Sol at 15× the price and
   beats both mid Claudes. The V6 thesis holds. But nobody is good yet: the best is 41%.
3. **Cheap is not always cheaper.** Haiku cost more per scene than Sonnet ($0.026 against $0.016) and
   had 31 ops refused for inventing sockets that do not exist. A weak model on a loose harness spends
   more, not less.
4. **Effort does not buy correctness.** Both models scored worse at medium than at low: Sonnet 12%
   against 24%, Luna 35% against 41%. Thinking does not supply what the harness fails to say, and it
   is charged at the output rate.
5. **Output is the bill.** What the model writes is 22–46% of each model's dollars; re-read history is
   17–33%. Cutting what it writes (patterns) beats trimming what it re-reads.
6. **The baselines behaved as predicted**: an empty prompt was run 3 times, a picture under the
   model's minimum 3 times. Pre-flight is worth building.
7. **The bench caught my own mistake.** `tidy-up` failed 12/12 against a correct layout, because the
   check compared the tops of nodes while `layoutGraph` centres a column. `arrange` was right; the
   check was wrong, and only the transcripts showed it.
8. Two scenes pass everywhere: refusing to guess on a two-word brief, and leaving placement to
   `arrange`.

Not measured: whether a picture is any good (nothing renders), and Opus 5 — the gateway refused it
all 14 times, for no charge.

## The order, revised by the data

1. **Patterns** (was step 3). It fixes the first failure and the first cost at once.
2. **The run happens** (part of step 1): the harness runs what the person approved, instead of relying
   on the model to call `run` after saying it will.
3. **Pre-flight** (was step 5), with both baselines already quantified.
4. **Fewer round trips** (the rest of step 1).
5. **Context trim** (was step 6), last: reads are the smallest share of the bill.
6. **Cheapest model that passes** (was step 7), re-measured after each of the above.

## Step 0. A ruler (half a day)

- `apps/studio/scripts/agent-report.mjs`: copies `.data/pg` to a temp directory, opens the copy, and
  prints per conversation: steps, tool mix, tokens and dollars by class (output, cache write, cache
  read, uncached), cache misses, the dearest step, failed jobs by error, hold against charge.
  The two scratch scripts from this session are the first draft.
- `agent_turns` gains `calls` (model calls in the step) and `effort`. Migration 0005. Effort decides
  reasoning tokens, and output is the largest share, so a report without it cannot explain a bill.
- Every later step quotes this report before and after, from real use, for nothing.

## Step 1. Fewer round trips (1–2 days, deterministic, no model change)

More than half the calls in the recorded session are ceremony the harness can do itself.

1. **The graph arrives with the ask.** The session attaches what `readGraph()` returns (graph, runs,
   selection) to each message the person sends, as a part the panel does not draw. Instruction 1
   becomes "the graph is attached; call `read_graph` only to look again after your own changes, or
   with `focus`". Saves one call per turn. Files: `editor/agent/session.ts`, `agent-panel.tsx`,
   `studio-core/agent/instructions.ts`.
2. **`run` prices itself.** The approval card already computes the estimate
   (`pendingRun.estimate`). The instruction to call `estimate` and state the total before `run` goes;
   `run`'s result carries the approved price. `estimate` stays for comparing options while planning.
   The spending gate is the harness's (the call waits for the person), so nothing about safety rests
   on the model here. Saves one call per run.
3. **Look once.** `inspect` takes `nodes` (one to six) and answers with one contact sheet: the
   results in a grid, each cell labelled with its node's label ("Draft 2"), composed in the browser
   on the canvas `smallCopy` already uses, at most 1024px. Ten calls and ten pictures become three
   and three. Single-node looks stay as they are. Files: `studio-core/agent/tools.ts` (schema),
   `editor/agent/host.ts`, `session.ts`, `shared/agent.ts`; the server's `toModelOutput` is unchanged.
4. **Picture audit.** Find why a look costs ~3,300 tokens where ~1,200 is expected (detail setting,
   size, encoding), then set look size and detail from a small per-provider table. Official formulas:
   Anthropic ⌈w/28⌉×⌈h/28⌉; OpenAI ⌈w/32⌉×⌈h/32⌉ × a per-model multiplier.

Expected on the recorded session: 24 calls → 11–13. Measured by Step 0's report on the next real
session, and by the bench once it exists.

## Step 2. The bench (2–3 days)

One harness, two hosts. The point is that the bench runs the *same* instructions, tools and model
options the app does, against a graph in memory, with renders that cost nothing.

- **`DocumentHost` in `studio-core`**: the `AgentHost` contract over a `GraphDocument`. `readGraph` →
  `describeGraph`; `applyOps` → `applyOpsToDocument` (exists); `estimate` → `estimateModelMicros`;
  `run` → marks nodes done with a placeholder `MediaRef`; `inspect` → a caption with no picture unless
  the task is about looking. The `AgentHost` interface and the pure half of `host.ts` (`upstreamOf`,
  status rules) move into `studio-core` so both hosts share them.
- **`server/agent/loop.ts`**: the model call (instructions, tools, provider options, caps, the
  message view of Step 6) lifted out of the step route, so the route and the bench call one function.
- **Tasks** in `apps/studio/bench/tasks/`: `{ id, tier, ask, startDoc?, replies, approve, expect }`.
  `replies` are fixed answers for when the agent asks or offers a pick, so the person's side is
  deterministic. Twenty to start: the four Home starters, the owner's two recorded asks, and the
  failures already seen — an empty prompt, a too-small picture into an edit, wiring into a taken
  input, extending a canvas against starting a new graph, "tidy up", a two-word ask (the right answer
  is questions and no build), an exact edit (the right answer is no drafts), a photo to a clip.
  Three tiers: one node, a pipeline, an ambiguous brief.
- **Checks, all deterministic**: no refused ops (and how many tries it took); a valid DAG; pre-flight
  passes (Step 5); shape assertions with small helpers (`has(type, where)`, `feeds(a, b)`); drafts at
  the cheapest settings; the final never run before a pick; no positions from the model; questions
  asked in the ambiguous tier and not in the clear one; the plan's price inside a band; and as first-
  class numbers: model calls, tool calls, tokens by class, dollars, seconds.
- **Five repeats a task.** Report pass@1 and **pass^5** (all five pass). 70% one-shot is 97% pass@3
  and 34% pass^3; nobody retries a broken graph five times, so pass^5 is the honest number.
- **Output**: one JSON line per trial with the full transcript, and a summary table. Results under
  `apps/studio/bench/results/` (ignored by git, except a committed `baseline.json`).
- **Money.** The bench spends real tokens and nothing on renders. It prints its estimate and wants
  `--yes`; a `--budget` stops it cold. From the recorded sessions, about $3–6 for a Sonnet-class sweep
  of 100 trials, about $1 for a mini-class one. Never in CI with a real key: CI runs it against the
  scripted mock model, which tests the plumbing and the checks.
- **Read the transcripts when a score moves.** Anthropic's own CORE-Bench number went 42% → 95% on
  harness defects found in traces, and a 9-point gain elsewhere was the agent exploiting the harness.

## Step 3. Patterns: the agent instantiates, it does not invent (3–4 days)

Evidence: grounded generation 78.5% against 66.2% free-form (Prompt2DAG, checked 2026-09-18: real,
numbers exact, but data pipelines, not pictures), and here, the build step that is 23% of a session.

- `packages/studio-core/src/patterns/`: `definePattern({ name, version, summary, args, roles,
  build(args) → GraphOp[] })`. First four: `drafts-pick-final`, `edit-picture`,
  `cutout-place-upscale`, `photo-to-clip`.
- One new op, `{ op: 'add_pattern', pattern, args }`, expanded by `compileOps` into primitive ops,
  laid out with `layoutGraph` clear of what is there. The result names the roles:
  `{ drafts: ['n3','n4','n5'], pick: 'n6', final: 'n7' }`. No new tool: the research and the tool-count
  numbers both say grow the op vocabulary.
- Membership on the nodes: `data.pattern = { name, version, instance, role }`. `describeGraph` prints
  an instance as one line (`p1 drafts-pick-final@1: drafts n3 n4 n5 (low) → pick n6 (unset) → final n7
  (high)`) and then only what differs from the pattern's defaults. Cheaper on every later read.
- The pattern list (name, one line, args) goes in the static prefix; a few hundred tokens, cached.
  Instructions: use a pattern when one fits, raw ops when none does, with two worked examples — the
  research is clear that examples lift small models more than rules do.
- **Templates become real through this.** `templates.ts` is mock today. A template is a pattern with
  default arguments; "Use template" is `createGraph` plus `add_pattern` through `applyOpsToDocument`.
  One source for the agent's patterns and the person's templates, as the vision has it.
- Target: the 3,141-token build step becomes ~150 tokens. Judged by pass^5 before and after, on the
  small models especially.

## Step 4. Draft sets are real (data model in Step 3; the UI is its own study)

With instances and roles, the canvas and the agent both know "p1 is an undecided draft set". That
gives: `estimate` on an instance (drafts, final, funnel total), and later, collapsing the rejects once
one is picked. No surveyed product treats drafts → pick → final as a thing in the graph. The canvas
side is UI, so it starts with a precedent study, not here.

## Step 5. Pre-flight: a run that cannot work is never offered (2 days)

- Each task's input rules move from `server/providers/fal-tasks.ts` into a pure
  `checkTaskInput(task, input)` in `studio-core`. The provider still calls it at submit (the
  authority); pre-flight calls the same function before (the courtesy). One rule, two callers.
- `preflight(doc, nodes)` walks the nodes and everything upstream: required inputs wired or valued,
  picks chosen, a picture known to be under a model's minimum, option values valid. It answers with
  problems in the model's words and a mechanical fix where one exists.
- The browser host's `run` calls it first and answers with the problems instead of asking the person;
  `estimate` includes them; the person's own Run control shows the same reason before, not a red
  error after.
- Follow-on: an exact `image/resize` node, so "too small" has a fix that can be inserted.

## Step 6. Context discipline (1–2 days, tuned by the bench and the report)

Reads are 9–19% of cost today and grow with the square of a session's length; pictures are most of
the transcript by the end. The research number (91.6% against 71%, checked: real, but 50 long
enterprise tasks of ~30k tokens each) is direction, not magnitude, for sessions our size.

- A pure `modelView(messages)` in `server/agent/loop.ts`: the stored conversation and the panel keep
  everything; the model sees a view. Byte-stable for the same input, and tested for it, or the cache
  dies quietly.
- In the view: a picture becomes its caption once the step that looked at it is over; superseded
  graph attachments and old `read_graph` results become a stub.
- Past a threshold, everything older than the last two turns becomes a **deterministic digest**: the
  person's words verbatim, one line per tool call from the same labels the panel draws. No model
  writes the summary. The canvas is the memory; the digest only has to carry decisions.
- In blocks and rarely: every edit to the middle of a prompt re-writes the cache from that point. Set
  the gateway's cache anchor when pruning starts, and check the gateway's session affinity for the
  OpenAI misses (both to be confirmed in the docs first). The report's cache-read share is the alarm.

## Step 7. Choose the engine by data (1 day, plus the sweeps' cost)

- Sweep model × effort on the bench: Haiku 4.5, Sonnet 5, GPT-5-mini, GPT-5.6 Sol, a Gemini Flash if
  the gateway serves it; low and medium effort. Effort matters as much as the model: output is the
  largest share of cost and reasoning is most of output.
- Auto becomes the cheapest pair that clears the bar on tiers one and two. The ambiguous tier is
  handled by asking, which is already the rule, not by a bigger model.
- Publish the numbers. Nobody in this market states graph-correctness or reliability figures.

## Step 8. Small things found on the way

- **Holds from data**: `AGENT_HOLD_OUTPUT_TOKENS` 8,000 → ~4,000 (the largest recorded step wrote
  3,141), and the known-cached prefix counted at the cache price after a conversation's first call.
- **Placement is never the model's job**: `position` and `move` leave the agent's op schema (the
  editor keeps them). `arrange` stays for "tidy up".
- **`search_nodes` answers small**: one query returned 5,309 characters. Name and one line by default;
  sockets and options for the top hit, or on request.

## Not doing

Summaries written by a model; self-consistency or best-of-N on graph building (non-monotonic for small
models); a model grading its own plan before spending; routers and classifiers; fine-tuning; code-
execution mode (six tools and batched ops already have its benefit); new top-level tools.

## Needs from the owner

- A yes each time the bench spends real tokens, with the printed estimate in front of you.
- A yes on dropping estimate-before-run and on contact-sheet looks (Step 1): both change what the
  agent says and shows.
- The bar: I suggest pass^5 ≥ 80% on tiers one and two before a model is allowed to be Auto.
- Whether the numbers get published.

## Risks

- **Tuning to the bench.** Tasks stay out of the prompt's examples; a fifth rotates each quarter; real
  failures become tasks within the week.
- **Patterns harden.** They are versioned, and raw ops stay; the bench keeps tasks no pattern fits.
- **Two hosts drift.** The contract and the pure rules live in `studio-core`; the browser host stays a
  thin skin over them.
- **Instruction changes land differently per provider.** Every change is judged per model on the
  bench, never on one.
- **Pruning kills the cache.** Byte-stability is tested; the report's cache-read share is watched.
- **Bench pictures are placeholders**, so it cannot judge the agent's eye. Looks are judged on real
  sessions through the report, and by you.
