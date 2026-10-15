/**
 * MSDF (Multi-channel Signed Distance Field) Shader
 *
 * Renders crisp, scalable text using instanced glyph quads.
 * Each instance is a single glyph positioned in world space.
 *
 * References:
 * - https://github.com/Chlumsky/msdfgen
 * - https://github.com/leochocolat/three-msdf-text-utils
 */

/**
 * Vertex shader for instanced MSDF text.
 *
 * Per-instance attributes:
 * - instanceMatrix: transformation matrix (position + scale)
 * - aUvOffset: vec4(u, v, width, height) in atlas UV space
 * - aColor: vec3 RGB color
 * - aOpacity: float opacity
 */
export const msdfVertexShader = /* glsl */ `
  // Per-instance attributes
  attribute vec4 aUvOffset;
  attribute vec3 aColor;
  attribute float aOpacity;

  // Varyings to fragment shader
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    // Map quad UV (0-1) to glyph UV in atlas
    // aUvOffset = (u, v, width, height) in normalized atlas coordinates
    // Only flip V: BMFont atlas has Y=0 at top, WebGL has Y=0 at bottom
    vUv = vec2(
      aUvOffset.x + uv.x * aUvOffset.z,
      aUvOffset.y + (1.0 - uv.y) * aUvOffset.w
    );
    vColor = aColor;
    vOpacity = aOpacity;

    // Standard instanced transform
    // Position is already set via instanceMatrix
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

/**
 * Fragment shader for MSDF text rendering.
 *
 * Uses the median of RGB channels to reconstruct the signed distance,
 * then applies smoothstep for anti-aliased edges.
 */
export const msdfFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uAtlas;
  uniform float uThreshold;    // SDF threshold (typically 0.5)
  uniform float uAlphaTest;    // Minimum alpha to render

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;

  // Compute median of three values (standard MSDF technique)
  float median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
  }

  void main() {
    // Sample MSDF texture
    vec4 texel = texture2D(uAtlas, vUv);

    // Get signed distance from median of RGB channels
    float sd = median(texel.r, texel.g, texel.b);

    // Compute anti-aliased alpha using screen-space derivatives
    // fwidth gives the rate of change, used for smooth edges regardless of zoom
    float w = fwidth(sd) * 0.5;
    float alpha = smoothstep(uThreshold - w, uThreshold + w, sd);

    // Apply opacity
    alpha *= vOpacity;

    // Alpha test for early discard
    if (alpha < uAlphaTest) discard;

    gl_FragColor = vec4(vColor, alpha);
  }
`;

/**
 * Alternative fragment shader with outline support.
 * Useful for edge labels that need better visibility.
 */
export const msdfFragmentShaderWithOutline = /* glsl */ `
  precision highp float;

  uniform sampler2D uAtlas;
  uniform float uThreshold;
  uniform float uAlphaTest;
  uniform vec3 uOutlineColor;
  uniform float uOutlineWidth;

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;

  float median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
  }

  void main() {
    vec4 texel = texture2D(uAtlas, vUv);
    float sd = median(texel.r, texel.g, texel.b);

    float w = fwidth(sd) * 0.5;

    // Fill alpha
    float fillAlpha = smoothstep(uThreshold - w, uThreshold + w, sd);

    // Outline alpha (extends further out)
    float outlineThreshold = uThreshold - uOutlineWidth;
    float outlineAlpha = smoothstep(outlineThreshold - w, outlineThreshold + w, sd);

    // Combine: outline where fill is transparent
    vec3 color = mix(uOutlineColor, vColor, fillAlpha);
    float alpha = max(fillAlpha, outlineAlpha * 0.8) * vOpacity;

    if (alpha < uAlphaTest) discard;

    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Shader uniform defaults.
 */
export const MSDF_SHADER_DEFAULTS = {
  threshold: 0.5,
  alphaTest: 0.01,
  outlineColor: [0, 0, 0] as [number, number, number],
  outlineWidth: 0.1,
} as const;
