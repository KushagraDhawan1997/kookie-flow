/**
 * Deterministic graph fixtures.
 *
 * Seeded, never Math.random: a perf number that moves because the fixture moved is not a
 * measurement, and a behavior test that fails one run in twenty teaches people to re-run it.
 * Same seed and same count always produce byte-identical entities and edges.
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
  const { count, seed = 1, edgeRatio = 0.8, socketsPerSide = 3 } = opts;
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
      inputs.push({
        id: `in-${s}`,
        name: `In ${s}`,
        type: SOCKET_TYPES[Math.floor(rand() * SOCKET_TYPES.length)],
      } as Socket);
      outputs.push({
        id: `out-${s}`,
        name: `Out ${s}`,
        type: SOCKET_TYPES[Math.floor(rand() * SOCKET_TYPES.length)],
      } as Socket);
    }

    entities.push({
      id: `n${i}`,
      type: 'default',
      position: {
        x: col * CELL_X + Math.round(rand() * 40) - 20,
        y: row * CELL_Y + Math.round(rand() * 40) - 20,
      },
      data: { label: `Node ${i}` },
      width: 200,
      height: 120,
      inputs,
      outputs,
    });
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
    edges.push({
      id: `e${e}`,
      source: `n${from}`,
      target: `n${to}`,
      sourceSocket: `out-${Math.floor(rand() * socketsPerSide)}`,
      targetSocket: `in-${Math.floor(rand() * socketsPerSide)}`,
    });
  }

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
