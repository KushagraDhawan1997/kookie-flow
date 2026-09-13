/**
 * The catalog, assembled. Import order is display order inside a category.
 */

import { NodeRegistry } from '../registry';
import * as sources from './sources';
import * as math from './math';
import * as text from './text';
import * as ai from './ai';

export function createRegistry(): NodeRegistry {
  const registry = new NodeRegistry();
  for (const group of [sources, math, text, ai]) {
    for (const def of Object.values(group)) {
      if (typeof def === 'object' && def !== null && 'type' in def && 'run' in def) registry.register(def);
    }
  }
  return registry;
}

/** The one catalog the app and the agent share. */
export const registry = createRegistry();
