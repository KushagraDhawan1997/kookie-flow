# @kushagradhawan/kookie-flow

A React library for node-graph editors: shader graphs, AI pipelines and whiteboards. It draws
nodes, edges, text, widgets, images, video and 3D models in WebGL, so a board of thousands of
nodes pans and zooms without React re-rendering.

**Pre-1.0.** The API still moves. The
[changelog](https://github.com/KushagraDhawan1997/kookie-flow/blob/main/CHANGELOG.md) marks every
breaking change.

Peer dependencies are React and React DOM 19 or later, three.js 0.170 or later, React Three Fiber
9 or later and drei 10 or later. It also needs KookieUI v2 (`@kookie-ui/react`) and a browser with
WebGL 2.

## Setup

Install the package and its peers:

```bash
pnpm add @kushagradhawan/kookie-flow react react-dom three @react-three/fiber @react-three/drei
```

KookieUI v2 supplies the theme and the selection toolbar's controls. It isn't on npm yet, so
build it from its [repository](https://github.com/KushagraDhawan1997/kookie-ui-v2) and depend
on the packed tarball. The
[Installation](https://kookie-flow.vercel.app/start/installation) chapter shows each step.

Import KookieUI's stylesheet once and put a `Theme` at the root of your app. The canvas reads
its colours and corners from that theme, so it follows your app into dark mode. Kookie Flow has
no stylesheet of its own.

```tsx
import "@kookie-ui/react/styles.css";
import { Theme } from "@kookie-ui/react";

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
