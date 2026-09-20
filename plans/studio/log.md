# Studio: build log

> Newest first. What was built, what was verified, what went wrong and what is open. The plan is
> [plan.md](./plan.md); the stack reasons are [research.md](./research.md).

---

## 2026-09-17, the agent panel's conversation

Asked with three screenshots: every tool call on its own grey line, one large picture per line
under "Looked at draftN", validation errors as paragraphs, text reading through the glass tabs and
the composer, and the attachment note shown in the person's bubble.

- **A Kookie UI v2 block first**, `conversation` (`kookie-ui-v2/apps/docs/blocks/conversation.tsx`
  and `.css`, registered with two demos and a usage file; the block laws pass). Copied to
  `apps/studio/src/app/conversation.{tsx,css}`. Parts: `UserMessage` (tint, no edge, thumbnails
  above), `Steps` + `Step` (a run folds to one row, live or counted, opening to a hairline list),
  `Pictures` (one at its shape, several square).
- **Precedent:** ChatGPT and Claude for the bubbles; ChatGPT "Thought for", Perplexity "Completed
  N steps", Cursor's grouped tool calls and FAUNA's live line and "View steps" for the fold;
  Midjourney and ChatGPT image sets for the pictures; Apple's scroll edge effect for the bands.
- **Panel:** a reply is read as text blocks and runs of tool calls; each run's `inspect` pictures
  are lifted out beside it. Self-corrected failures stay inside the run. "Thinking" is not shown
  when the live run already says what is happening.
- **Attachments:** a sent message carries `metadata.pictures` (their addresses); the model's
  "(Attached … as n1.)" note is stripped for display. Older messages show the words only.
- **Fade:** the transcript is hidden under the floating bands and ramps only over its last
  stretch (`agent-panel.css`). Belongs in `scroll-area.css` once the uncommitted message-scroller
  work there lands.
- Verified: `tsc` clean in both repos; screenshots of a full mock turn (attach, drafts, approval,
  pick, final, scrolled) on an isolated copy with the mock agent and provider, no key.
- Open: "Start over" still floats alone at the top (it belongs in the pane's header, which another
  session is editing); clarifying questions are plain text (Cursor's option card needs an ask tool).

## 2026-09-15, sign-in and a dollar balance

Asked as "we can build with better auth", then "keep dollar amount, very transparent about our
markup, 1$ = 1$", then Stripe in test mode (the owner is an autónomo in Spain; Stripe onboarding
chose Managed Payments). This is the start of phase 9, ahead of phases 3 and 5–8.

### What was built

- **Sign-in.** Better Auth 1.7.4, email and password, on the app's own database (`auth_*` tables).
  The first account is always allowed and takes over everything under the `local` workspace;
  after it only `STUDIO_SIGNUP_EMAILS` may sign up. The workspace is the user's id. `proxy.ts`
  sends a request with no session cookie to `/sign-in` (pages) or 401 (API); every route and page
  checks the real session (`server/session.ts`). Open paths: `/sign-in`, `/api/auth`, the webhook.
  `/api/blob` is now behind sign-in too.
- **Prices.** `studio-core/pricing.ts`: money in micros; `MARKUP = 0.5`, shown as its own line
  everywhere. fal's prices as of today, from its pricing API and model pages: GPT Image 2.5 by
  fal's size × quality table (nearest listed size, $0.01 per connected picture for input tokens,
  `auto` quality priced as high), Clarity $0.03/MP of the result, BiRefNet $0.0008/compute s
  estimated at 10 s, Wan $0.40 720p / $0.20 480p, ×1.25 past 81 frames. The inspector quotes
  "About $X to run: model $Y + 50% fee $Z" from the same table the server charges from.
- **Ledger.** `ledger` table, append-only: topup, hold, release, charge. Balance is the sum. A new
  job holds estimate + fee in the transaction that inserts it, under a per-workspace advisory lock,
  and a short balance is 402 with the amounts in the node's message. Every ending passes through
  `setStatus`, which settles once (a conditional `billing = 'held'` update): success releases the
  hold and charges the price of what came back; failure and cancel release. An ask answered by an
  existing row holds nothing. Billing is on when `STRIPE_SECRET_KEY` is set (or `STUDIO_BILLING`).
- **Stripe.** `POST /api/billing/checkout` makes a Checkout Session for $5, $10 or $25, with
  Managed Payments stated explicitly (on unless `STRIPE_MANAGED_PAYMENTS=off`) and tax code
  `txcd_10105001` (AI as a Service, cloud, personal use; `STRIPE_TAX_CODE` overrides). The webhook
  verifies the signature, credits the amount chosen from metadata (never the total with tax), keyed
  by session id. `/billing` shows the balance, the top-ups and the history; the balance menu sits
  in the editor header and on the graph list.

### What was verified

`tsc` clean for studio and studio-core. studio-core 41 tests (pricing among them). studio: billing
on a throwaway PGlite (refuse with nothing written, top-up credited once, hold then real charge
once across repeated polls, release on cancel and on a refused submission, workspaces apart),
sign-up rules (first account claims `local`, stranger refused, invited allowed), the webhook
(unsigned and forged refused, paid credited once across retries, unpaid and non-top-up ignored).
Against the running server: `/` redirects to sign-in, `/api/graphs` and `/api/blob` answer 401, an
unsigned webhook 400. In Stripe test mode, a session with the route's exact parameters was created
and paid with 4242 on the hosted page: $5.00 + IVA 21% = $6.05, `complete paid`, the forwarded
webhook answered 200 and the server logged "credited $5.00 to e2e-check".

### What went wrong

- **The keys and the CLI were different Stripe sandboxes.** `stripe login` authorised
  `acct_1UFgPl…`; the keys in `.env.local` belong to `acct_1UFgNs…`, so the first listener heard
  nothing. The owner then replaced the keys with the CLI sandbox's own (`acct_1UFgPl…`); the
  webhook secret was regenerated for it, and a second test payment there ($6.05 with IVA) was
  forwarded, answered 200 and credited $5.00.
- **Managed Payments is on by default for the account** and refuses a line item with no product
  tax code, and `stripe trigger checkout.session.completed` fails under it (shipping parameters).
- Stripe added 21% IVA for a Spanish card, which is why credit comes from metadata.
- The first proxy matcher sent `/fonts/*.woff2` to sign-in; fonts are now excluded.
- **The owner's first top-up went to the old sandbox and came back to sign-in.** Two causes. The
  Stripe client was cached once per process, so after the keys changed the checkout still used the
  old account, whose webhooks nobody forwards (test money; nothing credited). And the return URL
  came from `request.url`, which named `localhost:3002` while the session cookie lived on
  `127.0.0.1:3002`. Now the client is cached per key, the return URL is `BETTER_AUTH_URL`, and a
  page asked for under any other Host gets a tiny page that moves the browser to that address. A
  307 was tried first and looped in the browser: Next rewrote its Location to a bare path, since
  both names are its own origin. After a restart for fresh env: `localhost` answers the moving page
  pointing at `127.0.0.1:3002`, `127.0.0.1` pages behave normally, API under `localhost` still 401.
  Neither of the owner's two checkouts reached the new sandbox, so neither credited.
- A test-mode ledger row exists for workspace `e2e-check` ($5.00). It belongs to no one.

### Open

