/**
 * A node's box, from its type alone. The canvas works real heights out from its socket layout; away
 * from a canvas (a stored document, a test) this only has to be close enough that nothing overlaps.
 */

import type { NodeRegistry } from './registry';

const FALLBACK_WIDTH = 240;
/** Measured off the canvas: a socket row with its widget is about 40px, the header about 60. */
const SOCKET_ROW = 40;
const HEADER = 60;
const PREVIEW = 160;

export function estimateNodeSize(registry: NodeRegistry, type: string): { w: number; h: number } {
  const def = registry.get(type);
  if (!def) return { w: FALLBACK_WIDTH, h: 160 };
  const table = registry.entityTypes()[type];
  const rows = Object.keys(def.inputs).length + Object.keys(def.outputs).length;
  const h = HEADER + rows * SOCKET_ROW + (table?.preview ? PREVIEW : 0);
  return { w: def.width ?? table?.defaultWidth ?? FALLBACK_WIDTH, h };
}
