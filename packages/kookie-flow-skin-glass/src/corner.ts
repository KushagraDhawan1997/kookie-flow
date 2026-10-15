/**
 * The corner profile a SURFACE is drawn with, and the number that makes it match the DOM.
 *
 * KookieUI v2 draws a surface as a SQUIRCLE, not as a circular arc:
 *
 *     .kui-surface { border-radius: calc(var(--kui-sf-radius) * var(--kui-corner-k, 1)) }
 *     @supports (corner-shape: squircle) {
 *       .kui-surface { --kui-corner-k: 1.613; corner-shape: squircle }
 *     }
 *
 * Two things follow from that, and this package had both of them wrong.
 *
 * FIRST, THE PROFILE. A superellipse hugs the corner far closer than a circular arc of the same
 * radius, so the same number reads as much less rounded. `corner-shape: squircle` is
 * `superellipse(2)` in CSS terms, and CSS defines `superellipse(k)` as the curve
 * |x|^n + |y|^n = 1 with n = 2^k — so a squircle is the L4 norm, where a circle is L2. Swapping
 * `length()` for that norm is the whole of the shape change.
 *
 * SECOND, THE COMPENSATION. Because the squircle reads tighter, v2 multiplies the radius by
 * `--kui-corner-k` = 1.613 in the branch that can draw one, so both branches aim at the same
 * perceived roundness. Only Chrome has `corner-shape` today, so Safari and Firefox fall through to
 * `k = 1` and get a CIRCLE at the raw token — which is the rounder of the two, and is the look this
 * package copied when it took the token and drew an arc with it. The node bodies were the Safari
 * fallback, not the design.
 *
 * A shader has no such branch. We draw the real profile everywhere, so a node body is the intended
 * shape on every browser — which is one of the few places this renderer can be strictly better than
 * the DOM it is matching rather than merely equal to it.
 *
 * CONTROLS ARE NOT SQUIRCLES. `corner-shape` appears on `.kui-surface` and on nothing else in the
 * stylesheet; `.kui-control` is a plain `border-radius: var(--kui-ct-radius)`. Widget wells keep the
 * circular SDF in widgets-gl.tsx, and that difference is deliberate on v2's part, not an omission.
 */

/**
 * Multiplier from the surface radius token to the radius a squircle is drawn at.
 *
 * v2's `--kui-corner-k`. The nested-rows variant uses 1.75; a node body is a plain surface.
 */
export const CORNER_K = 1.613;

/**
 * `roundedBoxSDF(p, b, r)` with a squircle corner, as GLSL source.
 *
 * Drop-in for the circular version: same name, same signature, same clamp, so a call site does not
 * change. The only difference is the norm used outside the corner's centre.
 *
 * The L4 norm is computed WITHOUT `pow`: `(x^4 + y^4)^(1/4)` is `sqrt(sqrt(dot(m*m, m*m)))`, which
 * is two multiplies and two square roots against two transcendental calls. It runs per fragment on
 * the node body, the shadow halo and the selection ring, so the difference is not academic.
 *
 * This is not a Euclidean distance field for n != 2 — the gradient is not unit length off the
 * axes — but every consumer antialiases with `fwidth(d)`, which measures the actual screen-space
 * rate of change and therefore self-corrects. That is what makes the substitution safe.
 */
export const squircleBoxSDF = /* glsl */ `
  float roundedBoxSDF(vec2 p, vec2 b, float r) {
    // A rounded box is only defined for r <= min(b.x, b.y); past that every fragment lands outside
    // the shape and the early-discard erases the box. Clamped here rather than at the call sites:
    // they pass different radii (the body's, +padding, -outlineWidth) and a repeated clamp drifts.
    r = min(r, min(b.x, b.y));
    vec2 q = abs(p) - b + r;
    vec2 m = max(q, 0.0);
    vec2 m2 = m * m;
    return min(max(q.x, q.y), 0.0) + sqrt(sqrt(dot(m2, m2))) - r;
  }
`;