- The owner's account is not created. `/sign-in` is one screen, "Sign in" with "Create one"; the
  first account made there inherits the existing graphs, jobs and pictures, with no screen of its
  own (the "Create the owner account" heading was dropped at the owner's ask).
- The balance starts at $0, so every paid node is refused until a test top-up.
- The listener is a background task of this session; `stripe listen --api-key … --forward-to
  http://127.0.0.1:3002/api/billing/webhook` has to be running for top-ups to land locally.
- GPT Image's real charge is fal's table, not fal's token bill; fal does not report the tokens a
  request used. BiRefNet's seconds are an estimate for the same reason.
- No refunds of unused balance, no email verification, no password reset (needs an email service).

## 2026-09-15, the ring travels when the length is unknown

Asked as: the ring does almost a full spin, starts again, and sticks at centre right. The canvas
already draws a travelling arc when a run reports no progress. The jobs port reported a token 0.05
once the POST answered queued, and 0.3 while running with no provider number, so the arc (one lap
in about 3.3 s) snapped to a sweep and eased to 0.3, a quarter-plus of the perimeter from
top-centre: centre right, held for the rest of the job. The port now reports only a number the
provider gave, and no closing 1 (the success hold completes the ring). The port test expects
`[0.5]`. Not watched in a browser: that needs a real Run, which spends.

## 2026-09-15, the inspector speaks to people

Asked with a screenshot of the inspector header: "whats this n1 stuff? And why is the copy so
weird?" The header printed the node's id and type, and the description the agent reads.

### What was built

- Every node definition gains a required `summary`: one short, plain sentence for a person. The
  `description` stays as the agent's text. Search matches both.
- The inspector shows the label and the summary. The id and type line is gone. A node whose type
  no longer exists reads "Unknown node" and says so, rather than printing its type.

### What was verified

`tsc` clean for studio-core and studio; studio-core 35/35, studio 25/25. In a browser on a new
graph with nothing run, the selected GPT Image 2.5 shows "Makes an image from a prompt, or edits
one you connect.", with no id line and none of the agent's text. Test graph deleted.

## 2026-09-15, options read as words

Asked with screenshots of the Size list (`square_hd`, `portrait_4_3`) and "png", "auto": options
should read as a person would write them.

### What was built

- **Library.** A socket's `optionLabels` maps a value to its label. The closed select, the GL list
  (labels resolved once per open, measured for width), segmented, the accessibility mirror and the
  DOM select print the label; the stored value is unchanged. Docs (sockets) and changelog.
- **studio-core.** `SocketSpec.optionLabels`, passed through the registry. `choice` takes
  `[value, label]` pairs. Labels: Flare, Sunburst; Auto, Low, Medium, High, Extra high, Max; Auto,
  Transparent, Opaque; PNG, JPEG, WebP; Auto, Custom, Square HD, Square, Portrait 3:4, Portrait
  9:16, Landscape 4:3, Landscape 16:9 (fal's `portrait_4_3` is 3:4 tall); 1024 × 1024, 2048 × 2048;
  Regular, None. Values sent to fal did not change, so saved graphs and job keys still match.
- **Inspector.** Passes the labels to `Select` as `items`, so the trigger reads the label too.

### What was verified

`tsc` clean for all three. Library 890/890 (a new test: label or value fallback, closed select,
segments), studio-core 35/35, studio 25/25. In a browser on a new graph with nothing run: the node
reads Flare, Medium, Auto, Auto, PNG; the inspector triggers read the same; the mirror lists the
labelled options. The open GL list was not screenshotted. Test graphs deleted.

## 2026-09-15, opening a graph asks, it does not run

Asked as "I refresh, and I see prompt is empty error, why is this an error". Opening a graph ran
every node, paid ones included, so a GPT Image node with an empty prompt was submitted on every
load and came back red.

### What was built

- **Library.** `restoreAll()` on the engine, store and instance. It marks everything stale, runs
  reactive nodes, and opens manual ones with `ctx.restore = true`. A manual node that returns
  nothing stays dirty and holds its downstream. `EvaluationContext.restore` is false on every other
  run. `evaluate(id)` now also clears a leftover forced flag. Docs (evaluation, saving, instance)
  and the changelog carry it.
- **studio-core.** `RunContext.restore` and `JobRequest.restore`; `JobsPort.run` returns null for
  a restore that found nothing; a node's `run` may return nothing; the evaluator does not cache
  nothing.
- **Server.** `findJob` looks up a queued, running or finished row and never submits. `POST
  /api/jobs` with `restore` answers that row, or 204.
- **Editor.** Opens with `restoreAll()` instead of `evaluateAll()`. Run and Run all are unchanged,
  so a node never made is submitted only when pressed.

### What was verified

`tsc` clean for the library, studio-core and studio. Library evaluation tests 59/59 (three new:
restore flags reach only gates, a miss stays dirty and a later Run runs it for real, `evaluate`
never restores). studio-core 35/35. studio 25/25 (a restore that gets 204 answers null and polls
nothing; `findJob` finds nothing twice without making a row, then finds the submitted one). In a
browser: a new graph with GPT Image 2.5 and an empty prompt, reloaded; the only `/api/jobs` ask
carried `restore: true` (a non-restore ask was blocked by the check), no "prompt is empty", no red
ring, no page errors. The throwaway graph was deleted.

### Open

- A job that failed is not restored, so its node opens waiting rather than showing the failure.

## 2026-09-14, a node is a model

Asked in two steps once the key was in: "each node should be designed per model, so we can expose
the controls each model exposes; rename it to the model name", then "why are edit and normal
different nodes? As a user I don't know the difference."

### What was built

Every generation node is now one model, named for it, with that model's own controls and
defaults from fal's endpoint document, and nothing invented. **GPT Image 2.5** is one node: a
prompt alone makes a picture, and a connected picture (or reference) turns the same ask into an
edit — the server picks the endpoint, so the person at the canvas never learns there are two.
It carries variant (Flare, Sunburst), quality (auto to max), size (auto, custom with width and
height, or a preset), background, format, compression, an optional reference and mask, and a
reroll knob that stands in for the seed the model does not take. The server checks a custom
size against the endpoint's rule (655,360 to 8,294,400 pixels, no side over 3840, sides within
3 to 1) before anything is spent. **Clarity Upscaler** exposes factor, prompt and negative
prompt, creativity, resemblance, guidance, steps and seed. **BiRefNet** exposes its three models,
working resolution, edge refinement and format, and always asks for the mask. **Wan Image to
Video** replaces the invented seconds-and-fps with the model's frames (81 to 100), fps (5 to
24), resolution, aspect, guidance, shift, steps, prompt expansion, acceleration, negative prompt
and seed. Node types changed with the names (`ai/gpt-image-2.5`, `ai/clarity-upscaler`,
`ai/birefnet`, `video/wan-i2v`), as did the task ids; the owner's test graph holds three nodes
of the old types, which now show as unknown. What a node cannot yet carry — sixteen reference
pictures, several images per ask — waits for list sockets.

### What was verified

`tsc` clean for both packages. 35 studio-core tests; 23 studio tests, the fal table's among
them: the endpoint follows the variant and turns to edit when a picture is connected; every
control goes under the endpoint's name; compression is sent only with JPEG or WebP; an unknown
choice falls back to the model's default; an empty prompt, a size too small, too large, too
tall or over 3840 a side is refused before anything is sent; a mask with nothing to change is
not sent; the other three models' bodies and files. The pipeline test runs on the new task ids.
In a browser, light and dark, with nothing run: GPT Image 2.5 and BiRefNet land from the
right-click menu with every control on the node and in the inspector, wait for Run, and nothing
asked `/api/jobs`.

### Open

- Still not run against fal. The first real Run is the test of the shapes.
- Width and height are shown whether or not Size says custom; a control that hides when it does
  not apply needs a rule the socket table does not have.

## 2026-09-14, jobs that survive the tab

Asked as "durable streams: how will it survive browser refresh, long jobs", then "create an env
local, I'll add the key, let's build the infrastructure", then "start with GPT Image 2.5
Sunburst and Flare". The owner added a real `FAL_KEY` to `apps/studio/.env.local` mid-build.

### What was built

The job's state lives on the server, never in the tab. `POST /api/jobs` takes a task and inputs,
submits, saves the row with the provider's own id and `provider_state` (fal's status, result and
cancel URLs), and answers at once; the browser polls `GET /api/jobs/:id` every 1.5 s, holding no
request open. A pending row is asked about on each poll, and a done one is finished right there:
the file fetched, hashed, stored, and written back as a `MediaRef`. `DELETE /api/jobs/:id`
cancels. A refresh, a closed tab or a server restart loses nothing: the same ask finds the same
row by `key`, and the next poll carries on.

The same ask is free. `key` is sha-256 over provider, task, model and the inputs' identities — a
picture by its hash, so the URL it is reached by does not matter. A queued, running or finished
row with the key answers the next ask; a failed or cancelled one does not, so a retry is a fresh
submission. That is what makes opening a graph, which runs every node, cost nothing for what was
already made. The browser's in-memory cache stays as a shortcut in front of it.

Providers are a small interface in `src/server/providers/` (`model`, `submit`, `status`,
`result`, `cancel`) that never touches the database or sees a `MediaRef`. Nodes name a task
(`text-to-image`), never a model. The fal table (`fal-tasks.ts`) is hand-written from each
endpoint's OpenAPI document: pictures are `openai/gpt-image-2.5/{flare,sunburst}/text-to-image`
and `/edit`, chosen by a `model` select on the node, with a `quality` select (low, medium, high;
medium by default). Those models take no seed, so the node's seed is the "another one" knob and
says so. The size floor rose to 1024 a side because the endpoint wants 655,360 pixels at least.
Upscale is `fal-ai/clarity-upscaler`, remove background `fal-ai/birefnet` with its mask, and
animate `fal-ai/wan-i2v` at 720p with seconds and fps brought inside its 81–100 frames at 5–24.
A picture the node holds is uploaded to fal's storage first (once per hash per process), since
fal cannot reach this server. The mock is the same interface and now takes
`STUDIO_MOCK_DELAY_MS` (default 2000) from the row's own timestamp, a quarter of it queued, so the
whole path — row, poll, refresh, restart — runs with no key and no cost. `STUDIO_PROVIDER` picks
one; unset, a key means fal.

A provider's answer does not always state a file's size (birefnet's is nullable, wan's clip has
none), and the server has no decoder, so `studio-core` gains `probeMedia`: the size and type of a
PNG, JPEG, WebP, GIF or MP4 from its header, and an MP4's length from its movie header. Migration
`0002` adds `task`, `key` and `provider_state` to `jobs`. The app gains vitest (`pnpm --filter
studio test`) with the `@` alias.

