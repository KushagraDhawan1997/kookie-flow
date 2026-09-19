/**
 * The agent's tools, as plain JSON Schema so every model and later the MCP server see the same thing.
 *
 * WHERE A TOOL RUNS decides who answers it. `server` tools run inside the step route and the loop
 * carries on there. `browser` tools have no server body: the call ends the step, the editor runs it
 * against the live graph (the one the person is looking at, with their unsaved edits), and sends the
 * answer back with the next step. That is what keeps an edit and its undo in one place.
 */

export type ToolWhere = 'server' | 'browser';

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
}

export interface AgentToolSpec {
  name: AgentToolName;
  where: ToolWhere;
  description: string;
  inputSchema: JsonSchema;
}

export type AgentToolName =
  | 'read_graph'
  | 'apply_ops'
  | 'estimate'
  | 'run'
  | 'inspect'
  | 'search_nodes'
  | 'list_graphs'
  | 'create_graph';

const nodeIds = (description: string): JsonSchema => ({
  type: 'array',
  description,
  items: { type: 'string' },
});

/**
 * One op, flat rather than a union: every provider's tool format accepts a flat object, and the
 * compiler already refuses an op missing what its kind needs, with a message the model can act on.
 */
const OP_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    op: {
      type: 'string',
      enum: ['add_node', 'remove_node', 'connect', 'disconnect', 'set_values', 'set_label', 'move', 'arrange'],
    },
    type: { type: 'string', description: 'add_node: the node type, as search_nodes gives it.' },
    id: { type: 'string', description: 'add_node: optional id (omit for the next n<number>). Others: the node.' },
    label: { type: 'string', description: 'add_node, set_label: a short name shown on the node.' },
    values: {
      type: 'object',
      description: 'add_node, set_values: input values by socket id.',
      additionalProperties: true,
    },
    position: {
      type: 'object',
      description: 'add_node, move: world position. Omit on add_node to let Studio lay the cluster out.',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    },
    from: { type: 'string', description: 'connect: "nodeId.outputSocket".' },
    to: { type: 'string', description: 'connect, disconnect: "nodeId.inputSocket".' },
    ids: {
      type: 'array',
      description: 'arrange: only these nodes. Omit to arrange the whole graph.',
      items: { type: 'string' },
    },
  },
  required: ['op'],
};

export const AGENT_TOOLS: readonly AgentToolSpec[] = [
  {
    name: 'read_graph',
    where: 'browser',
    description:
      'Read the open graph: one line per node with its non-default values, one line per wire, then each node that has run with its status and what it made. Nodes in focus list every input.',
    inputSchema: {
      type: 'object',
      properties: { focus: nodeIds('Node ids to show in full.') },
    },
  },
  {
    name: 'apply_ops',
    where: 'browser',
    description:
      'Edit the open graph with a list of ops, applied together as one undo step. An op may refer to a node an earlier op in the same list added. All or nothing: if any op is refused, none is applied, and the answer says which and why; send the corrected list again in full. The arrange op lays nodes out left to right by their wiring, the same way every time; put it last in a list that adds or rewires nodes. Returns the ids created.',
    inputSchema: {
      type: 'object',
      properties: { ops: { type: 'array', items: OP_SCHEMA } },
      required: ['ops'],
    },
  },
  {
    name: 'estimate',
    where: 'browser',
    description: 'What running these nodes would cost the person, per node and in total, in US dollars.',
    inputSchema: {
      type: 'object',
      properties: { nodes: nodeIds('Node ids to price.') },
      required: ['nodes'],
    },
  },
  {
    name: 'run',
    where: 'browser',
    description:
      'Run these nodes and what they feed. The person is shown the price and must approve before anything runs; if they decline, say so and wait. Returns each node\'s status and error when it ends.',
    inputSchema: {
      type: 'object',
      properties: { nodes: nodeIds('Node ids to run. Downstream nodes follow on their own.') },
      required: ['nodes'],
    },
  },
  {
    name: 'inspect',
    where: 'browser',
    description: 'Look at a picture a node made. Use it after a run to judge the result before going on.',
    inputSchema: {
      type: 'object',
      properties: {
        node: { type: 'string' },
        socket: { type: 'string', description: 'The output to look at. Defaults to the node\'s first picture.' },
      },
      required: ['node'],
    },
  },
  {
    name: 'search_nodes',
    where: 'server',
    description:
      'Find node types by what they do. Returns each match with its inputs (type, default, options) and outputs. Search before adding a node you have not used in this conversation.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Words like "upscale", "image edit", "pick".' } },
      required: ['query'],
    },
  },
  {
    name: 'list_graphs',
    where: 'server',
    description: 'The person\'s other graphs, newest first, with names and node counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_graph',
    where: 'server',
    description:
      'Start a new graph when the ask has nothing to do with the open one. Takes a name and optionally the ops to build it with. Returns its id; tell the person it is there rather than building in the open graph. If any op is refused, no graph is made; fix the ops and call again.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        ops: { type: 'array', items: OP_SCHEMA },
      },
      required: ['name'],
    },
  },
];

export const BROWSER_TOOLS: ReadonlySet<string> = new Set(
  AGENT_TOOLS.filter((t) => t.where === 'browser').map((t) => t.name)
);

export function isBrowserTool(name: string): boolean {
  return BROWSER_TOOLS.has(name);
}
