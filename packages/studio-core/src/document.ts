/**
 * A graph as data: exactly what the canvas's `toObject()` hands out, plus a version so a later
 * shape can migrate an earlier one. Widget values live in `entity.data.values`, where the canvas
 * keeps them; runtime outputs are never in here.
 */

import type { Edge, Entity, FlowObject, Viewport, XYPosition } from '@kushagradhawan/kookie-flow';
import type { NodeRegistry } from './registry';
import { isMediaRef } from './values';

export interface GraphDocument extends FlowObject {
  version: 1;
}

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/**
 * Ids that name something on `Object.prototype` are refused everywhere a document is read or an
 * op is compiled. Nothing in the app needs them, and every plain object keyed by entity id — the
 * pending widget values, a lookup map — becomes a way to write to the prototype if they are let
 * through.
 */
export const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export function isUsableId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !FORBIDDEN_IDS.has(value);
}

export function emptyDocument(): GraphDocument {
  return { version: 1, entities: [], edges: [], viewport: { ...DEFAULT_VIEWPORT } };
}

export function toDocument(flow: FlowObject): GraphDocument {
  return { version: 1, entities: flow.entities, edges: flow.edges, viewport: flow.viewport };
}

/**
 * Drop everything the node catalog will say again, and everything that describes this moment
 * rather than the graph.
 *
 * The canvas hands out RESOLVED entities: the sockets, size and label that the type table filled
 * in are on every entity, beside the ones the graph actually chose. Stored as they are, a saved
 * graph freezes the catalog as it was on the day it was saved — add an input to a node type, or
 * change a default, and old graphs keep the old shape while the inspector shows the new one. The
 * fields below are exactly the ones the table puts back on load, so dropping them loses nothing
 * and keeps a saved document about the graph.
 */
export function stripResolved(
  entities: readonly Entity[],
  edges: readonly Edge[],
  registry: NodeRegistry
): { entities: Entity[]; edges: Edge[] } {
  const types = registry.entityTypes();

  // Taken apart by name and rebuilt from the rest, so a field the library adds that this does
  // not know about is kept: `inputs`, `outputs` and `preview` come from the type table, and
  // `selected` and `dragging` describe this moment rather than the graph.
  const strippedEntities = entities.map((entity) => {
    const { inputs, outputs, preview, selected, dragging, width, height, data, ...rest } = entity;
    const type = types[entity.type];
    const next: Entity = { ...rest, data };
    // A size the graph chose is kept; one that still equals the type's own is the table's.
    if (width !== undefined && width !== type?.defaultWidth) next.width = width;
    if (height !== undefined && height !== type?.defaultHeight) next.height = height;
    const label = (data as { label?: unknown }).label;
    if (typeof label === 'string' && label === type?.label) {
      const { label: fromTable, ...withoutLabel } = data;
      next.data = withoutLabel;
    }
    return next;
  });

  const strippedEdges = edges.map((edge) => {
    const { selected, ...rest } = edge;
    return rest;
  });

  return { entities: strippedEntities, edges: strippedEdges };
}