### What was verified

`tsc` clean for studio and studio-core. studio-core: 35 tests, the probe's synthetic headers
among them, and both fixture files probed for real. studio: 19 tests — the fal table's request
shaping and result reading; the key's identity rules; the pipeline end to end on a throwaway
PGlite with the mock (submit, found again by the same ask in any key order, finished by a poll
into storage with the photograph's own size, a clip with its size, a cancelled row and a refused
submission not answering the next ask, an unknown task refused); and the browser port against a
scripted `/api/jobs` (submit then poll to done with progress 0.05, 0.5, 1; a settled answer
returned at once; one failed poll ridden out and five in a row given up on; a gone or failed job
stopped on at once; abort stops the waiting with nothing more asked).

In a browser, light and dark, on new graphs, with nothing run: Generate image and Edit image
land from the right-click menu with Model and Quality selects on the node and in the inspector,
labelled, and wait for Run. The routes were exercised live too: the owner's own graph reloading
after the restart made three asks, each answered and polled to its end.

### What went wrong

- The JPEG test fixture had a segment length one byte short, so the walk fell off it. The
  fixture was wrong, not the walk.
- The mock clip is a fragmented MP4: its movie header says a length of zero, and it has no
  `mehd`. The probe took zero as the length and overrode the mock's stated 17.95 s. Zero is now
  unknown, `mehd` is read when present, and the provider's word fills what the header lacks.
- Prettier, run on the changed files, also reformatted `graphs.ts` and `storage.ts`, which were
  not touched. Reverted, so the diff is the work.
- The migration only applies on a fresh database open, and the dev server on 3002 was a
  background task from an earlier Claude session, so it was stopped and relaunched the same way.
  Next reloaded `.env.local` on its own when the key was added.

### Open

- The fal adapter has not run against fal. Its shapes are from fal's OpenAPI documents; the
  first real run is the test. Sunburst and Flare accept an explicit size per the schema; if
  they refuse one, the presets are the fallback.
- Opening a graph still runs every generation node. Already-made ones are free; a node whose
  inputs were never run is submitted on open, and one with an empty prompt or no picture makes a
  failed row on every open (the owner's reloaded graph did exactly that, three rows a time, at no
  cost). The honest fix is a load that asks for what exists without submitting, which needs the
  engine to tell a load from a Run.
- No webhook. Production would want `/api/hooks/fal` so a job nobody is watching lands the
  moment it finishes rather than on the next open.
- Cancel has a route and no button. The engine's abort stops the waiting, not the job, on
  purpose: a cancel on every input change or navigation would lose the long jobs this exists for.
- `graph_id` is not sent with an ask; the row has the node id only.
- The plan's "with a key, mock by default" rule is superseded by the owner adding the key and
  naming the models; the plan now says so.

## 2026-09-14, the editor's chrome and its faces

### Right-click adds a node

Asked after the empty state. A right-click on the canvas opens v2's `ContextMenu`: "Add node" over
one submenu per category, in the catalog's order. A node chosen there lands with its corner where
the right-click was. The canvas box is the trigger itself, through `render`, and the rows live in
`canvas-menu.tsx`. `onAdd` takes an optional position for it; + and ⌘K still place new nodes in the
middle of the view.

The menu opens on empty canvas only. Over a node, the minimap or a node's toolbar, the handler
stands Base UI down and refuses the platform's menu as well, since that menu means nothing over a
graph. A text field keeps the platform's menu. Whether a node is under the pointer is read from the
flow store's `hoveredEntityId`, once per right-click: a `StoreBridge` inside the canvas hands the
store out, rather than a subscription copying the hover out on every store write. The minimap takes
a `kd-minimap` class so the handler can tell it apart.

Verified in a browser, light and dark, each on a new graph. A right-click on empty canvas opens the
menu at the pointer, with the platform's menu refused. Its rows are Sources, Text, Math, Video and
AI. Math opens its nodes, and Clamp lands exactly at the right-clicked point and closes the menu. A
right-click on the node or on the minimap opens nothing and still refuses the platform's menu.
Escape closes the menu without adding anything, undo takes the node back, and a left-click still
selects. No page or console errors. `tsc` is clean for studio.

The first run failed one check, and the check was wrong: Base UI stops the event after refusing the
platform's menu, so a listener on the window never saw it. The check now listens in the capture
phase. Not checked: opening the menu from the keyboard.

### The inspector's empty state

Asked with a screenshot of the pane holding one line of grey text. The pane now shows the empty
state from v2's docs blocks, copied to `src/app/empty-state.tsx` because studio cannot import from
v2's docs app: a title and one sentence, centred, with the title a span rather than a heading. It
comes in two versions, as the builder's Layers panel does. A graph with no nodes says "No nodes
yet" and points at +. A graph with nodes and nothing selected says "Nothing selected" and says to
click a node. Neither has an action, because what fills the pane happens on the canvas. It sits
straight in the pane rather than in a scroller, whose content has no height, so it centres in the
pane.

Verified in a browser, light and dark, each on a new graph. Both versions show the right words,
centre exactly across and down the pane, and add no heading. + still opens the palette, choosing a
node closes it, clicking the canvas shows "Nothing selected", and clicking the node brings its
settings back. No page or console errors. `tsc` is clean for studio.

### The canvas runs under the inspector, which is glass

Asked once the inspector floated: nothing passed behind it, so it could not be glass. The inspector
states `backdrop`, and the canvas container is the whole content pane again, undoing the stop in
the entry below. That stop had two reasons, and each now has its own answer:

- **The minimap** sat at the container's bottom-right, which is now under the pane, and had no way
  to move. The library's `MinimapProps` gains `style`, applied after the minimap's own inline
  styles, which a stylesheet rule cannot beat. Studio passes
  `right: calc(10px + var(--kui-shell-inset-inline-end, 0px))`. The changelog, the minimap docs
  page and a test (`minimap.dom.test.tsx`, "lets a stated style win over its corner") carry it.
- **A new node landed at the container's centre.** The canvas now holds an inert box that stops at
  the reach, and `placeAt` measures that instead. `containerRef` is renamed `visibleRef`.

Closing the inspector no longer resizes the GL surface; only the minimap moves.

Verified in a browser, light and dark. The canvas and its GL surface reach the window's edge under
the pane. The pane is translucent with a backdrop filter and still takes its own presses; the canvas
beside it takes its presses too. The measured box ends one gap (8px) short of the pane. The minimap
sits 18px clear of the pane, goes back to 10px from the corner when the pane closes, and clears the
pane again when it reopens. A node added with + lands at x 552, the middle of the part in view,
where the whole canvas's middle is 720. No page errors or inset warnings. `tsc` is clean for studio
and the library, and the minimap tests pass (7/7).

### The inspector floats

Asked after the v2 builder got the same. `ShellInspector` takes `flush={false}` and drops
`width={320}`, which only restated the frame's token: the reach the content pane publishes is
derived from the token, so a pane stating its own width drifts from it. The canvas container now
ends at `--kui-shell-inset-inline-end` instead of running under the pane, because the minimap has
no style prop and sits at the container's bottom-right, and a new node lands at the container's
centre.

Verified in a browser, light and dark. The pane sits 8px off the window's edges and the published
reach matches it (336px). The canvas ends 8px short of it, the header's controls and the minimap
clear it, and closing the pane gives the canvas the full width back. No page errors or inset
warnings. `tsc` is clean for studio.

### + is loud

Asked with a screenshot of the strip. The + button takes `emphasis="loud"`, since it is the way into
the catalog. No tone: neutral, so it does not compete with Run's accent.

Verified in a browser, light and dark. The button fills dark on light and light on dark, and still
opens the palette. No page or console errors. `tsc` is clean for studio.

### Undo and redo take Hugeicons' own drawings

Asked with a screenshot of Hugeicons' "undo" results. The bottom row's buttons swap the turn arrows
(`ArrowTurnBackward`, `ArrowTurnForward`) for `Undo` and `Redo`, the mirrored circle arrows. Both
names clash with studio's own wrappers in `icons.tsx`, so they are imported as `UndoDrawing` and
`RedoDrawing`.

Verified in a browser, light and dark. Each button draws exactly Hugeicons' paths, and both are
disabled on a fresh graph. Undo and redo of an added node land in the saved graph. No page or
console errors. `tsc` is clean for studio.

### Run becomes a split button, on a re-vendored v2

Asked after the header work. v2 was rebuilt from its working tree and packed into `vendor/`.
`SplitButton` was still uncommitted in v2, so the tarball carries it ahead of v2's own history.

- **`pnpm install` kept the old copy.** The tarball keeps its name and version, so the lockfile
  looked current and the install skipped it. `pnpm update -r @kookie-ui/react` read it again and
  wrote the new integrity; `vendor/README.md` now says so. pnpm 12 runs on Node 24 here; the
  shell's Node 22 shim fails.
