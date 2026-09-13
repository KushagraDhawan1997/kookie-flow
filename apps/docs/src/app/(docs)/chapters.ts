/**
 * The docs, as DATA.
 *
 * One entry per chapter. This single array is the navigation tree, the route table and the
 * previous/next chain; the chapter pages are one renderer over it. A second list is a second
 * thing to keep in step, and two homes for one fact is how a docs site drifts.
 *
 * METADATA LIVES HERE, NOT IN FRONTMATTER, and that is a decision. Chapter ORDER has to be
 * authored — a directory listing cannot express it — so a registry exists either way, and
 * frontmatter beside it would be a second home for the same fields. Keeping it in TypeScript
 * also means `tsc` checks it.
 */
import type * as React from "react";
import type { MDXComponents } from "mdx/types";

import Installation from "../../content/start/installation.mdx";
import QuickStart from "../../content/start/quick-start.mdx";
import State from "../../content/start/state.mdx";
import EntityModel from "../../content/entities/model.mdx";
import Sockets from "../../content/entities/sockets.mdx";
import EntityTypes from "../../content/entities/types.mdx";
import Frames from "../../content/entities/frames.mdx";
import TextEntities from "../../content/entities/text.mdx";
import Media from "../../content/entities/media.mdx";
import Edges from "../../content/edges/edges.mdx";
import Connections from "../../content/edges/connections.mdx";
import Evaluation from "../../content/data/evaluation.mdx";
import Saving from "../../content/data/saving.mdx";
import UndoRedo from "../../content/data/history.mdx";
import Arrange from "../../content/data/arrange.mdx";
import Store from "../../content/data/store.mdx";
import GraphQueries from "../../content/data/graph-queries.mdx";
import Clipboard from "../../content/data/clipboard.mdx";
import Camera from "../../content/interaction/camera.mdx";
import SelectionChapter from "../../content/interaction/selection.mdx";
import Keyboard from "../../content/interaction/keyboard.mdx";
import Toolbar from "../../content/interaction/toolbar.mdx";
import ContextMenu from "../../content/interaction/context-menu.mdx";
import Drawing from "../../content/interaction/drawing.mdx";
import DropAndPaste from "../../content/interaction/drop-and-paste.mdx";
import Theming from "../../content/styling/theming.mdx";
import EntityStyling from "../../content/styling/entities.mdx";
import Fonts from "../../content/styling/fonts.mdx";
import Minimap from "../../content/styling/minimap.mdx";
import KookieFlowApi from "../../content/api/kookie-flow.mdx";
import InstanceApi from "../../content/api/instance.mdx";
import HooksApi from "../../content/api/hooks.mdx";
import UtilitiesApi from "../../content/api/utilities.mdx";
import TypesApi from "../../content/api/types.mdx";

export type SectionId =
  | "start"
  | "entities"
  | "edges"
  | "data"
  | "interaction"
  | "styling"
  | "api";

export type Section = {
  id: SectionId;
  title: string;
  /** What the whole section is for. Shown on the section's own index and in search. */
  blurb: string;
};

export const SECTIONS: readonly Section[] = [
  {
    id: "start",
    title: "Getting started",
    blurb:
      "Install Kookie Flow, build a small graph that you can wire up by hand, and decide who holds the graph's state.",
  },
  {
    id: "entities",
    title: "Entities",
    blurb:
      "Everything on the canvas is an entity. Learn the shape every entity shares, then the sockets, widgets and built-in types that make one a node, a frame, a note or a picture.",
  },
  {
    id: "edges",
    title: "Edges and connections",
    blurb:
      "Draw the wires between entities, and decide which connections a person is allowed to make by dragging.",
  },
  {
    id: "data",
    title: "Data",
    blurb:
      "Make the graph compute, save it and undo edits, tidy it, and read or change the live graph from your own code.",
  },
  {
    id: "interaction",
    title: "Interaction",
    blurb:
      "Control the camera, selection and keyboard, and add a toolbar, a context menu, a pen and media paste to your editor.",
  },
  {
    id: "styling",
    title: "Styling",
    blurb:
      "Make the graph follow your KookieUI theme, set how entities look, choose the font labels are drawn with, and add a minimap.",
  },
  {
    id: "api",
    title: "API reference",
    blurb:
      "Look up every prop, ref method, hook, utility and type, with a link to the chapter that explains each one.",
  },
];

