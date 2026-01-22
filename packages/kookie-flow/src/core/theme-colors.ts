/**
 * Semantic color configuration for Kookie Flow.
 *
 * All "what color should X be" decisions live here.
 * Maps semantic names to Kookie UI token keys.
 *
 * Components read from this config and resolve via useTheme().
 */

import type { ThemeTokens } from '../hooks/useThemeTokens';

/**
 * Token keys that can be used in color config.
 */
export type ColorTokenKey = keyof ThemeTokens & `--${string}`;

/**
 * Semantic color configuration.
 * All values are Kookie UI token keys (e.g., '--gray-8').
 */
export const THEME_COLORS = {
  // ============================================
  // Canvas
  // ============================================
  canvas: {
    background: '--gray-2',
  },

  // ============================================
  // Grid
  // ============================================
  grid: {
    lines: '--gray-3',
    linesAccent: '--gray-4',
  },

  // ============================================
  // Nodes
  // ============================================
  node: {
    // Backgrounds handled by variant system (style-resolver.ts)
    // These are for specific states
    borderSelected: '--accent-9',
  },

  // ============================================
  // Edges
  // ============================================
  edge: {
    default: '--gray-8',
    selected: '--accent-9',
    invalid: '--red-9',
  },

  // ============================================
  // Sockets
  // ============================================
  socket: {
    fallback: '--gray-8',
    invalid: '--red-9',
    validTarget: '--green-9',
  },

  // ============================================
  // Connection Line (drag preview)
  // ============================================
  connectionLine: {
    default: '--gray-8',
    invalid: '--red-9',
  },

  // ============================================
  // Selection Box
  // ============================================
  selectionBox: {
    fill: '--accent-9',
    border: '--accent-9',
  },

  // ============================================
  // Text
  // ============================================
  text: {
    primary: '--gray-12',
    secondary: '--gray-11',
  },

  // ============================================
  // Minimap
  // ============================================
  minimap: {
    background: '--gray-1',
    node: '--gray-8',
    nodeSelected: '--accent-9',
    viewport: '--accent-9',
  },
} as const;

/**
 * Helper to resolve a semantic color from tokens.
 *
 * @example
 * const tokens = useTheme();
 * const edgeColor = resolveColor(THEME_COLORS.edge.default, tokens);
 */
export function resolveColor(
  tokenKey: ColorTokenKey,
  tokens: ThemeTokens
): [number, number, number] {
  const value = tokens[tokenKey];
  if (Array.isArray(value) && value.length >= 3) {
    return [value[0], value[1], value[2]];
  }
  // Fallback gray
  return [0.5, 0.5, 0.5];
}
