/**
 * The example registry — one entry per live specimen a chapter shows.
 *
 * Each example is a REAL FILE that is consumed twice: imported here and rendered, and read
 * off disk and shown as source (`example.tsx`). That is the whole design. A docs site whose
 * snippets are strings written beside the thing they claim to show is a drift machine — two
 * homes for one fact. One file cannot disagree with itself.
 *
 * It also means `tsc` type-checks every sample the site publishes. A snippet in a fence is
 * text nobody compiles; these are modules in the app's own program, so an example using a
 * prop that no longer exists fails the type check rather than misleading a reader.
 *
 * The file name IS the registry key — convention rather than a mapping field, so there is no
 * third place for the pairing to go wrong.
 *
 * Every example is a client component: a canvas is a WebGL context, and there is no server
 * rendering of one to fall back to.
 */
import type * as React from "react";

import ArrangeExample from "./arrange";
import ConnectionRulesExample from "./connection-rules";
import ContextMenuExample from "./context-menu";
import DrawingExample from "./drawing";
import EdgesExample from "./edges";
import EntityKindsExample from "./entity-kinds";
import EntityStylingExample from "./entity-styling";
import EvaluationExample from "./evaluation";
import FramesExample from "./frames";
import HistoryExample from "./history";
import MediaExample from "./media";
import MediaEntitiesExample from "./media-entities";
import NodesExample from "./nodes";
import PreviewBandExample from "./preview-band";
import QuickStartExample from "./quick-start";
import TextEntitiesExample from "./text-entities";
import ToolbarExample from "./toolbar";

/* In reading order, so the registry reads like the chapters that use it. */
export const EXAMPLES: Record<string, React.ComponentType> = {
  "quick-start": QuickStartExample,
  "entity-kinds": EntityKindsExample,
  nodes: NodesExample,
  frames: FramesExample,
  "text-entities": TextEntitiesExample,
  "media-entities": MediaEntitiesExample,
  media: MediaExample,
  "preview-band": PreviewBandExample,
  edges: EdgesExample,
  "connection-rules": ConnectionRulesExample,
  evaluation: EvaluationExample,
  history: HistoryExample,
  arrange: ArrangeExample,
  toolbar: ToolbarExample,
  "context-menu": ContextMenuExample,
  drawing: DrawingExample,
  "entity-styling": EntityStylingExample,
};
