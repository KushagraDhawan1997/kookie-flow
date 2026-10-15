/**
 * Style resolution utilities for mapping KookieFlow props to WebGL-ready values.
 * Milestone 2: Props & Resolution
 */

import type { ThemeTokens, SimpleShadow } from '../hooks/useThemeTokens';
import { pickToken, type ColorTokenRef } from '../core/theme-colors';
import type { SkinMetrics } from '../skin/types';
import type {
  EntitySize,
  EntityVariant,
  EntityRadius,
  EntityStyleOverrides,
  HeaderPosition,
} from '../types/index';
import { parseColorToRGB, type RGBColor } from './color';
import { SOCKET_HIT_TOLERANCE } from '@kushagradhawan/kookie-flow-core/internal/core/constants';

// ============================================================================
// Header Position Map
// ============================================================================

const HEADER_POSITION_MAP: Record<HeaderPosition, 0 | 1 | 2> = {
  none: 0,
  inside: 1,
  outside: 2,
};

/**
 * The title's line box at its 12px size — the height the text layer gives one line of the node's
 * name. Declared here because the band that holds it is resolved here, and the two must agree.
 */
export const TITLE_LINE_BOX = 14;

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
  /** The aura's hue (`--accent-9`) when `accentHeader` is set, or null for none. */
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
  /**
   * A checkbox's corner. v2 restates it per radius level rather than deriving it from the
   * control's, because a mark is a 16-26px square and never becomes a circle: `--radius-mark-N`,
   * read from the theme, or the level's own row when the flow names a radius.
   */
  markRadius: number;
  /** The type step a control prints its value at: `--font-size-N`, 14px at size 2. */
  widgetFontSize: number;
  borderWidth: number;
  borderColor: RGBColor;
  borderColorHover: RGBColor;

  // Background
  background: RGBColor;
  backgroundHover: RGBColor;
  /** 0 for transparent variants (ghost, outline), 1 otherwise */
  backgroundAlpha: number;

  // Shadow: the card's float (skin metrics.nodeShadow) or a --shadow-N token for classic/overrides
  shadowBlur: number;
  shadowOffsetY: number;
  shadowOpacity: number;
  /** Alpha of the white band inside the top edge (skin metrics.nodeTopLight), per appearance */
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
function resolveTokenPx(token: keyof ThemeTokens | 0, tokens: ThemeTokens): number {
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
function resolveTokenShadow(token: keyof ThemeTokens | 'none', tokens: ThemeTokens): SimpleShadow {
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
  overrides: Partial<EntityStyleOverrides> | undefined,
  metrics: SkinMetrics
): ResolvedEntityStyle {
  const sizeConfig = metrics.sizes[size];
  const variantConfig = metrics.variants[variant];

  // Resolve padding from size
  const padding = resolveTokenPx(sizeConfig.padding, tokens);

  // Resolve border radius (explicit radius prop overrides size-based default)
  let borderRadius: number;
  if (overrides?.borderRadius !== undefined) {
    borderRadius = overrides.borderRadius;
  } else if (radius !== undefined) {
    borderRadius = resolveTokenPx(metrics.radii[radius], tokens);
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
      ? resolveTokenPx(metrics.widgetRadii[radius], tokens)
      : controlIsPill
        ? resolveTokenPx('--radius-full', tokens)
        : controlRadius;
  const widgetPad = resolveTokenPx(atIndex('--control-px-pill', size), tokens);
  const markRadius =
    radius !== undefined
      ? metrics.markRadii[radius][Math.min(4, Math.max(1, Number(size))) - 1]
      : resolveTokenPx(atIndex('--radius-mark', size), tokens);
  const widgetFontSize = resolveTokenPx(atIndex('--font-size', size), tokens);

  // Resolve background colors
  const background = overrides?.background
    ? parseColorToRGB(overrides.background)
    : resolveTokenColor(variantConfig.background, tokens);

  const backgroundHover = resolveTokenColor(variantConfig.backgroundHover, tokens);

  // Background alpha (transparent for ghost/outline)
  const backgroundAlpha = variant === 'ghost' || variant === 'outline' ? 0 : 1;

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
      blur: metrics.nodeShadow.blur,
      offsetY: metrics.nodeShadow.offsetY,
      opacity: metrics.nodeShadow.opacity[tokens.appearance],
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
  const headerHeight = resolveTokenPx(metrics.socketRowHeightToken, tokens);

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
    markRadius,
    widgetFontSize,
    borderWidth,
    borderColor,
    borderColorHover,
    background,
    backgroundHover,
    backgroundAlpha,
    shadowBlur: shadow.blur,
    shadowOffsetY: shadow.offsetY,
    shadowOpacity: shadow.opacity,
    topLightAlpha: metrics.nodeTopLight[tokens.appearance],
    selectedBorderColor,
    fontSize,
    socketSize: sizeConfig.socketSize,
  };
}
export type { ResolvedSocketLayout } from '@kushagradhawan/kookie-flow-core/internal/utils/socket-layout';
import type { ResolvedSocketLayout } from '@kushagradhawan/kookie-flow-core/internal/utils/socket-layout';

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
  tokens: ThemeTokens,
  metrics: SkinMetrics
): ResolvedSocketLayout {
  const sizeConfig = metrics.sizes[size];
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
  const rowHeight = Math.max(
    controlHeight + resolveTokenPx('--control-gap-2', tokens),
    wiringFloor
  );

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
    listRowHeight: Math.max(
      24,
      resolveTokenPx(atIndex('--line-height', size), tokens) + 2 * rowInset
    ),
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
