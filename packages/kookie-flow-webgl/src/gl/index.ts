/**
 * The GL control kit: shapes, compositing and the backdrop copy.
 *
 * Self-contained by rule — nothing in here knows what a node, a socket or a store is. It is the
 * part of the widget layer that could become its own package, and keeping that boundary honest
 * is cheaper now than untangling it later.
 */

export { SDF_GLSL } from './sdf';
export { COMPOSITE_GLSL } from './composite';
export {
  Magnet,
  MAGNET_STAGE,
  type MagnetRange,
  type MagnetTarget,
} from '@kushagradhawan/kookie-flow-core/internal/gl/magnet';
export { BackdropSnapshot, BACKDROP_GLSL } from './backdrop';
