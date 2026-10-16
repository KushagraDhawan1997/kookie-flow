import * as THREE from 'three';
import type { CardShader } from '@kushagradhawan/kookie-flow-webgl/internal/skin/types';
import { AURA_GLSL } from './paint';
import { MATERIAL } from './material';
import { METRICS } from './metrics';

/**
 * The glass card: v2's `--shadow-3` as its float, an accent that is light rather than trim (an
 * aura diffusing down from top-centre and a glowing rim), and a faint white top line otherwise.
 */
export const card: CardShader = {
  glsl: /* glsl */ `
  // The float: shadow-3 as (y, blur, spread) and a colour, three layers.
  uniform vec4 uCast[3];
  uniform vec4 uCastColor[3];
  uniform float uTopLight;
  uniform float uAuraAlpha;
  uniform float uAuraGrain;
  uniform float uRimLight;

  ${AURA_GLSL}

  // Each layer is the shape moved DOWN by y, grown by its spread, and blurred; the CSS blur
  // radius is two sigma, so the ramp runs -blur..blur. Exactly glassCast(). "cast" is a reserved
  // word in GLSL ES 1.00, hence the name.
  vec4 paintCardShadow(vec2 p, vec2 b, float r) {
    vec4 castAcc = vec4(0.0);
    for (int i = 0; i < 3; i++) {
      float cy = uCast[i].x;
      float cb = uCast[i].y;
      float cs = uCast[i].z;
      float dc = roundedBoxSDF(p + vec2(0.0, cy), b + cs, r + cs);
      castAcc = overC(castAcc, uCastColor[i], 1.0 - smoothstep(-cb, cb, dc));
    }
    return castAcc;
  }

  // The accent is light, not trim: the rim glows (paintCardEdgeLight) and this is its reflection
  // in the glass, diffusing down from top-centre. Its reach is capped in world units so a tall
  // card does not wash to the middle.
  vec3 paintCardFill(vec3 fill, vec2 p, vec2 b, vec2 size, vec3 hue, float accent) {
    if (accent < 0.5) return fill;
    vec4 aura = glassAura(vec2(p.x + b.x, b.y - p.y), size, min(size.y * 0.45, 140.0), hue, gl_FragCoord.xy, uAuraGrain);
    return mix(fill, aura.rgb, aura.a * uAuraAlpha);
  }

  vec3 paintCardEdgeLight(vec3 color, vec2 p, vec2 b, float r, float d, float aa, float fillMask, vec3 hue, float accent) {
    // Top light: the 1.5px just inside the shape, weighted to the top edge, dying through the
    // corners. White on every card, accented or not — the glass's own rim; the accent lives in
    // the aura. d runs negative inward: the band is d in [-1.5, 0], softened over the next 1.5px
    // so it reads as light and not as a second hairline.
    float rim = smoothstep(-3.0, -1.5, d) * fillMask;
    // Clamped to the shape the way roundedBoxSDF clamps it: radius="full" is 9999, and unclamped
    // that put up at ~1 around the whole perimeter. max(): smoothstep is undefined when its edges
    // coincide, and radius="none" is legal.
    float cr = min(r, min(b.x, b.y));
    float up = smoothstep(b.y - max(cr, 1.0), b.y, p.y);
    if (accent > 0.5) {
      // The accented card's rim glows in the accent, brightest at top-centre, drifting to the
      // aura's neighbour hue toward the shoulders so the edge and its reflection agree.
      vec2 lit = glassRimLight(p, b, d, 1.5, aa, cr);
      vec3 rimColor = mix(hue, auraHueTurn(hue, -0.4), smoothstep(0.2, 0.9, lit.y) * 0.6);
      return mix(color, rimColor, lit.x * uRimLight);
    }
    return mix(color, vec3(1.0), rim * up * uTopLight);
  }
`,
  uniforms({ tokens }) {
    const m = MATERIAL[tokens.appearance];
    return {
      // The card's float is v2's `--shadow-3`: three layers, per appearance. The colours are the
      // token's own, so the appearance pair is the material's and not a light/dark opacity.
      uCast: { value: m.floatingCast.map((l) => new THREE.Vector4(l.y, l.blur, l.spread, 0)) },
      uCastColor: { value: m.floatingCast.map((l) => new THREE.Vector4(...l.color)) },
      uTopLight: { value: METRICS.nodeTopLight[tokens.appearance] },
      uAuraAlpha: { value: m.auraAlpha },
      uAuraGrain: { value: m.auraGrain },
      uRimLight: { value: m.rimLight },
    };
  },
  shadowReach({ tokens }) {
    // A layer reaches `y + spread + blur` past the shape, and the quad has to hold all three.
    return MATERIAL[tokens.appearance].floatingCast.reduce(
      (m, l) => Math.max(m, Math.abs(l.y) + l.spread + l.blur),
      0
    );
  },
};
