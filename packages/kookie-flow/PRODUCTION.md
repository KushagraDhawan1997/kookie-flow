# Production qualification

The September 2026 hardening work fixes the sixteen findings from the isolated core audit.
The package remains pre-1.0. A passing unit suite alone is not a release approval: run the
complete gate below on the exact commit and qualify the target application's graphs and devices.

## Reproducible release gate

Use Node 24 and the repository's pinned pnpm 12.4.1. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir packages/kookie-flow exec playwright-core install --with-deps chromium
pnpm --filter @kushagradhawan/kookie-flow run check:release
pnpm audit --prod --audit-level high
```

`.github/workflows/core-quality.yml` runs these checks for pull requests and main. Browser tests
must run without `KUI_ONLY`; a filtered run is diagnostic only. Set `KOOKIE_CHROMIUM` to an
installed Chromium executable when using a custom browser installation. A browser launch
failure is a failed gate, never a skipped pass.

The gate includes source and harness type checking, unit/DOM regressions, deterministic graph,
layout and spatial oracles, a 192 MB overlap stress process, ESM/CJS/declaration builds, an
isolated packed-package consumer, and real WebGL behavior tests. The packed consumer installs
actual peers and verifies every public entry, both declaration formats, a browser bundle, and
license files. TypeScript 6's deprecation setting is explicit because tsup 8 injects `baseUrl`
while bundling declarations; remove the setting when that build tooling no longer needs it.

## Dependency and distribution contract

The supported peer ranges now start at the versions used in the regression fixture: React and
React DOM 19.2.8, Fiber 9.7.0, drei 10.7.8 and three 0.186.0. React/Fiber/drei stay within their
current major; three stays within 0.186. Node tooling and CJS consumers require Node 24 or newer.
Do not infer compatibility with an older three release or a future major from this work.

The renderer uses the unpublished `@kushagradhawan/kookie-ui-react@0.0.0-flow.1` archive in
`vendor/kushagradhawan-kookie-ui-react-0.0.0-flow.1.tgz`. It preserves the old tested UI snapshot;
only its package identity changed. Current UI v2 is a separate upgrade. See
[package installation](../../docs/PACKAGES.md) for the four Flow archives and all peers.

Use `pnpm pack`: its `beforePacking` hook removes workspace-only source export conditions.
The isolated consumer test packs with pnpm and checks the real tarballs. Core installs alone
without React/Three or DOM types. The React consumer exercises both module formats, declaration
formats, public plugins/layout and implementation identity across compatibility imports.

Public npm-only distribution still requires versioned UI and Flow publications and qualification.
No publication is part of this change. Every archive includes MIT licensing; the renderer also
ships Inter's license. Studio is not included in these library packages.

## Loading documents

TypeScript types do not validate JSON. Check imported or persisted data before mounting:

```ts
import { parseFlowObject, FlowDocumentError, validateGraph, buildAdjacencyIndex } from '@kushagradhawan/kookie-flow';

try {
  const document = parseFlowObject(JSON.parse(savedText), { maxEntities: 10_000, maxEdges: 50_000 });
  const executionIssues = validateGraph(document.entities, document.edges, buildAdjacencyIndex(document.edges));
  // Render document; decide how your app presents executionIssues.
} catch (error) {
  if (error instanceof FlowDocumentError) console.error(error.issues);
  else throw error; // e.g. malformed JSON
}
```

`validateFlowObject` returns issues instead of throwing. Shape validation checks finite positions,
dimensions and zoom, core field shapes, duplicate IDs, explicit socket references, edge endpoints,
reroutes and parent cycles. Default item limits are 100,000 entities and 500,000 edges; choose
smaller limits for your product. Custom payload semantics, URL permissions and application
schema migrations remain the application's responsibility. This is not an HTML/URL sanitizer.
The function returns the original object; do not mutate a document behind React's props.

Structural validation permits directed graph cycles and incomplete inputs: an editor must be
able to represent unfinished work. `validateGraph` additionally reports execution-readiness
issues. Omitted socket IDs remain supported for legacy entity-to-entity edges; explicit socket
IDs must exist in the appropriate direction. Parent and edge identifiers are opaque strings.

## Correctness and ownership guarantees covered by regressions

- Rectangles occupy one quadtree cell; overlap can make a query linear, but cannot duplicate
  each rectangle across thousands of cells. The bounded stress gate tests 10,000 overlapping frames.
- Movement batches accumulate until each renderer consumes them. Auto-layout translates nested
  descendants with their frame, including collapsed contents in absolute world coordinates.
- Cancellation never completes a connection. `useGraph` allocates unambiguous connection IDs,
  suppresses repeated identical connection tuples, handles collapse changes and preserves batched undo/redo.
- Changing an entity to a non-computational type aborts its old evaluation and retires outputs.
  Removal clears stale selection, interaction owners and pending movement references.
- Cycle membership uses iterative strongly connected components. Downstream descendants of a
  cycle are not labelled cyclic. Imported dangling references are reported.
- Edge validity follows controlled socket schema/type-table changes with stable edge arrays.
  Imperative zoom-in/out follow the component's minimum and maximum.
- Theme changes update materials without replacing instanced meshes. Capacity changes own fresh
  geometries so superseded attributes can be disposed. Browser tests require zero buffer growth
  after warm-up; the old allowance for a known per-theme leak has been removed.
- Graph widgets and notes render in WebGL. Native editing and the focused accessibility mirror
  remain bounded; 10,000 notes add no per-node DOM. Widget animation clocks submit their terminal
  frame even after a slow frame. Inline DOM widget APIs have been removed.
- Theme reads are scoped to each editor and observe inherited ancestor changes. Layout caches
  distinguish metric sets and entity/socket identity, so multiple editors cannot poison each other.
- Socket value dictionaries treat IDs such as `__proto__` as own keys through evaluation and saving.
- Text measurement, wrapping, glyph buffers, runtime atlases and cursor offsets handle
  supplementary Unicode code points. Kerning keys cannot collide with BMP pairs. Text caches
  include font/kerning identity and size parameters.

## Qualification boundaries

The bundled font atlas has a limited character set. Supply a matching custom atlas for additional
characters. Codepoint support is not complex-script shaping, bidirectional layout, color emoji
or full grapheme-cluster editing. A product requiring these should add a shaping layer and run language-specific acceptance tests.
Native input editing may use DOM; graph text rendering remains GPU-based.

The canvas uses continuous rendering for animation; idle work is not zero. Performance figures
from synthetic stores do not establish an interactive node-count limit. Profile representative
edges, sockets, media, collapsed frames and editing gestures on target GPUs. Test long sessions,
mount/unmount cycles, context loss, memory pressure, accessibility and input methods on each
supported browser/device. Small-graph Chromium probes do not certify Safari, Firefox or mobile.

Womp integration, React Flow API compatibility, application history/persistence and product
workloads were explicitly excluded from this isolated audit. Those are integration acceptance
checks, not promises made by the core release gate.
