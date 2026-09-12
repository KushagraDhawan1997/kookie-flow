/**
 * Easing, once, in both languages.
 *
 * The TypeScript half is what a transition tracker uses to find where a retargeted transition
 * currently IS (motion.ts); the GLSL half is what the shader uses to draw the same curve. They
 * have to agree, or a hover that reverses mid-fade jumps — so both are the same three lines.
 */

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = clamp01(t) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/**
 * v2's `--motion-easing`, `cubic-bezier(.22, 1, .36, 1)`: every colour change. That bezier is the
 * quintic ease-out, so this is exact rather than a fit.
 */
export function easeColor(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u * u * u;
}

/**
 * A damped spring from 0 to 1 over a unit of time, with natural frequency `w` and damping `z`.
 *
 * v2 ships its springs as CSS `linear()` tables. Each one below is this curve fitted to its
 * table, and each fit stays within half a percent of every stop, so a GL control moves on the
 * spring a DOM control does. The end is snapped to 1, which the table does too.
 */
function spring(t: number, w: number, z: number): number {
  const u = clamp01(t);
  if (u >= 1) return 1;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * u) * (Math.cos(wd * u) + ((z * w) / wd) * Math.sin(wd * u));
}

/** `--motion-spring-stiff`: a press, and the focus ring landing. Settles without overshoot. */
export const springStiff = (t: number) => spring(t, 4.7, 0.85);
/** `--motion-spring-lively`: recovery from a press, and a hover rise. One overshoot of ten percent. */
export const springLively = (t: number) => spring(t, 10.85, 0.58);
/** `--motion-spring`: a checkbox's tick drawing on. */
export const springMark = (t: number) => spring(t, 7.7, 0.65);
/** `--motion-spring-elastic`: a floating panel's entrance. */
export const springElastic = (t: number) => spring(t, 10.9, 0.72);

export const EASE_GLSL = /* glsl */ `
  float easeOutCubic(float t) {
    float u = 1.0 - clamp(t, 0.0, 1.0);
    return 1.0 - u * u * u;
  }

  float easeOutBack(float t) {
    float u = clamp(t, 0.0, 1.0) - 1.0;
    return 1.0 + 2.70158 * u * u * u + 1.70158 * u * u;
  }

  float easeColor(float t) {
    float u = 1.0 - clamp(t, 0.0, 1.0);
    return 1.0 - u * u * u * u * u;
  }

  float dampedSpring(float t, float w, float z) {
    float u = clamp(t, 0.0, 1.0);
    if (u >= 1.0) return 1.0;
    float wd = w * sqrt(1.0 - z * z);
    return 1.0 - exp(-z * w * u) * (cos(wd * u) + (z * w / wd) * sin(wd * u));
  }

  float springStiff(float t) { return dampedSpring(t, 4.7, 0.85); }
  float springLively(float t) { return dampedSpring(t, 10.85, 0.58); }
  float springMark(float t) { return dampedSpring(t, 7.7, 0.65); }
  float springElastic(float t) { return dampedSpring(t, 10.9, 0.72); }
`;
