/**
 * The GL control kit: shapes, the glass material and the backdrop copy.
 *
 * Self-contained by rule — nothing in here knows what a node, a socket or a store is. It is the
 * part of the widget layer that could become its own package, and keeping that boundary honest
 * is cheaper now than untangling it later.
 */

export { SDF_GLSL } from './sdf';
export { GLASS_GLSL, AURA_GLSL } from './glass';
export { LENS, LENS_GLSL, GLINT, type LensRung } from './lens';
export {
  MATERIAL,
  FOCUS_RING,
  CORNER_K_SURFACE,
  CORNER_K_FLOATING_ROWS,
  type Material,
  type Ring,
  type CastLayer,
  type RGBA,
} from '../skin/glass/material';
export {
  Magnet,
  MAGNET_STAGE,
  type MagnetRange,
  type MagnetTarget,
} from '@kushagradhawan/kookie-flow-core/internal/gl/magnet';
export { BackdropSnapshot, BACKDROP_GLSL } from './backdrop';
