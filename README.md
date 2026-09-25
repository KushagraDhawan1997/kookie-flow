# Kookie Flow

A React library for node-graph editors: shader graphs, AI pipelines and whiteboards. It draws
nodes, edges, text, widgets, images, video and 3D models in WebGL, so a board of thousands of
nodes pans and zooms without React re-rendering.

**Pre-1.0.** The API still moves. [`CHANGELOG.md`](CHANGELOG.md) marks every breaking change.

## Packages

| Package | Owns |
| --- | --- |
| `@kushagradhawan/kookie-flow-core` | Graph data, store, evaluation, history, layout and geometry. No React or browser runtime. |
| `@kushagradhawan/kookie-flow-webgl` | GPU drawing, interaction, text editing and Kookie Flow's glass appearance. Uses React/R3F. |
| `@kushagradhawan/kookie-flow-react` | The usual React entry: `KookieFlow`, `useGraph`, hooks and plugins. |
| `@kushagradhawan/kookie-flow` | Compatibility entry forwarding to those packages. |

These 0.2.0 candidates are unpublished. Use the workspace or pack all four packages with pnpm.
The renderer needs the exact UI archive in `vendor/`, React/React DOM 19.2.8+, Three 0.186,
Fiber 9.7+, drei 10.7+, and WebGL 2. The core only depends on Zustand's vanilla store.

See [package migration and two-way sync](docs/PACKAGES.md) for installation, API changes and the
planned Womp copy. [Production qualification](packages/kookie-flow/PRODUCTION.md) describes the
release gate and remaining product acceptance checks.

## An example

Import KookieUI's stylesheet and put its `Theme` at the root of your app, then render the canvas in
a box with a height.

```tsx
"use client";

import { KookieFlow, useGraph, type Entity } from "@kushagradhawan/kookie-flow-react";

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
      <KookieFlow entities={entities} edges={edges} onEntitiesChange={onEntitiesChange}
        onEdgesChange={onEdgesChange} onConnect={onConnect} />
    </div>
  );
}
```

Drag from the Constant node's output to the Viewer node's input to connect them.

## What it does

- [Typed sockets](https://kookie-flow.vercel.app/entities/sockets) with sliders, number fields,
  selects and checkboxes drawn on the node.
- [Evaluation](https://kookie-flow.vercel.app/data/evaluation) through one `onEvaluate`
  function, with manual gates, cancellation and progress shown on the node.
- [Frames](https://kookie-flow.vercel.app/entities/frames),
  [text and comments](https://kookie-flow.vercel.app/entities/text),
  [ink](https://kookie-flow.vercel.app/interaction/drawing), and
  [images, video and models](https://kookie-flow.vercel.app/entities/media), each an entity
  you select, move and delete like a node.
- [Undo](https://kookie-flow.vercel.app/data/history),
  [saving with `toObject`](https://kookie-flow.vercel.app/data/saving), and
  [`autoLayout`, align and distribute](https://kookie-flow.vercel.app/data/arrange).
- A [selection toolbar](https://kookie-flow.vercel.app/interaction/toolbar), a
  [minimap](https://kookie-flow.vercel.app/styling/minimap), and
  [keyboard access](https://kookie-flow.vercel.app/interaction/keyboard) to every node.
- [Theming](https://kookie-flow.vercel.app/styling/theming) from KookieUI v2, in light and dark.

Nodes don't host React components. The canvas draws nodes in depth order, so a node in front
covers the one behind it, and a DOM element can only sit above the whole canvas or below it. The
built-in widgets and text editing use DOM only for the length of one edit, and the accessibility
mirror only for the node the keyboard cursor is on. Nodes, comments and persistent socket widgets
all draw in WebGL. There is no custom DOM widget escape hatch.
[Entity types](https://kookie-flow.vercel.app/entities/types) shows what a node can declare
instead.

## Documentation

The site in `apps/docs` is the documentation, published at
[kookie-flow.vercel.app](https://kookie-flow.vercel.app).

| section | what it covers |
|---|---|
| [Getting started](https://kookie-flow.vercel.app/start/installation) | installing, a first graph, and controlled or uncontrolled state |
| [Entities](https://kookie-flow.vercel.app/entities/model) | nodes, sockets and widgets, entity types, frames, text and media |
| [Edges and connections](https://kookie-flow.vercel.app/edges/edges) | edge shapes, labels and markers, and which connections are allowed |
| [Data](https://kookie-flow.vercel.app/data/evaluation) | evaluation, saving, undo, layout, the store, graph queries and the clipboard |
| [Interaction](https://kookie-flow.vercel.app/interaction/camera) | the camera, selection, keyboard, toolbar, context menus, drawing and dropped files |
| [Styling](https://kookie-flow.vercel.app/styling/theming) | theming, node styling, fonts and the minimap |
| [API reference](https://kookie-flow.vercel.app/api/kookie-flow) | every prop, ref method, hook, utility and type |

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
packages/kookie-flow   the library, its vitest tests, and the Playwright harness in harness/
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
`packages/kookie-flow/fonts`. Regenerate it with:

```bash
pnpm --filter @kushagradhawan/kookie-flow generate:fonts
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md).

## Licence

MIT © [Kushagra Dhawan](https://github.com/KushagraDhawan1997)