- **Run is the action, Run all is the menu.** The label runs what changed; the chevron's one row
  runs everything.
- **The halves sit outside the header's arrow-key order.** v2's toolbar notes say a plain Button in
  a toolbar is its own tab stop, and `SplitButton` is two plain Buttons. v2 has no toolbar version
  of it yet. Not tested.
- **Studio's float-band CSS rule is gone.** v2 `140b252` makes a floating band's toolbar pass the
  pointer itself.

Verified in a browser, light and dark, on a scratch graph deleted afterwards. With a spy on the flow
instance, Run calls `evaluateDirty` only, and Run all from the menu calls `evaluateAll` and closes
the menu. The menu opens 4px under the button, flush with its end. Enter on the chevron opens it;
Escape closes it and returns focus. The halves share one fill and the row's 40px height, with
square inner corners. Presses beside the bands' controls reach the canvas without the old rule.
⌘K still opens the palette, and a selected generation node still shows its own Run. No page or
console errors. `tsc` is clean for studio, docs and the library.

### Header, bottom row and the palette's openers

Asked in a run of messages. The Studio mark leads the header and is the way home. The graph name
moves right, before Run, Run all and the inspector toggle. The Home and search buttons go. The
bottom-left row holds appearance, then Undo and Redo as separate buttons, then the save line.

- **The save line is muted and says when.** It reads "Last saved at 12:04", "Saving…", or, before
  the session's first save, "All changes saved". The status store holds no time, so `SaveStatus`
  notes it when a save lands. "Not saved" and "Changed elsewhere, reload to keep editing" are not
  muted.
- **The palette keeps its open state in the + strip.** It was lifted into the editor for a header
  search button that was then removed. The lift caused an "onOpenChange is not a function" error
  on ⌘K in an open tab: hot reload applied the strip, which then required the prop, before the
  editor that passed it. A fresh load was fine.

### Faces

- Inter reads in both apps; that switch landed from another session. The `layout.tsx` comments
  that still called Inter the canvas's face alone are fixed.
- PP Playground Medium sets the wordmark: "Flow" at step 8 in the docs sidebar, "Kookie© Flow" in
  the docs footer, "Studio" at step 8 in the studio header. The file is Pangram Pangram's, so it
  is copied into each app's gitignored `public/fonts`, and a clone without it sets the mark in
  Inter.

Verified in a browser, light and dark. The mark links home, and no Home or search button remains.
The name leads the right cluster. The bottom row reads appearance, Undo, Redo, save line; Undo and
Redo are disabled on a fresh graph and undo and redo an added node. The line turns to "Last saved
at …" after a rename. + and ⌘K open the palette, and ⌘K closes it. Presses beside the bands'
controls reach the canvas. Both wordmarks render in PP Playground as a web font. No page or
console errors. `tsc` is clean for studio.

---

## 2026-09-13, the node's shadow, and generation nodes that cost nothing

### The shadow was never KookieUI's

Asked why a node's float looked unlike the docs demo's, and why the studio's read as "cut". Two
different answers, and the second one was the real fault.

- **The demo was pinned to `variant="classic"`**, which resolved a `--shadow-N` token — a tight
  DOM-card shadow — while the studio took the default surface treatment. v2's Card is "one
  treatment and no variants", so the prop named a look the design system had deleted. Removed.
- **The body's float was invented.** `useThemeTokens` never parses `--shadow-1..5` at all — it
  returns hardcoded single-layer stand-ins, saying CSS shadows are "too complex to parse
  reliably" — and `NODE_SHADOW` then ignored even those, on the grounds that the tokens "top out
  at blur 16". That was only ever true of the fake table: v2's real `--shadow-3` is three layers
  reaching 48, and `gl/material.ts` has carried it, read off v2's stylesheet, all along. The
  popover has drawn it correctly since it was written. The node body was the one surface never
  moved over, and now draws the same three-layer cast.
- **The "cut" was a discard threshold.** The halo was thrown away below 1% alpha while the tail
  was still ~1% black — three luma levels on the light floor, a hard edge tracing the card's
  outline out in open canvas. A 4px blur hid it against the card's edge; a 20px one did not.
  Measured on the canvas before and after: a three-level step became one, the floor's own
  quantisation.

Still v1 residue, deliberately not swept up in a shadow fix: the fake `--shadow-N` table, the now
unread `NODE_SHADOW` and `resolvedStyle.shadow*`, and the whole `EntityVariant` axis (a public
type, documented in `entities.mdx`).

### Generation nodes, against a mock

Five nodes, all `where: 'server'` and `evaluation: 'manual'` — the two go together, because a node
that costs money must never run because a slider moved. Generate image, Edit image, Upscale,
Remove background, Animate image.

The pipeline is real and only the pixels are not: `/api/jobs` writes a row, paints a deterministic
placeholder PNG (hashed from the request, so the same prompt and seed give the same picture and a
second Run is answered from the evaluator's cache), stores it content-addressed, and returns a
`MediaRef`. The encoder is `node:zlib` and about sixty lines; no dependency, no key, no spend. The
fal adapter is a swap at the port, not a rewrite.

**Library change 1 from the plan, which was still undone:** `classifyPreviewValue` returned
nothing for an object, so a `MediaRef` on an output socket could never draw its own band. It now
reads a reference's `preview` before its `url`, and believes `kind: 'video'` over a URL with no
extension — a stored asset is served from an extensionless path, and a clip drawn as a picture is
a still that never moves. Five tests.

Three defects the screenshots caught, all the same v1-token trap: a prompt well took the control
family's pill sentinel and came out a **circle** (a multi-row field has to say `textarea`, which
is what `wellRadius` keys on); the inspector's output picture read `--radius-2` and did the same;
and it then ran off the panel, because a flex item's automatic minimum size is its content's.

Two more the owner caught by eye, both config rather than rendering. A prompt sat in the
half-width column beside its own label: the Text source node says `layout: 'stacked'` and the
generation nodes did not, and a prompt is the thing you came to the node to write. And the band
letterboxed — the registry asked for `fit: 'contain'`, so a square generation in a wide, short
band was centred with the card's fill either side, reading as a small picture in a frame rather
than as a band. It covers now; the uncropped frame is one click away in the inspector.

Verified in a browser: the band draws, the inspector reports Done, bytes land in `.data/blobs`,
and the video node's reference carries its duration and fps. `tsc` clean in all three packages;
library 752 tests, studio-core 24.

### The band was not in the same flow as the rows

Resizing a node drew the picture straight over its own inputs. A card taller than its content
CENTRES what is inside it — `geometry.ts` and `widget-geometry.ts` both add
`(height - computedHeight) / 2` to every socket and every widget — and the band alone was placed
at the bare `previewY`. So the moment an entity carried an explicit height, from a resize or from
a document that set one, the rows moved down and the band did not. It takes the same term now,
same sign, unclamped, and measures its remaining room from the offset top rather than from
`previewY`.

Reproduced without touching a drag handle: two nodes in one document, one default and one at
`width: 240, height: 720`. The sized one showed the overlap every time and is clean now.

### A band can lead

`EntityPreview` takes `position?: 'top' | 'bottom'`, defaulting to `bottom` — so the docs, the
demo and every existing consumer keep the layout they had, and adding a band to a node still
moves nothing. The studio asks for `top` on every node that has one: on a generator the picture
IS the point, and the prompt and the sizes are the controls underneath it. The layout places the
band before the outputs, and `buildCacheKey` carries `position` because it moves every row below
it — `fit` stays out of that key, being a drawing decision the layout never sees.

A leading band then sat too close to the title, and the reason is that `marginTop` is
`padding + titleBand`: content begins flush against the bottom of the title's own air. A socket
row hides that, its label being centred inside a tall row, so the space arrives for free. A
picture has no inside — its pixels start on that edge, and the title ends up sitting on the frame.
It takes `padding` above it now, the same inset it already had left and right, so the picture
carries an even margin on three sides.

### Real files instead of a painted placeholder

The mock answers with two real files from `apps/studio/mock/`: a photograph for every picture
(Birmingham Museums Trust, a 3999×2896 progressive JPEG) and a clip for every video (2560×1440
H.264, 17.95 s at 29.97 fps). The PNG painter is gone. A painted PNG only proved that PNGs work;
a large JPEG and an MP4 served by range are what a provider will actually hand back. Each file is
read and hashed once per process — a repeat job answers in 8 ms against 38 ms for the first.

Verified: the JPEG serves 200 at its exact size, the MP4 answers a range with 206, the photograph
draws in the Generate band, and the clip MOVES — 12,624 pixels change across 1.5 s, all inside
the Animate band. One run hit a shader compile error in `media-quad.ts`; it was a stale compile
of an in-flight save and cleared on reload.

The two files are 13.4 MB and uncommitted. Whether they belong in git is a call for later.

