import {
  parseColorToRGB,
  parsePx,
  setProbeHost,
  type RGBColor,
  withProbes,
} from '@kushagradhawan/kookie-flow-webgl/internal/utils/color';
import {
  FALLBACK_TOKENS,
  type ThemeTokens,
} from '@kushagradhawan/kookie-flow-webgl/internal/hooks/useThemeTokens';

/**
 * How the glass skin reads its token slots: KookieUI v2's CSS custom properties, under
 * `data-appearance` and `data-contrast`.
 */

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
 * Which appearance the theme root is in.
 *
 * The `.light` / `.dark` CLASSES are v1's spelling and are checked first only because a host page
 * may still carry them; v2 stamps `data-appearance` on the Theme element and its generated
 * selectors key on that attribute alone — measured, adding a `dark` class to a `.kui-theme` div
 * changes nothing, every token byte-identical. The attribute is the answer that matters.
 */
function detectAppearance(root: Element): 'light' | 'dark' {
  for (let element: Element | null = root; element; element = element.parentElement) {
    const appearance = element.getAttribute('data-appearance');
    if (appearance === 'light' || appearance === 'dark') return appearance;
    if (element.classList.contains('light')) return 'light';
    if (element.classList.contains('dark')) return 'dark';
  }

  // Check color-scheme CSS property as fallback
  const colorScheme = getComputedStyle(root).colorScheme;
  if (colorScheme?.includes('light')) return 'light';
  if (colorScheme?.includes('dark')) return 'dark';

  // Default to light
  return 'light';
}

/** v2's contrast rule: the stamped attribute wins; `auto` or none defers to the platform. */
function detectContrast(root: Element): 'normal' | 'high' {
  const attr = root.closest('[data-contrast]')?.getAttribute('data-contrast');
  if (attr === 'high') return 'high';
  if (attr === 'normal') return 'normal';
  return typeof matchMedia === 'function' && matchMedia('(prefers-contrast: more)').matches
    ? 'high'
    : 'normal';
}

/**
 * Read all theme tokens from CSS variables.
 */
