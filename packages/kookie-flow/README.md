# @kushagradhawan/kookie-flow

A React library for node-graph editors: shader graphs, AI pipelines and whiteboards. It draws
nodes, edges, text, widgets, images, video and 3D models in WebGL, so a board of thousands of
nodes pans and zooms without React re-rendering.

**Pre-1.0.** The API still moves. The
[changelog](https://github.com/KushagraDhawan1997/kookie-flow/blob/main/CHANGELOG.md) marks every
breaking change.

This is the compatibility entry for the split core, WebGL and React packages. New integrations
should import `@kushagradhawan/kookie-flow-react`.

The 0.2.0 candidates are unpublished. Pack with pnpm and install all four Flow archives plus the
pinned `@kushagradhawan/kookie-ui-react@0.0.0-flow.1` archive from this repository's `vendor/`.
Do not substitute current UI v2 without qualifying it: that source changed since the tested snapshot.
See [package migration](../../docs/PACKAGES.md) and [production qualification](./PRODUCTION.md).

Renderer peers: React/React DOM ^19.2.8, Three ~0.186.0, Fiber ^9.7.0 and drei ^10.7.8.
Node tooling and CJS consumers require Node 24+. The browser needs WebGL 2.

## Setup

Import KookieUI's stylesheet once and put a `Theme` at the root of your app. The canvas reads
its colours and corners from that theme, so it follows your app into dark mode. Kookie Flow has
no stylesheet of its own.

```tsx
import "@kushagradhawan/kookie-ui-react/styles.css";
import { Theme } from "@kushagradhawan/kookie-ui-react";

export default function App({ children }: { children: React.ReactNode }) {
  return <Theme>{children}</Theme>;
}
```

## An example

```tsx
"use client";

import { KookieFlow, useGraph, type Entity } from "@kushagradhawan/kookie-flow";

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

The canvas fills its parent, so give the parent a height. Drag from the Constant node's output
to the Viewer node's input to connect them. In the Next.js App Router, render `KookieFlow` from a
file that starts with `"use client"`.

## Entry points

- `@kushagradhawan/kookie-flow` holds the `KookieFlow` component, `useGraph` and the other hooks,
  and the utilities.
- `@kushagradhawan/kookie-flow/plugins` holds `useClipboard`, `useKeyboardShortcuts` and
  `useContextMenu`.

Both ship ES module and CommonJS builds with type declarations. Prefer the ES module build: it
loads the bundled Inter font atlas as a separate chunk, while the CommonJS build carries the
atlas inline. The declarations import types from three.js, so add `@types/three` in a
TypeScript project.

## Documentation

The documentation lives at [kookie-flow.vercel.app](https://kookie-flow.vercel.app). It covers
entities and sockets, edges and connections, evaluation, saving, undo and layout, interaction,
styling, and a reference for every prop, ref method and hook.

## Licence

MIT © [Kushagra Dhawan](https://github.com/KushagraDhawan1997)
