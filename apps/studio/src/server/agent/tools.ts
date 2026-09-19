/**
 * The agent's tools as the AI SDK takes them, built per request so the server tools act for the person
 * asking.
 *
 * The schemas and descriptions come from `studio-core` (`AGENT_TOOLS`). Browser tools get no
 * `execute`: the call ends the step and the editor answers it. `inspect` is answered in the browser
 * too, with a stored picture's hash, and turned into the picture itself here, on its way back to the
 * model, because the bytes are on the server and the model is called from here.
 */

import { jsonSchema, tool, type ToolSet } from 'ai';
import {
  AGENT_TOOLS,
  applyOpsToDocument,
  emptyDocument,
  registry,
  searchCatalog,
  type AgentModel,
  type GraphOp,
} from 'studio-core';
import type { InspectOutput } from '@/shared/agent';
import { createGraph, listGraphs } from '../graphs';
import { getStorage, storageKey } from '../storage';

/** A picture sent to the model is capped: a larger one goes as a description instead. */
const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

export interface AgentToolContext {
  workspaceId: string;
  model: AgentModel;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInspectPicture(value: unknown): value is Extract<InspectOutput, { hash: string }> {
  return isRecord(value) && typeof value.hash === 'string' && typeof value.mime === 'string';
}

/** Ops as the model sent them, kept only where they have an `op`; the compiler checks the rest. */
function opsFrom(value: unknown): GraphOp[] {
  if (!Array.isArray(value)) return [];
  return value.filter((op): op is GraphOp => isRecord(op) && typeof op.op === 'string');
}

async function readPicture(hash: string, mime: string): Promise<Uint8Array | null> {
  const file = await getStorage().open(storageKey(hash, mime));
  if (!file || file.size > MAX_PICTURE_BYTES) return null;
  return new Uint8Array(await new Response(file.body()).arrayBuffer());
}

export function agentTools(context: AgentToolContext): ToolSet {
  const server: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {
    search_nodes: async (input) => searchCatalog(registry, String(input.query ?? '')),

    list_graphs: async () => {
      const graphs = await listGraphs(context.workspaceId);
      return graphs.slice(0, 20).map((g) => ({ id: g.id, name: g.name, nodes: g.nodeCount, updated: g.updatedAt }));
    },

    create_graph: async (input) => {
      const name = String(input.name ?? '').trim().slice(0, 120) || 'Untitled';
      const applied = applyOpsToDocument(emptyDocument(), opsFrom(input.ops), registry);
      // A refused op makes nothing, so a retry does not leave a half-built graph behind.
      if (applied.errors.length) return { errors: applied.errors.map((e) => ({ index: e.index, message: e.message })) };
      const row = await createGraph(name, context.workspaceId, applied.doc);
      return {
        id: row.id,
        name: row.name,
        url: `/g/${row.id}`,
        created: applied.created,
        errors: applied.errors.map((e) => ({ index: e.index, message: e.message })),
      };
    },
  };

  const tools: ToolSet = {};
  for (const spec of AGENT_TOOLS) {
    const run = server[spec.name];
    if (spec.where === 'server' && run) {
      tools[spec.name] = tool({
        description: spec.description,
        inputSchema: jsonSchema<Record<string, unknown>>(spec.inputSchema),
        execute: (input) => run(input),
      });
    } else if (spec.name === 'inspect') {
      tools[spec.name] = tool({
        description: spec.description,
        inputSchema: jsonSchema<Record<string, unknown>>(spec.inputSchema),
        toModelOutput: async ({ output }) => {
          if (!isInspectPicture(output)) {
            const reason = isRecord(output) && typeof output.error === 'string' ? output.error : 'There is no picture to look at.';
            return { type: 'text', value: reason };
          }
          const caption = `${output.node}.${output.socket}: ${output.width} × ${output.height}`;
          const bytes = context.model.images ? await readPicture(output.hash, output.mime) : null;
          if (!bytes) return { type: 'text', value: `${caption}. The picture could not be shown to you.` };
          return {
            type: 'content',
            value: [
              { type: 'text', text: caption },
              { type: 'file', data: { type: 'data', data: bytes }, mediaType: output.mime },
            ],
          };
        },
      });
    } else {
      tools[spec.name] = tool({
        description: spec.description,
        inputSchema: jsonSchema<Record<string, unknown>>(spec.inputSchema),
      });
    }
  }
  return tools;
}
