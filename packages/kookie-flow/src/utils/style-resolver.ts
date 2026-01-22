/**
 * Style resolution utilities for mapping KookieFlow props to WebGL-ready values.
 * Milestone 2: Props & Resolution
 */

import type { ThemeTokens, SimpleShadow } from '../hooks/useThemeTokens';
import type { NodeSize, NodeVariant, NodeRadius, NodeStyleOverrides, HeaderPosition } from '../types';
import { parseColorToRGB, type RGBColor } from './color';

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
 * Socket row height token (fixed to --space-7 = 40px).
 * Both header (inside) and socket rows use this height for widget alignment.
 */
export const SOCKET_ROW_HEIGHT_TOKEN: keyof ThemeTokens = '--space-7';

/**
 * Widget height token (--space-6 = 32px at scale 1).
 * All Kookie UI components at size 2 use this height.
 */
export const WIDGET_HEIGHT_TOKEN: keyof ThemeTokens = '--space-6';

export const SIZE_MAP: Record<NodeSize, SizeConfig> = {
  '1': {
    padding: '--space-2', // 8px
    borderRadius: '--radius-3', // 10px
    fontSize: '--font-size-1', // 12px
    socketSize: 8,
  },
  '2': {
    padding: '--space-3', // 12px
    borderRadius: '--radius-4', // 12px
    fontSize: '--font-size-2', // 14px
    socketSize: 10,
  },
  '3': {
    padding: '--space-4', // 16px
    borderRadius: '--radius-4', // 12px
    fontSize: '--font-size-2', // 14px
    socketSize: 10,
  },
  '4': {
    padding: '--space-5', // 24px
    borderRadius: '--radius-5', // 16px
    fontSize: '--font-size-3', // 16px
    socketSize: 12,
  },
  '5': {
    padding: '--space-6', // 32px
    borderRadius: '--radius-5', // 16px
    fontSize: '--font-size-3', // 16px
    socketSize: 12,
  },
};

// ============================================================================
// Variant Map (matches Kookie UI Card)
// ============================================================================

interface VariantConfig {
  /** Background color token or 'transparent' */
  background: keyof ThemeTokens | 'transparent';
  /** Background color on hover */
  backgroundHover: keyof ThemeTokens;
  /** Border color token or 'transparent' */
  borderColor: keyof ThemeTokens | 'transparent';
  /** Border color on hover */
  borderColorHover: keyof ThemeTokens | 'transparent';
  /** Border width in pixels */
  borderWidth: number;
  /** Shadow token or 'none' */
  shadow: keyof ThemeTokens | 'none';
}

export const VARIANT_MAP: Record<NodeVariant, VariantConfig> = {
  surface: {
    background: '--gray-1',
    backgroundHover: '--gray-2',
    borderColor: '--gray-6',
    borderColorHover: '--gray-7',
    borderWidth: 1,
    shadow: 'none',
  },
  outline: {
    background: 'transparent',
    backgroundHover: '--gray-2',
    borderColor: '--gray-6',
    borderColorHover: '--gray-7',
    borderWidth: 1,
    shadow: 'none',
  },
  soft: {
    background: '--gray-2',
    backgroundHover: '--gray-3',
    borderColor: 'transparent',
    borderColorHover: 'transparent',
    borderWidth: 0,
    shadow: 'none',
  },
  classic: {
    background: '--color-surface-solid',
    backgroundHover: '--gray-2',
    borderColor: 'transparent',
    borderColorHover: 'transparent',
    borderWidth: 0,
    shadow: '--shadow-2',
  },
  ghost: {
    background: 'transparent',
    backgroundHover: '--gray-3',
    borderColor: 'transparent',
    borderColorHover: 'transparent',
    borderWidth: 0,
    shadow: 'none',
  },
};

// ============================================================================
// Radius Map
// ============================================================================

export const RADIUS_MAP: Record<NodeRadius, keyof ThemeTokens | 0> = {
  none: 0,
  small: '--radius-2', // 8px
  medium: '--radius-4', // 12px
  large: '--radius-6', // 20px
  full: '--radius-full', // 9999px
};

// ============================================================================
// Resolved Style (WebGL-ready)
// ============================================================================

/**
 * Fully resolved node style with all values ready for WebGL shaders.
 */
export interface ResolvedNodeStyle {
  // Layout
  padding: number;
  headerHeight: number;

  // Header styling
  /** Header background color (gray or accent tint) */
  headerBackground: RGBColor;
  /** Header position: 0=none, 1=inside, 2=outside */
  headerPosition: 0 | 1 | 2;

