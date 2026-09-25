# Package split and migration

## Ownership

The dependency direction is `react → webgl → core`; the compatibility package forwards to
`react` and `core/layout`. Core does not import React, Three, R3F, KookieUI or browser globals.
Its TypeScript configuration excludes DOM libraries. `pnpm check:boundaries` checks the source
imports; `pnpm test:packages` installs the tarballs in consumers outside this repository.

`webgl` owns Kookie Flow's tokens, glass, palette, shaders, font atlases, pointer and keyboard
interaction, accessibility mirror and native text editing. It uses React and R3F internally.
It is not a framework-independent WebGL renderer. `react` adds controlled graph state and
history through `useGraph`, and exposes the normal application API.

No design-token adapter is introduced. Glass remains a designed material owned by this renderer.
Core's numeric socket layout contract lets the renderer supply measured geometry without
making graph logic depend on CSS or on the names of design tokens.

Subpaths under `/internal/` are for the sibling packages and are not stable extension APIs.
Keep all Flow packages on the same release. Each module has one implementation; compatibility
imports and new imports share the store and React contexts.

## Use the packages

For a React editor, import from `@kushagradhawan/kookie-flow-react` and its `/plugins` subpath.
Import `@kushagradhawan/kookie-ui-react/styles.css` once and wrap the app in its `Theme`.
For nonvisual work:

```ts
import { createFlowStore, parseFlowObject } from '@kushagradhawan/kookie-flow-core';

const document = parseFlowObject(savedObject);
const store = createFlowStore({ entities: document.entities, edges: document.edges });
store.getState().fitView({}, 1280, 720);
// When this owner is finished:
store.getState().disposeEvaluation();
```

The standalone store is a Zustand vanilla store, not a React hook. `fitView` needs positive,
finite viewport width and height for a nonempty graph. The React canvas supplies its dimensions.

The legacy package preserves the root, `/plugins` and `/layout` import paths. It does not preserve
removed DOM widget APIs: `widgetTypes`, `ThemeComponent`, `InlineWidgetComponent`, `WidgetProps`
and `socket.widget = { component }` are removed. Use a supported GPU `WidgetType`, or `false`.
An untyped inline widget object throws instead of silently painting a second layer.

Notes now use instanced WebGL fill/border quads and MSDF text. Their colors and font size still
follow data changes. They participate in canvas depth and image export, with no DOM element per
note. Their former CSS drop shadow is not reproduced; GPU notes currently have fill and hairline.
Toolbars, minimap and app children remain ordinary React UI. Native edit fields and the focused
node's hidden accessibility controls remain bounded DOM surfaces.

## Pack and test, without publishing

Use Node 24 and pnpm 12.4.1. On a clean build checkout:

```sh
pnpm install --frozen-lockfile
pnpm --filter @kushagradhawan/kookie-flow... run build
pnpm test:packages
pnpm --filter '@kushagradhawan/kookie-flow*' -r pack --pack-destination ./artifacts
```

Use `pnpm pack` rather than `npm pack`: pnpm expands workspace dependencies and the repository's
`beforePacking` hook removes local source conditions. The consumer test uses that same hook
and real packing path. Built JS and both ESM/CJS declarations, licenses and WebGL font assets
must exist in the archives. Do not publish development source export conditions.

Install all four Flow archives plus `vendor/kushagradhawan-kookie-ui-react-0.0.0-flow.1.tgz` in a
consumer, with the renderer peers listed in `packages/kookie-flow-webgl/package.json`. The UI
archive is the previously tested Flow snapshot with only its package name and version changed.
Current UI v2 removed motion; upgrading Flow to that source is a separate change, not hidden
inside this package rename. Ordinary npm-only installation requires published, qualified releases.

## Womp copy and manual two-way sync

All personal packages live in this repository. Womp will keep a full copy in its own repository
under its own package scope. No Womp source is imported into this repository by this change.

For each transfer, record the source repository, commit and copied paths in a sync record in the
destination. Compare against the last transferred commit; copy only reviewed changes and rerun
both repositories' package and behavior gates. Fixes can move in either direction. Preserve
license notices and make a new commit in the receiving repository; do not merge the two Git
histories. Attribution and repository access are distinct from technical package structure.

Keep graph/store fixes separate from renderer appearance changes. Shared fixes need explicit
review in both directions; glass-specific changes stay here unless Womp chooses them. If both
copies change the same behavior, resolve it explicitly and run the regression in both copies.
A package split makes that comparison easier, but does not synchronize anything automatically.

## Qualification

Unit and DOM tests, import boundaries, isolated ESM/CJS consumers and real browser regressions
are required. The browser suite covers GPU note edits, replacement at unchanged count, zoom,
selection, light/dark contrast, independent editor themes and 10,000 notes with bounded DOM.
CPU store benchmarks are not GPU frame-rate measurements. Product graphs, target hardware,
long sessions, other browsers and Womp's persistence/history still need acceptance testing.
