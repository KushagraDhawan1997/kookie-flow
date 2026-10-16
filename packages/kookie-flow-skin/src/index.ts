import type { FlowSkin } from '@kushagradhawan/kookie-flow-webgl/internal/skin/types';
import { COLORS } from './colors';
import { card } from './card';
import { controls } from './controls';
import { CORNER_K, squircleBoxSDF } from './corner';
import { floating } from './floating';
import { media } from './media';
import { ui } from './ui';
import { METRICS } from './metrics';
import { FALLBACK_TOKENS } from '@kushagradhawan/kookie-flow-webgl/internal/hooks/useThemeTokens';
import { readTokens } from './tokens';

/** Kookie Flow drawn in KookieUI v2's tokens. Today that is its glass material. */
export const skin: FlowSkin = {
  name: 'kookie',
  colors: COLORS,
  metrics: METRICS,
  shape: { glsl: squircleBoxSDF, cornerScale: CORNER_K },
  ui,
  shaders: { card, controls, floating, media },
  fallbackTokens: FALLBACK_TOKENS,
  readTokens,
};

export { COLORS } from './colors';
export { METRICS } from './metrics';
export { readTokens } from './tokens';
export { ui } from './ui';
export {
  SIZE_MAP,
  VARIANT_MAP,
  RADIUS_MAP,
  WIDGET_RADIUS_MAP,
  MARK_RADIUS_BY_LEVEL,
  NODE_SHADOW,
  NODE_TOP_LIGHT,
  SOCKET_ROW_HEIGHT_TOKEN,
  WIDGET_HEIGHT_TOKEN,
} from './metrics';
export {
  MATERIAL,
  FOCUS_RING,
  CORNER_K_SURFACE,
  CORNER_K_FLOATING_ROWS,
  type Material,
  type Ring,
  type CastLayer,
  type RGBA,
} from './material';
export { MATERIAL_GLSL, AURA_GLSL } from './paint';
export { LENS, LENS_GLSL, GLINT, type LensRung } from './lens';
export { CORNER_K, squircleBoxSDF } from './corner';
