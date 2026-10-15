import type { FlowSkin } from '../types';
import { GLASS_COLORS } from './colors';
import { GLASS_METRICS } from './metrics';
import { MATERIAL } from './material';
import { GLASS_FALLBACK_TOKENS, readGlassTokens } from './tokens';

/** KookieUI v2's glass: translucent material, conic rings, aura and grain. */
export const glassSkin: FlowSkin = {
  name: 'glass',
  colors: GLASS_COLORS,
  metrics: GLASS_METRICS,
  material: MATERIAL,
  fallbackTokens: GLASS_FALLBACK_TOKENS,
  readTokens: readGlassTokens,
};

export { GLASS_COLORS } from './colors';
export { GLASS_METRICS } from './metrics';
export { GLASS_FALLBACK_TOKENS, readGlassTokens } from './tokens';
