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
  /**
   * On-node widget chrome, drawn in GL.
   *
   * A widget is a CONTROL on a surface, so it wears the field family's dress: a well one step off
   * the node body, a hairline, and the accent where it is filled or ticked.
   */
  widget: {
    /** The field well. One step off the node body so a control reads as recessed. */
    fill: '--neutral-3',
    /** The hairline. */
    border: '--neutral-6',
    /** A slider's unfilled channel, and a checkbox's box when it is off. */
    track: '--neutral-4',
    /**
     * The same three, one step up, for the pointer being over the control.
     *
     * Hover is +1 step and nothing else — no invented token, no new hue. That is the rule the
     * design system already applies to every variant it ships: `VARIANT_MAP` in
     * utils/style-resolver.ts moves a background one step up on hover and takes a border from 6 to
     * 7. A GL widget is a control on a surface like any other, so it wears the same convention
     * rather than a second one that would drift from it the first time the scale changed.
     */
    fillHover: '--neutral-4',
    trackHover: '--neutral-5',
    borderHover: '--neutral-7',
    /** The filled portion, a ticked box, a grabbed thumb. */
    active: '--accent-9',
    /** What sits ON the active fill — a tick, a label over a solid. */
    activeContrast: '--neutral-1',
    /** A slider's grip. */
    thumb: '--neutral-1',
  },

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
