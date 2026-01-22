import { useState, useEffect } from 'react';
import { parseColorToRGB, parseColorToRGBA, parsePx, type RGBColor, type RGBAColor } from '../utils/color';

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

  // Radius (resolved to pixels)
  '--radius-1': number;
  '--radius-2': number;
  '--radius-3': number;
  '--radius-4': number;
  '--radius-5': number;
  '--radius-6': number;
  '--radius-full': number;

  // Gray scale (as RGB arrays [0-1] for WebGL)
  '--gray-1': RGBColor;
  '--gray-2': RGBColor;
  '--gray-3': RGBColor;
  '--gray-4': RGBColor;
  '--gray-5': RGBColor;
  '--gray-6': RGBColor;
  '--gray-7': RGBColor;
  '--gray-8': RGBColor;
  '--gray-9': RGBColor;
  '--gray-10': RGBColor;
  '--gray-11': RGBColor;
  '--gray-12': RGBColor;

  // Gray alpha variants
  '--gray-a3': RGBAColor;
  '--gray-a6': RGBAColor;

  // Accent colors (from Theme's accentColor prop)
  '--accent-9': RGBColor;
  '--accent-a3': RGBAColor;

  // Radix color palette (for socket types)
  '--blue-9': RGBColor;
  '--purple-9': RGBColor;
  '--green-9': RGBColor;
  '--red-9': RGBColor;
  '--amber-9': RGBColor;
  '--cyan-9': RGBColor;
  '--pink-9': RGBColor;
  '--teal-9': RGBColor;
  '--orange-9': RGBColor;

  // Surfaces
  '--color-surface-solid': RGBColor;

  // Shadows (simplified for WebGL)
  '--shadow-1': SimpleShadow;
  '--shadow-2': SimpleShadow;
  '--shadow-3': SimpleShadow;
  '--shadow-4': SimpleShadow;
  '--shadow-5': SimpleShadow;
  '--shadow-6': SimpleShadow;

  // Meta
  '--scaling': number;
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

  // Radius (actual Kookie UI values at scaling=1, radius-factor=1)
  '--radius-1': 6,
  '--radius-2': 8,
  '--radius-3': 10,
  '--radius-4': 12,
  '--radius-5': 16,
  '--radius-6': 20,
  '--radius-full': 9999,

  // Gray (dark mode defaults)
  '--gray-1': [0.067, 0.067, 0.067], // #111111
  '--gray-2': [0.098, 0.098, 0.098], // #191919
  '--gray-3': [0.133, 0.133, 0.133], // #222222
  '--gray-4': [0.165, 0.165, 0.165], // #2a2a2a
  '--gray-5': [0.196, 0.196, 0.196], // #323232
  '--gray-6': [0.239, 0.239, 0.239], // #3d3d3d
  '--gray-7': [0.306, 0.306, 0.306], // #4e4e4e
  '--gray-8': [0.392, 0.392, 0.392], // #646464
  '--gray-9': [0.553, 0.553, 0.553], // #8d8d8d
  '--gray-10': [0.627, 0.627, 0.627], // #a0a0a0
  '--gray-11': [0.737, 0.737, 0.737], // #bcbcbc
  '--gray-12': [0.933, 0.933, 0.933], // #eeeeee

  // Gray alpha (approximate)
  '--gray-a3': [0.133, 0.133, 0.133, 0.5],
  '--gray-a6': [0.239, 0.239, 0.239, 0.5],

  // Accent (indigo defaults)
  '--accent-9': [0.392, 0.404, 0.961], // #6366f5 (indigo-9)
  '--accent-a3': [0.392, 0.404, 0.961, 0.3],

  // Radix colors for sockets
  '--blue-9': [0.0, 0.565, 1.0], // #0090ff
  '--purple-9': [0.557, 0.341, 0.969], // #8e57f7
  '--green-9': [0.18, 0.71, 0.486], // #2eb77c
  '--red-9': [0.906, 0.318, 0.365], // #e7515d
  '--amber-9': [1.0, 0.773, 0.239], // #ffc53d
  '--cyan-9': [0.0, 0.647, 0.773], // #00a5c5
  '--pink-9': [0.878, 0.365, 0.576], // #e05d93
  '--teal-9': [0.133, 0.631, 0.596], // #22a198
  '--orange-9': [0.973, 0.522, 0.204], // #f88534

  // Surfaces
  '--color-surface-solid': [0.098, 0.098, 0.098],

  // Shadows (simplified approximations of CSS multi-layer shadows)
  '--shadow-1': { offsetY: 1, blur: 2, opacity: 0.1 },
  '--shadow-2': { offsetY: 2, blur: 4, opacity: 0.15 },
  '--shadow-3': { offsetY: 4, blur: 8, opacity: 0.2 },
  '--shadow-4': { offsetY: 6, blur: 12, opacity: 0.25 },
  '--shadow-5': { offsetY: 8, blur: 16, opacity: 0.3 },
  '--shadow-6': { offsetY: 12, blur: 24, opacity: 0.35 },

  // Meta
  '--scaling': 1,
  appearance: 'dark',
};

