/**
 * Socket type resolution utilities.
 * Resolves theme token references (e.g., '--purple-9') to hex colors.
 */

import type { ThemeTokens } from '../hooks/useThemeTokens';
import { frozenHue } from '../core/palette';
import type { SocketType } from '../types';
import { rgbToHex, type RGBColor } from './color';

/**
 * Token keys that can be used in socket type colors.
 * Supports both scale-9 (legacy) and scale-10 (current default).
 */
type ColorTokenKey =
  | '--neutral-9'
  | '--neutral-10'
  | '--neutral-12'
  | '--blue-9'
  | '--blue-10'
  | '--purple-9'
  | '--purple-10'
  | '--violet-9'
  | '--violet-10'
  | '--success-9'
  | '--green-10'
  | '--destructive-9'
  | '--red-10'
  | '--amber-9'
  | '--amber-10'
  | '--cyan-9'
  | '--cyan-10'
  | '--pink-9'
  | '--pink-10'
  | '--teal-9'
  | '--teal-10'
  | '--orange-9'
  | '--orange-10';

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

  /**
   * The frozen palette FIRST, for the names it owns.
   *
   * The hue families a socket palette needs are not tokens any design system owes us — KookieUI v2
   * ships six distinct pigments and a graph needs nine — so they live in `core/palette.ts` at the
   * values v1 resolved. See that file for why they were frozen and what it gives up.
   *
   * THE ORDER WAS THEME-FIRST AND THAT WAS WRONG, measured on the far side of the swap: four of
   * these names — blue, amber, orange, green — DO exist in v2, at v2's own generated values, so a
   * theme-first resolver produced a per-family split whose only rationale was "the name still
   * resolves". Measured, `--blue-10` went from `#0588f0` to `rgb(0,122,240)` and `--green-9` from
   * a muted forest green to a near-fluorescent `#00f473`, while the other twenty-one kept the
   * frozen value. A palette that is half one system's and half another's is not a palette.
   *
   * So the freeze is the answer for every name in it, on both systems, and the trade this makes is
   * the one already recorded in `core/palette.ts`: an app that re-declares `--purple-10` in its
   * own CSS no longer moves the socket colour. The escape is `socketTypes`, which takes any CSS
   * colour verbatim — an app states its palette rather than overriding a token behind our back.
   */
  const frozen = frozenHue(color, tokens.appearance);
  if (frozen) return frozen;

  // Then the theme, for any token name the freeze does not own.
  const tokenValue = tokens[color as keyof ThemeTokens];
  if (tokenValue && Array.isArray(tokenValue) && tokenValue.length >= 3) {
    return rgbToHex(tokenValue as RGBColor);
  }

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
