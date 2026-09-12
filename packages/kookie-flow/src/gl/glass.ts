/**
 * KookieUI v2's material, as GLSL layers a control shader stacks on a shape.
 *
 * WHAT THE MATERIAL IS. v2 builds `material="regular"` out of a short list of CSS: a fill at a
 * partial alpha over a blurred, saturated ground; a 1px ring that is a CONIC gradient — bright
 * white at the top, a faint dark line around the sides and bottom — masked to the border; a
 * radial glint at the top-left plus a top-down wash; a soft inner shade pooled along the bottom;
 * fractal-noise grain at 4.5%; and, on anything filled or floating, a layered drop shadow. Each of
 * those is one function here, and `gl/material.ts` carries the numbers, so a control in GL is the
 * same recipe as a control in the DOM rather than an impression of it.
 *
 * Every layer is an `over` onto a straight-alpha accumulator that starts transparent, so a control
 * returns ONE colour and ONE alpha and the GPU does the last composite.
 *
 * Requires `SDF_GLSL` first. Coordinates are the shape's own: `p` centred, y up, world units.
 */

export const GLASS_GLSL = /* glsl */ `
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

  // Saturation and brightness, as backdrop-filter applies them to a ground.
  vec3 filterGround(vec3 c, float sat, float bright) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(l), c, sat) * bright;
  }

  // v2's loud fill: lightness lifted, chroma raised, at a partial alpha. Done in a luma/chroma
  // split rather than OKLCH — for a UI accent the difference is invisible and this is four ops.
  vec3 loudFill(vec3 c, float lift, float chroma) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return clamp(mix(vec3(l), c, chroma) * lift, 0.0, 1.0);
  }

  // A rounded box with a squircle corner — v2's corner-shape on surfaces. The L4 norm outside the
  // corner centre; computed without pow (see utils/corner-shader.ts for the derivation).
  float sdSquircleBox(vec2 p, vec2 b, float r) {
    r = min(r, min(b.x, b.y));
    vec2 q = abs(p) - b + r;
    vec2 m = max(q, 0.0);
    vec2 m2 = m * m;
    return min(max(q.x, q.y), 0.0) + sqrt(sqrt(dot(m2, m2))) - r;
  }

  // The conic ring, evaluated at the fragment's angle about the shape's centre. CSS conic angles
  // run clockwise from straight up; "from 345deg" starts fifteen degrees left of that. The four
  // colours are the stops at 0, 22%, 34% and 44-56%, mirrored on the way back.
  vec4 conicRing(vec2 p, vec4 top, vec4 upper, vec4 side, vec4 bottom) {
    float a = atan(p.x, p.y);                    // 0 at the top, clockwise positive
    float t = fract((a - radians(345.0)) / 6.2831853);
    t = t > 0.5 ? 1.0 - t : t;                   // symmetric about the bottom
    t *= 2.0;                                    // 0 at the top, 1 at the bottom
    // Linear between stops, and in PREMULTIPLIED space, as CSS gradients interpolate. Mixed
    // straight, the white-at-95% to black-at-7% run went through a half-alpha mid grey and drew a
    // dark line along the top of every pill; premultiplied, the white holds until its alpha is gone.
    vec4 c0;
    vec4 c1;
    float k;
    if (t < 0.44) { c0 = top; c1 = upper; k = t / 0.44; }
    else if (t < 0.68) { c0 = upper; c1 = side; k = (t - 0.44) / 0.24; }
    else { c0 = side; c1 = bottom; k = clamp((t - 0.68) / 0.20, 0.0, 1.0); }
    vec4 pm = mix(vec4(c0.rgb * c0.a, c0.a), vec4(c1.rgb * c1.a, c1.a), k);
    return vec4(pm.rgb / max(pm.a, 1e-5), pm.a);
  }

  // The ring, masked to a w-wide band inside the edge.
  vec4 glassRing(vec4 dst, float d, float aa, float w, vec2 p, vec4 top, vec4 upper, vec4 side, vec4 bottom, float opacity) {
    vec4 c = conicRing(p, top, upper, side, bottom);
    return overC(dst, c, opacity * ringSDF(d, w, aa));
  }

  // The medium wash: a radial glint centred at (16%, -12%) of the box, 130% x 80% across, fading
  // out by 55% of its radius; and a top-down white fading out by 45% of the height. u is the
  // fragment in 0..1 box coordinates, y down.
  vec4 glassWash(vec4 dst, float inside, vec2 u, float radialA, float linearA) {
    vec2 c = (u - vec2(0.16, -0.12)) / vec2(0.65, 0.40);
    float radial = 1.0 - smoothstep(0.0, 0.55, length(c));
    float linear = 1.0 - clamp(u.y / 0.45, 0.0, 1.0);
    dst = over(dst, vec3(1.0), inside * radialA * radial);
    return over(dst, vec3(1.0), inside * linearA * linear);
  }

  // control-light: a top-down white to 60% of the height, on a filled mark.
  vec4 glassLight(vec4 dst, float inside, float uy, float a) {
    return over(dst, vec3(1.0), inside * a * (1.0 - clamp(uy / 0.6, 0.0, 1.0)));
  }

  // An inset shadow, as CSS draws one: shade everywhere outside a "hole", the box moved by the
  // shadow's offset and grown by minus its spread, blurred. dHole is the distance to that hole;
  // blur is the CSS blur radius, which is two sigma, so the ramp runs -blur..blur. v2's pool,
  // inset 0 -6px 12px -10px, grows the hole past every edge, so what reaches the box is a
  // whisper along the bottom and nothing anywhere else.
  vec4 glassInset(vec4 dst, float inside, float dHole, float blur, float a) {
    return over(dst, vec3(0.0), inside * a * smoothstep(-blur, blur, dHole));
  }

  // One drop-shadow layer: the shape offset by y (CSS px, so DOWN), grown by spread, blurred.
  // Only outside the shape itself, which covers the rest — CSS never paints a box-shadow under
  // its own box. dCast is the distance to that offset, grown shape; dShape the distance to the
  // shape. The CSS blur radius is two sigma, so the ramp runs -blur..blur.
  vec4 glassCast(vec4 dst, float dCast, float dShape, float blur, vec4 c) {
    float s = 1.0 - smoothstep(-blur, blur, dCast);
    return overC(dst, c, s * step(0.0, dShape));
  }

  // An inset bottom line: inset 0 -1px 0. One pixel inside the bottom edge only.
  vec4 glassInsetLine(vec4 dst, float d, float aa, vec2 n, float a) {
    float line = ringSDF(d, 1.0, aa) * clamp(-n.y, 0.0, 1.0);
    return over(dst, vec3(0.0), a * line);
  }

  // The grain: v2's fractal-noise rim is white at 4.5%. A per-pixel hash reads the same at any
  // zoom, which is what a tiled 160px SVG does in the DOM.
  float grainHash(vec2 px) {
    vec3 p3 = fract(vec3(px.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec4 glassGrain(vec4 dst, float inside, vec2 px, float a) {
    return over(dst, vec3(1.0), inside * a * grainHash(floor(px)));
  }

  // The outward normal of a shape, from its distance field's screen-space gradient.
  vec2 sdfNormal(float d) {
    vec2 g = vec2(dFdx(d), dFdy(d));
    return g / max(length(g), 1e-6);
  }
`;
