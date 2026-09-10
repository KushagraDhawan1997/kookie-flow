/**
 * Deterministic graph fixtures.
 *
 * Seeded, never Math.random: a perf number that moves because the fixture moved is not a
 * measurement, and a behavior test that fails one run in twenty teaches people to re-run it.
 * Same seed and same count always produce byte-identical entities and edges.
 *
 * THE FIXTURE MUST NOT BE DEGENERATE. The first version of this file set `width: 200,
 * height: 120` on EVERY entity, which simultaneously hid two whole bug classes: the 240-vs-200
 * default mismatch between the socket index and the renderer (an explicit width means neither
 * default is ever taken) and the entire auto-height divergence (an explicit height means the
 * layout is never computed). A baseline built on that fixture blesses both bugs — the tests pass,
 * the code is wrong, and nothing can tell you. `makeGraph` therefore leaves most entities
 * unsized, and `SHAPES` covers the cases where the four independent height/socket-Y
 * implementations disagree.
 */

import type { Entity, Edge, Socket } from '../../src/types';

/** mulberry32 — small, fast, and stable across engines. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SOCKET_TYPES = ['float', 'int', 'string', 'image', 'signal'] as const;

export interface FixtureOptions {
  /** Number of entities. */
  count: number;
  /** Seed for every random choice. Same seed => same graph. */
  seed?: number;
  /** Roughly how many edges per entity. */
  edgeRatio?: number;
  /** Sockets per side, per entity. */
  socketsPerSide?: number;
  /**
   * Give every entity an explicit width and height.
   *
   * Default FALSE, which is the honest default: real documents mostly do not set these, and an
   * explicit size is exactly what hides the default-mismatch and auto-height bugs. Set true only
   * when a measurement genuinely needs every box identical (some perf comparisons do).
   */
  explicitSize?: boolean;
  /**
   * Put a value on every input socket, under `data.values`.
   *
   * Default FALSE so every existing law keeps the byte-identical fixture it was written against.
   * It exists because a widget with no value is a degenerate fixture for anything that MEASURES
   * widgets: the GL layer prints a widget's value as MSDF glyphs, and a grid whose sockets are
   * all undefined prints nothing at all — so a glyph-budget measurement taken on it would report
   * that drawing values is free. Real documents carry values; a spike that wants to know what
   * they cost has to ask for them.
   */
  values?: boolean;
  /**
   * Set `animated: true` on every generated edge, so the moving light has something to move on.
   * Default FALSE: a still graph is the fixture every existing law was written against.
   */
  animated?: boolean;
  /**
   * Give socket i the same type on both sides, and connect out-i to in-i.
   *
   * Default FALSE. With random types every generated edge fails the compatibility check and is
   * painted invalid — a fine fixture for counting vertices, a useless one for looking at edges,
   * because the whole graph is red dashes. This makes every edge valid and hued by its type.
   * Positions do not move: the same random draws are consumed either way.
   */
  typed?: boolean;
}

export interface Fixture {
  entities: Entity[];
  edges: Edge[];
}

/**
 * A grid-ish graph with jitter. Grid rather than uniform-random placement so that viewport
 * culling and the quadtree see a realistic spatial distribution instead of an even smear —
 * culling looks far better than it is against uniform noise.
 */
