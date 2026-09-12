/**
 * Graph operations: the one door every edit goes through.
 *
 * A person clicking "add node", the agent's `apply_ops` tool, and later the MCP server all speak
 * `GraphOp`. This compiles a list of them into the canvas's own `EntityChange` and `EdgeChange`
 * batches, validating as it goes against a working copy so an op can refer to what an earlier op
 * created. The batches go through the same handlers a drag does, which is what gives every caller
 * undo for free.
 */

import type { Edge, EdgeChange, Entity, EntityChange, XYPosition } from '@kushagradhawan/kookie-flow';
import type { NodeRegistry } from './registry';
import { typesCompatible } from './sockets';
import { isUsableId, nextNodeId, valueBag } from './document';

export type GraphOp =
  | {
      op: 'add_node';
      type: string;
      /** Omit to get the next `n<number>`. */
      id?: string;
      position?: XYPosition;
      values?: Record<string, unknown>;
      label?: string;
    }
  | { op: 'remove_node'; id: string }
  /** `from` and `to` are `nodeId.socketId`. An input holds one wire, so connecting replaces it. */
  | { op: 'connect'; from: string; to: string }
  | { op: 'disconnect'; to: string }
  | { op: 'set_values'; id: string; values: Record<string, unknown> }
  | { op: 'set_label'; id: string; label: string }
  | { op: 'move'; id: string; position: XYPosition };

export interface OpError {
  index: number;
  op: GraphOp;
  message: string;
}

export interface CompiledOps {
  entityChanges: EntityChange[];
  edgeChanges: EdgeChange[];
  errors: OpError[];
  /** Ids of nodes added, in order. */
  created: string[];
}

export interface CompileOptions {
  /** Where a node without a position lands. Default: (0, 0) stepped down per node. */
  placeAt?: (index: number) => XYPosition;
}

export function edgeId(source: string, sourceSocket: string, target: string, targetSocket: string): string {
  return `${source}-${sourceSocket}-${target}-${targetSocket}`;
}

/**
 * The wires a new one into this input replaces.
 *
 * An input takes one value, so wiring into a taken input means replacing what is there — the same
 * rule whether the wire was dragged on the canvas or asked for as an op, which is why it is one
 * function rather than the same filter written twice.
 */
export function replacedWires(
  edges: readonly Edge[],
  target: string | null | undefined,
  targetSocket: string | null | undefined
): string[] {
  if (!target || !targetSocket) return [];
  return edges.filter((e) => e.target === target && e.targetSocket === targetSocket).map((e) => e.id);
}

function parseRef(ref: string): { id: string; socket: string } | null {
  const dot = ref.lastIndexOf('.');
  if (dot <= 0 || dot === ref.length - 1) return null;
  return { id: ref.slice(0, dot), socket: ref.slice(dot + 1) };
}

/** Would a wire from `source` to `target` close a loop, given these edges? A DFS from target. */
function wouldCycle(edges: readonly Edge[], source: string, target: string): boolean {
  if (source === target) return true;
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.source);
    if (list) list.push(e.target);
    else out.set(e.source, [e.target]);
  }
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop() as string;
    if (id === source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of out.get(id) ?? []) stack.push(next);
  }
  return false;
}

