import * as THREE from 'three';
import type { SkinShader } from '../types';
import { resolveColor } from '../../core/theme-colors';
import { GLASS_GLSL } from './glass';
import { CORNER_K_FLOATING_ROWS, MATERIAL, type RGBA } from './material';

/**
 * KookieUI v2's floating surface: a squircle panel of tinted fill over the blurred, saturated
 * ground, with a wash, a pooled inner shade, a dark-only top line, grain, a three-layer cast and
 * the conic ring at 60% as its only edge.
 */
export const glassFloating: SkinShader = {
  glsl: /* glsl */ `
  uniform float uCornerK;
  uniform vec3 uTint;
  uniform float uTintA;
  uniform float uSaturate;
  uniform float uBrightness;
  uniform vec4 uRingTop;
  uniform vec4 uRingUpper;
  uniform vec4 uRingSide;
  uniform vec4 uRingBottom;
  uniform vec4 uBorder;
  uniform vec2 uWash;
  uniform float uPool;
  uniform float uTopLine;
  uniform float uGrain;
  uniform vec4 uCast[3];
  uniform vec4 uCastColor[3];
  uniform vec4 uRow;
  uniform float uRowSolid;

  ${GLASS_GLSL}

  // The squircle v2 draws a floating-rows surface with: the corner token times its k.
  float floatingRadius(float radius) {
    return radius * uCornerK;
  }

  float floatingShape(vec2 p, vec2 hs, float r) {
    return sdSquircleBox(p, hs, r);
  }

  vec4 paintFloatingBody(vec4 acc, vec2 p, vec2 hs, float r, float d, float inside, float aa, vec2 uv) {
    // --shadow-3: three layers, each the shape moved down, grown by its spread, and blurred.
    for (int i = 0; i < 3; i++) {
      float dc = sdSquircleBox(p - vec2(0.0, -uCast[i].x), hs + uCast[i].z, r + uCast[i].z);
      acc = glassCast(acc, dc, d, uCast[i].y, uCastColor[i]);
    }

    // The ground, blurred, saturated and lifted as backdrop-filter does it, under the fill.
    vec3 ground = filterGround(blurBackdrop(gl_FragCoord.xy, uBlur), uSaturate, uBrightness);
    acc = over(acc, mix(ground, uTint, uTintA), inside);
    // The floating wash: the radial glint at the top-left and the top-down white.
    acc = glassWash(acc, inside, uv, uWash.x, uWash.y);
    // inset 0 -10px 20px -14px: the hole is the panel moved up 10 and grown by 14.
    acc = glassInset(acc, inside, sdSquircleBox(p - vec2(0.0, 10.0), hs + 14.0, r + 14.0), 20.0, uPool);
    // inset 0 1px 0 white, dark only: the one pixel the panel's own shape moved down leaves bare.
    float dDown = sdSquircleBox(p + vec2(0.0, 1.0), hs, r);
    acc = over(acc, vec3(1.0), inside * uTopLine * (1.0 - fillSDF(dDown, aa)));
    return glassGrain(acc, inside, gl_FragCoord.xy, uGrain);
  }

  // v2's ::after ring at the floating opacity, on the outermost pixel. A floating panel has no
  // border of its own — the ring is the whole edge.
  vec4 paintFloatingEdge(vec4 acc, vec2 p, float d, float aa) {
    return glassRing(acc, d, aa, 1.0, p, uRingTop, uRingUpper, uRingSide, uRingBottom, 0.6);
  }

  vec4 floatingRow() {
    return uRow;
  }

  float floatingRowSolid() {
    return uRowSolid;
  }

  vec4 floatingBorder() {
    return uBorder;
  }
`,
  uniforms({ tokens, colors }) {
    const appearance = tokens.appearance;
    const m = MATERIAL[appearance];
    const rgb = (v: readonly number[]) => new THREE.Color(v[0], v[1], v[2]);
    const rgba = (v: RGBA) => new THREE.Vector4(v[0], v[1], v[2], v[3]);
    const highContrast = tokens.contrast === 'high';
    // The floating fill: v2's `--color-surface` in light, and in dark that surface mixed twelve
    // percent toward white — a floating panel sits a step above the card it floats over.
    const surface = resolveColor(colors.widget.thumb, tokens);
    const tint =
      appearance === 'dark'
        ? resolveColor({ light: '--neutral-1', dark: '--neutral-2' }, tokens).map(
            (v) => v * 0.88 + 0.12
          )
        : surface;
    return {
      uCornerK: { value: CORNER_K_FLOATING_ROWS },
      uTint: { value: rgb(tint) },
      uTintA: { value: m.floatingAlpha },
      uSaturate: { value: m.surfaceSaturate },
      uBrightness: { value: m.surfaceBrightness },
      uRingTop: { value: rgba(m.surfaceRing.top) },
      uRingUpper: { value: rgba(m.surfaceRing.upper) },
      uRingSide: { value: rgba(m.surfaceRing.side) },
      uRingBottom: { value: rgba(m.surfaceRing.bottom) },
      uBorder: { value: rgba(m.glassBorder) },
      uWash: { value: new THREE.Vector2(m.floatingWashRadial, m.floatingWashLinear) },
      uPool: { value: m.floatingPool },
      uTopLine: { value: m.floatingTopLine },
      uGrain: { value: m.grain },
      uCast: { value: m.floatingCast.map((l) => new THREE.Vector4(l.y, l.blur, l.spread, 0)) },
      uCastColor: { value: m.floatingCast.map((l) => rgba(l.color)) },
      // High contrast turns the lit row into a solid accent fill.
      uRow: {
        value: highContrast
          ? new THREE.Vector4(...resolveColor(colors.widget.active, tokens), 1)
          : rgba(m.rowWash),
      },
      uRowSolid: { value: highContrast ? 1 : 0 },
    };
  },
};
