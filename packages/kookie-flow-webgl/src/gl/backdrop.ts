/**
 * The ground behind a floating panel, copied out of the frame so the panel can blur it.
 *
 * A panel that floats over the graph — a list, a colour picker — sits over nodes, edges and the
 * grid, and glass over a busy ground has to blur it or it reads as a tinted rectangle. There is no
 * `backdrop-filter` in WebGL, so this does what the browser does under that property: just before
 * the panel draws, copy the pixels already drawn under its rectangle into a texture, and let the
 * panel's shader sample that texture with a disc blur.
 *
 * ONE COPY, ONE REGION, ONLY WHILE OPEN. `copyTexSubImage2D` reads back the rectangle under the
 * panel plus its shadow — a few hundred pixels a side — into a texture allocated ONCE per open
 * (and re-allocated only if the panel's screen size changes, which a zoom can do). Nothing is
 * copied while no panel is open, and nothing is read back to the CPU at any point.
 *
 * The renderer draws into the default framebuffer, which is what the copy reads; anything drawn
 * AFTER the panel is not in the copy, which is why the panel's render order has to be past every
 * layer it should see through.
 */

import * as THREE from 'three';

const POSITION = new THREE.Vector2();

export class BackdropSnapshot {
  texture: THREE.FramebufferTexture | null = null;
  /** Device-pixel origin of the copied region, from the framebuffer's bottom-left. */
  x = 0;
  y = 0;
  width = 0;
  height = 0;

  /** Size the texture to `width` x `height` device pixels, allocating only if that changed. */
  ensure(width: number, height: number): THREE.FramebufferTexture {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (this.texture && this.width === w && this.height === h) return this.texture;
    this.texture?.dispose();
    const tex = new THREE.FramebufferTexture(w, h);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this.texture = tex;
    this.width = w;
    this.height = h;
    return tex;
  }

  /**
   * Copy the region at device-pixel (x, y) — bottom-left origin — into the texture. Clamped to
   * the framebuffer: a panel half off the canvas copies the half that exists and the shader's
   * clamp fills the rest with the canvas colour.
   */
  capture(renderer: THREE.WebGLRenderer, x: number, y: number): void {
    if (!this.texture) return;
    const dpr = renderer.getPixelRatio();
    const size = renderer.getSize(POSITION);
    const fbW = Math.floor(size.x * dpr);
    const fbH = Math.floor(size.y * dpr);
    const cx = Math.max(0, Math.min(Math.floor(x), fbW - this.width));
    const cy = Math.max(0, Math.min(Math.floor(y), fbH - this.height));
    this.x = cx;
    this.y = cy;
    renderer.copyFramebufferToTexture(this.texture, POSITION.set(cx, cy));
  }

  dispose(): void {
    this.texture?.dispose();
    this.texture = null;
    this.width = 0;
    this.height = 0;
  }
}

/**
 * The shader half. Samples the snapshot at a device-pixel position — `gl_FragCoord.xy` — and
 * composites it over the canvas colour, because the framebuffer is cleared to transparent and the
 * canvas's own colour is a CSS background behind it. What was blended into a transparent buffer
 * is premultiplied by its coverage, so the composite is `rgb + bg * (1 - a)` and not a mix.
 *
 * The blur is a golden-angle disc, rotated per pixel by an interleaved-gradient hash so the tap
 * pattern does not print as a lattice at this tap count. Uniforms:
 *   uBackdrop, uBackdropOrigin (device px), uBackdropSize (device px), uCanvasBg
 */
export const BACKDROP_GLSL = /* glsl */ `
  uniform sampler2D uBackdrop;
  uniform vec2 uBackdropOrigin;
  uniform vec2 uBackdropSize;
  uniform vec3 uCanvasBg;

  vec3 sampleBackdrop(vec2 px) {
    vec2 uv = (px - uBackdropOrigin) / uBackdropSize;
    vec4 t = texture2D(uBackdrop, clamp(uv, vec2(0.002), vec2(0.998)));
    return t.rgb + uCanvasBg * (1.0 - t.a);
  }

  vec3 blurBackdrop(vec2 px, float radius) {
    float noise = fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
    float spin = noise * 6.2831853;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 32; i++) {
      float fi = float(i) + 0.5;
      float r = sqrt(fi / 32.0) * radius;
      float a = fi * 2.39996323 + spin;
      sum += sampleBackdrop(px + vec2(cos(a), sin(a)) * r);
    }
    return sum / 32.0;
  }
`;
