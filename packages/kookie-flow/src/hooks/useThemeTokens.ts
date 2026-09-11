import { useState, useEffect } from 'react';
import { themeRoot } from '../utils/theme-root';
import { parseColorToRGB, parsePx, setProbeHost, type RGBColor, withProbes } from '../utils/color';

/**
 * Simplified shadow for WebGL (single drop shadow, not multi-layer CSS).
 */
export interface SimpleShadow {
  offsetY: number; // Vertical offset in pixels
  blur: number; // Blur radius in pixels
  opacity: number; // 0-1, applied to black
}

/**
 * Theme tokens read from Kookie UI CSS variables.
 * Values are resolved to WebGL-compatible formats (pixels, RGB arrays).
 */
export interface ThemeTokens {
  // Spacing (resolved to pixels)
  '--space-1': number;
  '--space-2': number;
  '--space-3': number;
  '--space-4': number;
  '--space-5': number;
  '--space-6': number;
  '--space-7': number;

  // Radius (resolved to pixels)
  '--radius-1': number;
  '--radius-2': number;
  '--radius-3': number;
  '--radius-4': number;
  '--radius-5': number;
  '--radius-6': number;
  '--radius-full': number;
  /**
   * The SURFACE half of the radius scale.
   *
   * v2 partitions the scale by role: `--radius-1..5` are controls and go to 9999px at the theme's
   * `full` level, `--radius-6..10` are surfaces and never do — at `full` they are the same
   * 24/32/40/48 they are at `large`. `--radius-surface-1..4` are the four indices a
   * `.kui-surface[data-size=N]` picks from, and a node body is a surface.
   */
  '--radius-surface-1': number;
  '--radius-surface-2': number;
  '--radius-surface-3': number;
  '--radius-surface-4': number;

  /**
   * The v2 LAYOUT families, read unshifted.
   *
   * The `+1` shift below applies to `--space-N` and to nothing else: the space palette is the raw
   * material v1 and v2 index differently, while these are named bands that mean the same thing on
   * both. Each is the number v2 hands a component of that role at that index, so a value in the
   * package can say WHICH ROLE it is playing instead of landing on a `--space-N` that happens to
   * have the right magnitude.
   */
  '--surface-p-1': number;
  '--surface-p-2': number;
  '--surface-p-3': number;
  '--surface-p-4': number;
  '--control-height-1': number;
  '--control-height-2': number;
  '--control-height-3': number;
  '--control-height-4': number;
  '--control-px-1': number;
  '--control-px-2': number;
  '--control-px-3': number;
  '--control-px-4': number;
  /**
   * A control's inner inset when its own corner is a pill.
   *
   * v2 sets `padding-inline` from this unconditionally and lets the token carry the bump — at every
   * radius level below `full` it IS `--control-px-N`, and at `full` it steps up (10 -> 14 at index
   * 2) because a capsule's curve eats the corner the text would otherwise sit in. Roundness buys
   * its own padding, and it is a token rather than a formula.
   */
  '--control-px-pill-1': number;
  '--control-px-pill-2': number;
  '--control-px-pill-3': number;
  '--control-px-pill-4': number;
  '--control-gap-1': number;
  '--control-gap-2': number;
  '--control-gap-3': number;
  '--control-gap-4': number;
  '--row-inset-1': number;
  '--row-inset-2': number;
  '--row-inset-3': number;
  '--row-inset-4': number;
  '--line-height-1': number;
  '--line-height-2': number;
  '--line-height-3': number;
  '--line-height-4': number;
  /** The checkbox square and the slider grip. Byte-identical to `--line-height-N` in v2, which is
   * what makes a mark land on its own label's line with no alignment rule at all. */
  '--mark-1': number;
  '--mark-2': number;
  '--mark-3': number;
  '--mark-4': number;
  '--radius-control-1': number;
  '--radius-control-2': number;
  '--radius-control-3': number;
  '--radius-control-4': number;
  '--icon-size-1': number;
  '--icon-size-2': number;
  '--icon-size-3': number;
  '--icon-size-4': number;
  '--slider-track-1': number;
  '--slider-track-2': number;
  '--slider-track-3': number;
  '--slider-track-4': number;
  /** `.kui-surface` and `.kui-control` are border-box and declare their border beside their
   * padding, so every content inset in this package is `padding + borderWidth`. */
  '--border-width': number;

