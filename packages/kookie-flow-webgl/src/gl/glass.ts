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

/**
 * The aura: an accent that is LIGHT in the glass rather than trim on its edge.
 *
 * A uniform solid band at the top edge reads as trim. Here the rim itself glows in the accent,
 * brightest at top-centre, and the glass beneath carries that glow's reflection — a faint, grained
 * cast that diffuses as it travels down. The grain is the controls' own, so it is light on a surface
 * and not a gradient on a screen.
 *
 * Self-contained — it does not need `GLASS_GLSL` or `SDF_GLSL`, so a shader that runs on every
 * node pays for these three functions and nothing else.
 */
export const AURA_GLSL = /* glsl */ `
  // A turn about the grey axis (Rodrigues). Keeps a hue's lightness near where it was, which a
  // channel swap does not.
  vec3 auraHueTurn(vec3 c, float a) {
    const vec3 k = vec3(0.57735027);
    float ca = cos(a);
    return clamp(c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca), 0.0, 1.0);
  }

  float auraHash(vec2 px) {
    vec3 p3 = fract(vec3(px.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Smooth value noise, for bending the field so its blobs are not compass circles.
  float auraNoise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float a = auraHash(i);
    float b = auraHash(i + vec2(1.0, 0.0));
    float c = auraHash(i + vec2(0.0, 1.0));
    float d = auraHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  /**
   * The wash is a REFLECTION of the lit rim, not a paint of its own. The rim (glassRimLight) is an
   * accent emitter along the top edge with a gaussian profile; what it casts into the glass below is
   * that same profile diffusing as it travels — wider and fainter with depth (a gaussian whose sigma
   * grows, its peak scaled by s0/sigma so the light spreads rather than multiplies) and decaying away
   * from the edge. So the wash is brightest just under top-centre and nowhere the rim is not.
   *
   * q: world units from the box's top-left, y down. size: the box. reach: where it must be gone, in
   * world units. px: the screen pixel, so the grain is one device pixel at any zoom. Returns colour
   * and coverage for the caller to scale and mix.
   */
  vec4 glassAura(vec2 q, vec2 size, float reach, vec3 hue, vec2 px, float grain) {
    if (q.y > reach) return vec4(hue, 0.0);
    float w = max(size.x, 1.0);
    // A low-frequency bend so the cast reads as light through glass, not a perfect bell. Scaled by
    // the box, so a card keeps its shape of light at every zoom.
    vec2 warp = vec2(auraNoise(q / (w * 0.4) + 3.1), auraNoise(q / (w * 0.4) + 7.7)) - 0.5;
    vec2 k = q + warp * vec2(w * 0.12, reach * 0.2);
    float y = max(k.y, 0.0);
    // s0 matches the rim's own profile: exp(-along^2 * 3.2) is a sigma of ~0.2 of the width.
    float s0 = w * 0.2;
    float sigma = s0 + y * 0.9;
    float dx = k.x - w * 0.5;
    float cover = (s0 / sigma) * exp(-(dx * dx) / (2.0 * sigma * sigma)) * exp(-y / (reach * 0.38));
    cover *= 1.0 - smoothstep(reach * 0.6, reach, q.y);
    // Toward its edges the cast drifts to a neighbour hue — much past 0.4 rad a blue is green.
    vec3 c = mix(hue, auraHueTurn(hue, -0.4), clamp(abs(dx) / (w * 0.5), 0.0, 1.0) * 0.6);
    // Grain modulates coverage, so it lives inside the light and vanishes with it.
    cover *= 1.0 + (auraHash(floor(px)) - 0.5) * grain;
    return vec4(c, clamp(cover, 0.0, 1.0));
  }

  /**
   * The lit rim: brightest at top-centre, falling off along the top edge, wrapping a little way
   * over the shoulders and gone before the sides — the controls' conic ring, expressed on a box of
   * any aspect. Covers the hairline too, so the edge itself is what lights up. p centred, y up; d the shape's distance; w the band's width.
   * Returns the mask and, in .y, how far toward the shoulders the point is (0 centre, 1 corner).
   */
  vec2 glassRimLight(vec2 p, vec2 b, float d, float w, float aa, float cr) {
    float band = smoothstep(-w - aa, -w + aa * 0.5, d) * (1.0 - smoothstep(0.0, aa, d));
    float along = clamp(abs(p.x) / max(b.x, 1.0), 0.0, 1.0);
    float across = smoothstep(b.y - max(cr, 1.0) * 1.6, b.y, p.y);
    float centre = exp(-along * along * 3.2);
    return vec2(band * across * centre, along);
  }
`;