export function makeGraph(opts: FixtureOptions): Fixture {
  const {
    count,
    seed = 1,
    edgeRatio = 0.8,
    socketsPerSide = 3,
    explicitSize = false,
    values = false,
    animated = false,
    typed = false,
  } = opts;
  const rand = rng(seed);

  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const CELL_X = 320;
  const CELL_Y = 220;

  const entities: Entity[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);

    const inputs: Socket[] = [];
    const outputs: Socket[] = [];
    for (let s = 0; s < socketsPerSide; s++) {
      // Both draws happen regardless of `typed` so the position jitter below is unchanged.
      const inType = SOCKET_TYPES[Math.floor(rand() * SOCKET_TYPES.length)];
      const outType = SOCKET_TYPES[Math.floor(rand() * SOCKET_TYPES.length)];
      const pairedType = SOCKET_TYPES[s % SOCKET_TYPES.length];
      inputs.push({
        id: `in-${s}`,
        name: `In ${s}`,
        type: typed ? pairedType : inType,
      } as Socket);
      outputs.push({
        id: `out-${s}`,
        name: `Out ${s}`,
        type: typed ? pairedType : outType,
      } as Socket);
    }

    // One value per input, derived from the socket's own type so each widget kind gets something
    // it can actually print: a slider a fraction, a number an integer, a field a short string.
    const socketValues: Record<string, unknown> = {};
    if (values) {
      for (const socket of inputs) {
        socketValues[socket.id] =
          socket.type === 'float'
            ? Math.round(rand() * 100) / 100
            : socket.type === 'int'
              ? Math.floor(rand() * 100)
              : `v${i}-${socket.id}`;
      }
    }

    const entity: Entity = {
      id: `n${i}`,
      type: 'default',
      position: {
        x: col * CELL_X + Math.round(rand() * 40) - 20,
        y: row * CELL_Y + Math.round(rand() * 40) - 20,
      },
      data: values ? { label: `Node ${i}`, values: socketValues } : { label: `Node ${i}` },
      inputs,
      outputs,
    };
    if (explicitSize) {
      entity.width = 200;
      entity.height = 120;
    }
    entities.push(entity);
  }

  // Connect mostly to nearby nodes: long-range edges are rare in real graphs and they defeat
  // edge culling, which would flatter the renderer in exactly the wrong direction.
  const edges: Edge[] = [];
  const target = Math.floor(count * edgeRatio);
  for (let e = 0; e < target; e++) {
    const from = Math.floor(rand() * count);
    const hop = 1 + Math.floor(rand() * Math.min(6, Math.max(1, cols)));
    const to = (from + hop) % count;
    if (from === to) continue;
    const sourceIndex = Math.floor(rand() * socketsPerSide);
    const targetIndex = Math.floor(rand() * socketsPerSide);
    const edge: Edge = {
      id: `e${e}`,
      source: `n${from}`,
      target: `n${to}`,
      sourceSocket: `out-${sourceIndex}`,
      targetSocket: `in-${typed ? sourceIndex : targetIndex}`,
    };
    if (animated) edge.animated = true;
    edges.push(edge);
  }

  return { entities, edges };
}

/**
 * The shapes where the four independent height/socket-Y implementations disagree.
 *
 * `getEntitySocketLayout` is the source of truth, and `edges.tsx`, `connection-line.tsx`,
 * `minimap.tsx` and `store.ts` each re-derive it with different fallbacks. Every entity here
 * exists because one of those paths gets it wrong — a uniform 200x120 grid agrees everywhere and
 * proves nothing.
 *
 * Laid out in a single row so a screenshot shows them side by side.
 */
export function makeShapes(): Fixture {
  const X = 380;
  let col = 0;
  const at = () => ({ x: col++ * X + 40, y: 60 });

  const entities: Entity[] = [
    {
      // No width, no height. The renderer defaults to DEFAULT_ENTITY_WIDTH (240) while the socket
      // quadtree defaults to 200, so the grabbable socket sits 40px left of the painted one.
      id: 'unsized',
      type: 'default',
      position: at(),
      data: { label: 'Unsized' },
      inputs: [
        { id: 'in-0', name: 'In 0', type: 'float' },
        { id: 'in-1', name: 'In 1', type: 'string' },
      ],
      outputs: [{ id: 'out-0', name: 'Out 0', type: 'float' }],
    },
    {
      // Stacked sockets: label above widget, widget spans the entity. Rows are taller than
      // inline, so any path that assumes a fixed row height puts the endpoint in the wrong place.
      id: 'stacked',
      type: 'default',
      position: at(),
      data: { label: 'Stacked' },
      inputs: [
        { id: 'in-0', name: 'Prompt', type: 'string', layout: 'stacked', widget: 'text' },
        { id: 'in-1', name: 'Scale', type: 'float', layout: 'stacked', widget: 'slider' },
      ],
      outputs: [{ id: 'out-0', name: 'Out 0', type: 'image' }],
    },
    {
      // Multi-row: `rows: 3` makes one socket three widget-heights tall.
      id: 'multirow',
      type: 'default',
      position: at(),
      data: { label: 'Multi-row' },
      inputs: [
        { id: 'in-0', name: 'Body', type: 'string', widget: 'textarea', rows: 3 },
        { id: 'in-1', name: 'Seed', type: 'int' },
      ],
      outputs: [{ id: 'out-0', name: 'Out 0', type: 'string' }],
    },
    {
      // Explicit socket height, which takes precedence over `rows`.
      id: 'sockheight',
      type: 'default',
      position: at(),
      data: { label: 'Socket height' },
      inputs: [
        { id: 'in-0', name: 'Tall', type: 'string', height: 96 },
        { id: 'in-1', name: 'Normal', type: 'float' },
      ],
      outputs: [{ id: 'out-0', name: 'Out 0', type: 'float' }],
    },
    {
      // Explicit socket position (0 = top, 1 = bottom) — bypasses row layout entirely.
      id: 'sockpos',
      type: 'default',
      position: at(),
      data: { label: 'Socket position' },
      inputs: [
        { id: 'in-0', name: 'Top', type: 'float', position: 0.1 },
        { id: 'in-1', name: 'Bottom', type: 'float', position: 0.9 },
      ],
      outputs: [{ id: 'out-0', name: 'Out 0', type: 'float', position: 0.5 }],
    },
    {
      // Wide and short: an explicit size that is NOT the default, so a path that hardcodes either
      // default is wrong in a direction the uniform fixture cannot show.
      id: 'wide',
      type: 'default',
      position: at(),
      data: { label: 'Wide' },
      width: 360,
      height: 90,
      inputs: [{ id: 'in-0', name: 'In 0', type: 'float' }],
      outputs: [{ id: 'out-0', name: 'Out 0', type: 'float' }],
    },
    {
      // No sockets at all: every socket-driven height computation has to handle an empty list.
      id: 'nosockets',
      type: 'default',
      position: at(),
      data: { label: 'No sockets' },
    },
  ];

  // Edges reaching each awkward shape, so endpoint agreement is visible rather than inferred.
  const edges: Edge[] = [
    { id: 'se0', source: 'unsized', target: 'stacked', sourceSocket: 'out-0', targetSocket: 'in-0' },
    { id: 'se1', source: 'stacked', target: 'multirow', sourceSocket: 'out-0', targetSocket: 'in-0' },
    { id: 'se2', source: 'multirow', target: 'sockheight', sourceSocket: 'out-0', targetSocket: 'in-0' },
    { id: 'se3', source: 'sockheight', target: 'sockpos', sourceSocket: 'out-0', targetSocket: 'in-1' },
    { id: 'se4', source: 'sockpos', target: 'wide', sourceSocket: 'out-0', targetSocket: 'in-0' },
  ];

  return { entities, edges };
}