  // Typography - Font sizes (resolved to pixels)
  // Used for entity labels and widget sizing alignment
  '--font-size-1': number;
  '--font-size-2': number;
  '--font-size-3': number;
  '--font-size-4': number;

  // Typography - Line heights (resolved to pixels)
  // Used for header heights to match text vertical rhythm

  // Gray scale (as RGB arrays [0-1] for WebGL)
  '--neutral-1': RGBColor;
  '--neutral-2': RGBColor;
  '--neutral-3': RGBColor;
  '--neutral-4': RGBColor;
  '--neutral-5': RGBColor;
  '--neutral-6': RGBColor;
  '--neutral-7': RGBColor;
  '--neutral-8': RGBColor;
  '--neutral-9': RGBColor;
  '--neutral-10': RGBColor;
  '--neutral-11': RGBColor;
  '--neutral-12': RGBColor;

  // Gray alpha variants

  // Accent colors (from Theme's accentColor prop)
  '--accent-3': RGBColor;
  '--accent-9': RGBColor;
  /** The ink that reads on an `--accent-9` fill, in both appearances. */
  '--accent-contrast': RGBColor;
  /**
   * The two SEMANTIC colours the graph uses, as MEANINGS rather than as hues.
   *
   * An invalid connection is destructive and a valid drop target is a success. Those are the names
   * KookieUI v2 gives them, and they are the one part of the old Radix hue palette that belongs to
   * a design system rather than to `core/palette.ts`: a graph owns "purple means image", nobody
   * owns "red means wrong". On v1 they resolve through `--red-9` / `--green-9`, which is what they
   * have always been.
   */
  '--destructive-9': RGBColor;
  '--success-9': RGBColor;

  // Radix color palette (all 26 AccentColor values at steps 9 and 10)
  // Used for socket types and per-entity color overrides
  // Note: --gray-9/10 are already defined in gray scale above

  // Step 10 (hovered solid backgrounds) — used by socket type colors

  // Surfaces
  '--color-surface': RGBColor;

  // Shadows (simplified for WebGL)
  '--shadow-1': SimpleShadow;
  '--shadow-2': SimpleShadow;
  '--shadow-3': SimpleShadow;
  '--shadow-4': SimpleShadow;
  '--shadow-5': SimpleShadow;

  // Meta
  '--scale': number;
  appearance: 'light' | 'dark';
}

/**
 * Default tokens for standalone mode (when Kookie UI is not present).
 * Uses dark mode defaults.
 */
