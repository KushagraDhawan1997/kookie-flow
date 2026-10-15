/**
 * How a colour role resolves to a token.
 *
 * Which token plays which role is the skin's decision (`FlowSkin.colors`); this file only knows
 * how to collapse a role to a key for an appearance and read it out of the tokens.
 */

import type { ThemeTokens } from '../hooks/useThemeTokens';

/**
 * Token keys that can be used in color config.
 */
export type ColorTokenKey = keyof ThemeTokens & `--${string}`;

/**
 * A colour that is one token, or one token PER APPEARANCE.
 *
 * The value stack inverts between themes — in dark the canvas is the darkest thing and a card sits
 * a step above it; in light the canvas is a step below a white card — so a role like "the well"
 * cannot be one token index in both. A pair says which token plays the role in each appearance,
 * and `pickToken` collapses it to a key at material build, never per frame.
 */
export type ColorTokenRef = ColorTokenKey | { light: ColorTokenKey; dark: ColorTokenKey };

export function pickToken(ref: ColorTokenRef, appearance: 'light' | 'dark'): ColorTokenKey {
  return typeof ref === 'string' ? ref : ref[appearance];
}

/**
 * Helper to resolve a semantic color from tokens.
 *
 * @example
 * const tokens = useTheme();
 * const edgeColor = resolveColor(colors.edge.default, tokens);
 */
export function resolveColor(
  tokenKey: ColorTokenRef,
  tokens: ThemeTokens
): [number, number, number] {
  const value = tokens[pickToken(tokenKey, tokens.appearance)];
  if (Array.isArray(value) && value.length >= 3) {
    return [value[0], value[1], value[2]];
  }
  // Fallback gray
  return [0.5, 0.5, 0.5];
}

/** @deprecated The glass skin's colour roles. Use `useSkin().colors`. */
export { GLASS_COLORS as THEME_COLORS } from '../skin/glass/colors';
