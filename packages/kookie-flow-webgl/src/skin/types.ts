/**
 * The contract between the renderer and a skin.
 *
 * The renderer owns behaviour: geometry, hit testing, state, interaction, accessibility, text.
 * A skin owns how that looks: which token plays which role, the lengths each size and variant
 * take, the material numbers, and how theme tokens are read off the page. The renderer reads the
 * skin once at material build, never per frame.
 *
 * Token keys (`keyof ThemeTokens`) are the renderer's own vocabulary of slots. A skin built on a
 * different design system fills the same slots from its own CSS through `readTokens`.
 */

import type { ThemeTokens } from '../hooks/useThemeTokens';
import type { ColorTokenRef } from '../core/theme-colors';
import type { EntityRadius, EntitySize, EntityVariant } from '../types/index';
import type { Material } from './glass/material';

export interface SizeConfig {
  /** Token slot for padding */
  padding: keyof ThemeTokens;
  /** Token slot for border radius */
  borderRadius: keyof ThemeTokens;
  /** Token slot for font size */
  fontSize: keyof ThemeTokens;
  /** Socket radius in pixels */
  socketSize: number;
}

export interface VariantConfig {
  /** Background color token or 'transparent' */
  background: ColorTokenRef | 'transparent';
  /** Background color on hover */
  backgroundHover: ColorTokenRef;
  /** Border color token or 'transparent' */
  borderColor: ColorTokenRef | 'transparent';
  /** Border color on hover */
  borderColorHover: ColorTokenRef | 'transparent';
  /** Border width in pixels */
  borderWidth: number;
  /** Shadow token, 'none', or 'node' — the card's own float (`nodeShadow`) */
  shadow: keyof ThemeTokens | 'none' | 'node';
}

export interface SkinMetrics {
  sizes: Record<EntitySize, SizeConfig>;
  variants: Record<EntityVariant, VariantConfig>;
  radii: Record<EntityRadius, keyof ThemeTokens | 0>;
  widgetRadii: Record<EntityRadius, keyof ThemeTokens | 0>;
  markRadii: Record<EntityRadius, readonly [number, number, number, number]>;
  /** The card's own float: one drop shadow, opacity per appearance. */
  nodeShadow: {
    readonly blur: number;
    readonly offsetY: number;
    readonly opacity: { readonly light: number; readonly dark: number };
  };
  /** Alpha of the white band inside a card's top edge, per appearance. */
  nodeTopLight: { readonly light: number; readonly dark: number };
  /** The header and socket row height. */
  socketRowHeightToken: keyof ThemeTokens;
  widgetHeightToken: keyof ThemeTokens;
}

/** Which token plays each colour role. */
export interface SkinColors {
  canvas: { background: ColorTokenRef };
  grid: { lines: ColorTokenRef; linesAccent: ColorTokenRef };
  node: { borderSelected: ColorTokenRef };
  edge: { default: ColorTokenRef; selected: ColorTokenRef; invalid: ColorTokenRef };
  socket: { fallback: ColorTokenRef; invalid: ColorTokenRef; validTarget: ColorTokenRef };
  connectionLine: { default: ColorTokenRef; invalid: ColorTokenRef };
  selectionBox: { fill: ColorTokenRef; border: ColorTokenRef };
  entitySelection: {
    selected: ColorTokenRef;
    hover: ColorTokenRef;
    handleFill: ColorTokenRef;
    handleBorder: ColorTokenRef;
  };
  widget: {
    fill: ColorTokenRef;
    fillHover: ColorTokenRef;
    fillActive: ColorTokenRef;
    markFill: ColorTokenRef;
    markFillHover: ColorTokenRef;
    markFillActive: ColorTokenRef;
    track: ColorTokenRef;
    active: ColorTokenRef;
    activeContrast: ColorTokenRef;
    thumb: ColorTokenRef;
    ring: ColorTokenRef;
    glyph: ColorTokenRef;
    trackHighContrast: ColorTokenRef;
    chevron: ColorTokenRef;
    segmentThumb: ColorTokenRef;
  };
  text: { primary: ColorTokenRef; secondary: ColorTokenRef };
  minimap: {
    background: ColorTokenRef;
    node: ColorTokenRef;
    nodeSelected: ColorTokenRef;
    viewport: ColorTokenRef;
    viewportBorder: ColorTokenRef;
  };
}

export interface FlowSkin {
  readonly name: string;
  readonly colors: SkinColors;
  readonly metrics: SkinMetrics;
  /**
   * The material numbers, one record per appearance. Still glass-shaped: the shader code that
   * consumes them moves into the skin in a later step, and then this becomes skin-private.
   */
  readonly material: Record<'light' | 'dark', Material>;
  /** Tokens used before the page's theme can be read, and when it cannot. */
  readonly fallbackTokens: ThemeTokens;
  /** Read every token slot from the theme root's computed style. Called on theme change only. */
  readTokens(root: Element): ThemeTokens;
}
