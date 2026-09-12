/**
 * The studio's socket types, as the canvas understands them.
 *
 * `compatibleWith` is symmetric in the library (either side naming the other is enough), so each
 * pair is stated once. A mask is a one-channel picture and goes where a picture goes; an int or a
 * seed is a number and goes where a float goes. The node's `run` coerces — `Math.round` on an int
 * input — so the looseness costs nothing.
 */

import type { SocketType } from '@kushagradhawan/kookie-flow';
import type { StudioSocketType } from './define';

/**
 * The canvas's own rule, restated here because this package must load where React does not:
 * the library's entry point carries components, and a server route that imported it for one
 * pure function would fail to build. Same type, `any` on either side, or either side naming
 * the other.
 */
export function typesCompatible(a: string, b: string): boolean {
  if (a === b || a === 'any' || b === 'any') return true;
  const ca = SOCKET_TYPES[a as StudioSocketType]?.compatibleWith;
  const cb = SOCKET_TYPES[b as StudioSocketType]?.compatibleWith;
  if (ca === '*' || cb === '*') return true;
  return (Array.isArray(ca) && ca.includes(b)) || (Array.isArray(cb) && cb.includes(a));
}

export const SOCKET_TYPES: Record<StudioSocketType, SocketType> = {
  image: { name: 'Image', color: '#3e63dd', compatibleWith: ['mask'] },
  video: { name: 'Video', color: '#8e4ec6' },
  mask: { name: 'Mask', color: '#8b8d98' },
  text: { name: 'Text', color: '#30a46c', widget: 'text' },
  float: { name: 'Number', color: '#e5a336', widget: 'slider', compatibleWith: ['int', 'seed'], min: 0, max: 1, step: 0.01 },
  int: { name: 'Integer', color: '#f76b15', widget: 'number', compatibleWith: ['seed'], step: 1 },
  bool: { name: 'Boolean', color: '#e54666', widget: 'checkbox' },
  color: { name: 'Color', color: '#d6409f', widget: 'color' },
  seed: { name: 'Seed', color: '#12a594', widget: 'number', min: 0, step: 1 },
  any: { name: 'Any', color: '#8b8d98', compatibleWith: '*' },
};
