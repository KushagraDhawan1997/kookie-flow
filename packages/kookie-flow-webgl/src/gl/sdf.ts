/**
 * Signed-distance shapes, as a GLSL chunk every control shader includes.
 *
 * THE SEAM. Nothing in `src/gl/` imports the store, the theme, or a component: a file here takes
 * numbers and returns GLSL or numbers. That is what lets this directory be lifted into its own
 * package later without dragging the graph along — the shaders in `components/` compose these
 * chunks and add the part that knows what a widget is.
 *
 * Every function here works in WORLD units with a caller-supplied antialiasing width `aa`, which
 * the caller derives from `fwidth` so an edge is the same width in pixels at every zoom. Strokes
 * are drawn as capsules (`sdSegment`) rather than as bands cut by `step`, which is what gives the
 * tick and the chevron round caps and a clean joint instead of the stair-stepped corner the first
 * version showed at 500% zoom.
 */

export const SDF_GLSL = /* glsl */ `
  // A box of half-size b with corner radius r. Clamped so past r = min(b) every fragment lands
  // outside the shape and the box erases itself — the same clamp nodes.tsx applies.
  float sdRoundedBox(vec2 p, vec2 b, float r) {
    r = min(r, min(b.x, b.y));
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  float sdCircle(vec2 p, float r) {
    return length(p) - r;
  }

  // A capsule: the segment a-b with round caps of radius r.
  float sdSegment(vec2 p, vec2 a, vec2 b, float r) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }

  // Coverage from a signed distance: 1 inside, 0 outside, aa wide at the edge.
  float fillSDF(float d, float aa) {
    return 1.0 - smoothstep(-aa, aa, d);
  }

  // A band of width w just inside the edge: the hairline.
  float ringSDF(float d, float w, float aa) {
    return fillSDF(d, aa) - fillSDF(d + w, aa);
  }

  // A soft halo of width w OUTSIDE the edge, quadratic, full strength at the edge.
  float haloSDF(float d, float w) {
    float g = clamp(d / w, 0.0, 1.0);
    return (1.0 - g) * (1.0 - g) * step(0.0, d);
  }

  // The tick, in a square of side s centred on p, revealed from its left end by t in 0..1.
  // Two capsules along the path A -> B -> C; t walks the path's length so the second arm only
  // starts drawing once the first is complete. v2's proportions: in a 20px mark the path is 9px
  // by 6px with a stroke under 2px — a light tick, not a heavy one.
  float sdTick(vec2 p, float s, float t) {
    vec2 a = vec2(-0.225, 0.005) * s;
    vec2 b = vec2(-0.075, -0.150) * s;
    vec2 c = vec2(0.225, 0.155) * s;
    float l1 = length(b - a);
    float l2 = length(c - b);
    float walk = t * (l1 + l2);
    float t1 = clamp(walk / l1, 0.0, 1.0);
    float t2 = clamp((walk - l1) / l2, 0.0, 1.0);
    float r = 0.045 * s;
    float d = sdSegment(p, a, mix(a, b, t1), r);
    // The second arm exists only once the walk has reached B; before that it is the cap at B,
    // which the first arm already draws.
    if (t2 > 0.0) d = min(d, sdSegment(p, b, mix(b, c, t2), r));
    return d;
  }

  // A chevron pointing DOWN (y is up in shader space), w wide and h tall, stroke radius r,
  // rotated by angle a about its centre — pi turns it up while a list is open.
  float sdChevron(vec2 p, float w, float h, float r, float a) {
    float ca = cos(a);
    float sa = sin(a);
    vec2 q = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
    vec2 apex = vec2(0.0, -h * 0.5);
    float d1 = sdSegment(q, vec2(-w * 0.5, h * 0.5), apex, r);
    float d2 = sdSegment(q, vec2(w * 0.5, h * 0.5), apex, r);
    return min(d1, d2);
  }
`;