export function compileOps(
  graph: { entities: readonly Entity[]; edges: readonly Edge[] },
  ops: readonly GraphOp[],
  registry: NodeRegistry,
  options: CompileOptions = {}
): CompiledOps {
  const entities = new Map(graph.entities.map((e) => [e.id, e]));
  let edges: Edge[] = [...graph.edges];
  const entityChanges: EntityChange[] = [];
  const edgeChanges: EdgeChange[] = [];
  const errors: OpError[] = [];
  const created: string[] = [];
  const types = registry.entityTypes();
  const placeAt = options.placeAt ?? ((i) => ({ x: 0, y: i * 200 }));

  const fail = (index: number, op: GraphOp, message: string) => {
    errors.push({ index, op, message });
  };

  const socketType = (entity: Entity, socketId: string, direction: 'inputs' | 'outputs'): string | null => {
    const own = entity[direction]?.find((s) => s.id === socketId);
    if (own) return own.type;
    const fromType = types[entity.type]?.[direction]?.find((s) => s.id === socketId);
    return fromType ? fromType.type : null;
  };

  /** Inputs a node actually has. `Object.hasOwn`, so `constructor` is not an input. */
  const unknownInputs = (type: string, values: Record<string, unknown> | undefined): string[] => {
    const def = registry.get(type);
    if (!def) return Object.keys(values ?? {});
    return Object.keys(values ?? {}).filter((k) => !Object.hasOwn(def.inputs, k));
  };

  const removeEdge = (edge: Edge) => {
    edges = edges.filter((e) => e.id !== edge.id);
    edgeChanges.push({ type: 'remove', id: edge.id });
  };

  ops.forEach((op, index) => {
    switch (op.op) {
      case 'add_node': {
        if (!registry.has(op.type)) return fail(index, op, `unknown node type "${op.type}"`);
        const id = op.id ?? nextNodeId([...entities.values()]);
        // An id is data, and one that names something on Object.prototype turns every lookup
        // keyed by it into a write to the prototype.
        if (!isUsableId(id)) return fail(index, op, `"${id}" cannot be used as a node id`);
        if (entities.has(id)) return fail(index, op, `node "${id}" already exists`);
        const unknownKeys = unknownInputs(op.type, op.values);
        if (unknownKeys.length) return fail(index, op, `"${op.type}" has no input ${unknownKeys.map((k) => `"${k}"`).join(', ')}`);
        const entity = registry.create(op.type, id, op.position ?? placeAt(created.length), op.values);
        if (op.label && op.label.trim()) entity.data.label = op.label;
        entities.set(id, entity);
        entityChanges.push({ type: 'add', entity });
        created.push(id);
        return;
      }
      case 'remove_node': {
        if (!entities.has(op.id)) return fail(index, op, `no node "${op.id}"`);
        for (const edge of edges.filter((e) => e.source === op.id || e.target === op.id)) removeEdge(edge);
        entities.delete(op.id);
        entityChanges.push({ type: 'remove', id: op.id });
        return;
      }
      case 'connect': {
        const from = parseRef(op.from);
        const to = parseRef(op.to);
        if (!from || !to) return fail(index, op, 'a socket is written "nodeId.socketId"');
        const source = entities.get(from.id);
        const target = entities.get(to.id);
        if (!source) return fail(index, op, `no node "${from.id}"`);
        if (!target) return fail(index, op, `no node "${to.id}"`);
        const sourceType = socketType(source, from.socket, 'outputs');
        const targetType = socketType(target, to.socket, 'inputs');
        if (!sourceType) return fail(index, op, `"${from.id}" has no output "${from.socket}"`);
        if (!targetType) return fail(index, op, `"${to.id}" has no input "${to.socket}"`);
        if (!typesCompatible(sourceType, targetType)) {
          return fail(index, op, `cannot connect ${sourceType} to ${targetType}`);
        }
        const id = edgeId(from.id, from.socket, to.id, to.socket);
        if (edges.some((e) => e.id === id)) return; // already wired exactly so; not an error
        if (wouldCycle(edges, from.id, to.id)) return fail(index, op, 'that wire would make a loop');
        const replaced = new Set(replacedWires(edges, to.id, to.socket));
        for (const edge of edges.filter((e) => replaced.has(e.id))) removeEdge(edge);
        const edge: Edge = { id, source: from.id, sourceSocket: from.socket, target: to.id, targetSocket: to.socket };
        edges.push(edge);
        edgeChanges.push({ type: 'add', edge });
        return;
      }
      case 'disconnect': {
        const to = parseRef(op.to);
        if (!to) return fail(index, op, 'a socket is written "nodeId.socketId"');
        const hits = edges.filter((e) => e.target === to.id && e.targetSocket === to.socket);
        if (!hits.length) return fail(index, op, `nothing is wired into "${op.to}"`);
        for (const edge of hits) removeEdge(edge);
        return;
      }
      case 'set_values': {
        const entity = entities.get(op.id);
        if (!entity) return fail(index, op, `no node "${op.id}"`);
        const unknownKeys = unknownInputs(entity.type, op.values);
        if (unknownKeys.length) return fail(index, op, `"${entity.type}" has no input ${unknownKeys.map((k) => `"${k}"`).join(', ')}`);
        // The store merges `data` one level deep, so the whole bag goes back or the rest is lost.
        const values = { ...valueBag(entity), ...op.values };
        const next: Entity = { ...entity, data: { ...entity.data, values } };
        entities.set(op.id, next);
        entityChanges.push({ type: 'data', id: op.id, data: { values } });
        return;
      }
      case 'set_label': {
        const entity = entities.get(op.id);
        if (!entity) return fail(index, op, `no node "${op.id}"`);
        // Clearing the field means "no label of my own", which is what lets the node type's own
        // name come back. Stored as an empty string it would blank the header instead.
        const label = op.label.trim() ? op.label : undefined;
        entities.set(op.id, { ...entity, data: { ...entity.data, label } });
        entityChanges.push({ type: 'data', id: op.id, data: { label } });
        return;
      }
      case 'move': {
        const entity = entities.get(op.id);
        if (!entity) return fail(index, op, `no node "${op.id}"`);
        entities.set(op.id, { ...entity, position: op.position });
        entityChanges.push({ type: 'position', id: op.id, position: op.position });
        return;
      }
      default: {
        const unknown = op as { op?: unknown };
        return fail(index, op, `unknown op ${JSON.stringify(unknown.op)}`);
      }
    }
  });

  return { entityChanges, edgeChanges, errors, created };
}
