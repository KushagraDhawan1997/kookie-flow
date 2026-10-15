/**
 * The contract between the renderer and a skin.
 *
 * The renderer owns behaviour: geometry, hit testing, state, interaction, accessibility, text.
 * A skin owns how that looks: which token plays which role, the lengths each size and variant
 * take, how each surface is painted (its shader code), the DOM chrome's components, and how theme
 * tokens are read off the page. The renderer reads the skin once at material build, never per
 * frame.
 *
 * Token keys (`keyof ThemeTokens`) are the renderer's own vocabulary of slots. A skin built on a
 * different design system fills the same slots from its own CSS through `readTokens`.
 */

import type { ThemeTokens } from '../hooks/useThemeTokens';
import type { ColorTokenRef } from '../core/theme-colors';
import type { EntityRadius, EntitySize, EntityVariant } from '../types/index';
import type { IUniform } from 'three';
import type {
  ChangeEvent,
  ComponentType,
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from 'react';

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
  /** The keyboard focus ring around a control: its width and its gap from the edge, in px. */
  focusRing: { readonly width: number; readonly offset: number };
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

/** What a skin's uniform builder is given. Called at material build, never per frame. */
export interface SkinShaderContext {
  tokens: ThemeTokens;
  colors: SkinColors;
}

/**
 * A skin's part of one shader: GLSL declaring its private uniforms and defining the paint
 * functions the renderer calls, plus the values of those uniforms.
 *
 * The renderer includes `SDF_GLSL` and `COMPOSITE_GLSL` before `glsl`, so a skin may use the
 * shapes and `over`/`overC`. Skin uniform names must not collide with the renderer's own.
 */
export interface SkinShader {
  readonly glsl: string;
  uniforms(ctx: SkinShaderContext): Record<string, IUniform>;
}

/**
 * The card's outline, shared by every shader that draws or follows a card: the body, its
 * selection outline, comments and media. `glsl` defines `float roundedBoxSDF(vec2 p, vec2 b, float r)`;
 * the renderer multiplies a card's corner radius by `cornerScale` before passing it in.
 */
export interface SkinShape {
  readonly glsl: string;
  readonly cornerScale: number;
}

/**
 * A node card's look. The renderer includes `shape.glsl` and `COMPOSITE_GLSL` before `glsl`.
 * `r` is the scaled corner radius, `b` the card's half-size, `p` centred with y up. Defines:
 *
 * - `vec4 paintCardShadow(vec2 p, vec2 b, float r)` the card's float, as a straight-alpha colour.
 *   Only evaluated in the shadow pass, outside the body.
 * - `vec3 paintCardFill(vec3 fill, vec2 p, vec2 b, vec2 size, vec3 hue, float accent)` the body
 *   fill with an accent (`accent` 1) in `hue`; returns `fill` unchanged when `accent` is 0.
 * - `vec3 paintCardEdgeLight(vec3 color, vec2 p, vec2 b, float r, float d, float aa, float fillMask, vec3 hue, float accent)`
 *   light along the card's top edge.
 */
export interface CardShader extends SkinShader {
  /** How far the shadow reaches past the card, in world px, so the quad can hold it. */
  shadowReach(ctx: SkinShaderContext): number;
}

export interface FloatingShader extends SkinShader {
  /**
   * The blur of the ground under the panel, as a CSS gaussian sigma in px. 0 means the skin never
   * calls `blurBackdrop`, and the renderer skips copying the frame under the panel.
   */
  backdropBlur(ctx: SkinShaderContext): number;
}

export interface SkinShaders {
  card: CardShader;
  /**
   * The controls drawn on a picture, a clip or a model: play bar, grip, expand and download. The
   * renderer provides `vec3 mediaAt(vec2 q)` (the media at a 0..1 quad UV, over its ground) and
   * `uniform vec2 uSize` before `glsl`, which defines:
   *
   * - `float mediaControlReach()` how far past a control its paint reaches, in media px.
   * - `vec4 paintMediaControl(vec2 px, vec2 p, vec2 hs, float r, float aa)` one control's body:
   *   `px` top-left media px, `p` centred on the control with y up, `hs` its half-size, `r` its corner.
   */
  media: SkinShader;
  /**
   * Inline controls (fields, marks, sliders, switches, segmented). `glsl` defines:
   *
   * - `vec4 paintField(vec4 acc, vec2 p, vec2 halfSize, float r, float d, float inside, float aa, vec3 fill, vec2 px)`
   *   the field body: fill, depth, edge. `d` is the box distance, `px` the fragment coordinate.
   * - `vec4 paintLight(vec4 acc, float cover, float t, float strength)` the light on a filled
   *   mark, swatch or thumb; `t` runs 0 at the top to 1 at the bottom.
   * - `vec4 paintGripCast(vec4 acc, vec2 gp, vec2 gb, float gr, float gd, float circle, float alpha)`
   *   the shadow under a slider grip (`circle` 1), switch thumb or segment thumb.
   * - `vec4 controlEdge()` the hairline colour for a mark's edge and separators.
   * - `float controlInkAlpha()` the alpha of a chevron or glyph drawn in the control's ink.
   */
  controls: SkinShader;
  /**
   * The floating list and colour picker. Also given `BACKDROP_GLSL` and the renderer's `uBlur`.
   * `glsl` defines:
   *
   * - `float floatingRadius(float radius)` the corner the panel is drawn with.
   * - `float floatingShape(vec2 p, vec2 hs, float r)` the panel's signed distance.
   * - `vec4 paintFloatingBody(vec4 acc, vec2 p, vec2 hs, float r, float d, float inside, float aa, vec2 uv)`
   *   shadow and fill; `uv` is panel-local, 0..1 from the top-left.
   * - `vec4 paintFloatingEdge(vec4 acc, vec2 p, float d, float aa)` the outermost edge.
   * - `vec4 floatingRow()`, `float floatingRowSolid()` the lit row's colour, and 1 when it hides
   *   what is under it.
   * - `vec4 floatingBorder()` the hairline around the picker's controls.
   */
  floating: FloatingShader;
}

/** A size step for DOM chrome. */
export type SkinControlSize = '1' | '2' | '3' | '4';

/**
 * The DOM chrome's components: the selection toolbar and the media viewer's close button. These
 * are the props the renderer passes; a skin maps them onto its design system's components and
 * adds whatever that system needs to look right over the canvas.
 */
export interface SkinUI {
  Toolbar: ComponentType<{ size?: SkinControlSize; 'aria-label'?: string; children?: ReactNode }>;
  ToolbarGroup: ComponentType<{ children?: ReactNode }>;
  /** Only icon buttons are drawn, so a label is required. */
  ToolbarButton: ComponentType<{
    iconOnly: true;
    'aria-label': string;
    'aria-pressed'?: boolean;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    children?: ReactNode;
  }>;
  Button: ComponentType<{
    iconOnly: true;
    size?: SkinControlSize;
    'aria-label': string;
    style?: CSSProperties;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    children?: ReactNode;
  }>;
  TextField: ComponentType<{
    'aria-label'?: string;
    inputMode?: 'decimal' | 'numeric' | 'text';
    value?: string;
    style?: CSSProperties;
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
    onBlur?: () => void;
    onKeyDown?: (event: KeyboardEvent) => void;
  }>;
  Select: ComponentType<{
    items?: Record<string, ReactNode>;
    value?: string;
    onValueChange?: (value: string | null) => void;
    children?: ReactNode;
  }>;
  SelectTrigger: ComponentType<{ 'aria-label'?: string }>;
  SelectContent: ComponentType<{ children?: ReactNode }>;
  SelectItem: ComponentType<{ value: string; children?: ReactNode }>;
  SegmentedControl: ComponentType<{
    'aria-label'?: string;
    value?: string;
    onValueChange?: (value: unknown) => void;
    children?: ReactNode;
  }>;
  SegmentedItem: ComponentType<{ value: string; 'aria-label'?: string; children?: ReactNode }>;
  /** The stroke width the design system draws 24-grid icons with. */
  iconStroke: number;
}

export interface FlowSkin {
  readonly name: string;
  readonly colors: SkinColors;
  readonly metrics: SkinMetrics;
  readonly shape: SkinShape;
  /** The DOM chrome's components. */
  readonly ui: SkinUI;
  /** The skin's part of each surface shader. */
  readonly shaders: SkinShaders;
  /** Tokens used before the page's theme can be read, and when it cannot. */
  readonly fallbackTokens: ThemeTokens;
  /** Read every token slot from the theme root's computed style. Called on theme change only. */
  readTokens(root: Element): ThemeTokens;
}