export type Chapter = {
  /** The URL, and the registry's key: `<section>/<name>`. */
  slug: string;
  title: string;
  section: SectionId;
  /** One sentence: what a reader gets from this chapter. Used on section indexes, in the
      previous/next chain and as the page description. */
  blurb: string;
  /** Path INSIDE `src/content/`. The table of contents is read from this file's source; the
      `src/content` prefix lives in `toc.ts` so the bundler can scope the read to a subfolder
      rather than tracing the whole project into the server bundle. */
  source: string;
  /**
   * Example files this chapter renders with `<Example name="…" />`, named without the
   * `examples/` prefix or the extension.
   *
   * Declared rather than inferred, because the MDX compiles to a component and nothing static
   * can see which names it passes.
   */
  examples?: string[];
  /**
   * The compiled chapter.
   *
   * Typed with its `components` prop rather than as a bare `ComponentType`, because that prop
   * is real: `next build` wires the mapping automatically through `mdx-components.tsx`, but
   * anything that mounts a chapter directly has to hand the mapping over itself.
   */
  Content: React.ComponentType<{ components?: MDXComponents }>;
};

export const CHAPTERS: readonly Chapter[] = [
  /* Order in this array IS the order in the navigation and in `READING_ORDER`, so this is the
     whole of the decision. */
  {
    slug: "start/installation",
    title: "Installation",
    section: "start",
    blurb:
      "Add Kookie Flow and its peer dependencies to a React 19 app, then give the canvas a box with a height so it has room to draw.",
    source: "start/installation.mdx",
    Content: Installation,
  },
  {
    slug: "start/quick-start",
    title: "Quick start",
    section: "start",
    blurb:
      "Build a two-node graph step by step: describe the entities, give them sockets, hold them in state, and drag a wire between them.",
    source: "start/quick-start.mdx",
    examples: ["quick-start"],
    Content: QuickStart,
  },
  {
    slug: "start/state",
    title: "Controlled and uncontrolled state",
    section: "start",
    blurb:
      "The canvas keeps its own copy of your graph and reports most edits back to you. Decide whether to apply those reports with useGraph, in your own store, or not at all.",
    source: "start/state.mdx",
    Content: State,
  },

  {
    slug: "entities/model",
    title: "The entity model",
    section: "entities",
    blurb:
      "Every object on the canvas, from a node with sockets to a sticky note or a video, is an entity with an id, a type, a position and data.",
    source: "entities/model.mdx",
    examples: ["entity-kinds"],
    Content: EntityModel,
  },
  {
    slug: "entities/sockets",
    title: "Sockets and widgets",
    section: "entities",
    blurb:
      "Give an entity typed inputs and outputs. An unconnected input can show a control, such as a slider or a text field, that sets its value.",
    source: "entities/sockets.mdx",
    examples: ["nodes"],
    Content: Sockets,
  },
  {
    slug: "entities/types",
    title: "Entity types",
    section: "entities",
    blurb:
      "Describe a kind of node once, with its label, size and sockets, so every entity of that type gets them without repeating them.",
    source: "entities/types.mdx",
    Content: EntityTypes,
  },
  {
    slug: "entities/frames",
    title: "Frames and groups",
    section: "entities",
    blurb:
      "Put entities inside a frame to group them, collapse a frame to hide what it holds, and fold a set of nodes into one group node with ports.",
    source: "entities/frames.mdx",
    examples: ["frames"],
    Content: Frames,
  },
  {
    slug: "entities/text",
    title: "Text and comments",
    section: "entities",
    blurb:
      "Place text on the canvas that people can edit in place, choose how it sizes itself, and add sticky-note comments.",
    source: "entities/text.mdx",
    examples: ["text-entities"],
    Content: TextEntities,
  },
  {
    slug: "entities/media",
    title: "Images, video and models",
    section: "entities",
    blurb:
      "Show pictures, video clips, and glTF models on the canvas, and let a node show whatever one of its outputs holds inside its own body.",
    source: "entities/media.mdx",
    examples: ["media", "preview-band"],
    Content: Media,
  },

  {
    slug: "edges/edges",
    title: "Edges",
    section: "edges",
    blurb:
      "Connect two sockets with an edge, choose the shape of its path, and add labels, arrows, moving light and reroute points.",
    source: "edges/edges.mdx",
    examples: ["edges"],
    Content: Edges,
  },
  {
    slug: "edges/connections",
    title: "Connections",
    section: "edges",
    blurb:
      "Let people drag wires between sockets, turn a finished drag into an edge, and reject the connections your graph can't use.",
    source: "edges/connections.mdx",
    examples: ["connection-rules"],
    Content: Connections,
  },

  {
    slug: "data/evaluation",
    title: "Evaluation",
    section: "data",
    blurb:
      "Give the canvas one function that computes an entity's outputs from its inputs. The canvas decides when to call it, cancels stale runs and shows progress on the node.",
    source: "data/evaluation.mdx",
    examples: ["evaluation"],
    Content: Evaluation,
  },
  {
    slug: "data/saving",
    title: "Saving and exporting",
    section: "data",
    blurb:
      "Save the graph as plain data you can store and load again, and export what is on screen as an image.",
    source: "data/saving.mdx",
    Content: Saving,
  },
  {
    slug: "data/history",
    title: "Undo and redo",
    section: "data",
    blurb:
      "Turn on undo and redo in useGraph, add buttons for them, and learn what counts as one step.",
    source: "data/history.mdx",
    examples: ["history"],
    Content: UndoRedo,
  },
  {
    slug: "data/arrange",
    title: "Layout and alignment",
    section: "data",
    blurb:
      "Tidy a whole graph into columns, line a selection up or space it evenly, and help people place nodes with guides and a snapping grid.",
    source: "data/arrange.mdx",
    examples: ["arrange"],
    Content: Arrange,
  },
  {
    slug: "data/store",
    title: "The flow store",
    section: "data",
    blurb:
      "Read and change the live graph from any component rendered inside KookieFlow, without re-rendering on every frame.",
    source: "data/store.mdx",
    Content: Store,
  },
  {
    slug: "data/graph-queries",
    title: "Graph queries",
    section: "data",
    blurb:
      "Ask what feeds an entity, what it feeds, what order things run in and whether the graph is valid, and work out rewiring edits such as inserting a node on an edge.",
    source: "data/graph-queries.mdx",
    Content: GraphQueries,
  },
  {
    slug: "data/clipboard",
    title: "Clipboard and cloning",
    section: "data",
    blurb:
      "Copy, cut and paste a selection with useClipboard, or clone entities yourself to duplicate them and to copy a graph between tabs.",
    source: "data/clipboard.mdx",
    Content: Clipboard,
  },

  {
    slug: "interaction/camera",
    title: "Canvas and camera",
    section: "interaction",
    blurb:
      "Pan and zoom the canvas, set where the view starts, move the camera from code, and convert between screen and world coordinates.",
    source: "interaction/camera.mdx",
    Content: Camera,
  },
  {
    slug: "interaction/selection",
    title: "Selection",
    section: "interaction",
    blurb:
      "Select, move, resize, and delete entities and edges with the pointer, respond to clicks, and read or set the selection from code.",
    source: "interaction/selection.mdx",
    Content: SelectionChapter,
  },
  {
    slug: "interaction/keyboard",
    title: "Keyboard",
    section: "interaction",
    blurb:
      "Use the keys the canvas already responds to, reach a node's controls without a mouse, and add your own shortcuts without taking keys from the rest of the page.",
    source: "interaction/keyboard.mdx",
    Content: Keyboard,
  },
  {
    slug: "interaction/toolbar",
    title: "Selection toolbar",
    section: "interaction",
    blurb:
      "Show a floating toolbar above the selection with built-in controls for text, comments, images and ink, or with controls you write yourself.",
    source: "interaction/toolbar.mdx",
    examples: ["toolbar"],
    Content: Toolbar,
  },
  {
    slug: "interaction/context-menu",
    title: "Context menus",
    section: "interaction",
    blurb:
      "Open your own menu when someone right-clicks or long-presses the canvas, work out what they clicked, and act on it.",
    source: "interaction/context-menu.mdx",
    examples: ["context-menu"],
    Content: ContextMenu,
  },
  {
    slug: "interaction/drawing",
    title: "Drawing",
    section: "interaction",
    blurb:
      "Press D to turn on the pen and draw freehand strokes. Each stroke is an entity you can select, move, restyle and undo.",
    source: "interaction/drawing.mdx",
    examples: ["drawing"],
    Content: Drawing,
  },
  {
    slug: "interaction/drop-and-paste",
    title: "Dropping and pasting media",
    section: "interaction",
    blurb:
      "Paste or drop a picture, a video, a glTF model or a link to one onto the canvas, and it becomes an entity. Pass onFileDrop when you want the files yourself, for example to upload them first.",
    source: "interaction/drop-and-paste.mdx",
    Content: DropAndPaste,
  },

  {
    slug: "styling/theming",
    title: "Theming",
    section: "styling",
    blurb:
      "The canvas paints with your KookieUI theme's colours, spacing and corners, and repaints when the root Theme's settings change.",
    source: "styling/theming.mdx",
    Content: Theming,
  },
  {
    slug: "styling/entities",
    title: "Entity styling",
    section: "styling",
    blurb:
      "Choose the size, variant, corner radius and title placement every node is drawn with, mark nodes with a line of colour, and override the resolved style where you need to.",
    source: "styling/entities.mdx",
    examples: ["entity-styling"],
    Content: EntityStyling,
  },
  {
    slug: "styling/fonts",
    title: "Fonts and text rendering",
    section: "styling",
    blurb:
      "Choose the font the canvas draws its labels with, use the platform's own font, or bring an MSDF font atlas of your own.",
    source: "styling/fonts.mdx",
    Content: Fonts,
  },
  {
    slug: "styling/minimap",
    title: "Minimap",
    section: "styling",
    blurb:
      "Show a small overview of the whole graph in a corner of the canvas. People can click it or drag it to move the view.",
    source: "styling/minimap.mdx",
    Content: Minimap,
  },

  {
    slug: "api/kookie-flow",
    title: "KookieFlow",
    section: "api",
    blurb:
      "Look up every KookieFlow prop with its type and default, grouped by purpose, with a link to the chapter that explains it.",
    source: "api/kookie-flow.mdx",
    Content: KookieFlowApi,
  },
  {
    slug: "api/instance",
    title: "The ref instance",
    section: "api",
    blurb:
      "Look up every method on the KookieFlow ref, see which ones report their edits to onEntitiesChange, and follow each one to its chapter.",
    source: "api/instance.mdx",
    Content: InstanceApi,
  },
  {
    slug: "api/hooks",
    title: "Hooks",
    section: "api",
    blurb:
      "Look up every hook the package exports and where each one works, then read the style, layout and font hooks that let an overlay match what the canvas drew.",
    source: "api/hooks.mdx",
    Content: HooksApi,
  },
  {
    slug: "api/utilities",
    title: "Utilities",
    section: "api",
    blurb:
      "Use the plain functions the package exports to find what sits under a point, walk frames and their children, and convert CSS colours for your own drawing.",
    source: "api/utilities.mdx",
    Content: UtilitiesApi,
  },
  {
    slug: "api/types",
    title: "Types",
    section: "api",
    blurb:
      "Find every exported type and the chapter that explains it, and narrow an entity to a built-in type with the type guards.",
    source: "api/types.mdx",
    Content: TypesApi,
  },
];

export const BY_SLUG = new Map(
  CHAPTERS.map((chapter) => [chapter.slug, chapter]),
);

export const chaptersIn = (section: SectionId) =>
  CHAPTERS.filter((chapter) => chapter.section === section);

/** Reading order across the whole site — sections in declared order, chapters in declared
    order within each. What previous/next walks. */
export const READING_ORDER: readonly Chapter[] = SECTIONS.flatMap((section) =>
  chaptersIn(section.id),
);

export function neighbours(slug: string): {
  prev?: Chapter | undefined;
  next?: Chapter | undefined;
} {
  const index = READING_ORDER.findIndex((chapter) => chapter.slug === slug);
  if (index === -1) return {};
  return {
    prev: READING_ORDER[index - 1],
    next: READING_ORDER[index + 1],
  };
}
