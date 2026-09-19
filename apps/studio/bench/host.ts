/**
 * The bench's canvas: a graph document with the same tools the editor gives the agent, away from any
 * browser.
 *
 * WHY NOT THE REAL HOST. `editor/agent/host.ts` answers against a live canvas — the flow store, the
 * evaluator, a person pressing Run. What the agent sees through it is text: a description of the
 * graph, the ops it sent back with their errors, a price, a run's statuses, a picture. All of that can
 * be produced from a document, and this does, with the same functions the app uses (`describeGraph`,
 * `applyOpsToDocument`, `estimateModelMicros`, `withFee`). So the model's side of the conversation is
 * faithful while nothing is rendered and nothing is spent.
 *
 * WHAT IS NOT FAITHFUL, and must be remembered when reading results:
 * - A run produces a picture from the store instead of a new one. Pictures already paid for stand in,
 *   so `inspect` costs real image tokens, but the agent cannot judge whether the prompt worked.
 * - Approval is a policy, not a person. The task says what the person would press.
 * - Heights are estimated, as they are on the server; the canvas measures them for real.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Edge, Entity } from '@kushagradhawan/kookie-flow';
import {
  applyOpsToDocument,
  describeGraph,
  emptyDocument,
  estimateModelMicros,
  formatUsd,
  registry,
  TASK_BY_NODE_TYPE,
  valueBag,
  withFee,
  type GraphDocument,
  type GraphOp,
  type MediaRef,
} from 'studio-core';

export interface RunRecord {
  nodes: string[];
  micros: number;
  approved: boolean;
}

export interface HostState {
  doc: GraphDocument;
  /** What each node's outputs hold, as the evaluator would after a run. */
  outputs: Map<string, Record<string, unknown>>;
  runs: RunRecord[];
  /** Ops refused by the compiler, in order, for the report. */
  refusals: string[];
  opsSent: number;
}

/** Pictures a run hands back: already stored, already paid for, so looking costs real tokens. */
export interface BenchPicture {
  hash: string;
  mime: string;
  width: number;
  height: number;
}

export interface BenchHostOptions {
  /** Where the blobs live; a run's picture is read from here for `inspect`. */
  blobsDir: string;
  pictures: readonly BenchPicture[];
  /** The graph the person already had open. */
  startDoc?: GraphDocument;
  /** What the person presses when the agent asks to spend. */
  approve?: (run: { nodes: string[]; micros: number; index: number }) => boolean;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function pictureOf(state: HostState, entity: Entity, socket: string): MediaRef | null {
  const held = state.outputs.get(entity.id)?.[socket];
  return held !== null && typeof held === 'object' && 'hash' in (held as object) ? (held as MediaRef) : null;
}

/** Every node feeding these, however far up — the same walk the editor's host makes before a run. */
function upstreamOf(edges: readonly Edge[], ids: readonly string[]): Set<string> {
  const into = new Map<string, string[]>();
  for (const e of edges) {
    const list = into.get(e.target);
    if (list) list.push(e.source);
    else into.set(e.target, [e.source]);
  }
  const seen = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop() as string;
    for (const source of into.get(id) ?? []) {
      if (!seen.has(source)) {
        seen.add(source);
        stack.push(source);
      }
    }
  }
  return seen;
}

export class BenchHost {
  readonly state: HostState;
  private readonly options: BenchHostOptions;
  private picked = 0;

  constructor(options: BenchHostOptions) {
    this.options = options;
    this.state = {
      doc: options.startDoc ?? emptyDocument(),
      outputs: new Map(),
      runs: [],
      refusals: [],
      opsSent: 0,
    };
  }

  private entity(id: string): Entity | undefined {
    return this.state.doc.entities.find((e) => e.id === id);
  }

  private label(entity: Entity): string {
    const own = (entity.data as { label?: unknown }).label;
    return typeof own === 'string' && own ? own : (registry.get(entity.type)?.label ?? entity.type);
  }

  /** A node's inputs as the engine resolves them: a wired one reads its source's output. */
  private resolved(entity: Entity): Record<string, unknown> {
    const def = registry.get(entity.type);
    if (!def) return {};
    const values = valueBag(entity);
    const out: Record<string, unknown> = {};
    for (const [id, spec] of Object.entries(def.inputs)) {
      const edge = this.state.doc.edges.find((e) => e.target === entity.id && e.targetSocket === id);
      out[id] = edge?.sourceSocket
        ? this.state.outputs.get(edge.source)?.[edge.sourceSocket]
        : (values[id] ?? spec.default);
    }
    return out;
  }

  private micros(entity: Entity): number | null {
    const task = TASK_BY_NODE_TYPE[entity.type];
    if (!task) return null;
    const model = estimateModelMicros(task, this.resolved(entity));
    return model === undefined ? null : withFee(model).total;
  }

