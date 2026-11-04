# Kookie Flow

Kookie Flow is a React library for node editors, such as shader graphs, AI pipelines and
whiteboards. Most node editors draw each node as HTML, and they become slow when a graph has many
nodes. Kookie Flow draws everything in WebGL instead, so a board with thousands of nodes stays
smooth when you pan, zoom and drag. Read the docs at [flow.kookie.design](https://flow.kookie.design).

[Kookie Studio](apps/studio), a node canvas for AI images and video, uses Kookie Flow for its
canvas.

**Pre-1.0.** The API still moves. [`CHANGELOG.md`](CHANGELOG.md) marks every breaking change.

## Packages

| Package | Owns |
| --- | --- |
| `@kushagradhawan/kookie-flow-core` | Graph data, store, evaluation, history, layout and geometry. No React or browser runtime. |
| `@kushagradhawan/kookie-flow-webgl` | GPU drawing, interaction and text editing. Uses React/R3F. Its look comes from a skin. |
| `@kushagradhawan/kookie-flow-skin` | Kookie UI's glass look: colour roles, sizes, shaders and toolbar controls. |
| `@kushagradhawan/kookie-flow-react` | The usual React entry: `KookieFlow`, `useGraph`, hooks and plugins. |

These 0.2.0 candidates are unpublished. Use the workspace or pack all four packages with pnpm.
The renderer needs the exact UI archive in `vendor/`, React/React DOM 19.2.8+, Three 0.186,
Fiber 9.7+, drei 10.7+, and WebGL 2. The core only depends on Zustand's vanilla store.

See [package migration](docs/PACKAGES.md) for installation and API changes.
[Production qualification](packages/kookie-flow-harness/PRODUCTION.md) describes the
release gate and remaining product acceptance checks.

## An example

Import KookieUI's stylesheet and put its `Theme` at the root of your app, then render the canvas in
a box with a height.

```tsx
"use client";

import { KookieFlow, useGraph, type Entity } from "@kushagradhawan/kookie-flow-react";
import { skin } from "@kushagradhawan/kookie-flow-skin";

const initialEntities: Entity[] = [
  { id: "constant", type: "constant", position: { x: 0, y: 0 }, data: { label: "Constant" },
    outputs: [{ id: "value", name: "Value", type: "float" }] },
  { id: "viewer", type: "viewer", position: { x: 320, y: 0 }, data: { label: "Viewer" },
    inputs: [{ id: "value", name: "Value", type: "float" }] },
];

export default function Graph() {
  const { entities, edges, onEntitiesChange, onEdgesChange, onConnect } = useGraph({
    initialEntities,
  });

  return (
    <div style={{ width: "100%", height: 360 }}>
      <KookieFlow skin={skin} entities={entities} edges={edges} onEntitiesChange={onEntitiesChange}
        onEdgesChange={onEdgesChange} onConnect={onConnect} />
    </div>
  );
}
```

Drag from the Constant node's output to the Viewer node's input to connect them.

## What it does

- [Typed sockets](https://flow.kookie.design/entities/sockets) with sliders, number fields,
  selects and checkboxes drawn on the node.
- [Evaluation](https://flow.kookie.design/data/evaluation) through one `onEvaluate`
  function, with manual gates, cancellation and progress shown on the node.
- [Frames](https://flow.kookie.design/entities/frames),
  [text and comments](https://flow.kookie.design/entities/text),
  [ink](https://flow.kookie.design/interaction/drawing), and
  [images, video and models](https://flow.kookie.design/entities/media), each an entity
  you select, move and delete like a node.
- [Undo](https://flow.kookie.design/data/history),
  [saving with `toObject`](https://flow.kookie.design/data/saving), and
  [`autoLayout`, align and distribute](https://flow.kookie.design/data/arrange).
- A [selection toolbar](https://flow.kookie.design/interaction/toolbar), a
  [minimap](https://flow.kookie.design/styling/minimap), and
  [keyboard access](https://flow.kookie.design/interaction/keyboard) to every node.
- [Theming](https://flow.kookie.design/styling/theming) from Kookie UI, in light and dark.

Nodes don't host React components. The canvas draws nodes in depth order, so a node in front
covers the one behind it, and a DOM element can only sit above the whole canvas or below it. The
built-in widgets and text editing use DOM only for the length of one edit, and the accessibility
mirror only for the node the keyboard cursor is on. Nodes, comments and persistent socket widgets
all draw in WebGL. There is no custom DOM widget escape hatch.
[Entity types](https://flow.kookie.design/entities/types) shows what a node can declare
instead.

## Documentation

The site in `apps/docs` is the documentation, published at
[flow.kookie.design](https://flow.kookie.design).

| section | what it covers |
|---|---|
| [Getting started](https://flow.kookie.design/start/installation) | installing, a first graph, and controlled or uncontrolled state |
| [Entities](https://flow.kookie.design/entities/model) | nodes, sockets and widgets, entity types, frames, text and media |
| [Edges and connections](https://flow.kookie.design/edges/edges) | edge shapes, labels and markers, and which connections are allowed |
| [Data](https://flow.kookie.design/data/evaluation) | evaluation, saving, undo, layout, the store, graph queries and the clipboard |
| [Interaction](https://flow.kookie.design/interaction/camera) | the camera, selection, keyboard, toolbar, context menus, drawing and dropped files |
| [Styling](https://flow.kookie.design/styling/theming) | theming, node styling, fonts and the minimap |
| [API reference](https://flow.kookie.design/api/kookie-flow) | every prop, ref method, hook, utility and type |

The site also serves these:

| route | what it holds |
|---|---|
| `/demo` and `/demo-evaluation` | full-screen demos of a board and of evaluation |
| any chapter path + `.md` | the same chapter as markdown |
| `/llms.txt` and `/llms-full.txt` | an index of every chapter, and every chapter in one file |

Run it locally:

```bash
pnpm install
pnpm dev
```

`pnpm dev` watch-builds the package and runs the site together. `pnpm docs` runs the site alone,
against the package's last build.

## Repository layout

```text
packages/kookie-flow-core        graph data, store, evaluation, history, layout (no React)
packages/kookie-flow-webgl       the renderer: drawing, interaction, text, accessibility
packages/kookie-flow-skin  Kookie UI's glass look
packages/kookie-flow-react       the React entry: KookieFlow, useGraph, plugins
packages/kookie-flow-harness     private: the Playwright behaviour suite and release gate
packages/studio-core             shared logic for the studio app
apps/docs              the documentation site and the demos
plans/                 design notes; they can lag behind the source
docs/handovers         handover notes from past working sessions
vendor/                the pinned personal KookieUI archive used by the renderer and apps
```

## Commands

Run these from the repository root. They need pnpm 12 and Node 24 or later; `.nvmrc` pins 26 for local work.

| command | what it does |
|---|---|
| `pnpm dev` | watch-builds the package and runs the docs site, through turbo |
| `pnpm docs` | runs the docs site alone |
| `pnpm test` | runs the package's unit tests with vitest |
| `pnpm test:browser` | builds the harness and runs the behaviour checks in Chromium. It needs a Playwright Chromium (`npx playwright install chromium`), or a Chromium binary's path in `KOOKIE_CHROMIUM`. |
| `pnpm lint` | type-checks every workspace: the package and its harness, `studio-core`, the docs site and the studio |
| `pnpm format` | formats the repository with Prettier |
| `pnpm format:check` | reports files that Prettier would change |
| `pnpm build` | builds the package and the docs site |

The bundled Inter MSDF atlas is generated from the Inter font files in
`packages/kookie-flow-webgl/fonts`. Regenerate it with:

```bash
pnpm --filter @kushagradhawan/kookie-flow-webgl generate:fonts
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md).

## Licence

MIT © [Kushagra Dhawan](https://github.com/KushagraDhawan1997)
