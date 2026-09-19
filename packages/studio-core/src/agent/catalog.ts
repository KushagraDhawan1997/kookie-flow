/**
 * The node catalog as the agent reads it: a one-line index in its instructions, and a full entry per
 * type when it searches. Written from the same definitions the canvas uses, so a socket the agent is
 * told about is a socket the node has.
 */

import type { AnyNodeDefinition, SocketSpec } from '../define';
import type { NodeRegistry } from '../registry';

/** A node that costs money or minutes only runs through `run`, never on its own. */
function costs(def: AnyNodeDefinition): boolean {
  return def.evaluation === 'manual';
}

/**
 * One line per type, grouped by category: what exists and the socket names, without every schema.
 * The names are there because a model that knows a type tends to guess its sockets rather than
 * search (`value` for Text's `text`, `output` for Pick's `picked`), found on the first real run.
 */
export function catalogIndex(registry: NodeRegistry): string {
  const lines: string[] = [];
  for (const group of registry.categories()) {
    lines.push(`${group.label}:`);
    for (const def of group.nodes) {
      const ins = Object.keys(def.inputs).join(', ') || 'none';
      const outs = Object.keys(def.outputs).join(', ') || 'none';
      lines.push(`- ${def.type} (${def.label}): ${def.summary}${costs(def) ? ' Costs money.' : ''} In: ${ins}. Out: ${outs}.`);
    }
  }
  return lines.join('\n');
}

function valueText(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function socketLine(direction: 'in' | 'out', id: string, spec: SocketSpec): string {
  const parts = [`  ${direction} ${id}: ${spec.type}`];
  if (spec.label) parts.push(`"${spec.label}"`);
  if (spec.options?.length) parts.push(`one of ${spec.options.map((o) => JSON.stringify(o)).join(', ')}`);
  if (spec.min !== undefined || spec.max !== undefined) parts.push(`range ${spec.min ?? '…'} to ${spec.max ?? '…'}`);
  if (spec.default !== undefined) parts.push(`default ${valueText(spec.default)}`);
  const head = parts.join(' ');
  return spec.description ? `${head}. ${spec.description}` : head;
}

/** A type in full: what it is for, every input with its range and options, every output. */
export function describeNodeType(def: AnyNodeDefinition): string {
  const lines = [`${def.type} (${def.label})${costs(def) ? ', costs money' : ''}`, `  ${def.description}`];
  for (const [id, spec] of Object.entries(def.inputs)) lines.push(socketLine('in', id, spec));
  for (const [id, spec] of Object.entries(def.outputs)) lines.push(socketLine('out', id, spec));
  return lines.join('\n');
}

/** What `search_nodes` answers: the best matches in full, or a note to try other words. */
export function searchCatalog(registry: NodeRegistry, query: string, limit = 8): string {
  let matches = registry.search(query);
  // Every word must match; a long query that finds nothing tries its words one at a time.
  if (matches.length === 0) {
    const words = query.trim().split(/\s+/).filter((w) => w.length > 2);
    const seen = new Set<string>();
    matches = words.flatMap((w) => registry.search(w)).filter((d) => !seen.has(d.type) && seen.add(d.type));
  }
  if (matches.length === 0) return `No node matches "${query}". Try a shorter word, or read the catalog in your instructions.`;
  return matches.slice(0, limit).map(describeNodeType).join('\n\n');
}
