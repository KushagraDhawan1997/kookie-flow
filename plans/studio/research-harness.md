# The harness: research, 2026-09-18

Written for the owner and for later sessions. Six parallel web searches, read against Studio's own
agent code. The question: how good can the harness get, so a mid model does the work for almost
nothing (`vision.md`, "Efficiency: the V6").

Every number below is marked **measured** (a study, a benchmark, an official price page) or
**claimed** (a vendor post or one blog, unreplicated). Dates matter here: this field moved fast in
2026 and half of what is written about it is a year stale.

## Corrections after checking Studio's own data (2026-09-18, same day)

The plan that came out of this is `harness-plan.md`. Two conclusions below did not survive the
owner's real sessions, and are struck rather than deleted so the reasoning stays visible:

- **Point 6 is wrong for Studio today.** The agent is 37% of all spend ($0.39 against $0.67 on
  renders); a low-quality draft is half a cent and the session that makes three is 17–25 cents of
  agent steps. For image work the harness's tokens are the bill. It holds for video only.
- **Pruning is not first.** Reading old transcript is 9–19% of agent cost, because it is cached at a
  tenth. The money is in output tokens (34–38%, one 28-op build step alone was 23% of a session),
  cache writes (31–57%, mostly pictures from `inspect`), and round trips (about one model call per
  tool call; 16 of 24 calls in one session were `inspect`, `estimate` and `read_graph`).
- The two load-bearing papers were fetched and checked: Prompt2DAG (78.5 / 66.2 / 29.2) and "Less
  Context, Better Agents" (91.6% against 71%, and 79% for pruning alone) are real and the numbers are
  exact. Both are other domains (data pipelines; long enterprise workflows of ~30k tokens a task), so
  they give direction, not magnitude. The rest of the citations were gathered by search agents and
  have not been individually re-checked.

## The short of it

1. **The harness is where the variance is.** One model across nine harnesses: 14 points of accuracy
   and 17× of cost (measured, AgentConn, 2026-09). The same is true in reverse — a frontier model on
   a poor harness loses to a cheap one on a good harness.
2. **Grounding beats inventing.** Text → Airflow DAG, 260 runs, 13 models: template-grounded 78.5%,
   free-form LLM 66.2%, prose-to-graph 29.2% (measured, Prompt2DAG, arXiv 2509.13487). This is the
   single most useful number in the whole sweep, and it is exactly Studio's "templates are patterns"
   idea pointed at the agent instead of at the person.
3. **Small context, not small model.** Keeping the last five tool calls plus a rolling summary of what
   was dropped: 91.6% of tasks completed against 71% with the full history, on 63% fewer tokens
   (measured, Microsoft, arXiv 2606.10209). Pruning without the summary made agents stop early.
4. **Constrain the answer, never the thinking.** Naive schema-constrained decoding costs 10–30%
   accuracy; constraining only the final structured emission recovers it and then some (measured:
   CRANE arXiv 2502.09061; Format Tax arXiv 2604.03616). Tool calling already works this way, so
   Studio is on the right side of this — but it rules out "make the model answer in JSON only".
5. **Coordinates are the wrong job for a model.** Tokenizers split numbers so that a wildly wrong
   coordinate costs the same training loss as a near-miss; spatial accuracy falls as the canvas grows
   (measured, arXiv 2312.03042, arXiv 2510.20198). `arrange` was the right call; it should now be the
   only way position is ever set.
6. ~~**The bill is the renders, not the tokens.**~~ (Wrong for image work; see the corrections
   above.) Studio's LLM turn is cents; one video render is
   dollars. So the harness should spend tokens freely to avoid a wasted render — the opposite of the
   usual advice, and the thing to keep straight while chasing efficiency.

## What Studio already does right

Checked in code, 2026-09-18:

- Six tools. Accuracy falls past roughly 15–20 (measured on 370 tools, arXiv 2605.24660); six is
  safe, and new verbs go into `apply_ops`'s vocabulary rather than into new tools. `arrange` followed
  that rule.
- A static instruction prefix with the catalog in it, tool definitions unchanged per turn, and
  `gateway: { caching: 'auto' }`. Anthropic's own agent-loop figures: 2.5–3.7× cheaper at 81–90%
  cache hit rates (claimed, Anthropic cost-optimization doc).
- `maxOutputTokens` 16k–64k by effort. Anthropic measured a 16,384 cap ending 15% of Opus 5 attempts
  and a third of Fable 5's with nothing solved — a low cap does not save money, it pays for failures.
- All-or-nothing op batches with errors worded for the model, a revision precondition on every graph
  write, and search-before-naming a node type. Each is a named pattern in the neurosymbolic
  literature, and the last is the fix ComfyUI-Copilot and ComfyGPT were built around.
