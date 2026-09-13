/**
 * The GL control kit: shapes, the glass material, easing, transitions and the backdrop copy.
 *
 * Self-contained by rule — nothing in here knows what a node, a socket or a store is. It is the
 * part of the widget layer that could become its own package, and keeping that boundary honest
 * is cheaper now than untangling it later.
 */

export { SDF_GLSL } from './sdf';
export { GLASS_GLSL, AURA_GLSL } from './glass';
export { LENS, LENS_GLSL, GLINT, type LensRung } from './lens';
export {
  EASE_GLSL,
  easeOutCubic,
  easeOutBack,
  easeColor,
  springStiff,
  springLively,
  springMark,
  springElastic,
  clamp01,
} from './ease';
export {
  MATERIAL,
  MOTION,
  PRESS_SQUASH,
  PRESS_SCALE,
  FOCUS_RING,
  CORNER_K_SURFACE,
  CORNER_K_FLOATING_ROWS,
  type Material,
  type Ring,
  type CastLayer,
  type RGBA,
} from './material';
export { TransitionTracker, motionNow, SETTLED, type Transition } from './motion';
export {
  Magnet,
  MAGNET_STAGE,
  type MagnetRange,
  type MagnetTarget,
} from './magnet';
export { BackdropSnapshot, BACKDROP_GLSL } from './backdrop';
