# Agents that build or edit node graphs (research, 2026-09-16)

"Unverified" means the only source was secondary or low-credibility, or sources disagreed.

## Creative node tools

**FLORA / FAUNA** — most direct competitor
- Agent builds whole graphs and edits live canvases: add, reconnect, remove nodes, change settings, group and arrange, drive the layer editor. Runs up to 50 generation nodes at once. Finds web and Unsplash references; resizes one approved image into many formats.
- Sidebar (⌘/), @-mention nodes, attach images, expandable reasoning. Notices canvas edits between turns ([NEW]/[MODIFIED]).
- Assist mode (default) shows which nodes will run and the estimated cost, then waits for approval. Auto mode runs without asking. No clarifying-question step documented; it follows direction rather than challenging it.
- Agent is free; generations draw from a pooled dollar budget (credits until 2026-05-06). No markup disclosed. Plans $18 / $54 / $200 a month, unlimited seats.
- "Techniques": curated workflows from studios such as Netflix and Pentagram. No community feed.
- Scope: one project. Cannot see other projects or history. Chat history per project.
- Launched 2026-03-31, beta. Complaints: weak prompt adherence; every retry costs.
- https://docs.flora.ai/editor/fauna · https://flora.ai/blog/introducing-fauna · https://ppc.land/floras-fauna-the-ai-creative-agent-that-fights-back-against-generic/ · https://cmotech.news/story/flora-launches-on-canvas-tools-dollar-usage-pools

**Krea Node Agent** (inside Krea Nodes, March 2026)
- Reads the whole canvas including cached outputs and reuses them. Plans a pipeline, wires nodes, fills missing parameters, adds converter nodes. Reruns only affected downstream nodes after an edit.
- Plan first; you can swap models or drop stages. "Nothing runs until you say go."
- Per-node cost shown before running, in credits. Pro and up (about $30 a month).
- https://www.krea.ai/blog/ai-workflow-agent · https://www.krea.ai/docs/user-guide/features/nodes · https://x.com/krea_ai/status/2034642297485140143

**Krea Agent** (separate chat product, beta 2026-09-03)
- Plans, picks models, generates and edits assets, files them in a context library (session, personal, workspace). Explicitly does not run Krea Nodes graphs. Connects to Slack, Notion and others with allow-or-ask permissions; hosted MCP server.
- Generations cost the same as manual. Planning model billed separately. No cost preview documented. Stops before the next billable turn when credits run out.
- Plan access inconsistent (docs: every plan; blog: Max and up).
- Trustpilot: misread tasks, changed a character against instructions, burned credits fixing itself.
- https://www.krea.ai/docs/user-guide/agent/plans-and-credits · https://www.krea.ai/blog/what-is-krea-agent · https://alphasignal.ai/news/krea-agents-opens-beta-to-replace-node-wiring-with-plain-english-prompts · https://au.trustpilot.com/review/krea.ai

**Runway Agent + Workflows**
- Workflows (manual canvas) October 2025. Agent builds Skills 2026-07-08. `/Workflow` builds, connects and runs a full graph from plain language, 2026-07-23; no clarifying questions. Agent sessions in Projects with Brand Kits 2026-08-11. MCP lists, opens, changes and runs any workflow in the workspace, 2026-08-20: the only cross-workflow scope found.
- Credits; Claude nodes 3–4 credits a run on top of media.
- Agent 2.0 storyboard approval before spending (unverified). Stated downside: debugging a graph you didn't build is slower.
- https://runway.com/changelog · https://alphasignal.ai/news/runway-agent-builds-entire-ai-video-pipelines-from-plain-language · https://www.veo3ai.io/blog/runway-agent-2-0-review-2026 (unverified)

**Magnific** (Freepik Spaces, renamed 2026-04-28; Agents, MCP, Flows 2026-06-03)
- Agent builds editable Spaces workflows. Memory persists across sessions, shared with the team, holds brand files, coordinates other agents. Three stock agents plus custom. Workflows publish as team-runnable "Flows".
- Cost preview and clarifying questions not found (pages 403).
- https://www.magnific.com/agents · https://x.com/magnific/status/2062304741842137144 · https://www.wireflow.ai/blog/freepik-spaces-is-now-magnific

**Figma Weave** (Weavy, acquired October 2025, about $200M)
- No agent that builds Weave graphs. Weave tools inside Figma Design; workflows publish to Figma Community; exposed via MCP. Figma agent packages skills (September 2026).
- Credits vary with parameters; $10 = 1,000–1,200 credits.
- https://help.weavy.ai/en/articles/12267166-figma-weave-s-credit-system · https://www.figma.com/blog/config-2026-recap/ · https://releasebot.io/updates/figma

**Scenario Node Agent** (2026-05-06)
- Builds or edits graphs from text, including bulk edits. 500 models; 3D, rigging, animation chains. No cost preview documented.
- https://www.scenario.com/blog/scenario-node-agent-is-here

**Higgsfield Canvas**
- Node canvas; "agent-built workflow" tweet unverified, docs describe manual building. Free to build, pay per node run; canvases save as templates.
- https://x.com/higgsfield/status/2049582424535830917 · https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-canvas

**Adobe**
- Firefly AI Assistant (Project Moonlight), public beta 2026-04-27: about 100 tools across Creative Cloud, step in anytime, remembers preferences. Pricing undisclosed.
- Project Graph / Firefly Graph: node workflows shared as "capsules". No date; no graph-building agent. Invoke acquired October 2025 into AI Foundry.
- https://techcrunch.com/2026/04/15/adobes-new-firefly-ai-assistant-can-use-creative-cloud-apps-to-complete-tasks/ · https://blog.adobe.com/en/publish/2025/11/25/introducing-project-graph-creative-workflows-reimagined · https://www.pixelsham.com/2025/10/20/adobe-buys-invokeai-and-launches-adobe-ai-foundry/

