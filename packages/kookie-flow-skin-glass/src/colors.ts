import type { SkinColors } from '@kushagradhawan/kookie-flow-webgl/internal/skin/types';

/**
 * Which KookieUI v2 token plays each colour role in the glass skin.
 * All values are token keys (e.g., '--neutral-8').
 */
export const GLASS_COLORS = {
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
    lines: '--neutral-8',
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
     * The field dress, from v2: `--dress-field-fill` is neutral-3 in both appearances, one step up
     * on hover and one more when active. The material draws it at a partial alpha over the card
     * (skin/glass/material.ts), so it is a well the card shows through rather than a punched hole.
     */
    fill: '--neutral-3',
    fillHover: '--neutral-4',
    fillActive: '--neutral-5',
    /** The mark's dress before it is checked: `--dress-mark-fill`, and its hover and active steps. */
    markFill: { light: '--neutral-4', dark: '--neutral-5' },
    markFillHover: { light: '--neutral-5', dark: '--neutral-6' },
    markFillActive: { light: '--neutral-6', dark: '--neutral-7' },
    /** A slider's channel: `--color-track`. */
    track: '--neutral-4',
    /** The filled portion, a checked mark, a swatch's cast. */
    active: '--accent-9',
    /** What sits ON the active fill — a tick, a label over a solid. */
    activeContrast: '--accent-contrast',
    /** A slider's grip: `--color-thumb`, the surface in light and near-white in dark. */
    thumb: { light: '--neutral-1', dark: '--neutral-12' },
    /** A select's chevron. */
    /**
     * v2's `--focus-ring`: accent-solid in light, accent-11 in dark, whatever the control's tone.
     * High contrast re-solves accent-11, so the ring follows without a rule of its own.
     */
    ring: { light: '--accent-9', dark: '--accent-11' },
    /** A select row's selected tick: `--accent-glyph`, a glyph in the accent on a neutral ground. */
    glyph: '--accent-glyph',
    /** A slider's channel under high contrast, where v2 re-solves `--color-track` to neutral-6. */
    trackHighContrast: '--neutral-6',
    /** The select chevron: neutral-12, drawn at the material's partial ink. */
    chevron: '--neutral-12',
    /**
     * A segmented control's raised thumb: the surface in light, a lift of the well in dark — never
     * the grip's near-white, which the content ink printed over it could not be read against.
     */
    segmentThumb: { light: '--neutral-1', dark: '--neutral-6' },
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
} as const satisfies SkinColors;