function isFinitePoint(value: unknown): value is XYPosition {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<XYPosition>;
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isViewport(value: unknown): value is Viewport {
  if (!isFinitePoint(value)) return false;
  const zoom = (value as Partial<Viewport>).zoom;
  return typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0;
}

/**
 * Accept whatever was stored — or whatever a request body carried — and return a document, or
 * null if it is not one.
 *
 * IT CHECKS THE CONTENTS, not just the shape of the two arrays. This is the only gate between a
 * PUT body and the canvas: an entity with no position throws inside the renderer, an entity with
 * no id breaks every lookup, and an edge naming a node that is not there draws from nowhere. A
 * document that fails here is refused with the row left alone, which is the outcome the editor
 * can recover from.
 */
export function parseDocument(raw: unknown): GraphDocument | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<GraphDocument>;
  if (!Array.isArray(r.entities) || !Array.isArray(r.edges)) return null;
  if (r.version !== undefined && r.version !== 1) return null;

  const ids = new Set<string>();
  for (const entity of r.entities) {
    if (typeof entity !== 'object' || entity === null) return null;
    const e = entity as Partial<Entity>;
    if (!isUsableId(e.id) || ids.has(e.id)) return null;
    if (typeof e.type !== 'string' || e.type.length === 0) return null;
    if (!isFinitePoint(e.position)) return null;
    if (e.data !== undefined && (typeof e.data !== 'object' || e.data === null)) return null;
    if (e.width !== undefined && !Number.isFinite(e.width)) return null;
    if (e.height !== undefined && !Number.isFinite(e.height)) return null;
    ids.add(e.id);
  }

  const edgeIds = new Set<string>();
  for (const edge of r.edges) {
    if (typeof edge !== 'object' || edge === null) return null;
    const t = edge as Partial<Edge>;
    if (!isUsableId(t.id) || edgeIds.has(t.id)) return null;
    if (typeof t.source !== 'string' || !ids.has(t.source)) return null;
    if (typeof t.target !== 'string' || !ids.has(t.target)) return null;
    if (t.sourceSocket !== undefined && typeof t.sourceSocket !== 'string') return null;
    if (t.targetSocket !== undefined && typeof t.targetSocket !== 'string') return null;
    edgeIds.add(t.id);
  }

  return {
    version: 1,
    entities: r.entities as Entity[],
    edges: r.edges as Edge[],
    viewport: isViewport(r.viewport) ? r.viewport : { ...DEFAULT_VIEWPORT },
  };
}

/** `n7` when the highest existing `n<number>` is `n6`. Short ids keep the agent's context small. */
export function nextNodeId(entities: readonly Entity[]): string {
  let max = 0;
  for (const e of entities) {
    const m = /^n(\d+)$/.exec(e.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `n${max + 1}`;
}

/** An entity's widget values, guarded: `data.values` is an open bag the consumer owns. */
export function valueBag(entity: Entity): Record<string, unknown> {
  const v = (entity.data as { values?: unknown }).values;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

function short(value: unknown): string {
  if (isMediaRef(value)) return `<${value.kind} ${value.width}x${value.height}>`;
  if (typeof value === 'string') {
    const oneLine = value.replace(/\s+/g, ' ');
    return JSON.stringify(oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine);
  }
  return JSON.stringify(value);
}

/**
 * The graph as compact text, for the agent.
 *
 * One line per node with only the values that differ from the defaults, then one line per wire.
 * Nodes in `focus` show every input and its current value, defaults included.
 */
export function describeGraph(
  doc: Pick<FlowObject, 'entities' | 'edges'>,
  registry: NodeRegistry,
  focus: readonly string[] = []
): string {
  const focused = new Set(focus);
  const lines: string[] = [];
  for (const entity of doc.entities) {
    const def = registry.get(entity.type);
    const values = valueBag(entity);
    const parts: string[] = [entity.id, entity.type];
    const label = (entity.data as { label?: unknown }).label;
    if (typeof label === 'string' && label) parts.push(JSON.stringify(label));
    if (def) {
      for (const [id, spec] of Object.entries(def.inputs)) {
        const value = values[id];
        const isDefault = value === undefined || value === spec.default;
        if (focused.has(entity.id)) parts.push(`${id}=${short(value ?? spec.default)}`);
        else if (!isDefault) parts.push(`${id}=${short(value)}`);
      }
    } else {
      parts.push('(unknown type)');
    }
    lines.push(parts.join(' '));
  }
  for (const edge of doc.edges) {
    lines.push(`${edge.source}.${edge.sourceSocket ?? 'out'} -> ${edge.target}.${edge.targetSocket ?? 'in'}`);
  }
  return lines.length ? lines.join('\n') : '(empty graph)';
}