**ComfyUI ecosystem**
- ComfyUI-Copilot (Alibaba AIDC, v2.0 August 2025): returns 3 library workflows plus 1 written; debugs errors, suggests model downloads, edits by language; GenLab batch-compares parameters. Needs an API key; some services "no longer available".
- Comfy MCP (official, 2026-06-30): agents search and run shared workflows; do not build graphs.
- Image Chooser custom nodes pause a run for a human pick: the manual version of our pick node.
- https://github.com/AIDC-AI/ComfyUI-Copilot · https://comfyui-wiki.com/en/news/2026-06-30-comfy-mcp-agent-integration · https://www.runcomfy.com/comfyui-nodes/cg-image-picker

**NodeTool** (AGPL, Cloud alpha)
- Agent-first, about 120 tools across canvas, timeline, 3D and app builder. Builds, validates before running, runs, repairs. Decision and dollar caps per run. "Questioning mode" asks for decisions only the user can make.
- Bring your own keys at list price; no credits, no markup.
- https://nodetool.ai/blog/agent-first-privacy-first-ai-workspace · https://github.com/nodetool-ai/nodetool · https://nodetool.ai/pricing

**Chat agents without a graph**
- Luma Agents (2026-03-05): brief to delivery on boards; credits don't roll over, failed runs cost. https://techcrunch.com/2026/03/05/exclusive-luma-launches-creative-ai-agents-powered-by-its-new-unified-intelligence-models/
- Glif dropped nodes for a chat agent (March 2026); APIs deprecated 2026-05-20.
- fal Agent (2026-08-12): graph output not confirmed.
- Lovart ChatCanvas: mark up the canvas to steer.
- Canva AI 2.0 (2026-04-15): orchestrates tools from chat.

**No graph-building agent found:** Martini (community Recipes), Kaiber Superstudio, Leonardo Blueprints, OpenArt, Tensor.art, Pletor, Wireflow, Astorie. Visual Electric acquired by Perplexity October 2025 and shut down.

## General workflow builders

- n8n AI Workflow Builder: create, edit, debug by chat; 1 credit per message (20/50/150 a month). Cloud only.
- Zapier Copilot: "Auto-build" or "Ask as you build"; every change is a checkpoint with diff and one-click rollback.
- Make Maia: builds scenarios module by module; AI Agents beta 2026-02-02.
- Microsoft Copilot Studio (GA 2026-05-20): clarifying chat, then a plan you confirm, then it builds. Chat can't edit once the designer opens. Anthropic models.
- Gumloop Gummie: plan, add nodes, write prompts, diagnose errors.
- Vellum: prompt, doc or sketch to code plus graph.
- Google Opal: prompt to editable step graph; 160+ countries.
- OpenAI Agent Builder: manual canvas; shuts down 2026-11-30.
- Relay.app: built-in human approval steps that pause runs.
- Pipedream: AI build and debug; being acquired by Workday. Lindy: single-job agents. Langflow, Flowise, Dify: no confirmed prompt-to-graph.

## Research

- ComfyBench / ComfyAgent (arXiv 2409.01392, CVPR 2025): 200 tasks, workflows as code, multi-agent.
- ComfyGPT (arXiv 2503.17671): 86.1% vs 51.1% on ComfyBench; FlowBench.
- ComfyMind (arXiv 2505.17908): tree planning with rollback; 100% pass, 83% resolution.
- ComfyUI-R1 (arXiv 2506.09790): reinforcement learning.
- ComfyClaw (arXiv 2607.01709, ECCVW '26): typed graph edits with auto-revert; vision model checks output regions and turns failures into repairs; past runs distilled into skills.
- Knowledge-Centric Agents, INSAIT + Adobe (arXiv 2607.15845): Qwen3-14B fine-tuned on 912 workflows; 86.9% vs 36.4%; weak on rare nodes.
- GenRouter / GenCanvas (arXiv 2608.16721): routes each prompt to the cheapest good-enough pipeline; cost down more than 65%.
- AFlow (arXiv 2410.10762, ICLR 2025 oral): MCTS over workflow code; small models beat GPT-4o at 4.55% of the cost.

## What nobody does yet

1. A dollar quote with a stated fee, per node and per plan. Krea and FAUNA quote, but in credits or a pooled budget with no stated margin. NodeTool is pass-through with no fee and no hosted billing.
2. Clarifying questions before building a creative graph. Only Copilot Studio, Zapier and NodeTool ask.
3. An agent that composes cheap drafts, a human pick, then high fidelity. Picks exist only as manual ComfyUI chooser nodes or Relay approvals; cost-tier routing is research only (GenRouter).
4. Deciding between extending this graph and starting a new one. FAUNA is locked to one project; Krea's two agents are separate products; Runway MCP opens any workflow but documents no decision logic.
5. Checking outputs with vision and repairing, tied to a budget. Research and NodeTool only.
6. Curated templates without a community feed. FLORA Techniques only.

## Closest competitors

1. FLORA FAUNA: same shape and curated Techniques. Missing clarifying questions, cross-project scope, stated fee.
2. Krea Node Agent: best plan-then-build, per-node cost, downstream-only reruns. Credits; billing distrust; cross-project agent is a separate product.
3. Runway Agent + Workflows: builds and runs graphs, operates across all workflows via MCP. Credits; no clarifying questions.
4. Magnific: agents with team memory produce workflows published as Flows; biggest distribution.
5. NodeTool: closest pricing philosophy and agent design (questioning mode, validation, dollar caps), AGPL like Studio. Small, alpha, weak curation.
