/**
 * Straight-alpha compositing, as a GLSL chunk.
 *
 * Every layer a shader stacks is an `over` onto an accumulator that starts transparent, so a
 * shader returns ONE colour and ONE alpha and the GPU does the last composite. Behaviour shaders
 * and skin paint functions both use it, so it belongs to neither.
 */

export const COMPOSITE_GLSL = /* glsl */ `
  // Straight-alpha "over": c at alpha a on top of dst.
  vec4 over(vec4 dst, vec3 c, float a) {
    a = clamp(a, 0.0, 1.0);
    float outA = a + dst.a * (1.0 - a);
    vec3 outC = (c * a + dst.rgb * dst.a * (1.0 - a)) / max(outA, 1e-5);
    return vec4(outC, outA);
  }

  vec4 overC(vec4 dst, vec4 c, float a) {
    return over(dst, c.rgb, c.a * a);
  }
`;
