import type { ThemeTokens } from '@kushagradhawan/kookie-flow-webgl/internal/hooks/useThemeTokens';
import type {
  EntityRadius,
  EntitySize,
  EntityVariant,
} from '@kushagradhawan/kookie-flow-webgl/internal/types/index';
import { FOCUS_RING } from './material';
import type {
  SizeConfig,
  SkinMetrics,
  VariantConfig,
} from '@kushagradhawan/kookie-flow-webgl/internal/skin/types';

/**
 * The glass skin's sizes, radii and variants: which KookieUI v2 length token each slot takes.
 * Matches KookieUI v2's Card.
 */

/**
 * @deprecated The row height is derived (see `resolveSocketLayout`), not read from one token.
 * Kept because it is exported from the package index.
 */
const SOCKET_ROW_HEIGHT_TOKEN: keyof ThemeTokens = '--space-7';

/**
 * @deprecated The widget height is the row minus its own block inset (see `resolveSocketLayout`).
 * Kept because it is exported from the package index.
 */
const WIDGET_HEIGHT_TOKEN: keyof ThemeTokens = '--space-6';

const SIZE_MAP: Record<EntitySize, SizeConfig> = {
  '1': {
    padding: '--surface-p-1',
    borderRadius: '--radius-surface-1',
    fontSize: '--font-size-1',
    socketSize: 8,
  },
  '2': {
    padding: '--surface-p-1',
    borderRadius: '--radius-surface-1',
    fontSize: '--font-size-1',
    socketSize: 10,
  },
  '3': {
    padding: '--surface-p-2',
    borderRadius: '--radius-surface-2',
    fontSize: '--font-size-2',
    socketSize: 10,
  },
  '4': {
    padding: '--surface-p-3',
    borderRadius: '--radius-surface-3',
    fontSize: '--font-size-3',
    socketSize: 12,
  },
  '5': {
    padding: '--surface-p-4',
    borderRadius: '--radius-surface-4',
    fontSize: '--font-size-4',
    socketSize: 12,
  },
};

/**
 * The card body is a PAIR because the canvas is: dark puts the card one step above the floor
 * (`--neutral-1` canvas, `--neutral-3` body), light puts it one step below (`--neutral-2` canvas,
 * `--neutral-1` body). Same language, inverted. The hairline is the one token that reads on both.
 */
const VARIANT_MAP: Record<EntityVariant, VariantConfig> = {
  surface: {
    background: { light: '--neutral-1', dark: '--neutral-3' },
    backgroundHover: '--neutral-2',
    borderColor: '--neutral-5',
    borderColorHover: '--neutral-6',
    borderWidth: 1,
    shadow: 'node',
  },
  outline: {
    background: 'transparent',
    backgroundHover: '--neutral-2',
    borderColor: '--neutral-5',
    borderColorHover: '--neutral-6',
    borderWidth: 1,
    shadow: 'none',
  },
  soft: {
    background: { light: '--neutral-2', dark: '--neutral-3' },
    backgroundHover: '--neutral-3',
    borderColor: 'transparent',
    borderColorHover: 'transparent',
    borderWidth: 0,
    shadow: 'node',
  },
  classic: {
    background: '--color-surface',
    backgroundHover: '--neutral-2',
    borderColor: 'transparent',
    borderColorHover: 'transparent',
    borderWidth: 0,
    shadow: '--shadow-2',
  },
  ghost: {
    background: 'transparent',
    backgroundHover: '--neutral-3',
    borderColor: 'transparent',
    borderColorHover: 'transparent',
    borderWidth: 0,
    shadow: 'none',
  },
};

/**
 * The card's float. Not a --shadow-N token: those top out at blur 16 and are tuned for DOM cards
 * sitting on a page, where the shadow is read against white. A node sits on the canvas floor in
 * both appearances, so the opacity is a pair and the tail (quadratic, in the shader) is long.
 */
