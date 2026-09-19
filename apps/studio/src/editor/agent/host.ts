/**
 * The agent's browser tools, answered against the live graph: the one on screen, with the person's
 * unsaved edits, through the same op door the node library uses, so an agent's change is one undo
 * step like any other.
 *
 * None of it lives in React state. The host reads the graph and the engine through getters, so the
 * editor does not re-render while the agent works and the canvas keeps its frame rate.
 */

import type { Edge, Entity, KookieFlowInstance } from '@kushagradhawan/kookie-flow';
import {
  compileOps,
  describeGraph,
  formatUsd,
  isMediaRef,
  layoutCluster,
  registry,
  type CompiledOps,
  type GraphOp,
  type MediaRef,
} from 'studio-core';
import type { ApplyOpsOutput, EstimateOutput, InspectOutput, PendingAsk, RunOutput } from '@/shared/agent';
import type { EditorBus } from '../editor-bus';
import { quoteNode } from '../quote';

/** How long a run waits for what feeds it to settle before deciding it is blocked. */
const UPSTREAM_WAIT_MS = 15_000;
const POLL_MS = 250;

export interface AgentHostDeps {
  graph: () => { entities: Entity[]; edges: Edge[] };
  flow: () => KookieFlowInstance | null;
  bus: EditorBus;
  applyOps: (ops: GraphOp[]) => CompiledOps;
}

