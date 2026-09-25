/**
 * KookieUI v2's lens — the refraction half of its material — as numbers and GLSL.
 *
 * v2 ships it as an SVG displacement filter in `backdrop-filter` (`system/refraction.tsx`, after
 * kube.io's "Liquid Glass in the Browser"), and only Chromium can render that. In GL it is a few
 * lines of shader and runs everywhere. The model is v2's, number for number:
 *
 * THE BEZEL IS A CURVED GLASS SURFACE. Across a band `bezel` wide inside the edge the surface rises
 * with height H(t) and slope H'(t) — t is 0 at the lip and 1 where the band ends — on v2's profile
 * P = 2, Q = 0.25. Each fragment's bend follows Snell's law on that slope, air 1.0 into glass at
 * `ior`, along the edge's outward normal. The body inside the band stays true; only the rim lenses,
 * hardest at the lip. Red, green and blue bend by `fringe` percent apart, so the edge splits light,
 * and `boost` is v2's judged override of the physics (2x bend).
 *
 * THE GLINT is v2's rim light: white at (1 - t)^falloff across a band one bezel wide.
 *
 * Nothing here knows what it is drawn on — see gl/index.ts.
 */

export interface LensRung {
  /** The band inside the edge that bends, in CSS px. */
  bezel: number;
  /** How thick the glass is at the top of the rise, in CSS px. */
  thickness: number;
  /** Index of refraction, air into glass. */
  ior: number;
  /** How far apart the three channels bend, as a percentage of the bend. */
  fringe: number;
  /** v2's judged multiplier on the physical bend. */
  boost: number;
}

/** v2's three rungs, from `refraction.tsx`. */
export const LENS: Record<'thin' | 'regular' | 'thick', LensRung> = {
  thin: { bezel: 3, thickness: 6.7, ior: 1.45, fringe: 18, boost: 2 },
  regular: { bezel: 4.5, thickness: 9.6, ior: 1.5, fringe: 30, boost: 2 },
  thick: { bezel: 6.5, thickness: 12.6, ior: 1.62, fringe: 48, boost: 2 },
};

/** v2's `glint` token: the band as a fraction of the bezel, and how tightly it hugs the lip. */
export const GLINT = { band: 1, falloff: 4 } as const;

export const LENS_GLSL = /* glsl */ `
  // v2's bend at t (0 at the lip, 1 at the inner end of the bezel), in px. P = 2, Q = 0.25, so the
  // slope's constant P * Q is 0.5 — see refraction.tsx for why it has to be carried.
  float lensBend(float t, float bezel, float thickness, float ior) {
    float u = 1.0 - t;
    float uP = u * u;
    float height = pow(max(1.0 - uP, 0.0), 0.25);
    float slope = 0.5 * u / pow(max(1.0 - uP, 0.04), 0.75);
    float geo = slope * thickness / bezel;
    float th1 = atan(abs(geo));
    float th2 = asin(min(sin(th1) / ior, 1.0));
    return sign(geo) * thickness * height * tan(th1 - th2);
  }

  // v2's glint: (1 - t)^falloff across the band, feathered over the outermost pixel.
  float lensGlint(float inside, float band, float falloff) {
    if (inside > band) return 0.0;
    float t = max(inside, 0.0) / band;
    return pow(1.0 - t, falloff) * clamp(inside + 1.0, 0.0, 1.0);
  }
`;