export const FALLBACK_TOKENS: ThemeTokens = {
  // Spacing (assuming scaling = 1)
  '--space-1': 4,
  '--space-2': 8,
  '--space-3': 12,
  '--space-4': 16,
  '--space-5': 24,
  '--space-6': 32,
  '--space-7': 40,

  // Radius (actual Kookie UI values at scaling=1, radius-factor=1)
  '--radius-1': 6,
  '--radius-2': 8,
  '--radius-3': 10,
  '--radius-4': 12,
  '--radius-5': 16,
  '--radius-6': 20,
  '--radius-full': 9999,
  // v1 defines no surface family; these keep a v1 app on the radii it already had, with
  // `medium` -> surface-2 -> 12px, which is what `--radius-4` gave it.
  '--radius-surface-1': 8,
  '--radius-surface-2': 12,
  '--radius-surface-3': 16,
  '--radius-surface-4': 20,

  // The layout families at v2's default density and fine pointer, scale 1. v1 publishes none of
  // these names, so a v1 host lands here — and these are the numbers v1's own components used.
  '--surface-p-1': 16,
  '--surface-p-2': 24,
  '--surface-p-3': 32,
  '--surface-p-4': 40,
  '--control-height-1': 28,
  '--control-height-2': 32,
  '--control-height-3': 40,
  '--control-height-4': 48,
  '--control-px-1': 8,
  '--control-px-2': 10,
  '--control-px-3': 13,
  '--control-px-4': 16,
  // The non-pill values: v1 has no capsule level to bump for.
  '--control-px-pill-1': 8,
  '--control-px-pill-2': 10,
  '--control-px-pill-3': 13,
  '--control-px-pill-4': 16,
  '--control-gap-1': 4,
  '--control-gap-2': 8,
  '--control-gap-3': 8,
  '--control-gap-4': 12,
  '--row-inset-1': 4,
  '--row-inset-2': 5,
  '--row-inset-3': 5,
  '--row-inset-4': 6,
  '--line-height-1': 16,
  '--line-height-2': 20,
  '--line-height-3': 24,
  '--line-height-4': 26,
  '--mark-1': 16,
  '--mark-2': 20,
  '--mark-3': 24,
  '--mark-4': 26,
  '--radius-control-1': 4,
  '--radius-control-2': 6,
  '--radius-control-3': 8,
  '--radius-control-4': 10,
  '--icon-size-1': 16,
  '--icon-size-2': 16,
  '--icon-size-3': 20,
  '--icon-size-4': 24,
  '--slider-track-1': 4,
  '--slider-track-2': 5,
  '--slider-track-3': 6,
  '--slider-track-4': 7,
  '--border-width': 1,

  // Typography - Font sizes (assuming scaling = 1)
  '--font-size-1': 12,
  '--font-size-2': 14,
  '--font-size-3': 16,
  '--font-size-4': 18,

  // Typography - Line heights (assuming scaling = 1)

  // Gray (dark mode defaults)
  '--neutral-1': [0.067, 0.067, 0.067], // #111111
  '--neutral-2': [0.098, 0.098, 0.098], // #191919
  '--neutral-3': [0.133, 0.133, 0.133], // #222222
  '--neutral-4': [0.165, 0.165, 0.165], // #2a2a2a
  '--neutral-5': [0.196, 0.196, 0.196], // #323232
  '--neutral-6': [0.239, 0.239, 0.239], // #3d3d3d
  '--neutral-7': [0.306, 0.306, 0.306], // #4e4e4e
  '--neutral-8': [0.392, 0.392, 0.392], // #646464
  '--neutral-9': [0.545, 0.553, 0.596],
  '--neutral-10': [0.502, 0.514, 0.553],
  '--neutral-11': [0.737, 0.737, 0.737], // #bcbcbc
  '--neutral-12': [0.933, 0.933, 0.933], // #eeeeee

  // Gray alpha (approximate)

  // Accent (indigo defaults)
  '--accent-3': [0.114, 0.118, 0.208], // Subtle accent background (indigo-3)
  '--accent-9': [0.392, 0.404, 0.961], // #6366f5 (indigo-9)
  '--accent-contrast': [1, 1, 1],
  '--destructive-9': [0.898, 0.282, 0.302], // #e5484d — v1's --red-9
  '--success-9': [0.188, 0.643, 0.424], // #30a46c — v1's --green-9

  // Radix colors (all 26 AccentColor values at step 9, dark mode defaults)

  // Radix colors step 10 (hovered solid backgrounds, dark mode defaults)

  // Surfaces
  '--color-surface': [0.098, 0.098, 0.098],

  // Shadows (simplified approximations of CSS multi-layer shadows)
  '--shadow-1': { offsetY: 1, blur: 2, opacity: 0.1 },
  '--shadow-2': { offsetY: 2, blur: 4, opacity: 0.15 },
  '--shadow-3': { offsetY: 4, blur: 8, opacity: 0.2 },
  '--shadow-4': { offsetY: 6, blur: 12, opacity: 0.25 },
  '--shadow-5': { offsetY: 8, blur: 16, opacity: 0.3 },

  // Meta
  '--scale': 1,
  appearance: 'dark',
};

/**
 * Read a CSS variable from computed styles.
 *
 * This took `string | readonly string[]` and tried each name in turn — the mechanism that carried
 * the package across the v1 to v2 rename, reading the v2 name where it existed and the v1 name
 * where it did not, so one build was correct on both systems and the swap was bisectable. v1 is
 * gone, every one of the ~30 callers below passes a single string literal, and the array arm was
 * dead code describing a dual read that no longer happens.
 *
 * WHAT IS WORTH KEEPING is the hazard that arm existed to avoid, because it is still live and
 * still silent. `getPropertyValue` takes a custom-property NAME, not an expression. Handed a CSS
 * fallback chain — `'var(--neutral-2, var(--gray-2))'`, which is the obvious spelling — it
 * returns `''`. For every token. Every reader below then takes its fallback branch and the whole
 * of FALLBACK_TOKENS paints instead, and that table is entirely dark by construction: a light app
 * renders a black canvas with every token "present", every law green, and no warning anywhere.
 * Pass a name.
 */