/**
 * Read a CSS variable value from computed styles.
 * Returns empty string if not found.
 */
function getCSSVar(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim();
}

/**
 * Read a CSS variable as a pixel value.
 */
function getCSSVarPx(styles: CSSStyleDeclaration, name: string, fallback: number): number {
  const value = getCSSVar(styles, name);
  if (!value) return fallback;
  return parsePx(value);
}

/**
 * Read a CSS variable as an RGB color.
 */
function getCSSVarRGB(styles: CSSStyleDeclaration, name: string, fallback: RGBColor): RGBColor {
  const value = getCSSVar(styles, name);
  if (!value) return fallback;
  return parseColorToRGB(value);
}

/**
 * Read a CSS variable as an RGBA color.
 */
function getCSSVarRGBA(styles: CSSStyleDeclaration, name: string, fallback: RGBAColor): RGBAColor {
  const value = getCSSVar(styles, name);
  if (!value) return fallback;
  return parseColorToRGBA(value);
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

  return {
    // Spacing
    '--space-1': getCSSVarPx(styles, '--space-1', FALLBACK_TOKENS['--space-1']),
    '--space-2': getCSSVarPx(styles, '--space-2', FALLBACK_TOKENS['--space-2']),
    '--space-3': getCSSVarPx(styles, '--space-3', FALLBACK_TOKENS['--space-3']),
    '--space-4': getCSSVarPx(styles, '--space-4', FALLBACK_TOKENS['--space-4']),
    '--space-5': getCSSVarPx(styles, '--space-5', FALLBACK_TOKENS['--space-5']),
    '--space-6': getCSSVarPx(styles, '--space-6', FALLBACK_TOKENS['--space-6']),

    // Radius
    '--radius-1': getCSSVarPx(styles, '--radius-1', FALLBACK_TOKENS['--radius-1']),
    '--radius-2': getCSSVarPx(styles, '--radius-2', FALLBACK_TOKENS['--radius-2']),
    '--radius-3': getCSSVarPx(styles, '--radius-3', FALLBACK_TOKENS['--radius-3']),
    '--radius-4': getCSSVarPx(styles, '--radius-4', FALLBACK_TOKENS['--radius-4']),
    '--radius-5': getCSSVarPx(styles, '--radius-5', FALLBACK_TOKENS['--radius-5']),
    '--radius-6': getCSSVarPx(styles, '--radius-6', FALLBACK_TOKENS['--radius-6']),
    '--radius-full': getCSSVarPx(styles, '--radius-full', FALLBACK_TOKENS['--radius-full']),

    // Gray scale
    '--gray-1': getCSSVarRGB(styles, '--gray-1', FALLBACK_TOKENS['--gray-1']),
    '--gray-2': getCSSVarRGB(styles, '--gray-2', FALLBACK_TOKENS['--gray-2']),
    '--gray-3': getCSSVarRGB(styles, '--gray-3', FALLBACK_TOKENS['--gray-3']),
    '--gray-4': getCSSVarRGB(styles, '--gray-4', FALLBACK_TOKENS['--gray-4']),
    '--gray-5': getCSSVarRGB(styles, '--gray-5', FALLBACK_TOKENS['--gray-5']),
    '--gray-6': getCSSVarRGB(styles, '--gray-6', FALLBACK_TOKENS['--gray-6']),
    '--gray-7': getCSSVarRGB(styles, '--gray-7', FALLBACK_TOKENS['--gray-7']),
    '--gray-8': getCSSVarRGB(styles, '--gray-8', FALLBACK_TOKENS['--gray-8']),
    '--gray-9': getCSSVarRGB(styles, '--gray-9', FALLBACK_TOKENS['--gray-9']),
    '--gray-10': getCSSVarRGB(styles, '--gray-10', FALLBACK_TOKENS['--gray-10']),
    '--gray-11': getCSSVarRGB(styles, '--gray-11', FALLBACK_TOKENS['--gray-11']),
    '--gray-12': getCSSVarRGB(styles, '--gray-12', FALLBACK_TOKENS['--gray-12']),

    // Gray alpha
    '--gray-a3': getCSSVarRGBA(styles, '--gray-a3', FALLBACK_TOKENS['--gray-a3']),
    '--gray-a6': getCSSVarRGBA(styles, '--gray-a6', FALLBACK_TOKENS['--gray-a6']),

    // Accent
    '--accent-9': getCSSVarRGB(styles, '--accent-9', FALLBACK_TOKENS['--accent-9']),
    '--accent-a3': getCSSVarRGBA(styles, '--accent-a3', FALLBACK_TOKENS['--accent-a3']),

    // Radix colors for sockets
    '--blue-9': getCSSVarRGB(styles, '--blue-9', FALLBACK_TOKENS['--blue-9']),
    '--purple-9': getCSSVarRGB(styles, '--purple-9', FALLBACK_TOKENS['--purple-9']),
    '--green-9': getCSSVarRGB(styles, '--green-9', FALLBACK_TOKENS['--green-9']),
    '--red-9': getCSSVarRGB(styles, '--red-9', FALLBACK_TOKENS['--red-9']),
    '--amber-9': getCSSVarRGB(styles, '--amber-9', FALLBACK_TOKENS['--amber-9']),
    '--cyan-9': getCSSVarRGB(styles, '--cyan-9', FALLBACK_TOKENS['--cyan-9']),
    '--pink-9': getCSSVarRGB(styles, '--pink-9', FALLBACK_TOKENS['--pink-9']),
    '--teal-9': getCSSVarRGB(styles, '--teal-9', FALLBACK_TOKENS['--teal-9']),
    '--orange-9': getCSSVarRGB(styles, '--orange-9', FALLBACK_TOKENS['--orange-9']),

    // Surfaces
    '--color-surface-solid': getCSSVarRGB(
      styles,
      '--color-surface-solid',
      FALLBACK_TOKENS['--color-surface-solid']
    ),

    // Shadows - we use simplified single drop shadows
    // CSS shadows are too complex to parse reliably, so we use fallbacks
    '--shadow-1': FALLBACK_TOKENS['--shadow-1'],
    '--shadow-2': FALLBACK_TOKENS['--shadow-2'],
    '--shadow-3': FALLBACK_TOKENS['--shadow-3'],
    '--shadow-4': FALLBACK_TOKENS['--shadow-4'],
    '--shadow-5': FALLBACK_TOKENS['--shadow-5'],
    '--shadow-6': FALLBACK_TOKENS['--shadow-6'],

    // Meta
    '--scaling': getCSSVarPx(styles, '--scaling', FALLBACK_TOKENS['--scaling']),
    appearance,
  };
}