  // Border
  borderRadius: number;
  borderWidth: number;
  borderColor: RGBColor;
  borderColorHover: RGBColor;

  // Background
  background: RGBColor;
  backgroundHover: RGBColor;
  /** 0 for transparent variants (ghost, outline), 1 otherwise */
  backgroundAlpha: number;

  // Shadow (for classic variant)
  shadowBlur: number;
  shadowOffsetY: number;
  shadowOpacity: number;

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
function resolveTokenColor(
  token: keyof ThemeTokens | 'transparent',
  tokens: ThemeTokens
): RGBColor {
  if (token === 'transparent') return TRANSPARENT;
  const value = tokens[token];
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
 * Resolve node style props and theme tokens to WebGL-ready values.
 *
 * IMPORTANT: This function returns a new object every call.
 * Always memoize the result with useMemo to avoid unnecessary re-renders.
 *
 * @example
 * ```tsx
 * const resolvedStyle = useMemo(
 *   () => resolveNodeStyle(size, variant, radius, header, accentHeader, tokens, overrides),
 *   [size, variant, radius, header, accentHeader, tokens, overrides]
 * );
 * ```
 */
export function resolveNodeStyle(
  size: NodeSize = '2',
  variant: NodeVariant = 'surface',
  radius: NodeRadius | undefined,
  header: HeaderPosition = 'none',
  accentHeader: boolean = false,
  tokens: ThemeTokens,
  overrides?: Partial<NodeStyleOverrides>
): ResolvedNodeStyle {
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
  } else {
    shadow = resolveTokenShadow(variantConfig.shadow, tokens);
  }

  // Selection uses accent color
  const selectedBorderColor = resolveTokenColor('--accent-9', tokens);

  // Header styling
  const headerPosition = HEADER_POSITION_MAP[header];
  const headerBackground = accentHeader
    ? resolveTokenColor('--accent-3', tokens)
    : resolveTokenColor('--gray-3', tokens);

  // Header height uses fixed row height token (--space-7 = 40px)
  // This ensures header aligns with socket rows for widget layout
  const headerHeight = resolveTokenPx(SOCKET_ROW_HEIGHT_TOKEN, tokens);

  // Resolve font size from token
  const fontSize = resolveTokenPx(sizeConfig.fontSize, tokens);

  return {
    padding,
    headerHeight,
    headerBackground,
    headerPosition,
    borderRadius,
    borderWidth,
    borderColor,
    borderColorHover,
    background,
    backgroundHover,
    backgroundAlpha,
    shadowBlur: shadow.blur,
    shadowOffsetY: shadow.offsetY,
    shadowOpacity: shadow.opacity,
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
  /** Socket circle radius in pixels */
  socketSize: number;
  /** Padding inside node (from size config) */
  padding: number;
}

/**
 * Resolve socket layout from theme tokens and node style settings.
 *
 * Layout order: Header (if inside) → Output rows → Input rows
 *
 * @param hasHeaderInside - Whether the node has an inside header
 * @param size - Node size for padding and socket size
 * @param tokens - Theme tokens for resolving --space-N values
 */
export function resolveSocketLayout(
  hasHeaderInside: boolean,
  size: NodeSize = '2',
  tokens: ThemeTokens
): ResolvedSocketLayout {
  const sizeConfig = SIZE_MAP[size];
  const rowHeight = resolveTokenPx(SOCKET_ROW_HEIGHT_TOKEN, tokens);
  const widgetHeight = resolveTokenPx(WIDGET_HEIGHT_TOKEN, tokens);
  const padding = resolveTokenPx(sizeConfig.padding, tokens);

  // Margin from top depends on header position:
  // - No header or outside header: marginTop = padding
  // - Inside header: marginTop = rowHeight + padding (skip header row)
  const marginTop = hasHeaderInside ? rowHeight + padding : padding;

  return {
    rowHeight,
    widgetHeight,
    marginTop,
    socketSize: sizeConfig.socketSize,
    padding,
  };
}

/**
 * Calculate the minimum height required for a node based on socket count.
 *
 * Height = marginTop + max(1, totalRows) * rowHeight + bottomPadding
 *
 * @param outputCount - Number of output sockets
 * @param inputCount - Number of input sockets
 * @param layout - Resolved socket layout
 * @returns Minimum required height in pixels
 */
export function calculateMinNodeHeight(
  outputCount: number,
  inputCount: number,
  layout: ResolvedSocketLayout
): number {
  const totalRows = outputCount + inputCount;
  // At least 1 row for nodes with no sockets
  const rows = Math.max(1, totalRows);
  return layout.marginTop + rows * layout.rowHeight + layout.padding;
}
