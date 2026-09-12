/**
 * The one function the canvas calls, built from the catalog and the ports.
 *
 * The library decides WHEN a node runs. This decides WHAT runs: look the type up, coerce the
 * inputs to what the sockets promise, hand the node its ports, and cache the answer under a key
 * made of the inputs' identities — so a manual node asked twice with the same seed answers from
 * memory instead of paying twice.
 */

import type { EvaluationContext, OnEvaluate } from '@kushagradhawan/kookie-flow';
import { cacheKey, LruCache } from './cache';
import type { AnyNodeDefinition, SocketSpec } from './define';
import type { Ports, RunContext } from './ports';
import type { NodeRegistry } from './registry';
import { isMediaRef, valueIdentity } from './values';

export interface EvaluatorOptions {
  registry: NodeRegistry;
  ports: Ports;
  /** Results kept in memory. Default: 200. */
  cacheSize?: number;
}

/** Keep a number inside the range its socket declares, when it declares one. */
function withinRange(n: number, spec: SocketSpec): number {
  const low = spec.min !== undefined ? Math.max(spec.min, n) : n;
  return spec.max !== undefined ? Math.min(spec.max, low) : low;
}

/**
 * Bring an input to what its socket promises; a wire from an int into a float is fine, and so on.
 *
 * The range is applied here rather than in each node, because a widget cannot be the only guard:
 * a wire carries whatever the upstream node produced, and `decimals` of 400 or -1 reaches
 * `toFixed` and throws where the socket said 0 to 6.
 */
export function coerce(value: unknown, spec: SocketSpec): unknown {
  switch (spec.type) {
    case 'float':
    case 'seed': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? withinRange(n, spec) : (spec.default ?? 0);
    }
    case 'int': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? Math.round(withinRange(n, spec)) : (spec.default ?? 0);
    }
    case 'bool':
      return typeof value === 'boolean' ? value : value === 'true' || value === 1;
    case 'text':
    case 'color':
      return value === undefined || value === null ? (spec.default ?? '') : String(value);
    case 'image':
    case 'video':
    case 'mask':
      return isMediaRef(value) ? value : undefined;
    default:
      return value;
  }
}

/** `-0` and `0` are the same key in JSON but not the same number to `atan2` or `1/x`. */
function keyIdentity(value: unknown): unknown {
  if (typeof value === 'number' && Object.is(value, -0)) return '-0';
  return valueIdentity(value);
}

export function createOnEvaluate(options: EvaluatorOptions): OnEvaluate {
  const { registry, ports } = options;
  const cache = new LruCache<Record<string, unknown>>(options.cacheSize ?? 200);

  return async (entityId, entityType, rawInputs, ctx: EvaluationContext) => {
    const def: AnyNodeDefinition | undefined = registry.get(entityType);
    if (!def) throw new Error(`no node type "${entityType}"`);

    const inputs: Record<string, unknown> = {};
    for (const [id, spec] of Object.entries(def.inputs)) inputs[id] = coerce(rawInputs[id], spec);

    const runCtx: RunContext = {
      ...ports,
      entityId,
      signal: ctx.signal,
      progress: ctx.progress,
    };

    // An inline node is arithmetic on a few numbers: hashing its inputs to look for a saved
    // answer costs more than running it, and it runs on every frame of a slider drag.
    if (def.where === 'inline') {
      return (await def.run(inputs, runCtx)) ?? {};
    }

    const identity: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(inputs)) identity[id] = keyIdentity(value);
    const key = cacheKey(def.type, def.version ?? 1, identity);
    const hit = cache.get(key);
    if (hit) return hit;

    const outputs = (await def.run(inputs, runCtx)) ?? {};
    if (ctx.signal.aborted) return; // the engine drops it anyway; do not cache a cancelled run
    cache.set(key, outputs);
    return outputs;
  };
}