function getCSSVar(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim();
}

/**
 * Read a CSS variable as a pixel value.
 */
function getCSSVarPx(
  styles: CSSStyleDeclaration,
  name: string,
  fallback: number
): number {
  const value = getCSSVar(styles, name);
  if (!value) return fallback;
  return parsePx(value);
}

/**
 * Read a CSS variable as an RGB color.
 */
function getCSSVarRGB(
  styles: CSSStyleDeclaration,
  name: string,
  fallback: RGBColor
): RGBColor {
  const value = getCSSVar(styles, name);
  if (!value) return fallback;
  return parseColorToRGB(value);
}


/**
 * Which appearance the theme root is in.
 *
 * The `.light` / `.dark` CLASSES are v1's spelling and are checked first only because a host page
 * may still carry them; v2 stamps `data-appearance` on the Theme element and its generated
 * selectors key on that attribute alone — measured, adding a `dark` class to a `.kui-theme` div
 * changes nothing, every token byte-identical. The attribute is the answer that matters.
 */
function detectAppearance(root: Element): 'light' | 'dark' {
  // Explicit class first, so an explicit light overrides an inherited dark.
  if (root.classList.contains('light')) return 'light';
  if (root.classList.contains('dark')) return 'dark';

  // Check for data attribute (some versions might use this)
  const dataAppearance = root.getAttribute('data-appearance');
  if (dataAppearance === 'light') return 'light';
  if (dataAppearance === 'dark') return 'dark';

  // Check color-scheme CSS property as fallback
  const colorScheme = getComputedStyle(root).colorScheme;
  if (colorScheme?.includes('light')) return 'light';
  if (colorScheme?.includes('dark')) return 'dark';

  // Default to light
  return 'light';
}

/**
 * Read all theme tokens from CSS variables.
 */