### The editor loses its header

Laid out the way the docs site is (`docs-chrome.tsx`), because what the header held was either
the frame's own chrome or a control for the graph — and neither belongs in a band across the
whole window. The graph's controls float in a `ShellPaneHeader` over the canvas, which passes
behind them. The way home sits beside the node search in the sidebar's floating header; the
appearance control in its floating footer.

No separators, as the docs band has none: undo and redo are one `ToolbarGroup`, every other
control is its own capsule, and the gap between clusters is one step wider than the row's own, so
the air does the separating.

Two things the move broke, both caught on screen and fixed. The node list started UNDER the
floating header, hiding "Sources"; it now spends the pane's published reach with the docs nav's
own two lines. And the search ran off the pane; it grows into the row now, which needed
`minInlineSize: 0` on the field's wrapper, and its placeholder is "Search" because "Search nodes"
clipped at 167 px. Measured rather than eyeballed: zero separators, zero header elements, the
list's first label below the band, the field inside the pane.

### Refreshing stops locking the editor out

Asked about "this graph changed elsewhere" on refresh. Reproduced in a browser against a clone of
the graph. It was two bugs.

- **Opening a graph wrote the origin over its saved view.** The canvas started at the origin and
  was moved to the stored view one effect later, so autosave read the origin as a pan. Strict
  mode's cleanup sent that as a beacon and never learned the new revision, so the corrective save
  was refused. This is why the user's graph sat at 0,0. Fixed: the canvas starts on the stored
  view (`defaultViewport`), and the unmount path sends an ordinary save whose answer is read.
- **A refresh inside the save window renders the new page before the old page's last save
  lands.** The beacon goes at `pagehide`, which a reload fires only after the server has rendered
  the new page. The new page opened a revision behind, without the last edit, and its first save
  was refused. Fixed with a handover: the old page leaves its graph, and fingerprints of the writes
  it never heard back about, in session storage. The new page opens on that graph when its render
  is the tab's own history. Saves name the fingerprints (`supersedes`), and the server lets a stale
  write land only when the row holds one of them, conditional again on the revision it read.
  `documentFingerprint` is in studio-core, so browser and server compute the same value.

Also: a 409 logs a warning, not an error, since the status line already says it. A save whose
request failed counts as unanswered, so its retry is not refused if it landed. The autosave seed
is serialised once rather than on every render.

Verified by a browser script, 16 of 16. Opening a panned graph writes nothing and keeps the view. A
plain refresh writes nothing. Pan then refresh carries the pan and saves over its own beacon (base
2, answered revision 4). Two quick refreshes do the same. A second tab with its own session is
still refused and overwrites nothing. `tsc` is clean for studio and studio-core; studio-core has
27 tests, 3 new.

Open: every open runs both generation nodes again. `evaluateAll` on mount posts two jobs per
refresh — free against the mock, billed against a provider.

### Run in the node toolbar, for generation nodes

Asked for a Run button in the node toolbar, for generation nodes only. The studio now renders the
library's `Toolbar`, and only manual node types get a toolbar entry (`node-toolbar.tsx`), so a math
node shows none.

- **One node at a time**, as the inspector's Run is. `evaluate` starts a node on the inputs it has
  now, so Run on two selected nodes that form a chain would pay for the second on the picture the
  first is about to replace. Two selected nodes show no button; the header's Run orders a batch.
- **It spins while its node runs, and a press on a running node does nothing.** `evaluate` on a
  running node cancels the run and starts it again, and a double click lands its second press
  before the spinner has had a frame.
- **An entry per type, not one render function for the whole toolbar.** With the latter, every
  selection pays for the toolbar's bounds work on each pan frame, not only a selection that holds
  a generation node.

Also: generation nodes lost their accent glow. `accentHeader` is off on the canvas, and the five AI
definitions no longer set `color`. A node saved with a colour keeps it.

Verified by a browser script, 8 of 8, with jobs held three seconds so the running state could be
seen. Nothing selected: no button. A lone generation node: Run, visible. A double click: one job,
`aria-busy` during it and gone after. A selected Clamp: no button. Two generation nodes selected
with Cmd+A: no button. No page or console errors. `tsc` is clean for studio.

Open: tall nodes added from the library overlap. Placement assumes 180 px for a node with no stated
height, and a generation node is about 520, so the second lands 204 px below the first.

### The sidebar becomes a strip of tools

Asked to replace the node library's sidebar with a dropdown on a vertical toolbar. The sidebar is
gone, and the canvas has its width.

- **A vertical toolbar halfway down the canvas's left edge**, level with the header's inset. Its +
  opens a menu with a submenu per category, because as one list the catalog is taller than a
  laptop screen. Its search opens a palette that matches through `registry.search`, so "prompt"
  finds the generators by socket name, and Enter adds the highlighted node.
- **Home leads the header**, where the sidebar's toggle was. **The appearance menu keeps the
  bottom-left corner**, now in a floating footer of the content pane.
- **The bands over the canvas take presses only on their controls.** v2's floating pane turns its
  toolbar row's pointer events back on, so the header already swallowed presses across its whole
  width. One rule in `globals.css` turns the row off again.

Gaps in v2, for its own agent: a `ToolbarGroup` in a vertical toolbar stays a row (stacked here
with an inline `flexDirection: column`); in a vertical toolbar, ArrowDown on a menu trigger opens
the menu instead of moving to the next tool; and `.kui-pane-header[data-float] > *` outranks the
toolbar row's own `pointer-events: none`.

Verified by a browser script, 21 of 21, light and dark. No sidebar. The strip is vertical,
stacked, level with home and centred. Appearance sits bottom-left. Presses beside the bands'
controls reach the canvas, and home and appearance still take theirs. ArrowUp walks the strip.
+ › AI › Generate image and a search for "clamp" plus Enter each add their node. The palette
reopens on the whole catalog. No page or console errors. `tsc` is clean for studio.

### + opens the palette, and ⌘K does too

Asked: search did the same job as the + menu, so + opens the search palette, the search button
goes, and ⌘K opens it. The palette's list is in sections by category, not submenus.

- **The strip holds one button.** With no group left, the inline `flexDirection: column` went too.
- **⌘K and Ctrl-K open and close it**, from the canvas or a field. The listener is on the document
  in the capture phase, so the canvas's key handling cannot take the chord first.
- **The query clears as the palette opens, not as it closes.** Cleared on close, the list refilled
  while the panel was still leaving, under the words that had narrowed it.

v2 fixed the three toolbar gaps as `140b252`, but the vendored tarball predates it. Studio keeps
its `globals.css` rule until the tarball is rebuilt.

Verified by a browser script, 24 of 24, light and dark. The strip holds only +, level with home.
+ and ⌘K both open the palette with its field focused, on all 27 nodes in five sections. "prompt"
leaves only the sections that match, and a query matching nothing says so. Escape and a second
⌘K close it, and the next open starts on the whole catalog. "clamp" plus Enter adds a Clamp from
a palette opened in the name field, without touching the name, and a click on a row adds that
node. The bands still pass presses through. No page or console errors. `tsc` is clean for studio.

Under software GL a close can take over a second, because the palette's blur covers the canvas.
The script waits for the palette's state instead of sleeping.

---

## 2026-09-12, the ultracode audit and its fixes

152 agents over three rounds: seven dimension finders (correctness, performance, security, data
integrity, React and Next, conventions, library integration), a merge pass, then three independent
verifiers per finding — refute, reproduce, judge impact — with two of three needed to confirm.
**75 findings confirmed, 6 rejected.** Six agents in round two died on the session limit, so the
second gap sweep never ran; another pass has that ground left to cover.

### The critical one, and it was mine

**The strict-mode fix from the build was wrong.** Clearing `disposed` was not enough: `dispose`
also emptied the queue of stale nodes, and `markDirty` stops at a node whose record already reads
dirty — so the marks could never be made again. In development, where React disposes and revives
every effect, **a saved graph opened with nothing evaluating and Run doing nothing.** My smoke test
missed it because it only ran a single source node; nothing was ever wired.

`dispose` now keeps the queue and demotes an abandoned run back to dirty. Two tests pin it, and a
second smoke test (`chain.mjs`) wires 2 + 3 → Add so the case cannot go unnoticed again.

### Fixed

- **Nodes added by the consumer never ran** (library): the store marked a node stale only if it
  already existed, so a node from the library, an undone delete or an agent edit sat idle — and
  whatever it fed read `undefined`, fell back to the socket default, and reported success.
- **A widget override froze evaluation for a node** (library): the veto was per entity and an
  override whose value already matched could never retire, so later inspector, undo and agent
  edits to that node were all read as echoes. Now decided per socket, and a spent record retires.
- **A widget's baseline ignored the socket default** (library), so the first drag on an untouched
  slider snapped back mid-gesture.
- **Leaving the editor dropped unsaved edits**: the flush read the canvas after React had already
  detached it. The document is now snapshotted while the canvas is alive.
