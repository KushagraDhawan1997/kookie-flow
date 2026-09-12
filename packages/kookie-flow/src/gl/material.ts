/**
 * KookieUI v2's `material="regular"`, as numbers a shader can take.
 *
 * Every value here is read off v2's stylesheet — the token is named beside it — so the GL controls
 * are the same material as the DOM ones, not an impression of it. Two appearances, one record
 * each; a component picks one at material build and never per frame.
 *
 * Colours are `[r, g, b, a]` in 0..1. Lengths are CSS px, which are world px at zoom 1.
 */

export type RGBA = readonly [number, number, number, number];

function hex(s: string): RGBA {
  const h = s.replace('#', '');
  const n = Number.parseInt(h.length === 8 ? h.slice(0, 6) : h, 16);
  const a = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

/** One box-shadow layer: `0 y blur spread rgba`. */
export interface CastLayer {
  y: number;
  blur: number;
  spread: number;
  color: RGBA;
}

/**
 * The conic ring v2 masks to a control's 1px border — `--material-regular-ring-control`. Four
 * colours, symmetric about the bottom: `top` at the start (345deg, just left of straight up),
 * then `upper` at 22%, `side` at 34%, `bottom` from 44% to 56%, and back.
 */
export interface Ring {
  top: RGBA;
  upper: RGBA;
  side: RGBA;
  bottom: RGBA;
}

export interface Material {
  /** `--material-regular-control-alpha`: how much of a control's fill shows over the ground. */
  controlAlpha: number;
  /** `--material-regular-control-filter`: the ground's saturation and brightness under a control. */
  controlSaturate: number;
  controlBrightness: number;
  /** `--material-regular-ring-control`. */
  controlRing: Ring;
  /** `--material-regular-ring`, worn by a floating surface at 60%. */
  surfaceRing: Ring;
  /** `--material-pool-control`: the soft inner shade along a control's bottom. */
  poolAlpha: number;
  /** `--material-control-wash-medium`: the radial glint at the top-left and the top-down wash. */
  washRadial: number;
  washLinear: number;
  /** `--material-control-wash-loud`, for a filled (accent) control. */
  washRadialLoud: number;
  washLinearLoud: number;
  /** `--control-light`: the top-down white on a filled mark. */
  controlLight: number;
  /** `--control-chrome`: the two drop layers under a filled mark and its inset bottom line. */
  controlChrome: readonly CastLayer[];
  controlChromeInset: number;
  /** `--grip-cast`: under a slider's thumb. */
  gripCast: readonly CastLayer[];
  /** `--material-glass-border`: the hairline a surface wears. */
  glassBorder: RGBA;
  /** `--material-regular-alpha(-floating)`: a floating surface's fill over the ground. */
  floatingAlpha: number;
  /** `--material-regular-filter`: the ground under a floating surface. */
  surfaceBlur: number;
  surfaceSaturate: number;
  surfaceBrightness: number;
  /** `--shadow-3`, the elevated floating chrome. */
  floatingCast: readonly CastLayer[];
  /** `--material-regular-rim`: fractal-noise white at 4.5% over every material. */
  grain: number;
  /** `--material-row-wash`: a lit row. */
  rowWash: RGBA;
  /** `--material-regular-alpha-floating` wash on a floating surface: its radial glint and top-down white. */
  floatingWashRadial: number;
  floatingWashLinear: number;
  /** A floating surface's pool, `inset 0 -10px 20px -14px`. */
  floatingPool: number;
  /** A floating surface's top light, `inset 0 1px 0 white` — dark only. */
  floatingTopLine: number;
  /** The top-down white on a checked mark: `linear-gradient(white, transparent 60%)`. */
  markLight: number;
  /** The select chevron's ink: neutral-12 at this alpha. */
  chevronAlpha: number;
  /** `--material-ink-muted`. */
  inkMuted: RGBA;
  /** `--neutral-a7`, the mark's edge before it is checked. */
  markEdge: RGBA;
  /** The mark's edge under high contrast, where v2 resets the dress edge to `--control-edge`. */
  markEdgeHighContrast: RGBA;
  /** A filled (loud) control's fill: v2 lifts lightness and chroma and drops to this alpha. */
  loudAlpha: number;
  loudLift: number;
  loudChroma: number;
}

const LIGHT: Material = {
  controlAlpha: 0.48,
  controlSaturate: 1.6,
  controlBrightness: 1.04,
  controlRing: { top: hex('#fffffff2'), upper: hex('#00000012'), side: hex('#00000026'), bottom: hex('#0a05001c') },
  surfaceRing: { top: hex('#fffffff2'), upper: hex('#00000012'), side: hex('#00000026'), bottom: hex('#0a05001c') },
  poolAlpha: 0x0f / 255,
  washRadial: 0x0b / 255,
  washLinear: 0x08 / 255,
  washRadialLoud: 0x0e / 255,
  washLinearLoud: 0x0a / 255,
  controlLight: 0x12 / 255,
  controlChrome: [
    { y: 1, blur: 2, spread: 0, color: hex('#0000001a') },
    { y: 8, blur: 20, spread: -6, color: hex('#00000029') },
  ],
  controlChromeInset: 0x1f / 255,
  gripCast: [
    { y: 1, blur: 2, spread: 0, color: hex('#00000029') },
    { y: 2, blur: 6, spread: -1, color: hex('#0000002e') },
  ],
  glassBorder: hex('#0000001f'),
  floatingAlpha: 0.49,
  surfaceBlur: 4,
  surfaceSaturate: 2.07,
  surfaceBrightness: 1.05,
  floatingCast: [
    { y: 1, blur: 2, spread: 0, color: hex('#0000001a') },
    { y: 8, blur: 22, spread: -6, color: hex('#0000001a') },
    { y: 18, blur: 48, spread: -14, color: hex('#00000017') },
  ],
  grain: 0.045,
  rowWash: hex('#0000000d'),
  floatingWashRadial: 0x49 / 255,
  floatingWashLinear: 0x34 / 255,
  floatingPool: 0x0f / 255,
  floatingTopLine: 0,
  markLight: 0.16,
  chevronAlpha: 0.52,
  inkMuted: hex('#0000009e'),
  markEdge: hex('#00070d27'),
  markEdgeHighContrast: hex('#878b8f'),
  loudAlpha: 0.8,
  loudLift: 1.04,
  loudChroma: 1.6,
};

const DARK: Material = {
  controlAlpha: 0.6,
  controlSaturate: 1.75,
  controlBrightness: 0.94,
  controlRing: { top: hex('#ffffffb8'), upper: hex('#d2e6ff38'), side: hex('#ffffff14'), bottom: hex('#fff5eb33') },
  surfaceRing: { top: hex('#ffffff57'), upper: hex('#d2e6ff1a'), side: hex('#ffffff0a'), bottom: hex('#fff5eb14') },
  poolAlpha: 0x2e / 255,
  washRadial: 0x1d / 255,
  washLinear: 0x14 / 255,
  washRadialLoud: 0x24 / 255,
  washLinearLoud: 0x1a / 255,
  controlLight: 0x29 / 255,
  controlChrome: [
    { y: 1, blur: 2, spread: 0, color: hex('#00000066') },
    { y: 8, blur: 20, spread: -6, color: hex('#0000006b') },
  ],
  controlChromeInset: 0,
  gripCast: [
    { y: 1, blur: 2, spread: 0, color: hex('#00000080') },
    { y: 2, blur: 6, spread: -1, color: hex('#00000066') },
  ],
  glassBorder: hex('#ffffff29'),
  floatingAlpha: 0.62,
  surfaceBlur: 4,
  surfaceSaturate: 1.95,
  surfaceBrightness: 0.9,
  floatingCast: [
    { y: 1, blur: 2, spread: 0, color: hex('#00000066') },
    { y: 8, blur: 22, spread: -6, color: hex('#0000005c') },
    { y: 18, blur: 48, spread: -14, color: hex('#0000004d') },
  ],
  grain: 0.045,
  rowWash: hex('#ffffff1f'),
  floatingWashRadial: 0x0e / 255,
  floatingWashLinear: 0x0a / 255,
  floatingPool: 0x2e / 255,
  floatingTopLine: 0.05,
  markLight: 0.07,
  chevronAlpha: 0.74,
  inkMuted: hex('#ffffffb8'),
  markEdge: hex('#f3f9ff35'),
  markEdgeHighContrast: hex('#b0b3b5'),
  loudAlpha: 0.8,
  loudLift: 1.04,
  loudChroma: 1.6,
};

export const MATERIAL: Record<'light' | 'dark', Material> = { light: LIGHT, dark: DARK };

/** v2's squircle multipliers: a surface draws its radius at 1.613x, a floating row surface at 1.75x. */
export const CORNER_K_SURFACE = 1.613;
export const CORNER_K_FLOATING_ROWS = 1.75;

/**
 * v2 motion tokens, in seconds. A colour arrives on hover in `hoverIn`, leaves in `hoverOut`, and
 * lands at once on a press. Movement has its own clock: `press` on the stiff spring into a press,
 * `rise` on the lively spring back out of it.
 */
export const MOTION = {
  hoverIn: 0.08,
  hoverOut: 0.22,
  press: 0.14,
  rise: 0.55,
  mark: 0.38,
  ring: 0.26,
  floatingFall: 0.345,
} as const;

/** `--press-squash` and `--press-scale`. */
export const PRESS_SQUASH = 0.9;
export const PRESS_SCALE = 0.975;
/** `--focus-ring-width`, `--focus-ring-offset`, `--focus-ring-land`. */
export const FOCUS_RING = { width: 2, offset: 2, land: 4 } as const;
