# Kookie Flow vs React Flow

As of 2026-10-15. Written for Womp, which uses React Flow today.

## Summary

Kookie Flow is ahead of React Flow on scale and on what ships in the box, and behind on flexibility and maturity. The one hard blocker for Womp: React Flow nodes are arbitrary React components, and Kookie Flow nodes cannot contain React at all.

- **Ahead.** Everything on the canvas is drawn on the GPU, so node count stops being a DOM problem. Kookie Flow also has built-in undo/redo, copy/paste, auto layout, helper lines, drawing, grouping, media and a graph evaluation engine. React Flow sells those as Pro examples ($169–$289 a month) or leaves them to other libraries.
- **Behind.** Custom node content is limited to a fixed set of GPU widgets: slider, number, text, select, checkbox, colour, switch, segmented. React Flow is at 12.12.0 with 14.3M weekly downloads. Kookie Flow is pre-1.0, unpublished, and has never been measured on real GPUs.
- **For Womp.** Whether Womp can switch depends on what its current React Flow nodes render. Nodes that are a title, ports and simple controls map cleanly. Nodes with custom React content, such as charts, rich editors or embedded forms, need new GPU work or a DOM overlay escape hatch first.

## Architecture

React Flow puts every node in the page as real HTML. Kookie Flow paints the whole graph into one WebGL canvas and keeps only chrome in the page. Everything else in this study follows from that difference.

