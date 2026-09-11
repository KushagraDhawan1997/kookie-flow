/**
 * Style resolution utilities for mapping KookieFlow props to WebGL-ready values.
 * Milestone 2: Props & Resolution
 */

import type { ThemeTokens, SimpleShadow } from '../hooks/useThemeTokens';
import { pickToken, type ColorTokenRef } from '../core/theme-colors';
import type { EntitySize, EntityVariant, EntityRadius, EntityStyleOverrides, HeaderPosition } from '../types';
import { parseColorToRGB, type RGBColor } from './color';
import { SOCKET_HIT_TOLERANCE } from '../core/constants';

// ============================================================================
// Header Position Map
// ============================================================================

const HEADER_POSITION_MAP: Record<HeaderPosition, 0 | 1 | 2> = {
  none: 0,
  inside: 1,
  outside: 2,
};

// ============================================================================
// Size Map (matches Kookie UI Card)
// ============================================================================

interface SizeConfig {
  /** CSS variable name for padding */
  padding: keyof ThemeTokens;
  /** CSS variable name for border radius */
  borderRadius: keyof ThemeTokens;
  /** CSS variable name for font size */
  fontSize: keyof ThemeTokens;
  /** Socket radius in pixels */
  socketSize: number;
}

/**
 * @deprecated The row height is derived (see `resolveSocketLayout`), not read from one token.
 * Kept because it is exported from the package index.
 */
export const SOCKET_ROW_HEIGHT_TOKEN: keyof ThemeTokens = '--space-7';

/**
 * The title's line box at its 12px size — the height the text layer gives one line of the node's
 * name. Declared here because the band that holds it is resolved here, and the two must agree.
 */
export const TITLE_LINE_BOX = 14;

/**
 * @deprecated The widget height is the row minus its own block inset (see `resolveSocketLayout`).
 * Kept because it is exported from the package index.
 */
export const WIDGET_HEIGHT_TOKEN: keyof ThemeTokens = '--space-6';

/**
 * Which v2 index a node's interior reads from, one step BELOW the host's page default.
 *
 * v2's index 2 is calibrated for a page card several hundred pixels wide read at 1:1. A node is
 * `DEFAULT_ENTITY_WIDTH` = 240 and this package already reasons about being read below 1:1 —
 * `WIDGET_VALUE_MIN_ZOOM` is argued in DEVICE pixels. Index 2 applied wholesale spends
 * 24 + 96 + 24 = 144px of a 240px node on chrome before the first glyph, and puts the resting type
 * step at 14px on a canvas routinely viewed at half scale. Index 1 spends 128 and leaves type at 12.
 *
 * It also settles `EntitySize` '5', which v2 has no index for at all: it clamps to 4.
 */
export function nodeIndex(size: EntitySize): 1 | 2 | 3 | 4 {
  const n = Number(size) - 1;
  return Math.min(4, Math.max(1, n)) as 1 | 2 | 3 | 4;
}

/** A family token at the node's index, e.g. `--control-height-1`. */
function atIndex(family: string, size: EntitySize): keyof ThemeTokens {
  return `${family}-${nodeIndex(size)}` as keyof ThemeTokens;
}

/**
 * The clear space between two adjacent socket hit circles at the resting size.
 *
 * This is the constraint under the socket row height and it belongs to neither design system: a
 * row's pitch is also the pitch at which EDGE ENDPOINTS are separated, and a hit circle is
 * `socketSize + SOCKET_HIT_TOLERANCE` in radius. At size 2 that is 14, so two adjacent circles are
 * 28px across and a v2 control height of 32 would leave 4px between them — two device pixels at
 * the half zoom this canvas is read at. Wiring and hit disambiguation get measurably worse for a
 * number that was chosen against a page button.
 */
export const SOCKET_MIN_CLEAR = 12;