- Pictures re-encoded to 1024px JPEG before the model sees them. Anthropic charges ⌈w/28⌉×⌈h/28⌉
  tokens, so a 1024×768 look costs about 1,036 tokens (official, platform.claude.com).
- Plan, price, approve, then spend. Krea and Flora both do this; it is table stakes now, not an edge.

## Gaps, in the order I would fix them

### 1. The conversation grows forever (~~biggest live saving~~ real, but Step 6 in the plan, not first)

Every turn re-sends the whole transcript, old `read_graph` dumps and old inspected pictures included.
A picture costs its ~1,000 tokens again on every later turn. The measured fix is prune-plus-summarise
(91.6% vs 71%, 63% fewer tokens). Concretely: keep the last five tool results, replace older ones
with one line each ("read the graph", "looked at Draft 2"), drop the image parts entirely once a turn
is past, and keep one rolling summary block. On the gateway, set `cache_anchor_items` at the same
time, or pruning the middle of the prompt silently stops the cache from hitting (official, Vercel,
2026-09-08).

### 2. No bench, so no tuning

Nothing here is measurable today, which makes every other item a guess. The design the research
converges on, sized for one person:

- 20–50 tasks from real asks and real failures, tiered (one node, a pipeline, an ambiguous brief),
  kept out of the prompts being tuned (guidance, Anthropic evals, 2026-01-09).
- Deterministic checks only, at first: valid DAG, node types that exist, socket types that match,
  required values present, the plan's price from `estimateModelMicros`, tokens, tool calls, refusals.
  All free.
- The existing mock provider as the executor, so no render is ever paid for. `STUDIO_AGENT=mock`
  already exists for the model side; the bench needs the real model and the mock renders.
- Five repeats per task. Report pass@1 and **pass^5** — all five succeeding. A 70% one-shot rate is
  97% pass@3 but 34% pass^3 (measured, Schmid, 2025-03-24), and nobody retries a broken graph five
  times, so pass^5 is the number that matches how it feels to use.
- Inspect transcripts whenever a score jumps. Anthropic's own CORE-Bench score went 42% → 95% on
  harness fixes found by reading traces, not by watching scores; and a 9-point "gain" on another eval
  turned out to be the agent exploiting a defect in the harness (measured, Anthropic/Arize, 2026).
- Tools: Inspect AI (UK AISI) is the mature one; Promptfoo is the small-team CI choice, and is where
  OpenAI is pointing people as it closes its own Evals product this year. Neither is required — a
  vitest file with the mock provider gets the first version running today.
- Batch APIs are 50% off everywhere and have no interactive loop, which is exactly right for scoring
  and evals (official: Anthropic, OpenAI, Google).

### 3. No pattern library for the agent

Today the model writes every workflow from first principles. Prompt2DAG says grounding is worth about
12 points over free-form, and more than double over prose. So: a small set of named, versioned
patterns — `drafts-pick-final`, `edit-one-picture`, `upscale-and-cut-out`, `stills-to-clip` — each a
function that returns an op list for given arguments (how many drafts, which model, which quality).
The agent picks a pattern and fills in arguments; it writes raw op lists only when nothing fits.

Nobody in the market publishes a named, versioned pattern library (surveyed: Krea, Flora, Weavy,
ComfyUI, Lovart, Higgsfield, Freepik, n8n, Make, Zapier, Gumloop, Dify, LangFlow, Rivet, Retool,
Figma). Higgsfield's Hermes comes closest by remembering successful workflows as "episodic memory"
(claimed, 2026-05-14). Two consequences worth having: the agent gets cheaper and steadier, and a
pattern becomes a thing that can be improved, measured and shown to a person as a template.

### 4. Drafts → pick → final is not a first-class thing in the graph

`logic/pick` exists, but a draft set is not a named structure, so neither the agent nor the canvas can
say "this cluster is an undecided draft set", collapse the rejects once one is picked, or price the
funnel as a unit. No surveyed product does this either — every one of them fakes it with generic
branch nodes. It is Studio's signature workflow, and making it a real object in the document is both
the differentiator and a large token saving (the agent stops re-describing the arrangement each turn).

### 5. No graph walk before a run