/**
 * Comments — the last persistent-DOM surface in the package.
 *
 * Two of them, because the interesting failures are about IDENTITY rather than count: a comment
 * whose content changes, and a pair where one is swapped for another without the count moving.
 * A single comment cannot distinguish those from "nothing happened".
 */
export function makeComments(): Fixture {
  return {
    entities: [
      {
        id: 'note-a',
        type: 'comment',
        position: { x: 80, y: 80 },
        width: 200,
        height: 120,
        data: { content: 'first note', backgroundColor: '#FFF9C4', textColor: '#424242', fontSize: 14 },
      },
      {
        id: 'note-b',
        type: 'comment',
        position: { x: 340, y: 80 },
        width: 200,
        height: 120,
        data: { content: 'second note', backgroundColor: '#C8E6C9', textColor: '#1B5E20', fontSize: 16 },
      },
    ] as Entity[],
    edges: [],
  };
}

/**
 * One of each media entity, so the three quad-backed renderers can be seen at once.
 *
 * The sources are served by the harness's own static server rather than fetched from anywhere:
 * a law that depends on the network is a law that fails for a reason that has nothing to do with
 * the code. The image is a data URL, the clip and the model are files beside the fixture.
 *
 * `autoplay` is on for the video because a paused clip and a broken clip look identical in a
 * screenshot — the point of this scene is that frames are actually arriving.
 */
export function makeMedia(): Fixture {
  return {
    entities: [
      {
        id: 'media-image',
        type: 'image',
        position: { x: 60, y: 60 },
        width: 240,
        height: 160,
        data: { src: SWATCH_PNG, objectFit: 'cover' },
      },
      {
        id: 'media-video',
        type: 'video',
        position: { x: 340, y: 60 },
        width: 320,
        height: 180,
        data: { src: 'media/test.mp4', autoplay: true, loop: true, objectFit: 'contain' },
      },
      {
        id: 'media-mesh',
        type: 'mesh',
        position: { x: 700, y: 60 },
        width: 240,
        height: 240,
        data: { src: 'media/test.glb' },
      },
      // A plain node behind the video, overlapping it. This is the case that decided video would
      // be a GL quad rather than a DOM element: with a `<video>` in the DOM overlay the clip would
      // cover this node however the stack is ordered, because the overlay is one layer above the
      // whole canvas.
      {
        id: 'media-neighbour',
        type: 'default',
        position: { x: 500, y: 180 },
        width: 220,
        data: {},
        inputs: [{ id: 'n-in', name: 'In', type: 'image' }],
        outputs: [{ id: 'n-out', name: 'Out', type: 'image' }],
      },
    ] as Entity[],
    edges: [],
  };
}

/**
 * A 2x2 checkerboard as a data URL — four pixels, no network, and every corner a different colour
 * so an accidental UV flip is visible rather than plausible.
 */
const SWATCH_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGO4Y2Njs+AOw4cTNlEnKgAtBAab4uZ2GwAAAABJRU5ErkJggg==';

