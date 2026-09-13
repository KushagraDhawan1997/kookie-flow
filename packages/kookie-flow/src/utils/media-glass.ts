/**
 * The glass a piece of media's controls are made of, as uniforms the media shader reads.
 *
 * MEDIA IS THE ONE PLACE GLASS GETS A REAL GROUND FOR FREE. A floating panel has to copy the frame
 * under itself to blur it (gl/backdrop.ts); a control on a picture sits on that picture, and the
 * picture is already bound to the shader drawing the control. So the controls blur the media's own
 * texture: v2's `backdrop-filter`, with no copy, no second pass and no extra draw call.
 *
 * The numbers are v2's `material="regular"` from gl/material.ts, the same record the widget wells
 * and the popover read: the floating tint over a blurred, saturated ground, a control's medium wash,
 * pool and two-layer chrome cast, the conic ring at the floating opacity, and the grain. The corner
 * is the theme's control radius, so a pill theme gets pill controls and a square one square ones.
 *
 * Built once per theme and SHARED by every material: `applyMediaGlass` binds the same uniform
 * objects into each, so a theme flip is one rebuild and a rebind, never a write per entity per frame.
 */

import * as THREE from 'three';
import { GLINT, LENS, MATERIAL, type RGBA } from '../gl';
import { THEME_COLORS, resolveColor } from '../core/theme-colors';

type ThemeTokens = Parameters<typeof resolveColor>[1];

/**
 * LIQUID GLASS, NOT FROST — owner ruling 2026-09-13: "they dont look glass, they look like blur, see
 * liquid glass". The first cut took the floating panel's numbers, and a panel's job is to hide what
 * is behind it: a 49% milky tint over a heavy, doubly saturated blur. On media the job is the
 * opposite — the picture is the point — so what makes this read as glass is the LENS (gl/lens.ts),
 * v2's own and at its thickest rung, since a 28px control needs the strongest rim to show one. With
 * the rim doing the work the body can go near clear, which is v2's own argument for its lens
 * ("blur hides a backdrop; a lens re-states it"):
 *
 * - The blur is a light disc, a few px, not the panel's.
 * - The tint is a third of the floating alpha: enough to seat an ink glyph, not enough to fog.
 * - Saturation is a third of the panel's boost. At full strength it turned sky and grass into the
 *   yellow blotches of the first screenshot.
 */
const MEDIA_BLUR_RADIUS = 2;
const MEDIA_TINT_SHARE = 0.32;
const MEDIA_SATURATE_SHARE = 0.3;
/**
 * v2's thick rung, with a wider bezel and a narrower split. Measured on a real frame: at v2's 6.5px a
 * 28px control lensed only its outermost few pixels and read as an OUTLINE, and the 48% split
 * printed that outline orange. Nine pixels is about a third of the control, which is where the rim
 * reads as a thickness; the thickness follows the bezel as v2's own `fitLens` scales it, and the
 * split is the thin rung's, which fringes without tinting.
 */
const MEDIA_BEZEL = 9;
const MEDIA_LENS = {
  ...LENS.thick,
  bezel: MEDIA_BEZEL,
  thickness: LENS.thick.thickness * (MEDIA_BEZEL / LENS.thick.bezel),
  fringe: LENS.thin.fringe,
};
/** The glint's peak. A touch lower in dark, where a white rim on a dark ground reads louder. */
const GLINT_PEAK = { light: 0.75, dark: 0.5 } as const;

export type MediaGlass = Record<string, THREE.IUniform>;

/**
 * @param ground What shows where the media has no pixels — a letterbox, a model's transparent
 *   background: the canvas for a media entity, the card for a node's band.
 * @param controlRadius The theme's control corner. A pill sentinel is clamped by the shader to half
 *   of each control's own height, as v2 does.
 */
export function buildMediaGlass(
  tokens: ThemeTokens,
  ground: readonly number[],
  controlRadius: number
): MediaGlass {
  const m = MATERIAL[tokens.appearance];
  const rgb = (v: readonly number[]) => new THREE.Color(v[0], v[1], v[2]);
  const rgba = (v: RGBA) => new THREE.Vector4(v[0], v[1], v[2], v[3]);
  // The floating fill, as the popover computes it: the surface in light, and in dark that surface
  // mixed twelve percent toward white, a step above what it floats over.
  const tint = tokens.appearance === 'dark'
    ? resolveColor({ light: '--neutral-1', dark: '--neutral-2' }, tokens).map((v) => v * 0.88 + 0.12)
    : resolveColor(THEME_COLORS.widget.thumb, tokens);

  return {
    uGround: { value: rgb(ground) },
    uGlassTint: { value: rgb(tint) },
    uGlassTintA: { value: m.floatingAlpha * MEDIA_TINT_SHARE },
    uGlassFilter: {
      value: new THREE.Vector2(1 + (m.surfaceSaturate - 1) * MEDIA_SATURATE_SHARE, m.surfaceBrightness),
    },
    uGlassBlur: { value: MEDIA_BLUR_RADIUS },
    uLens: {
      value: new THREE.Vector4(MEDIA_LENS.bezel, MEDIA_LENS.thickness, MEDIA_LENS.ior, MEDIA_LENS.boost),
    },
    uLensFringe: { value: MEDIA_LENS.fringe / 100 },
    uGlint: { value: new THREE.Vector3(GLINT_PEAK[tokens.appearance], GLINT.falloff, GLINT.band) },
    uRingTop: { value: rgba(m.surfaceRing.top) },
    uRingUpper: { value: rgba(m.surfaceRing.upper) },
    uRingSide: { value: rgba(m.surfaceRing.side) },
    uRingBottom: { value: rgba(m.surfaceRing.bottom) },
    uGlassWash: { value: new THREE.Vector2(m.washRadial, m.washLinear) },
    uGlassPool: { value: m.poolAlpha },
    uGlassTopLine: { value: m.floatingTopLine },
    uGlassGrain: { value: m.grain },
    uGlassCast: { value: m.controlChrome.map((l) => new THREE.Vector4(l.y, l.blur, l.spread, 0)) },
    uGlassCastColor: { value: m.controlChrome.map((l) => rgba(l.color)) },
    uInk: { value: rgb(resolveColor(THEME_COLORS.text.primary, tokens)) },
    uAccent: { value: rgb(resolveColor(THEME_COLORS.widget.active, tokens)) },
    uControlRadius: { value: controlRadius },
  };
}

/** Bind the shared glass into a material. The objects are shared, not copied. */
export function applyMediaGlass(material: THREE.ShaderMaterial, glass: MediaGlass): void {
  for (const key in glass) material.uniforms[key] = glass[key];
}