- **Opening a graph saved it**: the first-run guard counted effect runs, which strict mode and
  Fast Refresh both defeat. It compares against what the server holds instead.
- **Two tabs overwrote each other.** Every save carries the revision it was based on, and the
  server refuses a stale write with 409 rather than applying it. Verified: correct revision saves
  and bumps, the same revision twice is refused.
- **A blank name discarded the document it arrived with** — name and document are judged separately
  now.
- **The dev server was open to the whole network**, unauthenticated. It binds loopback (`pnpm
  dev:lan` is the opt-in), and a middleware refuses unknown Hosts (DNS rebinding) and cross-site
  writes (CSRF). Verified with forged Host and cross-site requests.
- **The inspector committed a graph operation per pointer move and per keystroke** — about 120 full
  rebuilds for a two-second drag. Values commit when the edit ends. The canvas widget echo became a
  real debounce, and the canvas sits behind a memo boundary so typing a name no longer re-renders
  it.
- **The regex option on Replace could freeze the tab** (34 characters, about two minutes) and the
  freeze was saved with the graph. Matching is literal; the option returns when text can run in a
  worker with a time limit.
- Prototype-named ids (`__proto__`) could reach object keys and the expression parser's tables;
  both are guarded now, and stored documents are validated rather than trusted.
- Template kept mangling whitespace; `Length` counted code units; `toFixed` could throw from a
  wired input; wrong argument counts answered `NaN`; `-0` and `0` shared a cache key.
- Delete asks first, "New graph" cannot double-fire, the list refreshes on return, dates are the
  reader's, a failed migration closes its connection, uploads check size before buffering, and the
  list counts nodes in SQL instead of parsing every document.

### Deferred at first, then asked for anyway

Everything that had been left undone was fixed the same morning, on the owner's instruction: "fix
whatever you can, and run build."

- **The library was built** (`pnpm --filter @kushagradhawan/kookie-flow build`). `dist` has its
  declarations again, so the docs site picks up the engine fix — and it still serves.
- **The data directory is `STUDIO_DATA_DIR`**, defaulting to `.data` beside the app, and the
  migrations are traced into the standalone output. A standalone server no longer starts against a
  database with no tables, and nothing that matters sits where the next build would delete it.
- **Writes are durable**: bytes flushed before the rename, the directory flushed after it, and a
  file of the wrong length under a content hash is rewritten rather than trusted for good.
- **Files stream, with ranges.** A plain request gets `accept-ranges`, a range gets 206 with
  `content-range`, an impossible one gets 416 — which is what lets a video be seeked without
  fetching the whole thing, or holding it in memory to answer.
- **Save status left React state.** It lives in a store that one small component subscribes to, so
  a save no longer re-renders the editor at all.
- **Moving the view is saved**, reported from inside the canvas once it settles, so panning still
  costs nothing while it happens.
- **Pasted nodes are stripped** of the catalog's sockets, sizes and labels before they join the
  graph, so a paste cannot freeze the catalog into a saved document.
- **"One wire per input" is one function** (`replacedWires`), used by both the canvas and the op
  compiler, with its own test.

### Verified after the fixes

- `tsc` clean: app, studio-core, library. Tests: library 747, studio-core 24.
- Both browser suites pass, including the wired chain: computes on open, cascades on edit, a node
  added from the library evaluates, undo steps back.
- API: stale revision 409, malformed document 400, blank name keeps the document, forged Host 403,
  cross-site write 403, upload → blob 200 with ranges (206 and 416), unsupported type 415,
  traversal key 404.
- Pan, reload, same view. The docs site serves against the rebuilt `dist`.

### Still undone

- **The audit's second gap sweep** never ran — six agents hit the session limit. Worth repeating
  once there is more code to look at.
- **Dragging a wire between two sockets** is not covered end to end. The rule it exercises is unit
  tested, and the library's own harness covers the gesture.
- **The phases after this one**: GPU image ops, AI nodes and jobs, the agent, logic and control
  flow, video, templates, sign-in and credits.

### Note on the library's `dist`

The package's watch build cleans `dist` and re-emits the JavaScript before the declarations, so a
type-check landing in that window sees the whole library as `any` — which is how a green check
turned red mid-session. The app and studio-core now type-check against the library's source, so
neither depends on that timing. `dist` is what the docs site reads, and a real build is what fills
it in.

---

## 2026-09-12 → 13, the build

### State

Phase 1 (shell) is working in a real browser. Phase 2 (logic) has started: values, math and text
nodes run. No git commits; everything is on disk on `main`, alongside the owner's uncommitted docs
work, which was not touched.

Run it: `pnpm --filter studio dev`, then http://localhost:3002. No keys and no database server
needed; the database is embedded (`apps/studio/.data/pg`) and files go to `apps/studio/.data/blobs`.

### Built

- `packages/studio-core` (AGPL-3.0-only). It has no React and no DOM.
  - `defineNode` and the node registry. One definition gives the canvas its entity types, search,
    and (later) agent tools.
  - `GraphOp` compiler: add, remove, connect, disconnect, set values, set label, move. It validates
    against a working copy, refuses loops and type mismatches, and replaces the wire an input
    already holds.
  - `createOnEvaluate`: looks up the node, coerces inputs to socket types, and caches results by
    input identity. A cancelled run is never cached.
  - `describeGraph`: the compact text form the agent will read.
  - Nodes: number, slider, text, seed, toggle, color; add, subtract, multiply, divide, power, min,
    max, remap, clamp, round, expression (a safe parser, no `eval`); template, join, replace, length,
    number-to-text.
  - 11 unit tests.
- `apps/studio` (AGPL-3.0-only), Next 15.
  - Graph list at `/`, editor at `/g/[id]`.
  - Node library (searchable), inspector (every input as a control, status, outputs, run, delete),
    top bar (name, save state, undo, redo, run, run all, panes, appearance).
  - Autosave, debounced, with a `sendBeacon` flush when the tab closes.
  - Copy, paste and duplicate (mod+C/V/D). Delete, select-all and undo come from the library.
  - Drizzle schema for graphs, assets and jobs, with `workspace_id` on every table. The migration is
    generated in `drizzle/`. PGlite is used when `DATABASE_URL` is unset; the same schema runs on
    Postgres.
  - Content-addressed local storage and `/api/blob/<key>`. `/api/assets` accepts uploads.
  - Dark mode with a pre-paint script, the same mechanism as the docs.

### Verified

- `tsc` clean for `studio-core`, `studio` and the library. Tests: studio-core 11/11, library 743/743.
- Browser smoke test (Playwright, scratchpad):
  - Create a graph from the list and add three nodes from the library; the autosave row has 3.
  - Click a node and the inspector shows it. Set its value to 7 through the inspector, press Run,
    and the inspector reads "Done, out 7". The saved row has `{"value":7}`.
  - Copy and paste makes 4 nodes; delete brings it back to 3.

### Library changes (packages/kookie-flow)

