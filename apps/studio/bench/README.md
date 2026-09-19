# The agent bench

Twenty scenes the agent is asked to handle, scored by checks a machine can make, run against real
models for real tokens and no renders. It exists so that a claim about the harness — this model is
enough, this instruction helped, this tool saved a call — is a number instead of an opinion
(`plans/studio/harness-plan.md`).

## What it runs

The app's own instructions (`agentInstructions`), tool schemas (`AGENT_TOOLS`), provider options and
output caps, and `streamText` as the route uses. The tools answer from a `GraphDocument` instead of a
canvas (`host.ts`), through the same functions the app uses to describe a graph, compile ops and
price a node.

- **No renders.** A run marks its node done and hands back a picture already in the store, so
  `inspect` costs real image tokens while nothing is generated and nothing is charged to a balance.
- **The person is a policy.** `approve` on a task says what they would press; `replies` are what they
  would say next.
- **Only tokens cost money**, and the budget stops the run.

## Running it

Nothing happens without `BENCH_RUN=1`.

```sh
cd apps/studio
BENCH_RUN=1 BENCH_MODELS=anthropic/claude-haiku-4.5 BENCH_TASKS=one-image BENCH_BUDGET=0.10 \
  ./node_modules/.bin/vitest run --config vitest.bench.config.ts
```

| Variable | Default | What it does |
| --- | --- | --- |
| `BENCH_RUN` | unset | Without it, nothing runs and nothing is spent. |
| `BENCH_MODELS` | `anthropic/claude-sonnet-5` | Gateway slugs, comma-separated. |
| `BENCH_EFFORT` | `low` | `low`, `medium`, `high`, `max`. |
| `BENCH_TASKS` | `all` | Scene ids, comma-separated. |
| `BENCH_TIERS` | `1,2,3` | 1 one step, 2 a pipeline, 3 judgement. |
| `BENCH_REPEATS` | `1` | Trials per scene. Five gives pass^5. |
| `BENCH_BUDGET` | `1` | US dollars at list price. The run stops when reached. |
| `BENCH_LABEL` | `run` | Goes in the result file's name. |

`STUDIO_AGENT=mock` runs the scripted agent instead, which costs nothing and tests the plumbing. It
only knows the concept scene, so everything else fails.

Results land in `bench/results/<stamp>-<label>.json`: every trial with its checks, tool calls, tokens
by class, cost, and the graph it left behind. Read the transcripts whenever a number moves.

## Reading a score

- **pass^k, not pass@k.** Five repeats that all pass is the number that matches how it feels to use;
  one pass in five does not.
- **A scene marked `baselineFor` is a gap in the harness**, not a bad model: it is expected to fail
  until that step of the plan lands, and the failure is the measurement.
- A check can judge a graph, an order of events and a price. It cannot judge a picture.