| Layer            | React Flow                                                                                                                                                          | Kookie Flow                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Nodes            | One DOM subtree per node, any React component ([terms](https://reactflow.dev/learn/concepts/terms-and-definitions))                                                 | Instanced GPU quads, with the look from a skin shader                                                                             |
| Edges            | One SVG path per edge                                                                                                                                               | GPU geometry, culled off-screen, detail drops with zoom                                                                           |
| Text             | Browser text in each node                                                                                                                                           | One MSDF glyph atlas, one draw call for every label                                                                               |
| Pan and zoom     | CSS transform on one container, no React re-render ([source](https://raw.githubusercontent.com/xyflow/xyflow/main/packages/react/src/container/Viewport/index.tsx)) | Camera uniforms, no React re-render                                                                                               |
| Interaction      | d3-zoom and d3-drag, DOM hit testing                                                                                                                                | Own pointer handling, quadtree hit testing                                                                                        |
| Stays in the DOM | Everything                                                                                                                                                          | Toolbar, text-edit field, a hidden accessibility mirror for the focused node, the `children` overlay. The minimap is a 2D canvas. |
| Look             | CSS on your own components                                                                                                                                          | A `FlowSkin`: colour roles, sizes and shaders. Glass is Kookie UI v2's.                                                           |

The trade is direct. React Flow's DOM nodes can hold anything a web page can, and every one of them costs layout, measuring and compositing. Kookie Flow's nodes cost almost nothing per extra node, but can only show what the renderer knows how to draw.

## Features

Kookie Flow ships most of what React Flow leaves to Pro or to other libraries. React Flow wins wherever a node's content has to be custom.

| Feature                       | React Flow 12.12                                                                                                 | Kookie Flow (main)                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Custom node content           | Any React component                                                                                              | Fixed GPU widgets (slider, number, text, textarea, select, checkbox, colour, switch, segmented); no React inside nodes |
| Node kinds                    | Whatever you build                                                                                               | Built in: standard node, frame, comment, text, image, video, 3D mesh, ink stroke, reroute, preview band                |
| Handles and validation        | Handles are divs; `isValidConnection`, strict or loose mode                                                      | Typed sockets with compatibility rules; `isValidConnection`, strict or loose, `allowCycles`                            |
| Edge types                    | Bezier, smoothstep, step, straight, custom SVG edges                                                             | Bezier, straight, step, smoothstep; labels, arrows, animated light; no custom edge components                          |
| Edge reconnect, edge toolbar  | Free examples                                                                                                    | Not found in the docs                                                                                                  |
| Grouping and sub-flows        | Parent/child nodes free; selection grouping is Pro                                                               | Frames: nestable, collapsible, collapse-to-subgraph                                                                    |
| Undo/redo                     | Pro example only ([source](https://reactflow.dev/examples/interaction/undo-redo))                                | Built in, `useGraph({ history: true })`, 50 steps                                                                      |
| Copy/paste                    | Pro example only                                                                                                 | Built in, `useClipboard`, including cross-tab                                                                          |
| Auto layout                   | dagre or elkjs, wired by you; Auto Layout is Pro                                                                 | Built in: `layoutGraph`, `autoLayout()`, align and distribute; runs on a server too                                    |
| Helper lines                  | Pro example                                                                                                      | Built in, on by default                                                                                                |
| Freehand drawing              | Pro example                                                                                                      | Built in pen tool                                                                                                      |
| Minimap, controls, background | Built in                                                                                                         | Minimap and toolbar built in                                                                                           |
| Node resizer, node toolbar    | Built in                                                                                                         | Resize handles and a per-type toolbar built in                                                                         |
| Graph execution               | Not in scope                                                                                                     | Built-in evaluation engine: reactive or manual, progress, cancellation, status on nodes                                |
| Keyboard and accessibility    | Tab through nodes, arrow keys move, aria-live ([source](https://reactflow.dev/learn/advanced-use/accessibility)) | Keyboard cursor, screen-reader announcements, a hidden form mirror for the focused node                                |
| Server rendering              | Static HTML with sized nodes ([source](https://reactflow.dev/learn/advanced-use/ssr-ssg-configuration))          | Client only; layout and graph logic run on a server                                                                    |
| Export                        | Download Image example                                                                                           | `toImage()` and `toObject()` built in                                                                                  |
| Collaboration                 | yjs example (Pro)                                                                                                | Not built                                                                                                              |

Sources for React Flow's lists: [examples](https://reactflow.dev/examples), [Pro](https://reactflow.dev/pro), [API reference](https://reactflow.dev/api-reference/react-flow). Kookie Flow's come from its docs in `apps/docs/src/content`.

## API and developer experience

The two APIs are close at the edges and far apart at the node. Graph state, callbacks and the instance ref translate almost one for one. Custom nodes have to be rethought, because each one is data rather than JSX.

| Concern            | React Flow                                                                                    | Kookie Flow                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Graph data         | `nodes`, `edges`                                                                              | `entities`, `edges`                                                                   |
| Change callbacks   | `onNodesChange`, `onEdgesChange`, `onConnect`                                                 | `onEntitiesChange`, `onEdgesChange`, `onConnect`                                      |
| Local state helper | `useNodesState`, `useEdgesState`                                                              | `useGraph`, which can also hold undo history                                          |
| Store access       | `useStore`, `useStoreApi`, `useReactFlow`                                                     | `useFlowStore`, `useFlowStoreApi`, plus a ref (`KookieFlowInstance`)                  |
| Custom node        | A React component in `nodeTypes`                                                              | An `EntityTypeDefinition`: label, size, inputs, outputs, widgets, toolbar, evaluation |
| Custom edge        | A React component in `edgeTypes`                                                              | Not supported; four built-in shapes                                                   |
| Overlays           | Anything inside a node, or `Panel`                                                            | `children` render in a DOM layer over the canvas                                      |
| Styling            | CSS and your own components                                                                   | A skin, plus props: `size`, `variant`, `radius`, `header`, `entityStyle`              |
| Hooks              | 19 ([list](https://reactflow.dev/api-reference/hooks))                                        | 12, plus 3 plugins (`useClipboard`, `useKeyboardShortcuts`, `useContextMenu`)         |
| React and runtime  | React 17 or later                                                                             | React 19.2.8 or later, three 0.186, Fiber 9.7, WebGL 2                                |
| Distribution       | npm, MIT, 14.3M a week ([npm](https://api.npmjs.org/downloads/point/last-week/@xyflow/react)) | Unpublished 0.2.0; depends on a vendored Kookie UI archive                            |
| Docs and community | Large example set, 38.7k GitHub stars, paid support                                           | A full docs site in the repo, no outside users                                        |

Porting a Womp screen means three kinds of work. Rename the state plumbing, which is mechanical. Rewrite each node type as an entity type definition, which is design work per type. Move any DOM-heavy node content into the `children` overlay or the toolbar, or into a new GPU widget.

## Performance and scale

React Flow's own maintainers put its comfortable ceiling at around 1,000 simple nodes. Kookie Flow is designed for tens of thousands, but that has not yet been measured on a real GPU. Neither side has a like-for-like benchmark.

| Evidence         | React Flow                                                                                                                                                                                                                                                                | Kookie Flow                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stated limit     | "~1000 nodes is the limit depending on the complexity of the nodes" (maintainer, [#967](https://github.com/xyflow/xyflow/issues/967))                                                                                                                                     | Design target of 10,000–50,000 nodes at 60 fps (`plans/architecture.md`)                                                                                                         |
| Reports at scale | 10k nodes closed as "too many nodes for React Flow" ([#3044](https://github.com/xyflow/xyflow/issues/3044)); lag reported from about 100–200 complex nodes ([#5442](https://github.com/xyflow/xyflow/issues/5442), [#1437](https://github.com/xyflow/xyflow/issues/1437)) | 120 fps at 1,000 nodes while dragging, from a January 2026 profile (`plans/technical-decisions.md`)                                                                              |
| Measured in CI   | Not published; the stress example is 100 nodes                                                                                                                                                                                                                            | Browser suite with two editors and 10,000 GPU notes, which checks correctness and bounded DOM, not frame rate                                                                    |
| CPU benchmarks   | None published                                                                                                                                                                                                                                                            | Hit testing under 1 ms at 10k nodes; culling 3x cheaper at 10k and 160x at 50k (`CHANGELOG.md`)                                                                                  |
| What helps       | `React.memo` nodes, stable props, `onlyRenderVisibleElements`, hiding subtrees ([guide](https://reactflow.dev/learn/advanced-use/performance))                                                                                                                            | Built in: instancing, culling, zoom-based detail, no React work per frame                                                                                                        |
| Not yet known    | Not applicable                                                                                                                                                                                                                                                            | Frame time at 1k, 10k and 50k on real GPUs; long sessions; Safari, Firefox and mobile. The test machine renders with SwiftShader (`packages/kookie-flow-harness/PRODUCTION.md`). |

Before Womp decides, the missing number is a frame-time run of Womp-sized graphs on Womp's target machines, in both libraries.

## Gaps to close before Womp switches

One gap blocks the switch outright. The rest are engineering hardening, or depend on what Womp uses.

| Gap                               | Why it matters for Womp                                                                          | Size                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| No React inside nodes             | Any node that renders custom React (charts, rich text, previews, forms) has no direct equivalent | Blocker; needs a DOM-in-node escape hatch or new GPU widgets |
| No custom edge components         | Edges with buttons, toolbars or bespoke shapes                                                   | Medium                                                       |
| No edge reconnect or edge toolbar | Common React Flow interactions                                                                   | Small to medium                                              |
| No real-GPU performance proof     | The main reason to switch is unmeasured                                                          | Medium; one benchmark pass on target hardware                |
| Browser coverage                  | Only Chromium is qualified; Safari, Firefox and mobile are not                                   | Medium                                                       |
| Text limits                       | The font atlas has a limited character set, with no complex-script shaping, bidi or colour emoji | Depends on Womp's languages                                  |
| Unpublished packages              | Pre-1.0, no compatibility promise, depends on a vendored UI archive                              | Packaging work, plus Womp's own v1 skin                      |
| React 19 and WebGL 2 required     | Womp's React version and browser targets must meet them                                          | Check                                                        |
| Docs drift                        | Two pages still describe removed DOM widget and comment behaviour                                | Small                                                        |

## Migration path for Womp

Start with an inventory of Womp's node types, because that decides whether the switch is a port or a project. Each later step is cheap to stop at.

1. **Inventory.** List every React Flow node and edge type Womp renders, with what each contains: plain fields, custom React, sub-flows, any Pro examples in use.
2. **Benchmark.** Run Womp-sized graphs in both libraries on Womp's target machines and browsers. Record frame time while panning and dragging.
3. **Close the blocker.** Pick an answer for custom node content: a DOM overlay pinned to nodes, new GPU widgets, or both. Build it here first, then port it to Womp.
4. **Write Womp's skin.** Do step 6 of the skin plan (`plans/skin-layer.md`), a solid skin on Womp's Kookie UI v1, once v1 is stable enough to target.
5. **Port one screen.** Move one editor behind a flag, map node types to entity types, and compare in production.
6. **Retire React Flow** screen by screen.

### Open questions

- [ ] Which Womp repo and screens use React Flow, and how many node types?
- [ ] Do any Womp nodes render custom React that can't be expressed as Kookie Flow's widgets?
- [ ] Does Womp pay for React Flow Pro, or use Pro examples?
- [ ] Is Womp on React 19, and which browsers does it support?
- [ ] How large do Womp graphs get in practice?

### Sources

- React Flow: [npm downloads](https://api.npmjs.org/downloads/point/last-week/@xyflow/react), [releases](https://github.com/xyflow/xyflow/releases), [examples](https://reactflow.dev/examples), [Pro](https://reactflow.dev/pro), [API reference](https://reactflow.dev/api-reference/react-flow), [hooks](https://reactflow.dev/api-reference/hooks), [performance guide](https://reactflow.dev/learn/advanced-use/performance), [accessibility](https://reactflow.dev/learn/advanced-use/accessibility), [SSR](https://reactflow.dev/learn/advanced-use/ssr-ssg-configuration), issues [#967](https://github.com/xyflow/xyflow/issues/967), [#3044](https://github.com/xyflow/xyflow/issues/3044), [#5442](https://github.com/xyflow/xyflow/issues/5442), [#1437](https://github.com/xyflow/xyflow/issues/1437).
- Kookie Flow: the docs in `apps/docs/src/content`, `CHANGELOG.md`, `packages/kookie-flow-harness/PRODUCTION.md`, `plans/architecture.md`, `plans/technical-decisions.md`, on main as of 2026-10-15.
