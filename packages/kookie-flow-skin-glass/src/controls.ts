import * as THREE from 'three';
import type { SkinShader } from '@kushagradhawan/kookie-flow-webgl/internal/skin/types';
import { GLASS_GLSL } from './glass';
import { MATERIAL, type CastLayer, type RGBA } from './material';

/**
 * KookieUI v2's controls in the regular material: a partial-alpha fill, the pooled inner shade,
 * grain and the conic ring on a field; top-down light on a filled mark; a two-layer cast under
 * a grip.
 */
export const glassControls: SkinShader = {
  glsl: /* glsl */ `
  uniform float uControlAlpha;
  uniform vec4 uRingTop;
  uniform vec4 uRingUpper;
  uniform vec4 uRingSide;
  uniform vec4 uRingBottom;
  uniform float uPoolAlpha;
  uniform float uMarkLight;
  uniform float uChevronAlpha;
  uniform vec4 uGripCast[2];
  uniform vec4 uGripCastColor[2];
  uniform float uGrain;
  uniform vec4 uMarkEdge;

  ${GLASS_GLSL}

  vec4 controlEdge() {
    return uMarkEdge;
  }

  float controlInkAlpha() {
    return uChevronAlpha;
  }

  vec4 paintLight(vec4 acc, float cover, float t, float strength) {
    return glassLight(acc, cover, t, uMarkLight * strength);
  }

  vec4 paintField(vec4 acc, vec2 p, vec2 halfSize, float r, float d, float inside, float aa, vec3 fill, vec2 px) {
    acc = over(acc, fill, uControlAlpha * inside);
    // inset 0 -6px 12px -10px: the hole is the box moved up 6 and grown by 10.
    float dHole = sdRoundedBox(p - vec2(0.0, 6.0), halfSize + 10.0, r + 10.0);
    acc = glassInset(acc, inside, dHole, 12.0, uPoolAlpha);
    acc = glassGrain(acc, inside, px, uGrain);
    return glassRing(acc, d + 1.0, aa, 1.0, p, uRingTop, uRingUpper, uRingSide, uRingBottom, 1.0);
  }

  vec4 paintGripCast(vec4 acc, vec2 gp, vec2 gb, float gr, float gd, float circle, float alpha) {
    for (int i = 0; i < 2; i++) {
      vec2 cp = gp - vec2(0.0, -uGripCast[i].x);
      float dc = circle > 0.5
        ? sdCircle(cp, gr + uGripCast[i].z)
        : sdRoundedBox(cp, gb + uGripCast[i].z, gr + uGripCast[i].z);
      acc = glassCast(acc, dc, gd, uGripCast[i].y, uGripCastColor[i] * vec4(1.0, 1.0, 1.0, alpha));
    }
    return acc;
  }
`,
  uniforms({ tokens }) {
    const m = MATERIAL[tokens.appearance];
    const rgba = (v: RGBA) => new THREE.Vector4(v[0], v[1], v[2], v[3]);
    const cast = (l: CastLayer) => new THREE.Vector4(l.y, l.blur, l.spread, 0);
    return {
      uControlAlpha: { value: m.controlAlpha },
      uRingTop: { value: rgba(m.controlRing.top) },
      uRingUpper: { value: rgba(m.controlRing.upper) },
      uRingSide: { value: rgba(m.controlRing.side) },
      uRingBottom: { value: rgba(m.controlRing.bottom) },
      uPoolAlpha: { value: m.poolAlpha },
      uMarkLight: { value: m.markLight },
      uChevronAlpha: { value: m.chevronAlpha },
      uGripCast: { value: m.gripCast.map(cast) },
      uGripCastColor: { value: m.gripCast.map((l) => rgba(l.color)) },
      uGrain: { value: m.grain },
      uMarkEdge: {
        value: rgba(tokens.contrast === 'high' ? m.markEdgeHighContrast : m.markEdge),
      },
    };
  },
};
