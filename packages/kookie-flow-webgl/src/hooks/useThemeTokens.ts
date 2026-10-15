import { useState, useLayoutEffect } from 'react';
import { themeRoot } from '../utils/theme-root';
import { setProbeHost, type RGBColor } from '../utils/color';
import type { FlowSkin } from '../skin/types';

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
  /** A checkbox's corner at each size, per radius level — v2 restates it rather than scaling the control's. */
  '--radius-mark-1': number;
  '--radius-mark-2': number;
  '--radius-mark-3': number;
  '--radius-mark-4': number;
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
  /** The dark focus ring (`--focus-ring` is accent-solid in light, accent-11 in dark). */
  '--accent-11': RGBColor;
  /** A tick or a glyph in the accent on a neutral ground: a select row's selected mark. */
  '--accent-glyph': RGBColor;
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
  /**
   * v2's contrast axis: `high` when the Theme stamps `data-contrast="high"`, or when the platform
   * asks for more contrast and the Theme has not pinned `normal`. Most of what high contrast moves is
   * a token and arrives by itself; this is for the rules that are not a token, like a lit list row
   * becoming a solid fill.
   */
  contrast: 'normal' | 'high';
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
  '--radius-mark-1': 6,
  '--radius-mark-2': 6,
  '--radius-mark-3': 8,
  '--radius-mark-4': 8,
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
  '--accent-11': [0.537, 0.765, 1], // #89c3ff
  '--accent-glyph': [0.098, 0.6, 1], // #1999ff
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
  contrast: 'normal',
};

/**
 * Read the tokens, then put the probes back where they were.
 *
 * The host is a module-level pointer at whichever element the last read was rooted at, so it has
 * to be cleared: a probe left pointing into a theme that has since unmounted would append itself
 * to a detached element, and every measurement after that would come back zero.
 */
function readTokensAndRelease(skin: FlowSkin, root: Element): ThemeTokens {
  try {
    return skin.readTokens(root);
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
 * - Reads from the caller's inherited scope, otherwise from `:root`
 * - Watches scope/ancestor attributes and appearance-related media changes
 * - Falls back to sensible defaults if Kookie UI is not present
 * - Skips invalid reads during hydration to prevent flickering
 *
 * @returns Theme tokens with WebGL-compatible values
 */
export function useThemeTokens(scope: Element | null | undefined, skin: FlowSkin): ThemeTokens {
  // Lazy initializer: try to read tokens synchronously on first render
  // This avoids the dark→light flash from using FALLBACK_TOKENS initially
  const [tokens, setTokens] = useState<ThemeTokens>(() => {
    if (typeof document === 'undefined') return skin.fallbackTokens;
    const root = themeRoot(scope);
    if (!root) return skin.fallbackTokens;
    const domTokens = readTokensAndRelease(skin, root);
    return areTokensValid(domTokens) ? domTokens : skin.fallbackTokens;
  });

  useLayoutEffect(() => {
    const root = themeRoot(scope);

    if (!root) return;

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
      const newTokens = readTokensAndRelease(skin, root);
      if (areTokensValid(newTokens)) {
        // Only update if tokens actually changed
        setTokens((prev) => (tokensEqual(prev, newTokens) ? prev : newTokens));
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

    // An inherited theme can change on any ancestor. Observe attributes only: graph updates
    // inside the canvas must never cause CSS reads or React commits.
    const observer = new MutationObserver(() => tryRead());
    for (let element: Element | null = root; element; element = element.parentElement) {
      observer.observe(element, { attributes: true });
    }
    const media =
      typeof matchMedia === 'function'
        ? ['(prefers-color-scheme: dark)', '(prefers-contrast: more)', '(pointer: coarse)'].map(
            (q) => matchMedia(q)
          )
        : [];
    for (const query of media) query.addEventListener('change', onLoad);

    return () => {
      window.removeEventListener('load', onLoad);
      observer.disconnect();
      for (const query of media) query.removeEventListener('change', onLoad);
    };
  }, [scope, skin]);

  return tokens;
}
