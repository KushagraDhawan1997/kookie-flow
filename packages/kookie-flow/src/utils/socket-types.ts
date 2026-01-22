/**
 * Socket type resolution utilities.
 * Resolves theme token references (e.g., '--purple-9') to hex colors.
 */

import type { ThemeTokens } from '../hooks/useThemeTokens';
import type { SocketType } from '../types';
import { rgbToHex, type RGBColor } from './color';

/**
 * Token keys that can be used in socket type colors.
 */
type ColorTokenKey =
  | '--gray-9'
  | '--gray-12'
  | '--blue-9'
  | '--purple-9'
  | '--green-9'
  | '--red-9'
  | '--amber-9'
  | '--cyan-9'
  | '--pink-9'
  | '--teal-9'
  | '--orange-9';

/**
 * Check if a color string is a token reference.
 */
function isTokenReference(color: string): color is ColorTokenKey {
  return color.startsWith('--');
}

/**
 * Resolve a single socket type color.
 * If the color is a token reference (starts with '--'), resolve from tokens.
 * Otherwise, return the color as-is (hex, rgb, etc.).
 */
function resolveSocketColor(color: string, tokens: ThemeTokens): string {
  if (!isTokenReference(color)) {
    return color;
  }

  // Look up token value
  const tokenValue = tokens[color as keyof ThemeTokens];
  if (tokenValue && Array.isArray(tokenValue) && tokenValue.length >= 3) {
    return rgbToHex(tokenValue as RGBColor);
  }

  // Fallback if token not found
  console.warn(`[kookie-flow] Unknown color token: ${color}`);
  return '#808080';
}

/**
 * Resolve all socket type colors from theme tokens.
 * Returns a new object with resolved hex colors.
 *
 * @param socketTypes - Socket type definitions (may contain token references)
 * @param tokens - Theme tokens from useThemeTokens()
 * @returns Socket types with resolved hex colors
 */
export function resolveSocketTypes(
  socketTypes: Record<string, SocketType>,
  tokens: ThemeTokens
): Record<string, SocketType> {
  const resolved: Record<string, SocketType> = {};

  for (const [key, config] of Object.entries(socketTypes)) {
    resolved[key] = {
      ...config,
      color: resolveSocketColor(config.color, tokens),
    };
  }

  return resolved;
}