export function readTokens(root: Element): ThemeTokens {
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
    '--radius-surface-1': getCSSVarPx(
      styles,
      '--radius-surface-1',
      FALLBACK_TOKENS['--radius-surface-1']
    ),
    '--radius-surface-2': getCSSVarPx(
      styles,
      '--radius-surface-2',
      FALLBACK_TOKENS['--radius-surface-2']
    ),
    '--radius-surface-3': getCSSVarPx(
      styles,
      '--radius-surface-3',
      FALLBACK_TOKENS['--radius-surface-3']
    ),
    '--radius-surface-4': getCSSVarPx(
      styles,
      '--radius-surface-4',
      FALLBACK_TOKENS['--radius-surface-4']
    ),

    // The layout families, read UNSHIFTED — the space shift above is for `--space-N` alone.
    '--surface-p-1': getCSSVarPx(styles, '--surface-p-1', FALLBACK_TOKENS['--surface-p-1']),
    '--surface-p-2': getCSSVarPx(styles, '--surface-p-2', FALLBACK_TOKENS['--surface-p-2']),
    '--surface-p-3': getCSSVarPx(styles, '--surface-p-3', FALLBACK_TOKENS['--surface-p-3']),
    '--surface-p-4': getCSSVarPx(styles, '--surface-p-4', FALLBACK_TOKENS['--surface-p-4']),
    '--control-height-1': getCSSVarPx(
      styles,
      '--control-height-1',
      FALLBACK_TOKENS['--control-height-1']
    ),
    '--control-height-2': getCSSVarPx(
      styles,
      '--control-height-2',
      FALLBACK_TOKENS['--control-height-2']
    ),
    '--control-height-3': getCSSVarPx(
      styles,
      '--control-height-3',
      FALLBACK_TOKENS['--control-height-3']
    ),
    '--control-height-4': getCSSVarPx(
      styles,
      '--control-height-4',
      FALLBACK_TOKENS['--control-height-4']
    ),
    '--control-px-1': getCSSVarPx(styles, '--control-px-1', FALLBACK_TOKENS['--control-px-1']),
    '--control-px-2': getCSSVarPx(styles, '--control-px-2', FALLBACK_TOKENS['--control-px-2']),
    '--control-px-3': getCSSVarPx(styles, '--control-px-3', FALLBACK_TOKENS['--control-px-3']),
    '--control-px-4': getCSSVarPx(styles, '--control-px-4', FALLBACK_TOKENS['--control-px-4']),
    '--control-px-pill-1': getCSSVarPx(
      styles,
      '--control-px-pill-1',
      FALLBACK_TOKENS['--control-px-pill-1']
    ),
    '--control-px-pill-2': getCSSVarPx(
      styles,
      '--control-px-pill-2',
      FALLBACK_TOKENS['--control-px-pill-2']
    ),
    '--control-px-pill-3': getCSSVarPx(
      styles,
      '--control-px-pill-3',
      FALLBACK_TOKENS['--control-px-pill-3']
    ),
    '--control-px-pill-4': getCSSVarPx(
      styles,
      '--control-px-pill-4',
      FALLBACK_TOKENS['--control-px-pill-4']
    ),
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
    '--radius-control-1': getCSSVarPx(
      styles,
      '--radius-control-1',
      FALLBACK_TOKENS['--radius-control-1']
    ),
    '--radius-control-2': getCSSVarPx(
      styles,
      '--radius-control-2',
      FALLBACK_TOKENS['--radius-control-2']
    ),
    '--radius-control-3': getCSSVarPx(
      styles,
      '--radius-control-3',
      FALLBACK_TOKENS['--radius-control-3']
    ),
    '--radius-control-4': getCSSVarPx(
      styles,
      '--radius-control-4',
      FALLBACK_TOKENS['--radius-control-4']
    ),
    '--radius-mark-1': getCSSVarPx(styles, '--radius-mark-1', FALLBACK_TOKENS['--radius-mark-1']),
    '--radius-mark-2': getCSSVarPx(styles, '--radius-mark-2', FALLBACK_TOKENS['--radius-mark-2']),
    '--radius-mark-3': getCSSVarPx(styles, '--radius-mark-3', FALLBACK_TOKENS['--radius-mark-3']),
    '--radius-mark-4': getCSSVarPx(styles, '--radius-mark-4', FALLBACK_TOKENS['--radius-mark-4']),
    '--icon-size-1': getCSSVarPx(styles, '--icon-size-1', FALLBACK_TOKENS['--icon-size-1']),
    '--icon-size-2': getCSSVarPx(styles, '--icon-size-2', FALLBACK_TOKENS['--icon-size-2']),
    '--icon-size-3': getCSSVarPx(styles, '--icon-size-3', FALLBACK_TOKENS['--icon-size-3']),
    '--icon-size-4': getCSSVarPx(styles, '--icon-size-4', FALLBACK_TOKENS['--icon-size-4']),
    '--slider-track-1': getCSSVarPx(
      styles,
      '--slider-track-1',
      FALLBACK_TOKENS['--slider-track-1']
    ),
    '--slider-track-2': getCSSVarPx(
      styles,
      '--slider-track-2',
      FALLBACK_TOKENS['--slider-track-2']
    ),
    '--slider-track-3': getCSSVarPx(
      styles,
      '--slider-track-3',
      FALLBACK_TOKENS['--slider-track-3']
    ),
    '--slider-track-4': getCSSVarPx(
      styles,
      '--slider-track-4',
      FALLBACK_TOKENS['--slider-track-4']
    ),
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
    '--accent-11': getCSSVarRGB(styles, '--accent-11', FALLBACK_TOKENS['--accent-11']),
    '--accent-glyph': getCSSVarRGB(styles, '--accent-glyph', FALLBACK_TOKENS['--accent-glyph']),
    '--accent-contrast': getCSSVarRGB(
      styles,
      '--accent-contrast',
      FALLBACK_TOKENS['--accent-contrast']
    ),
    '--destructive-9': getCSSVarRGB(styles, '--destructive-9', FALLBACK_TOKENS['--destructive-9']),
    '--success-9': getCSSVarRGB(styles, '--success-9', FALLBACK_TOKENS['--success-9']),

    // Radix colors (all 26 AccentColor values)

    // Radix colors step 10

    // Surfaces
    '--color-surface': getCSSVarRGB(styles, '--color-surface', FALLBACK_TOKENS['--color-surface']),

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
    contrast: detectContrast(root),
  }));
}