export const SIZE_MAP: Record<EntitySize, SizeConfig> = {
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

// ============================================================================
// Variant Map (matches Kookie UI Card)
// ============================================================================

interface VariantConfig {
  /** Background color token or 'transparent' */
  background: ColorTokenRef | 'transparent';
  /** Background color on hover */
  backgroundHover: ColorTokenRef;
  /** Border color token or 'transparent' */
  borderColor: ColorTokenRef | 'transparent';
  /** Border color on hover */
  borderColorHover: ColorTokenRef | 'transparent';
  /** Border width in pixels */
  borderWidth: number;
  /** Shadow token, 'none', or 'node' — the card's own float (NODE_SHADOW) */
  shadow: keyof ThemeTokens | 'none' | 'node';
}

/**
 * The card body is a PAIR because the canvas is: dark puts the card one step above the floor
 * (`--neutral-1` canvas, `--neutral-3` body), light puts it one step below (`--neutral-2` canvas,
 * `--neutral-1` body). Same language, inverted. The hairline is the one token that reads on both.
 */
export const VARIANT_MAP: Record<EntityVariant, VariantConfig> = {
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
export const NODE_SHADOW = {
  blur: 20,
  offsetY: 8,
  opacity: { dark: 0.4, light: 0.1 },
} as const;

/**
 * A 1.5px lighter band just inside the top edge. Light is where the card is lit from; in the light
 * appearance the card is already the brightest thing on the canvas and the band would read as a
 * second hairline, so it is off there.
 */
export const NODE_TOP_LIGHT = { dark: 0.07, light: 0.0 } as const;


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
export const RADIUS_MAP: Record<EntityRadius, keyof ThemeTokens | 0> = {
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
export const WIDGET_RADIUS_MAP: Record<EntityRadius, keyof ThemeTokens | 0> = {
  none: 0,
  small: '--radius-1',
  medium: '--radius-2',
  large: '--radius-3',
  full: '--radius-full',
};


// ============================================================================
// Resolved Style (WebGL-ready)
// ============================================================================

/**
 * Fully resolved entity style with all values ready for WebGL shaders.
 */
export interface ResolvedEntityStyle {
  // Layout
  padding: number;
  headerHeight: number;

  // Header styling
  /**
   * The header tint a DOM header would wear (`--accent-3` with `accentHeader`, else
   * `--neutral-3`). The GL header block is gone — the header is typographic — so the shader no
   * longer reads this; it stays a real colour because it is public and consumers read it as one.
   */
  headerBackground: RGBColor;
  /** The top-edge accent band (`--accent-9`) when `accentHeader` is set, or null for none. */
  accentBand: RGBColor | null;
  /** Header position: 0=none, 1=inside, 2=outside */
  headerPosition: 0 | 1 | 2;

  // Border
  borderRadius: number;
  /**
   * The radius a widget on this entity wears — the control half of the scale, where the body's
   * `borderRadius` is the surface half. Clamped to the widget's own box by the shader, so the
   * `full` level is a pill and not an overflow.
   */
  widgetRadius: number;
  /**
   * The inner inset a widget prints its value at, and the one number in this file that ROUNDNESS
   * moves: v2 spends `--control-px-pill-N` here unconditionally and lets the token carry the bump —
   * it equals `--control-px-N` at every radius level below `full`, and steps up at `full` because a
   * capsule's curve eats the corner the first glyph would otherwise sit in.
   */
  widgetPad: number;
  borderWidth: number;
  borderColor: RGBColor;
  borderColorHover: RGBColor;

  // Background
  background: RGBColor;
  backgroundHover: RGBColor;
  /** 0 for transparent variants (ghost, outline), 1 otherwise */
  backgroundAlpha: number;

  // Shadow: the card's float (NODE_SHADOW) or a --shadow-N token for classic/overrides
  shadowBlur: number;
  shadowOffsetY: number;
  shadowOpacity: number;
  /** Alpha of the white band inside the top edge (NODE_TOP_LIGHT), per appearance */
  topLightAlpha: number;

  // Selection state (uses accent color)
  selectedBorderColor: RGBColor;

  // Text
  fontSize: number;

  // Sockets
  socketSize: number;
}

/** Transparent color constant */
const TRANSPARENT: RGBColor = [0, 0, 0];

/** No shadow constant */
const NO_SHADOW: SimpleShadow = { offsetY: 0, blur: 0, opacity: 0 };

/**
 * Resolve a token reference to its actual value.
 */
function resolveTokenPx(
  token: keyof ThemeTokens | 0,
  tokens: ThemeTokens
): number {
  if (token === 0) return 0;
  const value = tokens[token];
  if (typeof value === 'number') return value;
  return 0;
}

/**
 * Resolve a color token reference to RGB.
 */
export function resolveTokenColor(
  token: keyof ThemeTokens | 'transparent' | ColorTokenRef,
  tokens: ThemeTokens
): RGBColor {
  if (token === 'transparent') return TRANSPARENT;
  // An appearance-keyed pair picks its half here, so every caller that already takes a token
  // takes a pair for free and nothing downstream learns a second spelling.
  const key = typeof token === 'object' ? pickToken(token, tokens.appearance) : token;
  const value = tokens[key];
  if (Array.isArray(value)) {
    // Could be RGB or RGBA, take first 3 values
    return [value[0], value[1], value[2]];
  }
  return TRANSPARENT;
}

/**
 * Resolve a shadow token reference.
 */
function resolveTokenShadow(
  token: keyof ThemeTokens | 'none',
  tokens: ThemeTokens
): SimpleShadow {
  if (token === 'none') return NO_SHADOW;
  const value = tokens[token];
  if (value && typeof value === 'object' && 'blur' in value) {
    return value as SimpleShadow;
  }
  return NO_SHADOW;
}

/**
 * Resolve entity style props and theme tokens to WebGL-ready values.
 *
 * IMPORTANT: This function returns a new object every call.
 * Always memoize the result with useMemo to avoid unnecessary re-renders.
 *
 * @example
 * ```tsx
 * const resolvedStyle = useMemo(
 *   () => resolveEntityStyle(size, variant, radius, header, accentHeader, tokens, overrides),
 *   [size, variant, radius, header, accentHeader, tokens, overrides]
 * );
 * ```
 */
export function resolveEntityStyle(
  size: EntitySize = '2',
  variant: EntityVariant = 'surface',
  radius: EntityRadius | undefined,
  header: HeaderPosition = 'none',
  accentHeader: boolean = false,
  tokens: ThemeTokens,
  overrides?: Partial<EntityStyleOverrides>
): ResolvedEntityStyle {
  const sizeConfig = SIZE_MAP[size];
  const variantConfig = VARIANT_MAP[variant];

  // Resolve padding from size
  const padding = resolveTokenPx(sizeConfig.padding, tokens);

  // Resolve border radius (explicit radius prop overrides size-based default)
  let borderRadius: number;
  if (overrides?.borderRadius !== undefined) {
    borderRadius = overrides.borderRadius;
  } else if (radius !== undefined) {
    borderRadius = resolveTokenPx(RADIUS_MAP[radius], tokens);
  } else {
    borderRadius = resolveTokenPx(sizeConfig.borderRadius, tokens);
  }

  // The control half of the same level. Deliberately NOT taking `overrides.borderRadius`: that
  // override is the body's shape, and a node with square corners does not thereby have square
  // fields — v2 keeps the two families independent for the same reason.
  /*
   * The prop still names the level (that is what a per-entity `radius` is for); with no prop the
   * widget takes the control corner at the node's own index, which is what v2 indexes by.
   *
   * EXCEPT AT THE PILL LEVEL, and the exception is the whole reason this is not one line. v2
   * defines `--radius-control-N` at `radius="full"` as `calc(var(--control-height-N) / 2)` — half
   * the control's OWN height. Our widget is not `--control-height-N` tall: it is
   * `rowHeight - 2 * rowInset`, and the row has a wiring floor, so at the node index it comes out
   * 32 where `--control-height-1` is 28. Inheriting that token gives 14 on a 32px box — a pill
   * level with visibly flat ends.
   *
   * So when the token IS a pill for its own box, hand the shader the pill sentinel and let it
   * clamp to half of OUR box, which is the same arithmetic v2 is doing on its own. Below that
   * level the token is a small concrete radius and means exactly what it says.
   */
  const controlHeightForRadius = resolveTokenPx(atIndex('--control-height', size), tokens);
  const controlRadius = resolveTokenPx(atIndex('--radius-control', size), tokens);
  const controlIsPill = controlRadius >= controlHeightForRadius / 2;
  const widgetRadius =
    radius !== undefined
      ? resolveTokenPx(WIDGET_RADIUS_MAP[radius], tokens)
      : controlIsPill
        ? resolveTokenPx('--radius-full', tokens)
        : controlRadius;
  const widgetPad = resolveTokenPx(atIndex('--control-px-pill', size), tokens);

  // Resolve background colors
  const background = overrides?.background
    ? parseColorToRGB(overrides.background)
    : resolveTokenColor(variantConfig.background, tokens);

  const backgroundHover = resolveTokenColor(variantConfig.backgroundHover, tokens);

  // Background alpha (transparent for ghost/outline)
  const backgroundAlpha =
    variant === 'ghost' || variant === 'outline' ? 0 : 1;

  // Resolve border
  const borderWidth = overrides?.borderWidth ?? variantConfig.borderWidth;

  const borderColor = overrides?.borderColor
    ? parseColorToRGB(overrides.borderColor)
    : resolveTokenColor(variantConfig.borderColor, tokens);

  const borderColorHover = resolveTokenColor(variantConfig.borderColorHover, tokens);

  // Resolve shadow
  let shadow: SimpleShadow;
  if (overrides?.shadow !== undefined) {
    if (overrides.shadow === 'none') {
      shadow = NO_SHADOW;
    } else {
      const shadowKey = `--shadow-${overrides.shadow}` as keyof ThemeTokens;
      shadow = resolveTokenShadow(shadowKey, tokens);
    }
  } else if (variantConfig.shadow === 'node') {
    shadow = {
      blur: NODE_SHADOW.blur,
      offsetY: NODE_SHADOW.offsetY,
      opacity: NODE_SHADOW.opacity[tokens.appearance],
    };
  } else {
    shadow = resolveTokenShadow(variantConfig.shadow, tokens);
  }

  // Selection uses accent color
  const selectedBorderColor = resolveTokenColor('--accent-9', tokens);

  // Header styling
  const headerPosition = HEADER_POSITION_MAP[header];
  const headerBackground = accentHeader
    ? resolveTokenColor('--accent-3', tokens)
    : resolveTokenColor('--neutral-3', tokens);
  const accentBand = accentHeader ? resolveTokenColor('--accent-9', tokens) : null;

  // Header height uses fixed row height token (--space-7 = 40px)
  // This ensures header aligns with socket rows for widget layout
  const headerHeight = resolveTokenPx(SOCKET_ROW_HEIGHT_TOKEN, tokens);

  // Resolve font size from token
  const fontSize = resolveTokenPx(sizeConfig.fontSize, tokens);

  return {
    padding,
    headerHeight,
    headerBackground,
    accentBand,
    headerPosition,
    borderRadius,
    widgetRadius,
    widgetPad,
    borderWidth,
    borderColor,
    borderColorHover,
    background,
    backgroundHover,
    backgroundAlpha,
    shadowBlur: shadow.blur,
    shadowOffsetY: shadow.offsetY,
    shadowOpacity: shadow.opacity,
    topLightAlpha: NODE_TOP_LIGHT[tokens.appearance],
    selectedBorderColor,
    fontSize,
    socketSize: sizeConfig.socketSize,
  };
}

// ============================================================================
// Socket Layout Resolution (Milestone 3.5)
// ============================================================================

/**
 * Resolved socket layout values for positioning sockets and widgets.
 * All socket rows (header inside, outputs, inputs) use the same row height.
 */
export interface ResolvedSocketLayout {
  /** Row height in pixels (from --space-7, default 40px) */
  rowHeight: number;
  /** Widget height in pixels (from --space-6, default 32px) */
  widgetHeight: number;
  /** Margin from top of node to first socket row */
  marginTop: number;
  /** Height of the title's band inside the body; 0 when no title is drawn there */
  titleBand: number;
  /** Socket circle radius in pixels */
  socketSize: number;
  /** Padding inside node (from size config) */
  padding: number;
  /**
   * The checkbox's square, from `--mark-N`.
   *
   * v2 makes this byte-identical to `--line-height-N`, which is what lands a mark on its own
   * label's line with no alignment rule at all. It was an 18 in the shader.
   */
  markSize: number;
  /** The slider's rail, from `--slider-track-N`. Also a shader literal before. */
  trackHeight: number;
  /**
   * The body's border, which every content inset owes. `.kui-surface` is border-box and declares
   * its border in the same rule as its padding, so the distance from the outer edge to the first
   * glyph is `padding + borderWidth`, not `padding`.
   */
  borderWidth: number;
}

/**
 * Resolve socket layout from theme tokens and entity style settings.
 *
 * Layout order: Header (if inside) → Output rows → Input rows
 *
 * @param hasTitleBand - Whether the title is drawn INSIDE the body and needs a band of its own
 * @param size - Entity size for padding and socket size
 * @param tokens - Theme tokens for resolving --space-N values
 */
export function resolveSocketLayout(
  hasTitleBand: boolean,
  size: EntitySize = '2',
  tokens: ThemeTokens
): ResolvedSocketLayout {
  const sizeConfig = SIZE_MAP[size];
  const padding = resolveTokenPx(sizeConfig.padding, tokens);
  const borderWidth = 1;

  /*
   * THE ROW PITCH IS DECLARED, not imported, and this is the one number in the file that a design
   * system cannot hand over.
   *
   * A v2 stack of label-beside-control rows is `.kui-field-item` (`grid-template-columns: auto 1fr`)
   * inside a `.kui-field-group` whose `row-gap` is `--layout-space-3`, so its pitch is the control
   * height plus that gap — 32 + 8 = 40 at index 2. That is where today's 40 came from by accident,
   * via `--space-7`. But a socket row is also the pitch at which EDGE ENDPOINTS are separated, and
   * that has a floor a page row never has to respect: see SOCKET_MIN_CLEAR. The row takes whichever
   * is larger, so the wiring constraint can never be silently cut by a type-scale change.
   */
  const controlHeight = resolveTokenPx(atIndex('--control-height', size), tokens);
  const rowInset = resolveTokenPx(atIndex('--row-inset', size), tokens);
  const wiringFloor = 2 * (sizeConfig.socketSize + SOCKET_HIT_TOLERANCE) + SOCKET_MIN_CLEAR;
  const rowHeight = Math.max(controlHeight + resolveTokenPx('--control-gap-2', tokens), wiringFloor);

  // The air a row gives its control is the ROW'S OWN block inset, which is what
  // `.kui-row { padding-block: ... }` spends. It was the residue between two unrelated --space-N
  // steps before, and it landed on the same 8px by luck.
  const widgetHeight = Math.max(controlHeight, rowHeight - 2 * rowInset);

  /*
   * A TITLE DRAWN IN THE BODY GETS A BAND OF ITS OWN, and that band is TYPOGRAPHIC, not a row.
   *
   * It used to be `rowHeight` — 40px reserved for a 14px line, on top of a 24px body padding, so
   * the name floated 37px below the card's top edge with nothing in the gap. A socket row is that
   * tall because it carries a control and because edge endpoints need clearance; a title carries
   * neither. It takes the line box plus the row's own block inset, top and bottom, which is the
   * air a control gets inside its row.
   *
   * `none` and `outside` reserve nothing: one draws no title at all, the other draws it above the
   * body.
   */
  const titleBand = hasTitleBand ? TITLE_LINE_BOX + 2 * rowInset : 0;
  const marginTop = padding + titleBand;

  return {
    rowHeight,
    widgetHeight,
    marginTop,
    titleBand,
    socketSize: sizeConfig.socketSize,
    padding,
    borderWidth,
    markSize: resolveTokenPx(atIndex('--mark', size), tokens),
    trackHeight: resolveTokenPx(atIndex('--slider-track', size), tokens),
  };
}

/**
 * Calculate the minimum height required for an entity based on socket count.
 *
 * Height = marginTop + max(1, totalRows) * rowHeight + bottomPadding
 *
 * @param outputCount - Number of output sockets
 * @param inputCount - Number of input sockets
 * @param layout - Resolved socket layout
 * @returns Minimum required height in pixels
 */
export function calculateMinEntityHeight(
  outputCount: number,
  inputCount: number,
  layout: ResolvedSocketLayout
): number {
  const totalRows = outputCount + inputCount;
  // At least 1 row for nodes with no sockets
  const rows = Math.max(1, totalRows);
  return layout.marginTop + rows * layout.rowHeight + layout.padding;
}