/** A parent/child pair for the collapse and hidden-entity paths. */
export function makeGroup(): Fixture {
  const entities: Entity[] = [
    {
      // `type: 'frame'`, and it is load-bearing rather than cosmetic. `buildCollapsedGroupIds`
      // (core/store.ts) only ever collapses an entity whose type is exactly 'frame', so this
      // container spent its whole life as a `'default'` that could not be collapsed — every law
      // about collapsing read an empty `hiddenEntityIds` and passed on the strength of it. That is
      // the harness blessing a premise the package does not hold, the same shape as the change
      // applier reading `c.item` where the union says `entity`.
      id: 'frame',
      type: 'frame',
      position: { x: 60, y: 60 },
      data: { label: 'Frame' },
      width: 420,
      height: 300,
      collapsed: false,
    },
    {
      id: 'child-a',
      type: 'default',
      position: { x: 100, y: 130 },
      data: { label: 'Child A' },
      parentId: 'frame',
      inputs: [{ id: 'in-0', name: 'In 0', type: 'float' }],
      outputs: [{ id: 'out-0', name: 'Out 0', type: 'float' }],
    },
    {
      id: 'child-b',
      type: 'default',
      position: { x: 100, y: 250 },
      data: { label: 'Child B' },
      parentId: 'frame',
      inputs: [{ id: 'in-0', name: 'In 0', type: 'float' }],
      outputs: [{ id: 'out-0', name: 'Out 0', type: 'float' }],
    },
    {
      id: 'outside',
      type: 'default',
      position: { x: 620, y: 130 },
      data: { label: 'Outside' },
      inputs: [{ id: 'in-0', name: 'In 0', type: 'float' }],
      outputs: [{ id: 'out-0', name: 'Out 0', type: 'float' }],
    },
  ];

  const edges: Edge[] = [
    { id: 'ge0', source: 'child-a', target: 'child-b', sourceSocket: 'out-0', targetSocket: 'in-0' },
    // Crosses the collapse boundary — the case where a hidden endpoint has to be handled.
    { id: 'ge1', source: 'child-b', target: 'outside', sourceSocket: 'out-0', targetSocket: 'in-0' },
  ];

  return { entities, edges };
}

/** The sizes the migration brief asks for, plus a small one for behavior tests. */
export const SCALES = {
  tiny: 12,
  small: 100,
  k1: 1_000,
  k10: 10_000,
  k50: 50_000,
} as const;

/**
 * One entity of each type the built-in toolbar has a configuration for.
 *
 * `toolbar.tsx` keys its content off entity TYPE — text gets eight widgets, image two, comment
 * three — so a single-type scene reaches a third of the file. This is what makes the toolbar
 * measurable at all: before it, the whole component had zero coverage from every browser law in
 * the suite, and it is the file with the largest v1 -> v2 API break.
 */
export function makeToolbarScene(): Fixture {
  return {
    entities: [
      {
        id: 'txt',
        type: 'text',
        position: { x: 80, y: 200 },
        width: 240,
        height: 80,
        data: {
          content: 'toolbar text',
          fontSize: 16,
          fontWeight: 400,
          fontFamily: 'system-ui',
          textAlign: 'left',
          textColor: '#111111',
          lineHeight: 1.4,
          letterSpacing: 0,
          sizingMode: 'auto-height',
        },
      },
      {
        id: 'img',
        type: 'image',
        position: { x: 400, y: 200 },
        width: 200,
        height: 150,
        data: { src: '', objectFit: 'cover', aspectLock: true },
      },
      {
        id: 'note',
        type: 'comment',
        position: { x: 680, y: 200 },
        width: 200,
        height: 120,
        data: { content: 'a note', backgroundColor: '#FFF9C4', textColor: '#424242', fontSize: 14 },
      },
    ] as Entity[],
    edges: [],
  };
}

/**
 * One entity carrying one of every widget kind, wired so a value change round-trips.
 *
 * The graph fixtures elsewhere set no socket values at all, which is why nothing in the suite ever
 * exercised a widget: a widget with no value and no config renders nothing to press.
 */
export function makeWidgets(): Fixture {
  return {
    entities: [
      {
        id: 'w',
        type: 'default',
        position: { x: 120, y: 120 },
        width: 320,
        data: {
          label: 'Widgets',
          values: {
            flag: false,
            amount: 0.2,
            label: 'name',
            count: 3,
            tint: '#8e4ec6',
            mode: 'one',
          },
        },
        inputs: [
          { id: 'flag', name: 'Flag', type: 'boolean' },
          { id: 'amount', name: 'Amount', type: 'float', min: 0, max: 1, step: 0.01 },
          { id: 'label', name: 'Label', type: 'string' },
          { id: 'count', name: 'Count', type: 'int', min: 0, max: 10, step: 1 },
          { id: 'tint', name: 'Tint', type: 'color' },
          { id: 'mode', name: 'Mode', type: 'enum', options: ['one', 'two', 'three'] },
        ],
        outputs: [{ id: 'out', name: 'Out', type: 'float' }],
      },
    ] as Entity[],
    edges: [],
  };
}
