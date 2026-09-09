import { useState, useEffect } from 'react';
import { themeRoot } from '../utils/theme-root';
import { parseColorToRGB, parsePx, type RGBColor } from '../utils/color';

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

  // Typography - Font sizes (resolved to pixels)
  // Used for entity labels and widget sizing alignment
  '--font-size-1': number;
  '--font-size-2': number;
  '--font-size-3': number;

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

  // Typography - Font sizes (assuming scaling = 1)
  '--font-size-1': 12,
  '--font-size-2': 14,
  '--font-size-3': 16,

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
 * Read a CSS variable from computed styles, trying each name in turn.
 *
 * The list is what carries this package across the v1 -> v2 rename: `'--neutral-2'`
 * reads the v2 name where it exists and the v1 name where it does not, so one build is correct on
 * both design systems and the swap is bisectable.
 *
 * WHY A LIST AND NOT A CSS `var()` FALLBACK CHAIN, which is the obvious spelling and is silently
 * catastrophic: `getPropertyValue` takes a custom-property NAME, not an expression. Handed
 * `'var(--neutral-2, var(--gray-2))'` it returns `''` — for EVERY token — so every reader below
 * takes its fallback branch and the whole of FALLBACK_TOKENS paints instead. That table is
 * entirely dark by construction (see its header), so a light app renders a black canvas with
 * every token "present", every law green, and no warning anywhere. The chain also cannot work in
 * principle here: v1 declares `--space-8` too, at a different value, so its arm would win.
 *
 * Order is v2-first, v1-second, deliberately: when both resolve — and 40 of the 99 names do — the
 * new system's value is the intended one.
 */
function getCSSVar(styles: CSSStyleDeclaration, name: string | readonly string[]): string {
  if (typeof name === 'string') return styles.getPropertyValue(name).trim();
  for (const n of name) {
    const v = styles.getPropertyValue(n).trim();
    if (v) return v;
  }
  return '';
}

/**
 * Read a CSS variable as a pixel value.
 */
function getCSSVarPx(
  styles: CSSStyleDeclaration,
  name: string | readonly string[],
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
  name: string | readonly string[],
  fallback: RGBColor
): RGBColor {
  const value = getCSSVar(styles, name);
  if (!value) return fallback;
  return parseColorToRGB(value);
}


/**
 * Detect appearance (light/dark) from a Radix Themes element.
 * Radix Themes uses .light/.dark classes, or inherits from system preference.
 */
function detectAppearance(root: Element): 'light' | 'dark' {
  // Check for explicit class (Radix Themes uses .light or .dark)
  // IMPORTANT: Check light FIRST since we want explicit light to override dark
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

  return {
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

    // Typography - Font sizes
    '--font-size-1': getCSSVarPx(styles, '--font-size-1', FALLBACK_TOKENS['--font-size-1']),
    '--font-size-2': getCSSVarPx(styles, '--font-size-2', FALLBACK_TOKENS['--font-size-2']),
    '--font-size-3': getCSSVarPx(styles, '--font-size-3', FALLBACK_TOKENS['--font-size-3']),

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
  };
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
    const domTokens = readTokensFromDOM(root);
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
      const newTokens = readTokensFromDOM(root);
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
