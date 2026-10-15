import * as THREE from 'three';
import type { SkinShader } from '@kushagradhawan/kookie-flow-webgl/internal/skin/types';
import { resolveColor } from '@kushagradhawan/kookie-flow-webgl/internal/core/theme-colors';
import { GLASS_GLSL } from './glass';
import { GLINT, LENS, LENS_GLSL } from './lens';
import { MATERIAL, type RGBA } from './material';

/**
 * The glass a piece of media's controls are made of.
 *
 * MEDIA IS THE ONE PLACE GLASS GETS A REAL GROUND FOR FREE. A floating panel has to copy the frame
 * under itself to blur it (gl/backdrop.ts); a control on a picture sits on that picture, and the
 * picture is already bound to the shader drawing the control. So the controls blur the media's own
 * texture through the renderer's `mediaAt`: v2's `backdrop-filter`, with no copy, no second pass and
 * no extra draw call.
 *
 * The numbers are v2's `material="regular"`, the same record the widget wells and the popover read:
 * the floating tint over a blurred, saturated ground, a control's medium wash, pool and two-layer
 * chrome cast, the conic ring at the floating opacity, and the grain.
 */

/**
 * LIQUID GLASS, NOT FROST — owner ruling 2026-09-13: "they dont look glass, they look like blur, see
 * liquid glass". The first cut took the floating panel's numbers, and a panel's job is to hide what
 * is behind it: a 49% milky tint over a heavy, doubly saturated blur. On media the job is the
 * opposite — the picture is the point — so what makes this read as glass is the LENS (skin/glass/lens.ts),
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

export const glassMedia: SkinShader = {
  glsl: /* glsl */ `
uniform vec3 uGlassTint;
uniform float uGlassTintA;
uniform vec2 uGlassFilter;
uniform float uGlassBlur;
uniform vec4 uRingTop;
uniform vec4 uRingUpper;
uniform vec4 uRingSide;
uniform vec4 uRingBottom;
uniform vec2 uGlassWash;
uniform float uGlassPool;
uniform float uGlassTopLine;
uniform float uGlassGrain;
uniform vec4 uGlassCast[2];
uniform vec4 uGlassCastColor[2];
// The lens (skin/glass/lens.ts): bezel, thickness, ior, boost; the channel split; the glint's
// peak, falloff and band.
uniform vec4 uLens;
uniform float uLensFringe;
uniform vec3 uGlint;

${GLASS_GLSL}
${LENS_GLSL}

// How far past a control its cast can reach, so the blur runs only where glass can be.
float mediaControlReach() {
  return 24.0;
}

// A light blur over the media under a control: a golden-angle disc rotated per pixel so the taps do
// not print as a lattice. px is top-left media pixels.
vec3 blurredGround(vec2 px) {
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float spin = noise * 6.2831853;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 10; i++) {
    float fi = float(i) + 0.5;
    float rr = sqrt(fi / 10.0) * uGlassBlur;
    float ang = fi * 2.39996323 + spin;
    sum += mediaAt((px + vec2(cos(ang), sin(ang)) * rr) / uSize);
  }
  return sum / 10.0;
}

// What a control shows at this fragment. The body is near-clear glass: the media, lightly blurred.
// The rim BENDS it — v2's lens: Snell's law across a curved bezel, hardest at the lip, each channel
// bent a little differently so the edge splits light. n is the outward normal in top-left px.
//
// INWARD, AND KEPT ON THE PICTURE. A convex rim pulls what is under the body out toward the lip, so
// the bend samples along -n. Bent outward it reached past the media's own edge — a control sits 8px
// in and the lip bends up to twice that — sampled the flat ground there, and drew a white band that
// the channel split then printed orange. The clamp holds every bent tap on the picture.
vec3 lensGround(vec2 px, vec2 n, float inside) {
  if (inside >= uLens.x) return blurredGround(px);
  float bend = lensBend(clamp(inside / uLens.x, 0.0, 1.0), uLens.x, uLens.y, uLens.z) * uLens.w;
  vec2 lo = vec2(uGlassBlur + 1.0);
  vec2 hi = uSize - lo;
  return vec3(
    blurredGround(clamp(px - n * bend * (1.0 + uLensFringe), lo, hi)).r,
    blurredGround(clamp(px - n * bend, lo, hi)).g,
    blurredGround(clamp(px - n * bend * (1.0 - uLensFringe), lo, hi)).b
  );
}

// One glass control: the chrome cast, the lensed ground under a light tint, the wash, the pool, the
// top light, the grain, the glint along the rim, and the ring. px is top-left media pixels; p is the
// same point centred on the control with y up. Controls are round, never squircles — D13.
vec4 paintMediaControl(vec2 px, vec2 p, vec2 hs, float r, float aa) {
  vec4 ui = vec4(0.0);
  float d = sdRoundedBox(p, hs, r);
  for (int i = 0; i < 2; i++) {
    float dc = sdRoundedBox(p - vec2(0.0, -uGlassCast[i].x), hs + uGlassCast[i].z, r + uGlassCast[i].z);
    ui = glassCast(ui, dc, d, uGlassCast[i].y, uGlassCastColor[i]);
  }
  // Outside the control only its cast shows, and the lens and the blur are never paid for.
  if (d > aa) return ui;

  float inside = -d;
  // The outward normal, from the field itself rather than from screen derivatives, so it holds at
  // every zoom: y up for the light, top-left px for the bend.
  vec2 g = vec2(
    sdRoundedBox(p + vec2(0.5, 0.0), hs, r) - sdRoundedBox(p - vec2(0.5, 0.0), hs, r),
    sdRoundedBox(p + vec2(0.0, 0.5), hs, r) - sdRoundedBox(p - vec2(0.0, 0.5), hs, r)
  );
  vec2 nUp = g / max(length(g), 1e-5);

  float cover = fillSDF(d, aa);
  vec3 gnd = filterGround(lensGround(px, vec2(nUp.x, -nUp.y), inside), uGlassFilter.x, uGlassFilter.y);
  ui = over(ui, mix(gnd, uGlassTint, uGlassTintA), cover);
  ui = glassWash(ui, cover, (vec2(p.x, -p.y) + hs) / (2.0 * hs), uGlassWash.x, uGlassWash.y);
  ui = glassInset(ui, cover, sdRoundedBox(p - vec2(0.0, 6.0), hs + 10.0, r + 10.0), 12.0, uGlassPool);
  ui = over(ui, vec3(1.0), cover * uGlassTopLine * (1.0 - fillSDF(sdRoundedBox(p + vec2(0.0, 1.0), hs, r), aa)));
  ui = glassGrain(ui, cover, gl_FragCoord.xy, uGlassGrain);
  // The glint, brightest where the rim faces the light at the top-left and its reflection at the
  // bottom-right — the two catches that make a liquid-glass edge read as a solid with thickness.
  float facing = mix(0.35, 1.0, abs(dot(nUp, vec2(-0.70710678, 0.70710678))));
  ui = over(ui, vec3(1.0), cover * lensGlint(inside, uLens.x * uGlint.z, uGlint.y) * uGlint.x * facing);
  // The ring, quieter than a panel's: the glint is the edge now, and the ring's dark sides only fog it.
  return glassRing(ui, d, aa, 1.0, p, uRingTop, uRingUpper, uRingSide, uRingBottom, 0.35);
}
`,
  uniforms({ tokens, colors }) {
    const m = MATERIAL[tokens.appearance];
    const rgb = (v: readonly number[]) => new THREE.Color(v[0], v[1], v[2]);
    const rgba = (v: RGBA) => new THREE.Vector4(v[0], v[1], v[2], v[3]);
    // The floating fill, as the popover computes it: the surface in light, and in dark that surface
    // mixed twelve percent toward white, a step above what it floats over.
    const tint =
      tokens.appearance === 'dark'
        ? resolveColor({ light: '--neutral-1', dark: '--neutral-2' }, tokens).map(
            (v) => v * 0.88 + 0.12
          )
        : resolveColor(colors.widget.thumb, tokens);
    return {
      uGlassTint: { value: rgb(tint) },
      uGlassTintA: { value: m.floatingAlpha * MEDIA_TINT_SHARE },
      uGlassFilter: {
        value: new THREE.Vector2(
          1 + (m.surfaceSaturate - 1) * MEDIA_SATURATE_SHARE,
          m.surfaceBrightness
        ),
      },
      uGlassBlur: { value: MEDIA_BLUR_RADIUS },
      uLens: {
        value: new THREE.Vector4(
          MEDIA_LENS.bezel,
          MEDIA_LENS.thickness,
          MEDIA_LENS.ior,
          MEDIA_LENS.boost
        ),
      },
      uLensFringe: { value: MEDIA_LENS.fringe / 100 },
      uGlint: {
        value: new THREE.Vector3(GLINT_PEAK[tokens.appearance], GLINT.falloff, GLINT.band),
      },
      uRingTop: { value: rgba(m.surfaceRing.top) },
      uRingUpper: { value: rgba(m.surfaceRing.upper) },
      uRingSide: { value: rgba(m.surfaceRing.side) },
      uRingBottom: { value: rgba(m.surfaceRing.bottom) },
      uGlassWash: { value: new THREE.Vector2(m.washRadial, m.washLinear) },
      uGlassPool: { value: m.poolAlpha },
      uGlassTopLine: { value: m.floatingTopLine },
      uGlassGrain: { value: m.grain },
      uGlassCast: {
        value: m.controlChrome.map((l) => new THREE.Vector4(l.y, l.blur, l.spread, 0)),
      },
      uGlassCastColor: { value: m.controlChrome.map((l) => rgba(l.color)) },
    };
  },
};