function readTokensFromDOM(root: Element): ThemeTokens {
  const styles = getComputedStyle(root);
  const appearance = detectAppearance(root);
  /**
   * Measure inside the theme, not beside it.
   *
   * A v2 length is `calc(var(--scale) * 12px)`, and the computed value of a custom property is
   * still a token stream — the `var()` is there when the probe is handed it. On the body, where
   * the probe used to live, `--scale` resolves to nothing, the calc is invalid, and the value
   * falls back: every `--scale` a product set was ignored and the graph stayed at 1 while the
   * page scaled around it.
   */
  setProbeHost(root);

  /**
   * The space scale is OFF BY ONE INDEX from what this reader's names say, and the shift is
   * kept rather than flattened.
   *
   * v1 emitted 4/8/12/16/24/32/40/48/64 for `--space-1..9`; v2 emits 2/4/8/12/16/24/32/40/48,
   * so v1's N is v2's N+1. The names on the left of this table are v1's, and the values they
   * resolve to are the ones every node metric was judged against — a socket row at 40px, a
   * widget at 32. Reading `--space-N` directly would shrink both by a fifth, which is a design
   * change wearing a migration's clothes. Re-judging them against v2's own ladder is a real
   * piece of work and belongs to something visible, not to a rename.
   */
  const space = (n: number) => `--space-${n + 1}` as const;

  // One attach/detach of the measuring probes for the whole pass rather than one per token.
  // The probes are ephemeral by design (see utils/color.ts — leaving one attached across a
  // React hydration render is what made the docs app throw a mismatch), and this pass resolves
  // over a hundred values, so without the wrapper it would append and remove an element that
  // many times on every mount and every theme change.
  return withProbes(() => ({
    // Spacing — see `space()` above for why the index moves.
    '--space-1': getCSSVarPx(styles, space(1), FALLBACK_TOKENS['--space-1']),
    '--space-2': getCSSVarPx(styles, space(2), FALLBACK_TOKENS['--space-2']),
    '--space-3': getCSSVarPx(styles, space(3), FALLBACK_TOKENS['--space-3']),
    '--space-4': getCSSVarPx(styles, space(4), FALLBACK_TOKENS['--space-4']),
    '--space-5': getCSSVarPx(styles, space(5), FALLBACK_TOKENS['--space-5']),
    '--space-6': getCSSVarPx(styles, space(6), FALLBACK_TOKENS['--space-6']),
    '--space-7': getCSSVarPx(styles, space(7), FALLBACK_TOKENS['--space-7']),

    // Radius
    '--radius-1': getCSSVarPx(styles, '--radius-1', FALLBACK_TOKENS['--radius-1']),
    '--radius-2': getCSSVarPx(styles, '--radius-2', FALLBACK_TOKENS['--radius-2']),
    '--radius-3': getCSSVarPx(styles, '--radius-3', FALLBACK_TOKENS['--radius-3']),
    '--radius-4': getCSSVarPx(styles, '--radius-4', FALLBACK_TOKENS['--radius-4']),
    '--radius-5': getCSSVarPx(styles, '--radius-5', FALLBACK_TOKENS['--radius-5']),
    '--radius-6': getCSSVarPx(styles, '--radius-6', FALLBACK_TOKENS['--radius-6']),
    '--radius-full': getCSSVarPx(styles, '--radius-full', FALLBACK_TOKENS['--radius-full']),
    '--radius-surface-1': getCSSVarPx(styles, '--radius-surface-1', FALLBACK_TOKENS['--radius-surface-1']),
    '--radius-surface-2': getCSSVarPx(styles, '--radius-surface-2', FALLBACK_TOKENS['--radius-surface-2']),
    '--radius-surface-3': getCSSVarPx(styles, '--radius-surface-3', FALLBACK_TOKENS['--radius-surface-3']),
    '--radius-surface-4': getCSSVarPx(styles, '--radius-surface-4', FALLBACK_TOKENS['--radius-surface-4']),

    // The layout families, read UNSHIFTED — the space shift above is for `--space-N` alone.
    '--surface-p-1': getCSSVarPx(styles, '--surface-p-1', FALLBACK_TOKENS['--surface-p-1']),
    '--surface-p-2': getCSSVarPx(styles, '--surface-p-2', FALLBACK_TOKENS['--surface-p-2']),
    '--surface-p-3': getCSSVarPx(styles, '--surface-p-3', FALLBACK_TOKENS['--surface-p-3']),
    '--surface-p-4': getCSSVarPx(styles, '--surface-p-4', FALLBACK_TOKENS['--surface-p-4']),
    '--control-height-1': getCSSVarPx(styles, '--control-height-1', FALLBACK_TOKENS['--control-height-1']),
    '--control-height-2': getCSSVarPx(styles, '--control-height-2', FALLBACK_TOKENS['--control-height-2']),
    '--control-height-3': getCSSVarPx(styles, '--control-height-3', FALLBACK_TOKENS['--control-height-3']),
    '--control-height-4': getCSSVarPx(styles, '--control-height-4', FALLBACK_TOKENS['--control-height-4']),
    '--control-px-1': getCSSVarPx(styles, '--control-px-1', FALLBACK_TOKENS['--control-px-1']),
    '--control-px-2': getCSSVarPx(styles, '--control-px-2', FALLBACK_TOKENS['--control-px-2']),
    '--control-px-3': getCSSVarPx(styles, '--control-px-3', FALLBACK_TOKENS['--control-px-3']),
    '--control-px-4': getCSSVarPx(styles, '--control-px-4', FALLBACK_TOKENS['--control-px-4']),
    '--control-px-pill-1': getCSSVarPx(styles, '--control-px-pill-1', FALLBACK_TOKENS['--control-px-pill-1']),
    '--control-px-pill-2': getCSSVarPx(styles, '--control-px-pill-2', FALLBACK_TOKENS['--control-px-pill-2']),
    '--control-px-pill-3': getCSSVarPx(styles, '--control-px-pill-3', FALLBACK_TOKENS['--control-px-pill-3']),
    '--control-px-pill-4': getCSSVarPx(styles, '--control-px-pill-4', FALLBACK_TOKENS['--control-px-pill-4']),
    '--control-gap-1': getCSSVarPx(styles, '--control-gap-1', FALLBACK_TOKENS['--control-gap-1']),
    '--control-gap-2': getCSSVarPx(styles, '--control-gap-2', FALLBACK_TOKENS['--control-gap-2']),
    '--control-gap-3': getCSSVarPx(styles, '--control-gap-3', FALLBACK_TOKENS['--control-gap-3']),
    '--control-gap-4': getCSSVarPx(styles, '--control-gap-4', FALLBACK_TOKENS['--control-gap-4']),
    '--row-inset-1': getCSSVarPx(styles, '--row-inset-1', FALLBACK_TOKENS['--row-inset-1']),
    '--row-inset-2': getCSSVarPx(styles, '--row-inset-2', FALLBACK_TOKENS['--row-inset-2']),
    '--row-inset-3': getCSSVarPx(styles, '--row-inset-3', FALLBACK_TOKENS['--row-inset-3']),
    '--row-inset-4': getCSSVarPx(styles, '--row-inset-4', FALLBACK_TOKENS['--row-inset-4']),
    '--line-height-1': getCSSVarPx(styles, '--line-height-1', FALLBACK_TOKENS['--line-height-1']),
    '--line-height-2': getCSSVarPx(styles, '--line-height-2', FALLBACK_TOKENS['--line-height-2']),
    '--line-height-3': getCSSVarPx(styles, '--line-height-3', FALLBACK_TOKENS['--line-height-3']),
    '--line-height-4': getCSSVarPx(styles, '--line-height-4', FALLBACK_TOKENS['--line-height-4']),
    '--mark-1': getCSSVarPx(styles, '--mark-1', FALLBACK_TOKENS['--mark-1']),
    '--mark-2': getCSSVarPx(styles, '--mark-2', FALLBACK_TOKENS['--mark-2']),
    '--mark-3': getCSSVarPx(styles, '--mark-3', FALLBACK_TOKENS['--mark-3']),
    '--mark-4': getCSSVarPx(styles, '--mark-4', FALLBACK_TOKENS['--mark-4']),
    '--radius-control-1': getCSSVarPx(styles, '--radius-control-1', FALLBACK_TOKENS['--radius-control-1']),
    '--radius-control-2': getCSSVarPx(styles, '--radius-control-2', FALLBACK_TOKENS['--radius-control-2']),
    '--radius-control-3': getCSSVarPx(styles, '--radius-control-3', FALLBACK_TOKENS['--radius-control-3']),
    '--radius-control-4': getCSSVarPx(styles, '--radius-control-4', FALLBACK_TOKENS['--radius-control-4']),
    '--icon-size-1': getCSSVarPx(styles, '--icon-size-1', FALLBACK_TOKENS['--icon-size-1']),
    '--icon-size-2': getCSSVarPx(styles, '--icon-size-2', FALLBACK_TOKENS['--icon-size-2']),
    '--icon-size-3': getCSSVarPx(styles, '--icon-size-3', FALLBACK_TOKENS['--icon-size-3']),
    '--icon-size-4': getCSSVarPx(styles, '--icon-size-4', FALLBACK_TOKENS['--icon-size-4']),
    '--slider-track-1': getCSSVarPx(styles, '--slider-track-1', FALLBACK_TOKENS['--slider-track-1']),
    '--slider-track-2': getCSSVarPx(styles, '--slider-track-2', FALLBACK_TOKENS['--slider-track-2']),
    '--slider-track-3': getCSSVarPx(styles, '--slider-track-3', FALLBACK_TOKENS['--slider-track-3']),
    '--slider-track-4': getCSSVarPx(styles, '--slider-track-4', FALLBACK_TOKENS['--slider-track-4']),
    '--border-width': getCSSVarPx(styles, '--border-width', FALLBACK_TOKENS['--border-width']),

    // Typography - Font sizes
    '--font-size-1': getCSSVarPx(styles, '--font-size-1', FALLBACK_TOKENS['--font-size-1']),
    '--font-size-2': getCSSVarPx(styles, '--font-size-2', FALLBACK_TOKENS['--font-size-2']),
    '--font-size-3': getCSSVarPx(styles, '--font-size-3', FALLBACK_TOKENS['--font-size-3']),
    '--font-size-4': getCSSVarPx(styles, '--font-size-4', FALLBACK_TOKENS['--font-size-4']),

    // Typography - Line heights

    // Gray scale
    '--neutral-1': getCSSVarRGB(styles, '--neutral-1', FALLBACK_TOKENS['--neutral-1']),
    '--neutral-2': getCSSVarRGB(styles, '--neutral-2', FALLBACK_TOKENS['--neutral-2']),
    '--neutral-3': getCSSVarRGB(styles, '--neutral-3', FALLBACK_TOKENS['--neutral-3']),
    '--neutral-4': getCSSVarRGB(styles, '--neutral-4', FALLBACK_TOKENS['--neutral-4']),
    '--neutral-5': getCSSVarRGB(styles, '--neutral-5', FALLBACK_TOKENS['--neutral-5']),
    '--neutral-6': getCSSVarRGB(styles, '--neutral-6', FALLBACK_TOKENS['--neutral-6']),
    '--neutral-7': getCSSVarRGB(styles, '--neutral-7', FALLBACK_TOKENS['--neutral-7']),
    '--neutral-8': getCSSVarRGB(styles, '--neutral-8', FALLBACK_TOKENS['--neutral-8']),
    '--neutral-9': getCSSVarRGB(styles, '--neutral-9', FALLBACK_TOKENS['--neutral-9']),
    '--neutral-10': getCSSVarRGB(styles, '--neutral-10', FALLBACK_TOKENS['--neutral-10']),
    '--neutral-11': getCSSVarRGB(styles, '--neutral-11', FALLBACK_TOKENS['--neutral-11']),
    '--neutral-12': getCSSVarRGB(styles, '--neutral-12', FALLBACK_TOKENS['--neutral-12']),

    // Gray alpha

    // Accent
    '--accent-3': getCSSVarRGB(styles, '--accent-3', FALLBACK_TOKENS['--accent-3']),
    '--accent-9': getCSSVarRGB(styles, '--accent-9', FALLBACK_TOKENS['--accent-9']),
    '--accent-contrast': getCSSVarRGB(styles, '--accent-contrast', FALLBACK_TOKENS['--accent-contrast']),
    '--destructive-9': getCSSVarRGB(styles, '--destructive-9', FALLBACK_TOKENS['--destructive-9']),
    '--success-9': getCSSVarRGB(styles, '--success-9', FALLBACK_TOKENS['--success-9']),

    // Radix colors (all 26 AccentColor values)

    // Radix colors step 10

    // Surfaces
    '--color-surface': getCSSVarRGB(
      styles,
      '--color-surface',
      FALLBACK_TOKENS['--color-surface']
    ),

    // Shadows - we use simplified single drop shadows
    // CSS shadows are too complex to parse reliably, so we use fallbacks
    '--shadow-1': FALLBACK_TOKENS['--shadow-1'],
    '--shadow-2': FALLBACK_TOKENS['--shadow-2'],
    '--shadow-3': FALLBACK_TOKENS['--shadow-3'],
    '--shadow-4': FALLBACK_TOKENS['--shadow-4'],
    '--shadow-5': FALLBACK_TOKENS['--shadow-5'],

    // Meta
    '--scale': getCSSVarPx(styles, '--scale', FALLBACK_TOKENS['--scale']),
    appearance,
  }));
}

