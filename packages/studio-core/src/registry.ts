/**
 * The catalog. Definitions go in once; the canvas's entity types, a new entity of a type, and the
 * agent's search all come out of the same table.
 */

import type { Entity, EntityTypeDefinition, Socket, XYPosition } from '@kushagradhawan/kookie-flow';
import {
  CATEGORY_LABELS,
  titleCase,
  type AnyNodeDefinition,
  type Category,
  type NodeDefinition,
  type SocketSpec,
  type SocketSpecs,
} from './define';

const DEFAULT_PREVIEW_HEIGHT = 160;

function toSocket(id: string, spec: SocketSpec): Socket {
  const s: Socket = { id, name: spec.label ?? titleCase(id), type: spec.type };
  if (spec.widget !== undefined) s.widget = spec.widget;
  if (spec.min !== undefined) s.min = spec.min;
  if (spec.max !== undefined) s.max = spec.max;
  if (spec.step !== undefined) s.step = spec.step;
  if (spec.options !== undefined) s.options = spec.options;
  if (spec.placeholder !== undefined) s.placeholder = spec.placeholder;
  if (spec.rows !== undefined) s.rows = spec.rows;
  if (spec.layout !== undefined) s.layout = spec.layout;
  if (spec.default !== undefined) s.defaultValue = spec.default;
  return s;
}

function toSockets(specs: SocketSpecs): Socket[] {
  return Object.entries(specs).map(([id, spec]) => toSocket(id, spec));
}

/** The band shows the stated output, else the first picture or clip the node makes. */
export function previewSocket(def: AnyNodeDefinition): string | undefined {
  if (def.preview) return def.preview;
  for (const [id, spec] of Object.entries(def.outputs)) {
    if (spec.type === 'image' || spec.type === 'video' || spec.type === 'mask') return id;
  }
  return undefined;
}

export class NodeRegistry {
  private readonly defs = new Map<string, AnyNodeDefinition>();
  private entityTypesCache: Record<string, EntityTypeDefinition> | null = null;

  register<I extends SocketSpecs, O extends SocketSpecs>(def: NodeDefinition<I, O>): this {
    if (this.defs.has(def.type)) throw new Error(`node type registered twice: ${def.type}`);
    this.defs.set(def.type, def);
    this.entityTypesCache = null;
    return this;
  }

  get(type: string): AnyNodeDefinition | undefined {
    return this.defs.get(type);
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  all(): AnyNodeDefinition[] {
    return [...this.defs.values()];
  }

  categories(): Array<{ id: Category; label: string; nodes: AnyNodeDefinition[] }> {
    const groups = new Map<Category, AnyNodeDefinition[]>();
    for (const def of this.defs.values()) {
      const list = groups.get(def.category);
      if (list) list.push(def);
      else groups.set(def.category, [def]);
    }
    return (Object.keys(CATEGORY_LABELS) as Category[])
      .filter((id) => groups.has(id))
      .map((id) => ({ id, label: CATEGORY_LABELS[id], nodes: groups.get(id) ?? [] }));
  }

  /** Case-insensitive match on type, label, description and socket names; empty query is all. */
  search(query: string): AnyNodeDefinition[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.all();
    const terms = q.split(/\s+/);
    return this.all().filter((def) => {
      const hay = [
        def.type,
        def.label,
        def.description,
        ...Object.keys(def.inputs),
        ...Object.keys(def.outputs),
      ]
        .join(' ')
        .toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  /** The table the canvas takes. Built once per registration set. */
  entityTypes(): Record<string, EntityTypeDefinition> {
    if (this.entityTypesCache) return this.entityTypesCache;
    const out: Record<string, EntityTypeDefinition> = {};
    for (const def of this.defs.values()) {
      const preview = previewSocket(def);
      const entry: EntityTypeDefinition = {
        type: def.type,
        label: def.label,
        inputs: toSockets(def.inputs),
        outputs: toSockets(def.outputs),
        evaluation: def.evaluation ?? 'reactive',
      };
      if (preview) {
        /**
         * `cover`, so the band is the picture and not a picture sitting in a frame.
         *
         * `contain` letterboxes: a square generation in a wide, short band is centred with the
         * card's own fill either side, which reads as a smaller picture rather than as a band.
         * Cropping the edges is the right trade here — the band is a glance, and the full frame
         * is one click away in the inspector.
         */
        /**
         * `top`, because the picture is why the node exists.
         *
         * The library defaults a band to the bottom so that adding one to an existing node moves
         * nothing. A generator is the other case: the result is the thing you look at, and the
         * prompt and the sizes are the controls under it.
         */
        entry.preview = {
          socket: preview,
          height: def.previewHeight ?? DEFAULT_PREVIEW_HEIGHT,
          fit: 'cover',
          position: 'top',
        };
      }
      if (def.width !== undefined) entry.defaultWidth = def.width;
      out[def.type] = entry;
    }
    this.entityTypesCache = out;
    return out;
  }

  /** A new entity of a type. Sockets come from the type table, so none are copied here. */
  create(type: string, id: string, position: XYPosition, values: Record<string, unknown> = {}): Entity {
    const def = this.defs.get(type);
    if (!def) throw new Error(`unknown node type: ${type}`);
    const entity: Entity = { id, type, position, data: { values: { ...values } } };
    if (def.color) entity.color = def.color;
    return entity;
  }
}
