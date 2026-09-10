/**
 * What a type declaration fills in.
 *
 * An app that has fifty Add nodes should not have to repeat Add's sockets fifty times. It hands
 * <KookieFlow> a table — `entityTypes` — and a node that says `type: 'add'` and nothing else comes
 * out of this file with Add's sockets, width and label on it.
 *
 * Two rules hold the whole thing up:
 *
 *   The node wins. Anything the node states itself is kept; the table only fills gaps. An empty
 *   socket list is a statement, not a gap — `[]` means "no inputs", and undefined means "unsaid".
 *
 *   The library only copies. It has no idea what Add is. The app wrote every one of these values;
 *   this moves them onto the node before anything reads it.
 *
 * Resolution happens once, where entities enter the store, so the hundred-odd places that read
 * `entity.inputs` never learn that a table exists. It is cached by object identity, so the prop
 * sync that runs on every consumer render resolves nothing it has already seen.
 */

import type { Entity, EntityData, EntityTypeDefinition } from '../types';

/**
 * Both directions of one resolution.
 *
 * `resolved` keeps the prop sync cheap: the same entity object resolves once, ever. `source`
 * remembers what the consumer actually handed over, so a table that arrives or changes later can
 * fill the gaps again from the original rather than from a copy this file already filled.
 */
export interface EntityTypeCache {
  resolved: WeakMap<Entity, Entity>;
  source: WeakMap<Entity, Entity>;
}

export function createEntityTypeCache(): EntityTypeCache {
  return { resolved: new WeakMap(), source: new WeakMap() };
}

/**
 * What the consumer handed over for this entity, where that is known.
 *
 * Known for anything straight off the prop sync. An entity the store has since rebuilt — moved,
 * resized, edited — is its own source, so a later table fills only what is still unsaid on it.
 */
export function sourceEntity(entity: Entity, cache?: EntityTypeCache): Entity {
  return cache?.source.get(entity) ?? entity;
}

/**
 * The node, with anything it left unsaid filled in from its type.
 *
 * Returns the SAME object when there is nothing to fill — no table entry, or a node that states
 * everything itself — so identity comparisons downstream still mean what they meant.
 */
export function resolveEntity(
  entity: Entity,
  types: Record<string, EntityTypeDefinition> | undefined,
  cache?: EntityTypeCache
): Entity {
  const def = types?.[entity.type];
  if (!def) return entity;

  const cached = cache?.resolved.get(entity);
  if (cached) return cached;

  const inputs = entity.inputs === undefined ? def.inputs : undefined;
  const outputs = entity.outputs === undefined ? def.outputs : undefined;
  const width = entity.width === undefined ? def.defaultWidth : undefined;
  const preview = entity.preview === undefined ? def.preview : undefined;
  const height = entity.height === undefined ? def.defaultHeight : undefined;
  // `data.label` is what the header draws. The table's label is a default for the type — "Add" —
  // and a node that carries its own keeps it.
  const label =
    def.label !== undefined && (entity.data as { label?: unknown } | undefined)?.label === undefined
      ? def.label
      : undefined;

  if (
    inputs === undefined && outputs === undefined && width === undefined &&
    height === undefined && label === undefined && preview === undefined
  ) {
    // Nothing to fill. Cached too: the next sync skips even this check.
    cache?.resolved.set(entity, entity);
    return entity;
  }

  const resolved: Entity = { ...entity };
  if (inputs !== undefined) resolved.inputs = inputs;
  if (outputs !== undefined) resolved.outputs = outputs;
  if (width !== undefined) resolved.width = width;
  if (preview !== undefined) resolved.preview = preview;
  if (height !== undefined) resolved.height = height;
  if (label !== undefined) {
    // Spread rather than replace: `data.values` must keep its identity, because a changed values
    // reference is how the store hears that a node's inputs moved.
    resolved.data = { ...(entity.data ?? {}), label } as EntityData;
  }
  cache?.resolved.set(entity, resolved);
  cache?.source.set(resolved, entity);
  return resolved;
}

/**
 * The same, for a whole array. Returns the array it was given when no entity needed anything,
 * which is the common case on a board whose nodes all state their own shape.
 */
export function resolveEntities(
  entities: Entity[],
  types: Record<string, EntityTypeDefinition> | undefined,
  cache?: EntityTypeCache
): Entity[] {
  if (!types) return entities;
  let out: Entity[] | null = null;
  for (let i = 0; i < entities.length; i++) {
    const resolved = resolveEntity(entities[i], types, cache);
    if (resolved !== entities[i] && out === null) out = entities.slice(0, i);
    if (out !== null) out.push(resolved);
  }
  return out ?? entities;
}

/**
 * Whether two tables say the same thing, by entry identity.
 *
 * An app that writes its table inline in JSX hands over a new object on every render, and the
 * work behind a table swap — re-resolving every node, rebuilding both quadtrees — must not happen
 * sixty times a second because of that. Entries compared by reference: an app that also writes
 * each entry inline defeats this, which is why the docs say to hoist the table out of the render.
 */
export function sameTypeTable(
  a: Record<string, EntityTypeDefinition>,
  b: Record<string, EntityTypeDefinition>
): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}