- **Fixed: the evaluation engine never came back from React strict mode.** Strict mode runs the
  flow's cleanup, which disposes the engine, and then runs its effects again. `setHandlers` now
  clears `disposed`. Before this, every strict-mode development build had an engine that answered
  nothing: Run did nothing, and there was no error. A test pins it (`evaluation.test.ts`, "comes
  back when handlers arrive after a dispose").
- **Not done yet**, both from the plan:
  - The preview band accepting a `MediaRef` object. This comes with phase 3, when there are pictures
    to show.
  - Exporting `useGraph`'s reducers. Not needed so far: the op compiler emits change batches that
    `useGraph` applies.

### Found, and how it was handled

- **Selection is not reported through `onEntitiesChange`.** It lives in the flow store, so the
  inspector showed nothing when a node was clicked. A `SelectionBridge` inside the canvas subscribes
  to the store and hands selection to an `EditorBus`, which tells the panes once per frame.
- **A paste lands in the store but is not reported to a controlled owner**, so the next prop sync
  removed it. The studio's paste now reports the added entities and edges itself.
- **The library's tsup watcher (running for about 2 days) stopped rebuilding `dist`.** The studio
  now compiles the library from `src` through a webpack alias plus tsconfig paths. Library edits
  show up in the studio with no watcher involved. **The docs site still reads `dist`**, so it will
  not have the strict-mode fix until that watcher is restarted.
- **Importing the library's root entry from server code fails to build**, because the entry carries
  React components. `studio-core` now restates the one pure function it needed (socket
  compatibility) instead of importing it.
- **The first request after a cold dev-server start failed with "ArrayBuffer is not detachable".**
  Cause: the embedded database opened inside the page render. Fixed: the database now opens at
  server start (`instrumentation.ts` → `instrumentation-node.ts`). The Node-only import sits inside
  an inline `NEXT_RUNTIME === 'nodejs'` test. An early return instead let the edge compile try to
  bundle Drizzle's migrator, which failed on `node:crypto`.
- **Three visual defects from the screenshots**, all fixed:
  - Inspector labels sat beside their inputs, because `FieldItem` is the inline checkbox row. Fixed
    with plain `Field`.
  - Nodes added from the library piled up 40px apart. Placement now searches a grid for free space.
  - The minimap was large and bright in the bottom-left. It is now 160×112 in the bottom-right.

### Verified after the fixes

- The first request after a cold restart returns 200.
- Undo, step by step: paste 3→4, delete 4→3, undo 3→4, undo 4→3.
- Light and dark screenshots: canvas and chrome both follow the theme, labels sit above inputs,
  and new nodes form a column.
- `tsc` is clean for `studio`, `studio-core` and the library.

### Open

- Wiring by dragging between sockets is not in the smoke test yet.
- The minimap's viewport rectangle runs past the minimap's top edge when the view is larger than
  the content. This is the library's minimap, seen in the screenshots and not changed.
- An ultracode audit of the app is running; its fixes land after this entry.

## 2026-09-15 — The graph list and billing move into KookieUI's Shell

Research (Figma, Linear, Vercel, Krea, Flora, Runway, Leonardo, Weavy, Lovable, v0, Anthropic and
OpenAI consoles) agreed on: a sidebar shell, the balance small in the shell with detail on its own
page, one "Add credits" button opening a dialog, a thumbnail grid for projects, and per-item
actions in a "…" menu rather than a bare delete icon.

- `app/(app)/` route group: one `Shell` for every screen outside the editor. Sidebar: mark, Graphs,
  Billing with the balance beside it, account menu (appearance, sign out) in the footer. Each page
  is `AppPane`: a floating band (sidebar toggle, mirrored `ToolbarTitle`, the page's one action)
  and a `Page` title in a `ShellScroll`.
- Graphs: grid of cards. Cover is the newest image a run in the graph made, else a sketch of the
  node boxes. Search, relative edit time, menu with Rename, Duplicate, Delete. `listGraphs` returns
  `cover` and `layout`; `POST /api/graphs` takes `from` to duplicate.
- Billing: balance and pricing cards, Add credits dialog, Activity table filtered All/Runs/Payments.
  Holds and releases are hidden (a hold shows only while its run is going); run rows show task,
  model and the model + fee split, joined from `jobs` in `listEntries`.
- The editor's balance menu now links to Billing and opens the dialog with `/billing?add=1`.
- Verified: `tsc` clean; light and dark screenshots on an isolated copy with the mock provider.
  Not yet seen: a populated activity table and a card with a real cover.

### Same day: two more passes, judged by walking the screens in one session

- Structure: the pricing card and the card chrome are gone from Billing. Balance is a plain figure,
  the description is one sentence, Activity is a table with end-aligned amounts. Graph tiles have
  no card: the picture, then name and edit time. Every page shares one 64rem column (a per-page
  width moved the title on every switch).
- Fixed: graph covers were always empty. In a single-table select Drizzle writes `${graphs.id}` as
  a bare "id", which the job subquery read as its own. The outer columns are spelled out now.
- Run rows use the node's label from the registry ("GPT Image 2.5") and show only the model + fee
  split; raw model ids are gone. Dates are short ("Sep 15, 1:36 PM").
- The editor hides the minimap while the graph is empty.
- Phone width: two tile columns, one-line meta; Billing drops the Date column and puts the date in
  each row's detail line.
- Verified: `tsc` clean; tours in light and dark at 1440 and at 390 wide, the title measured at the
  same position on Graphs, Billing and back. Not verified: the Stripe return notices, a graph whose
  cover is a video.

## 2026-09-17 — Model pages from precedent

- Owner rule: never invent UI; study how others do it first. Study in `model-page-study.md`.
- Model page rebuilt: facts row (Made by, Served by, Price, Commercial use), Examples, Pricing table,
  Served by (fal, endpoints, terms), Inputs, Outputs, Similar models.
- Price tables and inputs are read from `estimateModelMicros` and the node registry, so the page
  shows what the canvas offers and what a run is charged. Commercial use from fal's `licenseType`.
- fal mark added (LobeHub). Models list rows say "Served by fal".
- Served by redone after Vercel's provider row and OpenRouter's slug: name links to fal's page (↗),
  "Legal: Terms · Privacy" quiet under it, endpoints as plain mono with Kookie's copy-done button,
  no loose third column. Top-aligned so the name and first endpoint share a line.
- Owner rule: no `size="1"` in Studio; captions quieten with emphasis. Swept Home, shell, templates,
  graphs, billing and the model page (the nav Avatar keeps size 1).
- Vision recorded in `vision.md` (owner asked; it had only been in chat). Home composer's picker was
  image models, which is wrong for an LLM agent: now "Auto · Medium" (Claude model + effort), after
  Krea Agent; the agent picks generation models, as in Krea Agent, FAUNA and Lovart.
- Home reoriented to the vision (study in home-study.md, second pass): headline names the harness,
  starter asks under the box, a mock plan for the chosen ask (asks → drafts → pick → final) with
  each step's real model and price and the total, then "Try a model", then curated templates.
  Action tiles removed; "New graph" moved to the toolbar. Plans are mock data in home/plans.ts.
- Home cut to "tell less, show more": "One ask. A whole workflow.", short starters, the plan as one
  picture per step with label, model and price, section heads without sentences, cards without
  summaries. Plan pictures load from public/home/<starter>/<step>.webp (list in home-images.md)
  and stay grey until the owner adds them.
- Plan preview removed from Home: the owner rejected the concept. A canned plan contradicts an agent
  that decides the workflow after asking. Starters now only fill the box (home/starters.ts).
- Agent plan changed: across providers (Claude and GPT) on the Vercel AI SDK 7, direct provider keys,
  AI Gateway optional. plan.md Agent section, research.md, vision.md and .env.example updated.
  Home's model menu groups Anthropic and OpenAI models.
- Owner chose Vercel AI Gateway for agent model access: `AI_GATEWAY_API_KEY`, zero markup, works
  off Vercel. GPT-6 Astra added to the menu.
- Agent build plan drafted in `agent-plan.md`: models and prices, step route with tools and turn
  charging, the panel, the harness rules, pick and gate nodes, inspect, verification. Not started.

## 2026-09-17 — The agent (phase 5)

- Built per `agent-plan.md`: AI SDK 7 through Vercel AI Gateway, Claude and GPT models, browser and
  server tools, turn holds and charges, conversation per graph, the panel beside the canvas, the
  harness in the instructions, `logic/pick`, `logic/gate`, `source/image`.
- Without a gateway key a scripted agent answers, so the loop runs for nothing in development.
- Verified end to end in the preview with the mock agent and mock jobs; tests: studio-core 56,
  studio 42.
- Fixed on the way: local storage gave two same-millisecond saves of one picture the same temp name.
- SDK pinned at `ai` 7.0.102 and `@ai-sdk/react` 4.0.105, the newest old enough for pnpm's minimum
  release age; the exclusions `pnpm add` wrote into pnpm-workspace.yaml were removed.
- Checked against current docs and a real gateway key. Haiku 4.5 now gets a thinking budget instead of
  adaptive thinking and effort; the output cap scales with effort. Sonnet 5 and GPT-5.6 Sol each ran the
  whole loop in the browser. The first real run found six faults, all fixed (see agent-plan.md, Status).
  Tests: studio-core 58, studio 42.
- Owner's first real run (Sonnet 5, real fal, billing on): three drafts ran and were charged right,
  then the final's turn was refused for a $73 hold. The hold counted the three inspected pictures'
  bytes as prompt text, and the pictures went whole because a 1024×768 PNG was under the shrink
  threshold. Pictures now count as a fixed 1,600 tokens each, and every inspected picture is
  re-encoded as a JPEG at most 1024px. A reload mid-look left the calls unanswered for good: the
  session now re-answers open browser tool calls on load (an edit is refused with a note, a run asks
  again). Panel: the message and the approval are Surfaces, the composer is Home's size, the pane is
  480px, resizable and remembered, stated on the Shell's token so the toolbar and minimap clear it.
- The agent's transcript is a Kookie v2 `MessageScroller` (new in kookie-ui-v2, on `@shadcn/react`'s
  headless message-scroller primitive, MIT): follows the live edge, anchors each ask near the top,
  jump-to-latest button. The pane's `ShellScroll` is the viewport, so the Shell's floating bands and
  fade are untouched: the tabs and the composer float, the transcript passes under both and fades
  (the composer publishes its measured height as the band's row). Vendored as a new tarball.
- Agent panel, per the owner: the chat goes behind the floating tabs and composer at full strength and
  fades only at the panel's edges (the Shell's band-deep fade ran too far into the chat; an override
  that hid content under the bands was a cut). Live labels shimmer, as AI Elements' Reasoning does.
  The Conversation block's Studio copy gained `liveClassName` on `Steps`; owed upstream to the docs
  block. AI Elements studied as a collection: research.md, "Agent and chat UI: the standard".
- Arrange, 2026-09-17. The agent's nodes landed haphazardly: `layoutCluster` placed each batch as its
  own block under the last, blind to wires into existing nodes. New op `{ op: 'arrange', ids? }` in
  `GraphOp`, compiled by `compileOps` into positions from the library's `layoutGraph` (layered, left
  to right, deterministic; the block's top left stays put; nodes the batch added land in place). Real
  node boxes come from the canvas (`getEntityBounds`, new on the instance), estimates on the server.
  The agent is told to end every build with it and never to `move`; the person gets the same op as
  "Tidy up" in the canvas's right-click menu. `studio-core` imports the layout from a new library
  entry, `kookie-flow/layout`, so the server still loads no React or three; the published dist gains
  that entry when the library watcher next restarts (tsup reads entries at start). Not yet seen in
  the browser: every page needs the owner's session. Tests: studio-core 61, studio 42.
- Harness research, 2026-09-18. Six web sweeps (tool design, harness-vs-model, deterministic pairing,
  eval benches, the market, cost mechanics) read against the agent code; written up in
  `research-harness.md` with measured/claimed marked and dated sources. The load-bearing numbers:
  template-grounded graph generation 78.5% vs 66.2% free-form vs 29.2% prose (Prompt2DAG, 260 runs);
  prune-plus-summarise context 91.6% vs 71% task completion on 63% fewer tokens (Microsoft);
  14-point and 17x spread for one model across nine harnesses (AgentConn); constraining the whole
  generation costs 10-30% accuracy, constraining only the final emission does not (CRANE, Format Tax);
  LLM-emitted coordinates are a tokenizer-level dead end. Studio already sits right on tool count,
  cache-stable prefix, output caps, all-or-nothing batches, search-before-naming and 1024px looks.
  Gaps, in order: the transcript never prunes (old pictures re-billed every turn); no bench, so
  nothing is measurable; no named pattern library for the agent to instantiate; draft sets are not a
  structure in the document; no pre-flight graph walk; model choice unmeasured. Also: nobody in the
  market publishes a named versioned pattern library, treats drafts-pick-final as a first-class
  primitive, or states graph-correctness numbers — three open lanes.
- Harness plan, 2026-09-18: `harness-plan.md`, nothing built. Before planning, the research was
  checked against the owner's own sessions (a copy of `.data/pg`; 34 agent steps). It overruled the
  research twice. The agent is 37% of all spend, not a rounding error beside renders; and the money is
  in output tokens (one 28-op build step = 23% of a session), cache writes (pictures from `inspect`)
  and round trips (about one model call per tool call; 16 of 24 calls were inspect, estimate and
  read_graph), not in re-reading old transcript (9-19%, cached at a tenth). Also found: 28 failed jobs
  that a pre-flight would have caught ("prompt is empty" x24, "too small" x4), holds 28x the charge,
  looks costing ~3,300 tokens where ~1,200 is expected, one unexplained cache miss = 18% of a session.
  Order: a report script, fewer round trips (graph attached to the ask, run prices itself, contact-
  sheet looks), the bench (one harness, a DocumentHost, mock renders, pass^5), patterns as an
  `add_pattern` op that also makes templates real, pre-flight, a deterministic model view of the
  transcript, then the model x effort sweep. Prompt2DAG and "Less Context, Better Agents" were fetched
  and confirmed; both are other domains.
- Agent panel, finesse passes 1–3 against captured frames of every state (empty, working, approval,
  running, drafts, steps open, done, scrolled): the pane is solid and floats, and the tabs, Start
  over, the composer and the jump button state `backdrop` for themselves, so the chat passes behind
  them and dissolves only at the panel's edges. Start over moved into the header row; the approval is
  one row (AI Elements' Confirmation); a run waiting for approval no longer prints a step saying so;
  32px between turns, 16px within; the empty state sits in the middle; the scrollbar runs between the
  bands; the jump button is placed by layout, so hovering no longer throws it down the transcript
  (Kookie: the dock aligns to its end instead of lifting the button with `translate`).
- A step's words are one line, cut with an ellipsis; inside Kookie's `fit-content` scroll content that
  scrolled the whole panel sideways, so the transcript's content box refuses to widen.
- The steps list is a timeline: a two-hairline thread with a ringed dot per step, the dot centred by
  auto margins and drawn only inside the list, so a lone step keeps the text column instead of hanging
  its dot into the pane's padding. Sent back to KookieUI v2's docs block, where the block lives.
- MessageScroller and the Conversation block shipped in KookieUI v2 (§56 in DECISIONS, an entry in
  LOG): the component with its three parts and three hooks, five laws (one scroll box, the pane's
  anatomy kept, the live region, the button placed by layout), a playground section, a reference
  entry with its composition and topics, a usage example, the builder exclusion, regenerated agent
  rules and API tables, and the CSS budget re-recorded (+5 bytes). The block's parts default to size
  3 and carry their own `data-kb-size`, never the system's axis.
- Studio's own agent UI is now arrangement only: no bespoke paint. The shimmer moved into the block
  as `Thinking` and a live Steps row; what is left in agent-panel.css is this pane's geometry and
  three answers to Kookie defaults, each marked owed upstream (the scroll content box's width and
  height, the floating band's veil, the dock's offset inside a padded viewport).
- The bench, built and run 2026-09-18. `apps/studio/bench/`: 20 scenes, the app's own instructions,
  tools, provider options and caps, answered from a document; pictures come from the store so a look
  costs real image tokens and no render is paid for. 274 trials, $3.65 of gateway tokens, no credits.
  Result: the harness is the ceiling, not the model. The same two failures lead everywhere — no pick
  node (25), never ran it (24) — and the vision's own drafts-pick-final was built correctly in 0 of 12
  attempts by any model. Luna at $0.0013 a scene ties Sol at 15x the price and beats both mid Claudes
  (41% / 41% / 29% Haiku / 24% Sonnet pass^3). Haiku cost more than Sonnet and had 31 ops refused for
  inventing sockets. Both models scored worse at medium effort than at low (Sonnet 12% vs 24%, Luna 35% vs 41%). Output tokens are 22-46% of each
  bill, re-read history 17-33%, so patterns beat pruning. The plan's order was revised on this:
  patterns first, then make the approved run actually happen, then pre-flight. The bench also caught a
  wrong check of mine (tidy-up compared node tops; the layout centres columns) — `arrange` was correct.
  Mistakes on the way: four parallel sweeps took the owner's own session down with a gateway rate
  limit (now serial, paced, retrying); results were only written at the end, so the killed runs lost
  what they had paid for (now appended per trial); one hung stream ate 2.6 hours (now a per-call
  timeout). Opus 5 returned nothing 14 times through the gateway, for no charge.

## 2026-09-19 — Triage: a decision model reads each message first

Jev is TypeSafe AI's "System One" model: it writes nothing, and answers typed questions about a text
with calibrated probabilities in well under a second, for $0.042 a million input tokens. It came out
on 2026-09-15 and is served by Vercel AI Gateway as `typesafe-ai/jev`, through the AI SDK's
experimental `evaluate` call (from `ai` 7.0.105), under the same key the agent thinks with. So the
whole of adding it was a version bump (`ai` 7.0.102 → 7.0.107, `@ai-sdk/react` 4.0.110) and a
release-age exception in `pnpm-workspace.yaml`.

Where it went: not the canvas. The bill data says the agent is 37% of spend, so the loop is where a
cheap decision pays. `studio-core/agent/triage.ts` asks three questions the harness already decides
by rule — clear enough to build (boolean), extend or new graph, drafts or one exact result — and
writes one byte-stable `[triage]` line from the answers. The browser session asks
`POST /api/agent/triage` before sending (three-second limit, the message goes without it on any
failure) and keeps the answers on the message's metadata; the step route appends the line to the
copy the model reads (`withTriageNotes`), never to the stored conversation or the panel; the
instructions say what the line is and that the rules win. In gateway mode a triage is a turn of its
own, held and charged like a step and listed as "Triage · Jev"; the mock is a scripted
`Experimental_EvaluationMockModelV4` that reads a short ask as unclear and a named edit as one result,
so the path runs for nothing in dev and tests. `STUDIO_TRIAGE=off` sends messages without it.

The bench reads each message the same way and prices the triage tokens into the trial; `BENCH_TRIAGE=0`
is the control. Nothing has been measured yet: the harness plan's "Not doing" rules out routers, and
this is the cheapest test of that rule — a hint, not a route. If the with-and-without numbers do not
move, it goes. If patterns land, the same call can name the pattern, and that is the point at which it
would stop being a hint.

Costs and caveats: a message now waits for the triage before it appears in the panel (a few hundred
milliseconds; three seconds at worst). Jev reads words only, so it says nothing about pictures. The
gateway's list price for Jev could not be read from this session; `TRIAGE_MODEL` carries TypeSafe's
published price and should be checked against the gateway's model list. The `evaluate` API is
experimental and `ai` is pinned exactly.

