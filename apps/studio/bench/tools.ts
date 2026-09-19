/**
 * The agent's tools for the bench: the app's own schemas and descriptions (`AGENT_TOOLS`), each with
 * an `execute` that answers from a document instead of from a canvas and a server.
 *
 * ONE DIFFERENCE FROM THE APP, and it is about plumbing rather than about what the model sees: in the
 * app a browser tool ends the HTTP step and the editor answers it in the next request, while here
 * every tool answers in place and the SDK carries the loop on. Either way each model call re-sends the
 * conversation so far, so tokens, calls and cost are counted the same.
 *
 * `inspect` turns into a real picture through `toModelOutput`, exactly as `server/agent/tools.ts`
 * does, so a look costs what a look costs.
 */

import { jsonSchema, tool, type ToolSet } from 'ai';
import {
  AGENT_TOOLS,
  applyOpsToDocument,
  emptyDocument,
  registry,
  searchCatalog,
  type GraphDocument,
  type GraphOp,
} from 'studio-core';
import type { BenchHost } from './host';

export interface ToolTrace {
  name: string;
  /** Characters of input the model wrote, and of the answer it got back. */
  inChars: number;
  outChars: number;
  ops?: number;
  refused?: number;
}

export interface BenchTools {
  tools: ToolSet;
  trace: ToolTrace[];
  /** Graphs the agent started beside the open one. */
  created: Array<{ name: string; doc: GraphDocument }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function opsFrom(value: unknown): GraphOp[] {
  if (!Array.isArray(value)) return [];
  return value.filter((op): op is GraphOp => isRecord(op) && typeof op.op === 'string');
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function isPicture(value: unknown): value is { node: string; socket: string; hash: string; mime: string; width: number; height: number } {
  return isRecord(value) && typeof value.hash === 'string' && typeof value.mime === 'string';
}

export function benchTools(host: BenchHost, options: { images: boolean }): BenchTools {
  const trace: ToolTrace[] = [];
  const created: Array<{ name: string; doc: GraphDocument }> = [];

  const answer = (name: string, input: unknown, output: unknown, extra: Partial<ToolTrace> = {}) => {
    trace.push({
      name,
      inChars: JSON.stringify(input ?? {}).length,
      outChars: JSON.stringify(output ?? {}).length,
      ...extra,
    });
    return output;
  };

  const run: Record<string, (input: Record<string, unknown>) => unknown> = {
    read_graph: (input) => answer('read_graph', input, host.readGraph(strings(input.focus))),

    apply_ops: (input) => {
      const ops = opsFrom(input.ops);
      const result = host.applyOps(ops);
      return answer('apply_ops', input, result, { ops: ops.length, refused: result.errors.length });
    },

    estimate: (input) => answer('estimate', input, host.estimate(strings(input.nodes))),

    run: (input) => answer('run', input, host.run(strings(input.nodes))),

    inspect: (input) =>
      answer('inspect', input, host.inspect(String(input.node ?? ''), typeof input.socket === 'string' ? input.socket : undefined)),

    search_nodes: (input) => answer('search_nodes', input, searchCatalog(registry, String(input.query ?? ''))),

    list_graphs: (input) => answer('list_graphs', input, []),

    create_graph: (input) => {
      const name = String(input.name ?? '').trim().slice(0, 120) || 'Untitled';
      const applied = applyOpsToDocument(emptyDocument(), opsFrom(input.ops), registry);
      if (applied.errors.length) {
        return answer('create_graph', input, { errors: applied.errors.map((e) => ({ index: e.index, message: e.message })) }, {
          refused: applied.errors.length,
        });
      }
      created.push({ name, doc: applied.doc });
      const id = `b${created.length}`;
      return answer('create_graph', input, { id, name, url: `/g/${id}`, created: applied.created, errors: [] });
    },
  };

  const tools: ToolSet = {};
  for (const spec of AGENT_TOOLS) {
    const execute = run[spec.name];
    if (!execute) continue;
    tools[spec.name] =
      spec.name === 'inspect'
        ? tool({
            description: spec.description,
            inputSchema: jsonSchema<Record<string, unknown>>(spec.inputSchema),
            execute: (input: Record<string, unknown>) => execute(input),
            toModelOutput: ({ output }: { output: unknown }) => {
              if (!isPicture(output)) {
                const reason = isRecord(output) && typeof output.error === 'string' ? output.error : 'There is no picture to look at.';
                return { type: 'text', value: reason };
              }
              const caption = `${output.node}.${output.socket}: ${output.width} × ${output.height}`;
              const bytes = options.images ? host.pictureBytes(output.hash, output.mime) : null;
              if (!bytes) return { type: 'text', value: `${caption}. The picture could not be shown to you.` };
              return {
                type: 'content',
                value: [
                  { type: 'text', text: caption },
                  { type: 'file', data: { type: 'data', data: bytes }, mediaType: output.mime },
                ],
              };
            },
          })
        : tool({
            description: spec.description,
            inputSchema: jsonSchema<Record<string, unknown>>(spec.inputSchema),
            execute: (input: Record<string, unknown>) => execute(input),
          });
  }

  return { tools, trace, created };
}
