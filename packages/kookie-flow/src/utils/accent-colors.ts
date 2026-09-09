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
 * Accent colour -> theme token, as a table.
 *
 * Derived from the `AccentColor` union: `Record<AccentColor, ...>` means a colour added to the
 * union without a row here fails `tsc`, so the table cannot silently fall behind the type it
 * mirrors. Built because the key used to be assembled with a template literal on every entity on
 * every frame.
 */
const ACCENT_TOKEN_KEY: Record<AccentColor, string> = {
  gray: '--gray-9',
  gold: '--gold-9',
  bronze: '--bronze-9',
  brown: '--brown-9',
  yellow: '--yellow-9',
  amber: '--amber-9',
  orange: '--orange-9',
  tomato: '--tomato-9',
  red: '--red-9',
  ruby: '--ruby-9',
  crimson: '--crimson-9',
  pink: '--pink-9',
  plum: '--plum-9',
  purple: '--purple-9',
  violet: '--violet-9',
  iris: '--iris-9',
  indigo: '--indigo-9',
  blue: '--blue-9',
  cyan: '--cyan-9',
  teal: '--teal-9',
  jade: '--jade-9',
  green: '--green-9',
  grass: '--grass-9',
  lime: '--lime-9',
  mint: '--mint-9',
  sky: '--sky-9',
};

/** Unknown colours already reported. See the warn site below for why this is not a per-frame log. */
const warned = new Set<string>();

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

  // Table lookup rather than `\`--${color}-9\``: this runs per entity per frame, and a template
  // literal allocates a string every time to name a key from a closed set of 26.
  //
  // The Array.isArray guard below STAYS. Nothing in this package validates `entity.color` at
  // runtime — it is only typed — so an unknown colour arriving from stored JSON is reachable, and
  // without the guard the lookup is undefined, `value[0]` throws inside useFrame, and R3F does not
  // catch frame-loop errors. The canvas would die rather than warn.
  const tokenKey = ACCENT_TOKEN_KEY[color] as keyof ThemeTokens | undefined;
  const value = tokenKey ? tokens[tokenKey] : undefined;

  // Check if it's a valid RGB array
  if (Array.isArray(value) && value.length >= 3) {
    return [value[0], value[1], value[2]];
  }

  // Fallback: return sentinel to use global accent.
  //
  // Once per colour, not once per frame. This runs per entity inside `useFrame`, so an entity
  // carrying a bad colour used to build a string and call into the console sixty times a second —
  // strictly more expensive than the allocation this change set exists to remove, and loud enough
  // to bury everything else in the log.
  if (!warned.has(color)) {
    warned.add(color);
    console.warn(`[kookie-flow] Unknown accent color: ${String(color)}`);
  }
  return NO_OVERRIDE_SENTINEL;
}
