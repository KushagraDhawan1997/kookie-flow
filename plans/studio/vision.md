# Studio vision

The owner's vision, in their words where possible. Every design and build decision is checked
against this file. Recorded 2026-09-17 from the owner's messages; update it when they refine it.

## How decisions are made

1. **Never invent UI.** Search how the best products solve the same thing, study several, take the
   best of each. Name the precedent.
2. **Then tune it to this vision.** Precedent is the raw material, not the answer. Where a
   precedent conflicts with the vision (a community feed, a fee split, a salesy hero), the vision
   wins.
3. Studies live beside this file: `home-study.md`, `model-page-study.md`, `research-graph-agents.md`.

## What makes Studio different

Flora, Weavy, Krea Nodes and others exist. Studio's edge is three things:

1. **Transparent, fair pricing.** Pass-through model cost plus a stated fee, no subscription.
   Transparency must not cost usability: one price, what you pay, everywhere, "think Apple".
   Transparency also means showing where models come from (who makes it, who serves it).
2. **Curated templates, no community.** Quality over quantity. Templates are input → output
   workflows (Flora calls them techniques). Opening one shows what it does; you can go to its
   graph. Running a template as an "app" comes later.
3. **The harness: agent loops.** The largest focus. See below.

## The agent and its harness

- **The naive path** is: write or generate a detailed prompt → plug it in → generate. Studio's
  path is: ask the agent. How it responds *is* the harness.
- **A good response is a workflow, not an answer.** For "I need to generate a gaming controller"
  the agent:
  1. asks questions: what is it, for what device, is it a mock, a concept, a real product;
  2. makes low-fidelity directions with a cheap model (up to N): did it get the direction right;
  3. lets you pick (a selection switch, a logic node, not just generation);
  4. makes the final with the best model.
  The template this leaves behind is prompt → low-fi ideas → selection switch → final fidelity,
  and the pattern scales without limit.
- **The agent generates everything as a workflow.** It must *know* how to build good workflows.
- **It runs above graphs.** It decides whether to add nodes to the current graph or start a new
  graph.
- **A graph is infinite and holds clusters.** A template is an isolated node cluster for one job;
  one graph can hold many.
- **Where it lives.** The right-hand panel (today's inspector) is where the LLM sits.
- **Later:** the whole of Studio is controllable by the agent.
- **The agent is an LLM, from any provider.** Claude and GPT at launch. Its picker chooses the
  language model and effort (Krea's "Auto · Medium").
  Image and video models are the agent's to choose, as in Krea Agent, FAUNA and Lovart.

## Efficiency: the V6 (recorded 2026-09-17)

The owner's example is the last Ford GT: the V8 swapped for a V6, and the car built around getting
the most out of it. The model is the engine; the harness is the car. The aim is a harness so well
made that a mid model (Sonnet, Opus, smaller) does the job for next to nothing, and a frontier model
is never needed.

- **Deterministic tools beside the model, always.** The model decides intent. Anything with one right
  answer is a tool: layout (`arrange`), validation, pricing, model choice by table, settings for a
  draft, the shape of a known workflow.
- **Every token and every call is weighed.** Fewer, bigger, safer tool calls; small context; cached
  prefix; cheap model first, a dearer one only when a check fails.
- **Proof, not feel.** A fixed set of asks, scored by deterministic checks (graph shape, cost, tokens,
  refusals), run across models. The harness is tuned until the small model passes.

## Home

- The Krea vibe, not Flora's: **this is where you come to try the models.** Models are the pull.
- Two ideas lead: **run the agent**, and **the models**.
- Genuine, never salesy. No filler copy ("Nothing runs until you approve the price" was called out).
- No fixed plan or process diagram on Home. The agent decides the workflow after it asks, so a
  canned plan misstates the harness (tried and rejected 2026-09-17). Home is the box, starters,
  models and templates; the workflow shows up where the agent builds it.

## Craft

- Kookie UI v2 throughout: `Shell`, `Page`, one column width, no layout shift between pages.
- Cards only group or contain; images sit bare with labels under them.
- No `size="1"`; quieten with emphasis.
- Mocks use grey boxes, never stock images.
- Research before building, every time.