  /** `logic/pick` with no choice holds everything downstream, as the engine does. */
  private blockedBy(ids: readonly string[]): string | null {
    for (const id of upstreamOf(this.state.doc.edges, ids)) {
      const entity = this.entity(id);
      if (!entity || entity.type !== 'logic/pick') continue;
      const choice = valueBag(entity).choice;
      if (choice === undefined || choice === null || choice === '') return id;
    }
    return null;
  }

  readGraph(focus: string[] = []): string {
    const { entities, edges } = this.state.doc;
    const lines = [describeGraph({ entities, edges }, registry, focus)];
    const runs: string[] = [];
    for (const entity of entities) {
      const held = this.state.outputs.get(entity.id);
      if (!held) continue;
      const parts = Object.entries(held).map(([socket, value]) =>
        value !== null && typeof value === 'object' && 'width' in (value as object)
          ? `${socket}=<image ${(value as MediaRef).width}x${(value as MediaRef).height}>`
          : `${socket}=${JSON.stringify(value)}`
      );
      runs.push(`${entity.id} done ${parts.join(' ')}`);
    }
    if (runs.length) lines.push('', 'Runs:', ...runs);
    return lines.join('\n');
  }

  applyOps(ops: GraphOp[]) {
    this.state.opsSent += ops.length;
    const applied = applyOpsToDocument(this.state.doc, ops, registry);
    if (applied.errors.length) {
      for (const error of applied.errors) this.state.refusals.push(error.message);
      return { created: [], errors: applied.errors.map((e) => ({ index: e.index, message: e.message })) };
    }
    this.state.doc = applied.doc;
    return { created: applied.created, errors: [] };
  }

  estimate(nodes: string[]) {
    const rows: Array<{ id: string; label: string; micros: number; price: string }> = [];
    let total = 0;
    for (const id of nodes) {
      const entity = this.entity(id);
      if (!entity) continue;
      const micros = this.micros(entity) ?? 0;
      total += micros;
      rows.push({ id, label: this.label(entity), micros, price: formatUsd(micros) });
    }
    return { nodes: rows, totalMicros: total, total: formatUsd(total) };
  }

  run(nodes: string[]) {
    const quote = this.estimate(nodes);
    const index = this.state.runs.length;
    const approved = this.options.approve?.({ nodes, micros: quote.totalMicros, index }) ?? true;
    this.state.runs.push({ nodes, micros: quote.totalMicros, approved });
    if (!approved) return { declined: true, nodes: [] };

    const blocked = this.blockedBy(nodes);
    const rows = nodes.map((id) => {
      const entity = this.entity(id);
      if (!entity) return { id, label: id, status: 'error', error: `no node "${id}"` };
      if (blocked) return { id, label: this.label(entity), status: 'blocked', error: `waiting on the pick at ${blocked}` };
      const def = registry.get(entity.type);
      const held: Record<string, unknown> = {};
      for (const [socket, spec] of Object.entries(def?.outputs ?? {})) {
        if (spec.type === 'image' || spec.type === 'mask' || spec.type === 'video') {
          const picture = this.options.pictures[this.picked++ % this.options.pictures.length];
          held[socket] = {
            kind: spec.type === 'video' ? 'video' : 'image',
            hash: picture.hash,
            mime: picture.mime,
            width: picture.width,
            height: picture.height,
            url: `/api/blob/${picture.hash}`,
            preview: `/api/blob/${picture.hash}`,
          } satisfies MediaRef;
        }
      }
      this.state.outputs.set(entity.id, { ...this.state.outputs.get(entity.id), ...held });
      return { id, label: this.label(entity), status: 'done' };
    });
    return { nodes: rows };
  }

  inspect(node: string, socket?: string) {
    const entity = this.entity(node);
    if (!entity) return { node, error: `no node "${node}"` };
    const def = registry.get(entity.type);
    const which =
      socket ?? Object.entries(def?.outputs ?? {}).find(([, s]) => s.type === 'image' || s.type === 'mask')?.[0];
    if (!which) return { node, error: 'that node makes no picture' };
    const picture = pictureOf(this.state, entity, which);
    if (!picture) return { node, error: 'nothing has been made there yet' };
    return { node, socket: which, hash: picture.hash, mime: picture.mime, width: picture.width, height: picture.height };
  }

  /** The bytes behind an inspected picture, for the model. */
  pictureBytes(hash: string, mime: string): Uint8Array | null {
    const file = path.join(this.options.blobsDir, `${hash}.${EXT[mime] ?? 'png'}`);
    try {
      return new Uint8Array(fs.readFileSync(file));
    } catch {
      return null;
    }
  }
}