/**
 * Read the tokens, then put the probes back where they were.
 *
 * The host is a module-level pointer at whichever element the last read was rooted at, so it has
 * to be cleared: a probe left pointing into a theme that has since unmounted would append itself
 * to a detached element, and every measurement after that would come back zero.
 */
function readTokensAndRelease(root: Element): ThemeTokens {
  try {
    return readTokensFromDOM(root);
  } finally {
    setProbeHost(null);
  }
}

/**
 * Check if tokens appear valid (not all zeros from failed CSS read).
 * During hydration, getComputedStyle may return empty/zero values briefly.
 */
function areTokensValid(tokens: ThemeTokens): boolean {
  /**
   * Two lengths that are non-zero under every legal theme configuration.
   *
   * `--radius-4` used to be the second one and it is NOT level-invariant: v2 emits
   * `--radius-4: 0px` under `[data-radius="none"]`, which is an ordinary setting a consumer can
   * choose. A zero there made this function report the read as FAILED, so the hook kept
   * FALLBACK_TOKENS — a table that is entirely dark by construction — and a light app rendered a
   * black canvas with the theme working perfectly. A validity check has to be about whether the
   * READ worked, never about what the designer chose.
   *
   * A type step is the right partner for a space step: both are non-zero at every density,
   * radius level, pointer world and appearance.
   */
  return tokens['--space-3'] > 0 && tokens['--font-size-2'] > 0;
}