export interface AgentHost {
  readGraph(focus: string[]): string;
  applyOps(ops: GraphOp[]): ApplyOpsOutput;
  estimate(nodes: string[]): EstimateOutput;
  run(nodes: string[]): Promise<RunOutput>;
  inspect(node: string, socket?: string): InspectOutput & { url?: string };
  /** Put attached pictures on the canvas as Picture nodes; their ids, for the message. */
  addPictures(pictures: PendingAsk['pictures']): string[];
  /** Resolves once the canvas is up and has brought its saved results back, or after a wait. */
  ready(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function labelOf(entity: Entity): string {
  const own = (entity.data as { label?: unknown }).label;
  return typeof own === 'string' && own ? own : (registry.get(entity.type)?.label ?? entity.type);
}

function short(value: unknown): string {
  if (isMediaRef(value)) return `<${value.kind} ${value.width}x${value.height}>`;
  if (typeof value === 'string') return JSON.stringify(value.length > 60 ? `${value.slice(0, 57)}...` : value);
  return JSON.stringify(value) ?? String(value);
}

/** Every node that feeds these, however far up. */
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

export function createAgentHost({ graph, flow, bus, applyOps }: AgentHostDeps): AgentHost {
  const hasOutput = (entity: Entity): boolean => {
    const def = registry.get(entity.type);
    const f = flow();
    return Boolean(def && f && Object.keys(def.outputs).some((id) => f.getSocketValue(entity.id, id) !== undefined));
  };

  const statusOf = (entity: Entity): string => {
    const f = flow();
    const status = f?.getEvaluationStatus(entity.id) ?? 'idle';
    // The engine returns a settled node to idle; having produced something is what tells "done" apart.
    return status === 'idle' && hasOutput(entity) ? 'done' : status;
  };

  const settle = async (ids: readonly string[], limitMs: number, until: (status: string) => boolean) => {
    const started = Date.now();
    while (Date.now() - started < limitMs) {
      const byId = new Map(graph().entities.map((e) => [e.id, e]));
      const waiting = ids.some((id) => {
        const entity = byId.get(id);
        return entity ? !until(statusOf(entity)) : false;
      });
      if (!waiting) return;
      await sleep(POLL_MS);
    }
  };

  return {
    readGraph(focus) {
      const { entities, edges } = graph();
      const lines = [describeGraph({ entities, edges }, registry, focus)];
      const f = flow();
      const runs: string[] = [];
      for (const entity of entities) {
        const def = registry.get(entity.type);
        const status = statusOf(entity);
        const parts: string[] = [];
        if (def && f) {
          for (const id of Object.keys(def.outputs)) {
            const value = f.getSocketValue(entity.id, id);
            if (value !== undefined) parts.push(`${id}=${short(value)}`);
          }
        }
        const message = bus.message(entity.id);
        if (status === 'idle' && parts.length === 0) continue;
        runs.push(`${entity.id} ${status}${parts.length ? ` ${parts.join(' ')}` : ''}${message ? ` (${message})` : ''}`);
      }
      if (runs.length) lines.push('', 'Runs:', ...runs);
      if (bus.selected.length) lines.push('', `Selected: ${bus.selected.join(', ')}`);
      return lines.join('\n');
    },

    applyOps(ops) {
      const placed = layoutCluster(graph(), ops, registry);
      // All or nothing. Applied in part, a batch leaves later ops naming nodes that never landed and a
      // half-built cluster the model then patches around (the first real run: 5 nodes in, 8 refused).
      const check = compileOps(graph(), placed, registry, { sizeOf: (e) => flow()?.getEntityBounds(e.id) ?? null });
      if (check.errors.length) {
        return { created: [], errors: check.errors.map((e) => ({ index: e.index, message: e.message })) };
      }
      const result = applyOps(placed);
      // Bring what was made into view, as a person adding a node would see it land. After two frames:
      // the new nodes reach the canvas's store on the render after this, and a fit before then fits
      // nothing.
      // An arrange moves everything, so everything is what comes into view.
      const arranged = placed.some((op) => op.op === 'arrange' && !op.ids);
      if (result.created.length || arranged) {
        const entities = arranged ? undefined : result.created;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => flow()?.fitView({ entities, padding: 160, duration: 300, maxZoom: 1 }))
        );
      }
      return { created: result.created, errors: result.errors.map((e) => ({ index: e.index, message: e.message })) };
    },

    estimate(nodes) {
      const { entities, edges } = graph();
      const byId = new Map(entities.map((e) => [e.id, e]));
      const rows: EstimateOutput['nodes'] = [];
      for (const id of nodes) {
        const entity = byId.get(id);
        if (!entity) continue;
        const micros = quoteNode(entity, edges, flow())?.total ?? 0;
        rows.push({ id, label: labelOf(entity), micros, price: formatUsd(micros) });
      }
      const totalMicros = rows.reduce((sum, r) => sum + r.micros, 0);
      return { nodes: rows, totalMicros, total: formatUsd(totalMicros) };
    },

    async run(nodes) {
      const f = flow();
      const { entities, edges } = graph();
      const byId = new Map(entities.map((e) => [e.id, e]));
      const targets = nodes.filter((id) => byId.has(id));
      if (!f || targets.length === 0) return { nodes: [] };

      // Only what costs money is started here. Everything else runs by itself when its inputs change,
      // and starting it again sends its output on afresh, which cancels the paid runs it feeds: asked
      // for Prompt, Draft 1 and Draft 2 together, the drafts were cancelled and the tool waited on them
      // for good (the first run against a real model, 2026-09-17).
      const paid = targets.filter((id) => {
        const entity = byId.get(id);
        return entity ? registry.get(entity.type)?.evaluation === 'manual' : false;
      });
      const out: RunOutput['nodes'] = [];

      // In waves, so a paid node fed by another paid node in the same ask starts after that one ends.
      let pending = paid;
      while (pending.length) {
        const waiting = new Set(pending);
        const wave = pending.filter((id) => ![...upstreamOf(edges, [id])].some((u) => waiting.has(u)));
        // What feeds this wave settles first: a pick just set is still passing its picture on.
        const upstream = [...upstreamOf(edges, wave)].filter((id) => !waiting.has(id));
        await settle(upstream, UPSTREAM_WAIT_MS, (s) => s !== 'running');

        const runnable: string[] = [];
        for (const id of wave) {
          const entity = byId.get(id);
          if (!entity) continue;
          // A node behind something unfinished would run on an empty input: a final before its pick.
          const blocker = [...upstreamOf(edges, [id])]
            .map((u) => graph().entities.find((e) => e.id === u))
            .find((u) => u && ['error', 'dirty', 'idle', 'blocked'].includes(statusOf(u)));
          if (blocker) {
            const why = bus.message(blocker.id);
            out.push({
              id,
              label: labelOf(entity),
              status: 'blocked',
              error: `waiting on ${blocker.id} (${labelOf(blocker)})${why ? `: ${why}` : ''}`,
            });
          } else {
            runnable.push(id);
          }
        }

        // `evaluate` resolves when the run ends, however it ends.
        await Promise.all(runnable.map((id) => f.evaluate(id)));
        for (const id of runnable) {
          const entity = graph().entities.find((e) => e.id === id);
          if (!entity) continue;
          const status = statusOf(entity);
          const error = bus.message(id);
          if (status === 'dirty') {
            out.push({ id, label: labelOf(entity), status: 'stopped', error: 'its inputs changed while it ran; run it again' });
          } else {
            out.push({ id, label: labelOf(entity), status: status === 'idle' ? 'done' : status, ...(status === 'error' && error ? { error } : {}) });
          }
        }
        pending = pending.filter((id) => !wave.includes(id));
      }

      // Free nodes asked for are reported as they stand, once they settle.
      const free = targets.filter((id) => !paid.includes(id));
      await settle(free, UPSTREAM_WAIT_MS, (s) => s !== 'running');
      for (const id of free) {
        const entity = graph().entities.find((e) => e.id === id);
        if (!entity) continue;
        const status = statusOf(entity);
        const error = bus.message(id);
        out.push({ id, label: labelOf(entity), status: status === 'idle' ? 'done' : status, ...(status === 'error' && error ? { error } : {}) });
      }
      return { nodes: out };
    },

    inspect(node, socket) {
      const entity = graph().entities.find((e) => e.id === node);
      const def = entity ? registry.get(entity.type) : undefined;
      const f = flow();
      if (!entity || !def || !f) return { node, error: `There is no node ${node}.` };
      const socketId =
        socket ?? Object.entries(def.outputs).find(([, spec]) => spec.type === 'image' || spec.type === 'mask')?.[0];
      if (!socketId) return { node, error: `${node} makes no picture.` };
      const value = f.getSocketValue(node, socketId);
      if (!isMediaRef(value)) return { node, error: `${node} has not made anything yet.` };
      if (value.kind === 'video') return { node, error: 'Clips cannot be looked at yet, only pictures.' };
      return {
        node,
        socket: socketId,
        hash: value.hash,
        mime: value.mime ?? 'image/png',
        width: value.width,
        height: value.height,
        url: value.url,
      };
    },

    async ready() {
      const started = Date.now();
      let quiet = 0;
      while (Date.now() - started < UPSTREAM_WAIT_MS) {
        const f = flow();
        const busy = !f || graph().entities.some((e) => ['running', 'dirty'].includes(f.getEvaluationStatus(e.id)));
        quiet = busy ? 0 : quiet + POLL_MS;
        if (quiet >= 500) return;
        await sleep(POLL_MS);
      }
    },

    addPictures(pictures) {
      if (pictures.length === 0) return [];
      const ops: GraphOp[] = pictures.map((p, i) => {
        const image: MediaRef = { kind: 'image', hash: p.hash, width: p.width, height: p.height, url: p.url, preview: p.url, mime: p.mime };
        return { op: 'add_node', type: 'source/image', label: pictures.length > 1 ? `Picture ${i + 1}` : 'Picture', values: { image } };
      });
      return this.applyOps(ops).created;
    },
  };
}
