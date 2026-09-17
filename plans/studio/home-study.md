# Home study: Krea and Higgsfield (2026-09-17)

Observed from the live, signed-out pages at 1440×900 (Playwright screenshots, scratchpad), before
redesigning Studio's Home. The owner wants the Krea feel: Home is where people come to try models
and to start the agent.

## Krea (krea.ai)

**Shell.** Left sidebar, dark. Workspace switcher ("Krea ▾") at the top.
- Places: Home, Moodboards, Train Lora, Node Editor, Assets.
- Group label "Tools": Image, Video, Enhancer, Seedance Studio, Nano Banana, Realtime, Edit, More.
  Each item has its own coloured app icon (a small rounded square), so tools and models read as apps.
- Pinned at the bottom: Pricing (with a discount pill), Enterprise, Krea Agent, Sign in.

**Home, top to bottom.**
1. Hero, full width, animated background. One short headline ("A new era") and one line under it.
   Then the agent box: large, wide, centred. Placeholder "Ask me to do anything…". Inside: a "+"
   attach button at the left, a model and effort picker ("Auto Medium ▾") and a round send at the
   right. No helper text, no promises.
2. Featured banner carousel: one very large media card, a caption under it, previous/next arrows.
3. Bento row: one large promo card (Krea Agent, "Every model, one tool.", "Try now") beside six small
   action cards in a 3×2 grid. Each small card: model or tool icon top-left, a verb title
   ("Create images", "Edit by typing", "Enhance up to 21K", "Render as you draw", "Create videos",
   "Connect your agent") and a muted second line naming the model ("with Krea 2", "with Nano
   Banana…"). The model is the subtitle of the action, not the headline.
4. "Create with Krea Agent" section: subtitle "Start with template workflows, directly with Krea
   Agent.", an "Open Agent →" button at the right, then a horizontal row of large media cards with
   the title and one line laid over the bottom of the image. Templates are started by the agent.
5. "Explore image models" (with a search icon, previous/next arrows): large featured model cards,
   image background, "Featured" badge, name, one line, and three meters: speed (bolts), quality
   (gems), cost (a number with a credits glyph).
6. A gallery with its own search ("Search 90s anime") and tabs Images / Moodboards.

**Tool page (Image, Video).** "Model Krea 2 Turbo ▾" at the top left, with a tip "Change model for
higher quality." The tool's icon and name large in the centre (a video tool names the model:
"MiniMax H3"), example cards fanned under it, and the prompt bar docked at the bottom: text, then a
row of chips (model, style transfer, moodboard, LoRA, aspect "2:3", settings) and a round send. Video
adds Add image / Add video / Add audio tiles above the text, and start frame, end frame, duration
and aspect chips.

**Model Library (public page).** Eyebrow "AI MODEL CATALOG", title "Model Library", tool filter
chips with counts (Image 31, Video 34, Video Restyle 1, Motion Transfer 5, Lipsync 2, Audio 3).
Sections per modality; three columns of rows: provider logo, model name, one plain line ("Fast
model. Best for LoRAs."), an arrow. No prices on the list.

## Higgsfield (higgsfield.ai)

- Top navigation, not a sidebar: Explore, Image, Video, Audio, MCP | product names with small
  "New"/"Free" pills; Pricing with a "30% OFF" pill; neon yellow Sign up.
- Marketing-heavy: uppercase condensed display headings ("AI IMAGE GENERATOR BUILT FOR
  PROFESSIONALS"), neon CTAs, discount banners.
- Generator pages: a hero video with the prompt bar laid over its lower edge. The bar: "+" attach,
  placeholder "Describe any visual idea. We will generate an image.", chips for model ("Nano Banana
  Pro" with the provider logo), aspect ("3:4"), duration, sound; a large GENERATE button.
- Model tiles: small dark cards, provider icon, name, a "TOP" badge, one line, a modality tag.
- Feature cards: large media, a title, one or two lines under it.

## What carries over to Studio, and what does not

Carries over:
- Home as a launcher, not a document page: a centred agent box is the first thing, with attach and a
  model picker inside it, and no helper copy.
- Actions named by verb with the model as the subtitle ("Make images / with GPT Image 2.5").
- Templates as agent starts: "start from a template" is a way into the agent, not a separate gallery.
- Models as a browsable row with plain one-line descriptions and a small set of facts per model.
  Where Krea shows a credits number, Studio shows dollars.
- Tools as sidebar items with their own icons, under a "Tools" label.
- A prompt bar with chips (model, aspect, count) on tool pages.

Does not:
- Higgsfield's marketing voice: discount pills, neon, all caps, "built for professionals".
- Community gallery and search: Studio has no community feed.
- Featured banner carousels: nothing to announce yet.

## Second pass: say what Studio is (2026-09-17)

Owner: "What do you want to make?" is generic; Home does not come off as the vision. Studied
first screens of agent and model products (Playwright, scratchpad `study5/`).

- **n8n**: "AI agents and workflows you can see and control", then "Every step of your agents'
  reasoning, traceable on the canvas." The headline names the difference.
- **OpenRouter**: "The Unified Interface For Every Model" / "Better prices, better uptime, no
  subscriptions." Models are the pull; price is a plain promise, not arithmetic.
- **Lovable**: "Build something Lovable" / one line of scope, then the prompt box.
- **Manus**: "What can I do for you?", then starter buttons under the box (Create slides, Build
  website, Design…). Generic headline; the starters carry the meaning.
- **Lovart**: placeholder "What shall we design together?" and a live panel that shows the agent's
  steps ("Analyzed user intent", "Searching for high-quality references") beside the canvas.
- **Krea Node Agent** (earlier study): plans first, you can swap models before anything runs.
- Gumloop, Lindy, Runway, Flora: marketing heroes; nothing to take for an in-app Home.

What Studio takes, tuned to `vision.md`:
- A headline that names the harness, n8n-style, not a generic question.
- Starter asks under the box (Manus), each an ask the agent would turn into a workflow.
- The plan shown, not described (Lovart's steps, Krea's plan-first): for the chosen ask, the loop
  the vision describes (questions, cheap drafts, a pick, the final) with the real model and real
  price of each step, and the total. One element carries all three USPs.
- Models stay as the pull (OpenRouter, Krea), with prices. Curated templates after.
- "Build a graph on an empty canvas" moves to the toolbar as "New graph".