Krea walks the whole graph before spending and repairs what it can — inserting a conversion node
where two sockets don't match — rather than failing mid-run (claimed, Krea, 2026-03-18). Studio has
the pieces (`compileOps` validation, the evaluator's dirty tracking); what is missing is one
deterministic pre-flight that returns "this will run, here is the price" or "this cannot run, here is
why, here is the fix", called before every `run`.

### 6. Cheap model by default, escalate on evidence

Auto is Sonnet 5 today, Opus at high effort. Once the bench exists, the question becomes answerable
rather than aesthetic: run the set on Haiku 4.5, Sonnet 5, GPT-5-mini and Gemini Flash-Lite, and keep
the cheapest that passes. Routing literature is encouraging (RouteLLM: 95% of GPT-4 quality at 85%
less cost, measured 2024; FrugalGPT up to 98% less, measured 2023) but the honest limit is repeated
in every 2026 survey: small models fail on ambiguity and long horizons. So escalate on ambiguity —
a short or contradictory brief goes to the bigger model or comes back as a question — not on
everything.

Current cheap-tier prices, official pages, 2026-09-18, per million tokens in:out (cached in):
Haiku 4.5 1:5 (0.10) · Sonnet 5 2:10 (0.20) · GPT-5-nano 0.05:0.40 (0.005) · GPT-5-mini 0.25:2
(0.025) · Gemini 3.1 Flash-Lite 0.25:1.50 · Gemini 3.7 Flash 0.75:3.75 (0.075).

### 7. Things to leave alone

- **Don't add self-consistency or best-of-N to graph building.** Majority voting is non-monotonic for
  small models — past a peak, more samples lower accuracy (measured, arXiv 2608.11403) — and higher
  reasoning effort reduced accuracy in most of 21,730 rollouts across nine models (claimed, HAL,
  arXiv 2510.11977). Sample the *renders* instead: cheap drafts, a cheap scorer, one expensive final.
- **Don't let the model grade its own prompt before spending.** o3 reward-hacked 30.4% of RE-Bench
  runs (measured, arXiv 2604.15149). Keep the checks outside the model: schema, price, the actual
  picture.
- **Don't build a DSL bigger than the ops.** A grammar is a win while it is small and orthogonal, and
  a second codebase after that (Fowler, 2026).

## Order of work (superseded by `harness-plan.md`)

1. Prune and summarise the conversation; drop stale pictures; set the cache anchor. One change, pays
   immediately, no design questions.
2. The bench: 20 tasks, deterministic checks, mock renders, pass^5. Nothing else can be judged
   without it.
3. Pattern library, grounded in the bench. Measure before and after.
4. Draft sets as a real structure in the document.
5. Pre-flight graph walk with repairs.
6. Sweep the models, pick the cheapest that passes, escalate only on ambiguity.

## Sources

Tool design and context: Anthropic "Writing effective tools for agents" (2025-09-11), "Code execution
with MCP" (2025-11, 150k → 2k tokens on one workflow), "Effective context engineering" (2025-09),
Agent Skills (2025-10); Cloudflare Code Mode (2025-09-26, 2026-02-20); OpenAI function-calling guide
(tool_search, <20 tools); Meta arXiv 2605.24660; Microsoft arXiv 2606.10209; Chroma "Context Rot"
(2025-07). Harness vs model: arXiv 2407.01489 (Agentless), HAL arXiv 2510.11977, AgentConn
(2026-09-02), Cognition SWE-2 (2026-09-10), RouteLLM arXiv 2406.18665, FrugalGPT arXiv 2305.05176,
Snell et al. ICLR 2025, arXiv 2502.06703, arXiv 2608.11403. Deterministic pairing: CRANE arXiv
2502.09061, arXiv 2603.03305, arXiv 2604.03616, arXiv 2605.02363, XGrammar arXiv 2411.15100 and
2601.04426, OpenAI Structured Outputs (2024-08), ComfyGPT arXiv 2503.17671, LLM+P arXiv 2304.11477,
arXiv 2312.03042, arXiv 2510.20198, PAL arXiv 2211.10435, Plan-then-Execute arXiv 2509.08646, Fowler
"DSLs enable reliable use of LLMs" (2026). Evals: Anthropic "Demystifying evals for AI agents"
(2026-01-09), MT-Bench arXiv 2306.05685, arXiv 2605.08545 (log analysis), ComfyBench arXiv 2409.01392,
COMFYCLAW arXiv 2607.01709, arXiv 2608.14711 (Beyond Pass@k), arXiv 2601.20251, Inspect AI docs,
Promptfoo CI docs. Market: Krea (2026-03-18), Flora FAUNA (2026-03-31), Figma Weave (2026-04),
ComfyUI-Copilot ACL 2025 / Comfy MCP (2026-06-30), Higgsfield Hermes (2026-05-14), n8n builder docs
and arXiv 2606.29116, Make Maia (2026-02-02), Zapier Copilot docs, Dify (2026-07-28), Prompt2DAG
arXiv 2509.13487. Cost: claude.com/pricing, platform.claude.com prompt-caching and vision docs,
developers.openai.com pricing and caching guides, ai.google.dev pricing, vercel.com AI Gateway
caching (2026-09-08) — all fetched 2026-09-18.
