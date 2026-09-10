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
 * Semantic color configuration.
 * All values are Kookie UI token keys (e.g., '--neutral-8').
 */
export const THEME_COLORS = {
  // ============================================
  // Canvas
  // ============================================
  canvas: {
    /** Dark: the floor everything floats above. Light: a step below the white card. */
    background: { light: '--neutral-2', dark: '--neutral-1' },
  },

  // ============================================
  // Grid
  // ============================================
  grid: {
    /** The dot lattice. Alpha is applied in grid.tsx per appearance. */
    lines: '--neutral-7',
    /** @deprecated The grid draws dots and no accent lines; kept for the public prop's type. */
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
    hover: '--neutral-7',
    /** A resize handle is an accent dot ringed in the card's own body colour. */
    handleFill: '--accent-9',
    handleBorder: { light: '--neutral-1', dark: '--neutral-3' },
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
    /**
     * The field well. Dark: punched through to the canvas, so a control reads as a hole in the
     * card. Light: a step below the white card. Same language, inverted with the value stack.
     */
    fill: { light: '--neutral-3', dark: '--neutral-1' },
    /** The hairline. */
    border: '--neutral-5',
    /** A slider's unfilled channel, and a checkbox's box when it is off. The well pair. */
    track: { light: '--neutral-3', dark: '--neutral-1' },
    /**
     * The same three, one step up, for the pointer being over the control.
     *
     * Hover is +1 step and nothing else — no invented token, no new hue. That is the rule the
     * design system already applies to every variant it ships: `VARIANT_MAP` in
     * utils/style-resolver.ts moves a background one step up on hover and takes a border one step
     * up. A GL widget is a control on a surface like any other, so it wears the same convention
     * rather than a second one that would drift from it the first time the scale changed.
     */
    fillHover: { light: '--neutral-4', dark: '--neutral-2' },
    trackHover: { light: '--neutral-4', dark: '--neutral-2' },
    borderHover: '--neutral-6',
    /** The filled portion, a ticked box, a grabbed thumb. */
    active: '--accent-9',
    /** What sits ON the active fill — a tick, a label over a solid. */
    activeContrast: '--accent-contrast',
    /** A slider's grip: the card's body colour, so it reads as sitting on the card. */
    thumb: { light: '--neutral-1', dark: '--neutral-3' },
    /** The hairline around the grip. */
    thumbRing: '--neutral-7',
    /** A select's chevron. */
    chevron: '--neutral-11',
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