/**
 * Hook to read Kookie UI theme tokens from CSS variables.
 *
 * - Reads from the `.kui-theme` element if present, otherwise from `:root`
 * - Watches for theme changes via MutationObserver
 * - Falls back to sensible defaults if Kookie UI is not present
 * - Skips invalid reads during hydration to prevent flickering
 *
 * @returns Theme tokens with WebGL-compatible values
 */
export function useThemeTokens(): ThemeTokens {
  // Lazy initializer: try to read tokens synchronously on first render
  // This avoids the dark→light flash from using FALLBACK_TOKENS initially
  const [tokens, setTokens] = useState<ThemeTokens>(() => {
    if (typeof document === 'undefined') return FALLBACK_TOKENS;
    const root = themeRoot();
    const domTokens = readTokensAndRelease(root);
    return areTokensValid(domTokens) ? domTokens : FALLBACK_TOKENS;
  });

  useEffect(() => {
    const root = themeRoot();

    // Compare tokens to avoid unnecessary re-renders
    /**
     * Compare every token, not a sample of four.
     *
     * This used to check appearance, --space-3, --radius-4 and --gray-6 only, which meant an
     * accent-only change was swallowed and the GL layer kept painting the previous accent. It runs
     * on a theme mutation, never per frame, so walking the whole record is free.
     */
    const tokensEqual = (a: ThemeTokens, b: ThemeTokens): boolean => {
      if (a.appearance !== b.appearance) return false;
      for (const key of Object.keys(a) as Array<keyof ThemeTokens>) {
        const av = a[key];
        const bv = b[key];
        if (Array.isArray(av)) {
          if (!Array.isArray(bv) || av.length !== bv.length) return false;
          for (let i = 0; i < av.length; i++) {
            if (av[i] !== bv[i]) return false;
          }
        } else if (av !== bv) {
          return false;
        }
      }
      return true;
    };

    const tryRead = () => {
      const newTokens = readTokensAndRelease(root);
      if (areTokensValid(newTokens)) {
        // Only update if tokens actually changed
        setTokens((prev) => tokensEqual(prev, newTokens) ? prev : newTokens);
        return true;
      }
      return false;
    };

    // Re-read in case CSS wasn't fully loaded during useState initializer
    tryRead();

    // If document isn't fully loaded yet, also listen for load event
    // (CSS vars may not be computed until stylesheets are loaded)
    const onLoad = () => tryRead();
    if (document.readyState !== 'complete') {
      window.addEventListener('load', onLoad);
    }

    // Watch for theme changes (accent color, gray color, etc.)
    const observer = new MutationObserver(() => tryRead());
    observer.observe(root, {
      attributes: true,
      attributeFilter: [
        // `class` is the important one and it was missing: Kookie UI v1's Theme carries the
        // light/dark appearance in className, not in a data attribute, and `detectAppearance`
        // reads `classList`. Without it a dark-mode toggle repainted every DOM control and left
        // every GL colour at the previous appearance's values.
        'class',
        'data-accent-color',
        'data-gray-color',
        'data-radius',
        'data-scaling',
        'data-is-root-theme',
        'data-font-family',
        'data-material',
        // v2 carries appearance and contrast as data attributes on the element it stamps.
        'data-appearance',
        'data-contrast',
        // The other three axes v2's Theme stamps, and each of them MOVES A VALUE this reader
        // consumes — this is the `class` defect above, re-committed on three new attributes if
        // they are left out. Measured against v2's emitted tokens: `[data-density="compact"]`
        // takes `--layout-space-3` from 8px to 4px and `--control-height-2` from 32px to 28px;
        // `[data-radius="none"]` takes `--radius-4` from 9999px to 0px; `[data-pointer="coarse"]`
        // re-prices the whole control ladder and raises the reading type steps.
        //
        // Latent today, on purpose: the reader consumes no density-, radius- or pointer-indexed
        // token yet, so nothing moves under v1. It is here rather than later because the cost of
        // forgetting is a graph frozen at the old palette while every DOM control repaints, which
        // is precisely the bug the `class` entry was added to fix.
        'data-density',
        'data-pointer',
        'data-depth',
      ],
    });

    return () => {
      window.removeEventListener('load', onLoad);
      observer.disconnect();
    };
  }, []);

  return tokens;
}
