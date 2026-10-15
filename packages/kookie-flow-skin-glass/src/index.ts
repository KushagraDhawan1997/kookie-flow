import type { FlowSkin } from '@kushagradhawan/kookie-flow-webgl/internal/skin/types';
import { GLASS_COLORS } from './colors';
import { glassCard } from './card';
import { glassControls } from './controls';
import { CORNER_K, squircleBoxSDF } from './corner';
import { glassFloating } from './floating';
import { glassMedia } from './media';
import { glassUI } from './ui';
import { GLASS_METRICS } from './metrics';
import { FALLBACK_TOKENS } from '@kushagradhawan/kookie-flow-webgl/internal/hooks/useThemeTokens';
import { readGlassTokens } from './tokens';

/** KookieUI v2's glass: translucent material, conic rings, aura and grain. */
export const glassSkin: FlowSkin = {
  name: 'glass',
  colors: GLASS_COLORS,
  metrics: GLASS_METRICS,
  shape: { glsl: squircleBoxSDF, cornerScale: CORNER_K },
  ui: glassUI,
  shaders: {
    card: glassCard,
    controls: glassControls,
    floating: glassFloating,
    media: glassMedia,
  },
  fallbackTokens: FALLBACK_TOKENS,
  readTokens: readGlassTokens,
};

export { GLASS_COLORS } from './colors';
export { GLASS_METRICS } from './metrics';
export { readGlassTokens } from './tokens';
export { glassUI } from './ui';
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
export { GLASS_GLSL, AURA_GLSL } from './glass';
export { LENS, LENS_GLSL, GLINT, type LensRung } from './lens';
export { CORNER_K, squircleBoxSDF } from './corner';
