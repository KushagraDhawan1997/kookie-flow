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
 * All values are Kookie UI token keys (e.g., '--neutral-8').
 */
export const THEME_COLORS = {
  // ============================================
  // Canvas
  // ============================================
  canvas: {
    background: '--neutral-2',
  },

  // ============================================
  // Grid
  // ============================================
  grid: {
    lines: '--neutral-3',
    linesAccent: '--neutral-4',
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
    default: '--neutral-8',
    selected: '--accent-9',
    invalid: '--destructive-9',
  },

  // ============================================
  // Sockets
  // ============================================
  socket: {
    fallback: '--neutral-8',
    invalid: '--destructive-9',
    validTarget: '--success-9',
  },

  // ============================================
  // Connection Line (drag preview)
  // ============================================
  connectionLine: {
    default: '--neutral-8',
    invalid: '--destructive-9',
  },

  // ============================================
  // Selection Box (drag-to-select)
  // ============================================
  selectionBox: {
    fill: '--accent-9',
    border: '--accent-9',
  },

  // ============================================
  // Entity Selection Outline + Resize Handles
  // ============================================
  entitySelection: {
    selected: '--accent-9',
    hover: '--neutral-8',
    handleFill: '--neutral-1',
    handleBorder: '--accent-9',
  },

  // ============================================
  // Text
  // ============================================
  text: {
    primary: '--neutral-12',
    secondary: '--neutral-11',
  },

  // ============================================
  // Minimap
  // Note: Alpha values for background (0.9) and viewport fill (0.3)
  // are applied in the minimap component itself.
  // Shadow uses var(--shadow-3) directly from Kookie UI.
  // ============================================
  minimap: {
    background: '--neutral-1',
    node: '--neutral-4',
    nodeSelected: '--accent-9',
    viewport: '--accent-9',
    viewportBorder: '--accent-9',
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