const NODE_SHADOW = {
  blur: 20,
  offsetY: 8,
  opacity: { dark: 0.4, light: 0.1 },
} as const;

/**
 * A 1.5px lighter band just inside the top edge. Light is where the card is lit from; in the light
 * appearance the card is already the brightest thing on the canvas and the band would read as a
 * second hairline, so it is off there.
 */
const NODE_TOP_LIGHT = { dark: 0.07, light: 0.0 } as const;

// ============================================================================
// Radius Map
// ============================================================================

/**
 * A NODE BODY IS A SURFACE, and that is the whole of this table.
 *
 * KookieUI v2 partitions the radius scale by role rather than by magnitude: `--radius-1..5` are
 * the control family and `--radius-6..10` the surface family, and the theme's `data-radius` level
 * scales each on its own terms. At the `full` level the control family goes to 9999px — a pill,
 * bounded by the control's own height — while the surface family stays at 24/32/40/48, exactly
 * where `large` leaves it. A `.kui-surface[data-size=N]` reads `--radius-surface-N`, and there is
 * no level at which a surface becomes a capsule.
 *
 * This table used to mix the two: `--radius-2`, `--radius-4` and `--radius-6` for the first three
 * levels and `--radius-full` for the last. Under v2 that reads three control tokens and a pill for
 * a thing that is a card — so `radius="full"` handed the shader 9999, every SDF site clamped the
 * corner to half the shorter side, and a node became a stadium with its title and its first socket
 * row outside the shape. Worse quietly: v2's DEFAULT level (`:root`, no `data-radius`) resolves
 * `--radius-1..5` to 9999 as well, so `radius="medium"` did the same thing to an app that simply
 * never set a level.
 *
 * Every entry is a surface index now, so every level is bounded by the theme's own scale.
 */
const RADIUS_MAP: Record<EntityRadius, keyof ThemeTokens | 0> = {
  none: 0,
  small: '--radius-surface-1',
  medium: '--radius-surface-2',
  large: '--radius-surface-3',
  full: '--radius-surface-4',
};

/**
 * A WIDGET IS A CONTROL, so it reads the other half of the scale.
 *
 * The same five levels, climbing `--radius-1..3` and ending at `--radius-full` — which is what v2
 * means by a control at the `full` level: `calc(control-height / 2)`, a true pill. The shader
 * clamps to half the widget's own box, so 9999 resolves to exactly that and can never reach past
 * the control it rounds.
 *
 * Widgets were a fixed 8px before this, so the `radius` prop stopped at the node body and never
 * reached the controls on it.
 */
/**
 * `--radius-mark-1..4` at each level, from v2's stylesheet: square at `none`, and `full` is `large`
 * because a checkbox never becomes a circle. Used when the flow names a radius itself; otherwise the
 * theme's own tokens answer.
 */
const MARK_RADIUS_BY_LEVEL: Record<EntityRadius, readonly [number, number, number, number]> = {
  none: [0, 0, 0, 0],
  small: [2, 2, 3, 3],
  medium: [4, 4, 6, 6],
  large: [6, 6, 8, 8],
  full: [6, 6, 8, 8],
};

const WIDGET_RADIUS_MAP: Record<EntityRadius, keyof ThemeTokens | 0> = {
  none: 0,
  small: '--radius-1',
  medium: '--radius-2',
  large: '--radius-3',
  full: '--radius-full',
};

export const GLASS_METRICS: SkinMetrics = {
  sizes: SIZE_MAP,
  variants: VARIANT_MAP,
  radii: RADIUS_MAP,
  widgetRadii: WIDGET_RADIUS_MAP,
  markRadii: MARK_RADIUS_BY_LEVEL,
  nodeShadow: NODE_SHADOW,
  nodeTopLight: NODE_TOP_LIGHT,
  socketRowHeightToken: SOCKET_ROW_HEIGHT_TOKEN,
  widgetHeightToken: WIDGET_HEIGHT_TOKEN,
  focusRing: FOCUS_RING,
};

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
};