/**
 * Check if tokens appear valid (not all zeros from failed CSS read).
 * During hydration, getComputedStyle may return empty/zero values briefly.
 */
function areTokensValid(tokens: ThemeTokens): boolean {
  // Check a few critical values - if these are all 0, the read likely failed
  return tokens['--space-3'] > 0 && tokens['--radius-4'] > 0;
}

/**
 * Hook to read Kookie UI theme tokens from CSS variables.
 *
 * - Reads from `.radix-themes` element if present, otherwise from `:root`
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
    const root = document.querySelector('.radix-themes') ?? document.documentElement;
    const domTokens = readTokensFromDOM(root);
    return areTokensValid(domTokens) ? domTokens : FALLBACK_TOKENS;
  });

  useEffect(() => {
    const root = document.querySelector('.radix-themes') ?? document.documentElement;

    // Compare tokens to avoid unnecessary re-renders
    const tokensEqual = (a: ThemeTokens, b: ThemeTokens): boolean => {
      // Quick check on appearance first (most likely to change)
      if (a.appearance !== b.appearance) return false;
      // Check a few critical numeric values
      if (a['--space-3'] !== b['--space-3']) return false;
      if (a['--radius-4'] !== b['--radius-4']) return false;
      // Check a color (arrays need element comparison)
      const aGray = a['--gray-6'];
      const bGray = b['--gray-6'];
      if (aGray[0] !== bGray[0] || aGray[1] !== bGray[1] || aGray[2] !== bGray[2]) return false;
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
        'data-accent-color',
        'data-gray-color',
        'data-radius',
        'data-scaling',
        'data-is-root-theme',
      ],
    });

    return () => {
      window.removeEventListener('load', onLoad);
      observer.disconnect();
    };
  }, []);

  return tokens;
}
