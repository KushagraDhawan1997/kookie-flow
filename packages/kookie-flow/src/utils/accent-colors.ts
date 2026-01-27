/**
 * Per-node accent color resolution utilities.
 * Maps AccentColor names to theme tokens for WebGL rendering.
 */

import type { ThemeTokens } from '../hooks/useThemeTokens';
import type { AccentColor } from '../types';
import type { RGBColor } from './color';

/**
 * Sentinel value indicating "use global accent" (no per-node override).
 * When this is passed to the shader, it signals to use uniform colors.
 * Using -1 because valid RGB values are always 0-1.
 */
export const NO_OVERRIDE_SENTINEL: RGBColor = [-1, -1, -1];

/**
 * Resolve an AccentColor to its RGB value from theme tokens.
 * Returns the -9 (solid) variant for headers and selection.
 *
 * @param color - AccentColor name or undefined
 * @param tokens - Theme tokens from context
 * @returns RGB color array [0-1, 0-1, 0-1] or NO_OVERRIDE_SENTINEL if no override
 */
export function resolveAccentColorRGB(
  color: AccentColor | undefined,
  tokens: ThemeTokens
): RGBColor {
  if (!color) {
    return NO_OVERRIDE_SENTINEL;
  }

  // Build token key dynamically: 'indigo' -> '--indigo-9'
  const tokenKey = `--${color}-9` as keyof ThemeTokens;
  const value = tokens[tokenKey];

  // Check if it's a valid RGB array
  if (Array.isArray(value) && value.length >= 3) {
    return [value[0], value[1], value[2]];
  }

  // Fallback: return sentinel to use global accent
  console.warn(`[kookie-flow] Unknown accent color token: ${tokenKey}`);
  return NO_OVERRIDE_SENTINEL;
}
