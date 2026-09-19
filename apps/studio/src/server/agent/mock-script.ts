/**
 * The mock agent's script. With no gateway key (or `STUDIO_AGENT=mock`) the route thinks with this
 * instead of a model, so the whole loop runs for nothing: a question for a short ask, then drafts, a
 * pick, a final, each step through the real tools and the real approval.
 *
 * It follows the harness rather than being clever, and reads only what a tool answered, so a test can
 * walk it turn by turn. Pure.
 */

export interface MockHistory {
  /** The latest message from the person. */
  userText: string;
  /** How many messages the person has sent in the conversation. */
  userMessages: number;
  /** Tool answers since that message, oldest first. */
  results: Array<{ name: string; output: unknown }>;
}

export interface MockTurn {
  text?: string;
  calls?: Array<{ name: string; input: Record<string, unknown> }>;
}

const PICK_REPLY = /\b(1|2|one|two|first|second)\b/i;

function choiceOf(text: string): '1' | '2' {
  return /\b(2|two|second)\b/i.test(text) ? '2' : '1';
}

function highestNodeNumber(graph: string): number {
  let max = 0;
  for (const m of graph.matchAll(/^n(\d+) /gm)) max = Math.max(max, Number(m[1]));
  return max;
}

function outputOf(results: MockHistory['results'], name: string): unknown {
  for (let i = results.length - 1; i >= 0; i--) {
    const result = results[i];
    if (result?.name === name) return result.output;
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The ops for drafts, a pick and a final, numbered after what is already on the canvas. */
function draftOps(ask: string, after: number) {
  const id = (k: number) => `n${after + k}`;
  const [brief, d1, d2, pick, final] = [id(1), id(2), id(3), id(4), id(5)];
  return {
    drafts: [d1, d2],
    ops: [
      { op: 'add_node', id: brief, type: 'source/text', label: 'Brief', values: { text: ask } },
      { op: 'add_node', id: d1, type: 'ai/gpt-image-2.5', label: 'Draft 1', values: { quality: 'low', size: 'square_hd' } },
      { op: 'add_node', id: d2, type: 'ai/gpt-image-2.5', label: 'Draft 2', values: { quality: 'low', size: 'square_hd', reroll: 1 } },
      { op: 'add_node', id: pick, type: 'logic/pick', label: 'Pick' },
      { op: 'add_node', id: final, type: 'ai/gpt-image-2.5', label: 'Final', values: { quality: 'high' } },
      { op: 'connect', from: `${brief}.out`, to: `${d1}.prompt` },
      { op: 'connect', from: `${brief}.out`, to: `${d2}.prompt` },
      { op: 'connect', from: `${d1}.image`, to: `${pick}.a` },
      { op: 'connect', from: `${d2}.image`, to: `${pick}.b` },
      { op: 'connect', from: `${brief}.out`, to: `${final}.prompt` },
      { op: 'connect', from: `${pick}.picked`, to: `${final}.image` },
    ],
  };
}

export function nextMockTurn(history: MockHistory): MockTurn {
  const { userText, results } = history;
  const graph = String(outputOf(results, 'read_graph') ?? '');
  const last = results[results.length - 1];

  if (!last) return { calls: [{ name: 'read_graph', input: {} }] };

  const pickId = /^(n\d+) logic\/pick/m.exec(graph)?.[1];
  const finalId = /^(n\d+) ai\/gpt-image-2\.5 "Final"/m.exec(graph)?.[1];
  const finishing = Boolean(pickId && finalId && PICK_REPLY.test(userText));

  switch (last.name) {
    case 'read_graph': {
      if (finishing && pickId) {
        return { calls: [{ name: 'apply_ops', input: { ops: [{ op: 'set_values', id: pickId, values: { choice: choiceOf(userText) } }] } }] };
      }
      if (history.userMessages === 1 && userText.trim().split(/\s+/).length <= 3) {
        return {
          text: 'Before I build anything:\n1. What is it for?\n2. Is it a concept, a mock-up or a real product?\n3. Any style or colours to keep?',
        };
      }
      return { calls: [{ name: 'search_nodes', input: { query: 'pick' } }] };
    }
    case 'search_nodes': {
      const { ops } = draftOps(userText, highestNodeNumber(graph));
      return { calls: [{ name: 'apply_ops', input: { ops } }] };
    }
    case 'apply_ops': {
      const out = record(last.output);
      const created = strings(out.created);
      if (finishing && finalId) return { calls: [{ name: 'estimate', input: { nodes: [finalId] } }] };
      const drafts = created.slice(1, 3);
      if (drafts.length < 2) return { text: 'I could not build the drafts. The canvas refused the change.' };
      return { calls: [{ name: 'estimate', input: { nodes: drafts } }] };
    }
    case 'estimate': {
      const out = record(last.output);
      const nodes = out.nodes;
      const ids = Array.isArray(nodes) ? nodes.map((n) => String(record(n).id)) : [];
      const what = finishing ? 'The final' : 'Two drafts';
      return { text: `${what}, about ${String(out.total ?? '')}.`, calls: [{ name: 'run', input: { nodes: ids } }] };
    }
    case 'run': {
      const out = record(last.output);
      if (out.declined) return { text: 'Nothing ran. Tell me when you want to go ahead.' };
      const nodes = Array.isArray(out.nodes) ? out.nodes.map(record) : [];
      const failed = nodes.find((n) => n.status === 'error');
      if (failed) return { text: `${String(failed.label ?? failed.id)} failed: ${String(failed.error ?? 'no reason given')}.` };
      const first = nodes[0];
      return { calls: [{ name: 'inspect', input: { node: String(first?.id ?? '') } }] };
    }
    case 'inspect':
      return finishing
        ? { text: 'Done. The final is on the canvas.' }
        : { text: 'The drafts are ready. Which one should I finish, 1 or 2? Or tell me what to change.' };
    default:
      return { text: 'Done.' };
  }
}
