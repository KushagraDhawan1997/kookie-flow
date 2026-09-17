# Model page study (2026-09-17)

Observed live at 1440×900 (Playwright, scratchpad `study2/`) before rebuilding Studio's model pages.
Rule from the owner: never invent UI; take the best of the precedents.

## What each does well

- **OpenRouter** (`/anthropic/claude-sonnet-4`). Maker logo + name, slug with copy. A strip of
  labelled facts: Modalities, In/Out price, Context, Released, Knowledge cutoff. Left section nav:
  Providers, Pricing, Performance, Uptime, Benchmarks, Apps, Activity, FAQ. Providers table: logo,
  name, region flag, input/output/cache price, latency, throughput, uptime. One sentence explains
  that several companies host the same model.
- **Vercel AI Gateway** (`/ai-gateway/models/claude-sonnet-4`). Maker as an eyebrow over the name.
  "Input / output price: From $3 / $15 per 1M" and "24h uptime" as two labelled facts. Anchor tabs:
  Overview, Playground, Providers, Uptime, Status, Throughput, Latency, API, Similar, About, FAQ.
  Providers table with "Legal: Terms • Privacy" under each provider name, and the line "Using a
  provider means you agree to their terms". List page: Model, Input, Output, Latency, Providers
  (logos), ZDR, No Training, Capabilities, Released.
- **fal** (`/models/fal-ai/flux-pro/v1.1`). Endpoint id as the title, badges Inference / Commercial
  use / Partner. Tabs Playground, API, Examples. Input form beside Result. Price as one rule:
  "Your request will cost $0.04 per megapixel. Images are billed by rounding up…". Readme below.
- **Replicate** (`/black-forest-labs/flux-1.1-pro`). Owner / name. One meta line: Warm, Official,
  runs, "$0.04 per output image", Commercial use, Zero training. Tabs Playground, API, Examples,
  README. Input schema lists each field with type, description and default.

## What Studio took

| Studio section | From |
| --- | --- |
| Facts row: Made by, Served by, Price, Commercial use | OpenRouter's strip, Replicate's meta line |
| Examples first | fal, Replicate |
| Pricing: one rule sentence, then a table of the choices that move it | fal's rule, OpenRouter's pricing table |
| Served by: provider, endpoints, Terms · Privacy, View on fal | OpenRouter and Vercel Providers |
| Inputs: name, description, type, default | Replicate's schema, fal's Schema |
| Similar models | Vercel |
| List rows name the host ("Served by fal") | Vercel's Providers column |

Left out for now: performance and uptime (no data yet), playground (the graph is the playground),
code/API tabs (Studio has no public API).
