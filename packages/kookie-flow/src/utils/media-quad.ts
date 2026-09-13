/**
 * The quad every MEDIA entity is drawn on, and the one shader that fits a picture into it.
 *
 * An image and a video differ in where their pixels come from and in nothing else: both are one
 * textured rectangle in world space, both letterbox or crop to a box the user resized, both sit at
 * a depth `entity-depth.ts` assigns them. Sharing the geometry is not a tidiness argument — a
 * second PlaneGeometry with its own flipped UVs is a second thing to get wrong, and the flip is
 * the part that is easy to get wrong.
 *
 * THE FLIP. Textures here are uploaded with `flipY = false`, because UNPACK_FLIP_Y_WEBGL is
 * unreliable for ImageBitmap across browsers and WebGL versions. So V = 0 is the top of the source
 * for an ImageBitmap AND for an HTMLVideoElement, and the quad's own UVs are flipped once, here,
 * to match. Any texture handed to this material must therefore also set `flipY = false` — a
 * VideoTexture defaults to true and arrives upside down without it.
 *
 * THE CORNER. A media entity is a SURFACE, the same as a node body, so it takes the same squircle
 * profile from corner-shader.ts rather than being the one hard-cornered rectangle on a board of
 * rounded cards. It was exactly that until someone looked at a board and noticed. The mask is
 * applied to alpha rather than by discarding, so the curve is antialiased by fwidth the way every
 * other edge in this renderer is; a hard discard would leave a stair-stepped arc at the one place
 * the eye is most likely to be looking.
 *
 * THE CONTROLS ARE GLASS, drawn on the same quad — see utils/media-glass.ts for the material and
 * why media is the one place it gets a real blurred ground for nothing.
 */

import * as THREE from 'three';
import { SDF_GLSL, GLASS_GLSL, LENS_GLSL } from '../gl';
import { squircleBoxSDF, CORNER_K } from './corner-shader';
import {
  CONTROL_BAR_HEIGHT,
  CONTROL_BAR_INSET,
  CONTROL_BUTTON_SIZE,
  CONTROL_GAP,
  CONTROL_TRACK_END_PAD,
  EXPAND_BUTTON_SIZE,
  MESH_DRAG_STRIP_HEIGHT,
} from './media-chrome';
import type { MediaGlass } from './media-glass';

/** Shared unit quad geometry — reused by every media mesh (never disposed) */
export const sharedGeometry = (() => {
  const geo = new THREE.PlaneGeometry(1, 1);
  // Flip V coordinate so UV (0,0) = top-left (matches ImageBitmap origin).
  // This compensates for tex.flipY = false on our ImageBitmap textures.
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setY(i, 1 - uv.getY(i));
  }
  return geo;
})();

/** Placeholder material for media that hasn't loaded yet */
export function createPlaceholderMaterial(color: string): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}

const f = (n: number) => n.toFixed(1);

export const MEDIA_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const MEDIA_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D map;
uniform float opacity;
uniform vec2 uvOffset;
uniform vec2 uvScale;
varying vec2 vUv;

uniform vec2 uSize;
uniform float uCornerRadius;

/**
 * The chrome, in one vector so a still picture pays for nothing.
 *
 *   x  0 = none, 1 = a video's play bar, 2 = a model's drag grip
 *   y  how far through the clip, 0..1
 *   z  1 while playing, 0 while paused
 *   w  how present the bar or grip is, 0..1 — it fades in under the pointer
 */
uniform vec4 uChrome;
/** How present the expand button is, 0..1. Separate from uChrome.w: a picture has a button and no bar. */
uniform float uExpand;

// The glass (utils/media-glass.ts).
uniform vec3 uGround;
uniform vec3 uGlassTint;
uniform float uGlassTintA;
uniform vec2 uGlassFilter;
uniform float uGlassBlur;
uniform vec4 uRingTop;
uniform vec4 uRingUpper;
uniform vec4 uRingSide;
uniform vec4 uRingBottom;
uniform vec2 uGlassWash;
uniform float uGlassPool;
uniform float uGlassTopLine;
uniform float uGlassGrain;
uniform vec4 uGlassCast[2];
uniform vec4 uGlassCastColor[2];
uniform vec3 uInk;
uniform vec3 uAccent;
uniform float uControlRadius;
// The lens (gl/lens.ts): bezel, thickness, ior, boost; the channel split; the glint's peak,
// falloff and band.
uniform vec4 uLens;
uniform float uLensFringe;
uniform vec3 uGlint;

${squircleBoxSDF}
${SDF_GLSL}
${GLASS_GLSL}
${LENS_GLSL}

/**
 * The screen-space rate of change of the media UV, taken ONCE at the top of main.
 *
 * Every tap under a control is inside a branch and a loop, and a texture read there has no
 * derivatives of its own: the GPU picks a mip level from garbage wherever the branch differs across
 * a 2x2 pixel quad. On a mipmapped picture that printed a dotted ring exactly where the lens hands
 * over to the body (a video has no mips, so it never showed on one). An explicit gradient taken in
 * uniform control flow is correct for every tap: they are all within a few pixels of this fragment.
 */
vec2 gUvDx;
vec2 gUvDy;

// The media's own pixels, output-encoded, over the ground, at a quad UV. Outside the picture — a
// contain letterbox, a model's transparent background — it is the ground.
vec3 mediaAt(vec2 q) {
  vec2 s = q * uvScale + uvOffset;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return uGround;
  vec4 t = linearToOutputTexel(textureGrad(map, s, gUvDx, gUvDy));
  return mix(uGround, t.rgb, t.a);
}

// A light blur over the media under a control: a golden-angle disc rotated per pixel so the taps do
// not print as a lattice. px is top-left media pixels.
vec3 blurredGround(vec2 px) {
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float spin = noise * 6.2831853;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 10; i++) {
    float fi = float(i) + 0.5;
    float rr = sqrt(fi / 10.0) * uGlassBlur;
    float ang = fi * 2.39996323 + spin;
    sum += mediaAt((px + vec2(cos(ang), sin(ang)) * rr) / uSize);
  }
  return sum / 10.0;
}

// What a control shows at this fragment. The body is near-clear glass: the media, lightly blurred.
// The rim BENDS it — v2's lens: Snell's law across a curved bezel, hardest at the lip, each channel
// bent a little differently so the edge splits light. n is the outward normal in top-left px.
//
// INWARD, AND KEPT ON THE PICTURE. A convex rim pulls what is under the body out toward the lip, so
// the bend samples along -n. Bent outward it reached past the media's own edge — a control sits 8px
// in and the lip bends up to twice that — sampled the flat ground there, and drew a white band that
// the channel split then printed orange. The clamp holds every bent tap on the picture.
vec3 lensGround(vec2 px, vec2 n, float inside) {
  if (inside >= uLens.x) return blurredGround(px);
  float bend = lensBend(clamp(inside / uLens.x, 0.0, 1.0), uLens.x, uLens.y, uLens.z) * uLens.w;
  vec2 lo = vec2(uGlassBlur + 1.0);
  vec2 hi = uSize - lo;
  return vec3(
    blurredGround(clamp(px - n * bend * (1.0 + uLensFringe), lo, hi)).r,
    blurredGround(clamp(px - n * bend, lo, hi)).g,
    blurredGround(clamp(px - n * bend * (1.0 - uLensFringe), lo, hi)).b
  );
}

// One glass control: the chrome cast, the lensed ground under a light tint, the wash, the pool, the
// top light, the grain, the glint along the rim, and the ring. px is top-left media pixels; p is the
// same point centred on the control with y up. Controls are round, never squircles — D13.
vec4 glassControl(vec2 px, vec2 p, vec2 hs, float aa) {
  vec4 ui = vec4(0.0);
  float r = uControlRadius;
  float d = sdRoundedBox(p, hs, r);
  for (int i = 0; i < 2; i++) {
    float dc = sdRoundedBox(p - vec2(0.0, -uGlassCast[i].x), hs + uGlassCast[i].z, r + uGlassCast[i].z);
    ui = glassCast(ui, dc, d, uGlassCast[i].y, uGlassCastColor[i]);
  }
  // Outside the control only its cast shows, and the lens and the blur are never paid for.
  if (d > aa) return ui;

  float inside = -d;
  // The outward normal, from the field itself rather than from screen derivatives, so it holds at
  // every zoom: y up for the light, top-left px for the bend.
  vec2 g = vec2(
    sdRoundedBox(p + vec2(0.5, 0.0), hs, r) - sdRoundedBox(p - vec2(0.5, 0.0), hs, r),
    sdRoundedBox(p + vec2(0.0, 0.5), hs, r) - sdRoundedBox(p - vec2(0.0, 0.5), hs, r)
  );
  vec2 nUp = g / max(length(g), 1e-5);

  float cover = fillSDF(d, aa);
  vec3 gnd = filterGround(lensGround(px, vec2(nUp.x, -nUp.y), inside), uGlassFilter.x, uGlassFilter.y);
  ui = over(ui, mix(gnd, uGlassTint, uGlassTintA), cover);
  ui = glassWash(ui, cover, (vec2(p.x, -p.y) + hs) / (2.0 * hs), uGlassWash.x, uGlassWash.y);
  ui = glassInset(ui, cover, sdRoundedBox(p - vec2(0.0, 6.0), hs + 10.0, r + 10.0), 12.0, uGlassPool);
  ui = over(ui, vec3(1.0), cover * uGlassTopLine * (1.0 - fillSDF(sdRoundedBox(p + vec2(0.0, 1.0), hs, r), aa)));
  ui = glassGrain(ui, cover, gl_FragCoord.xy, uGlassGrain);
  // The glint, brightest where the rim faces the light at the top-left and its reflection at the
  // bottom-right — the two catches that make a liquid-glass edge read as a solid with thickness.
  float facing = mix(0.35, 1.0, abs(dot(nUp, vec2(-0.70710678, 0.70710678))));
  ui = over(ui, vec3(1.0), cover * lensGlint(inside, uLens.x * uGlint.z, uGlint.y) * uGlint.x * facing);
  // The ring, quieter than a panel's: the glint is the edge now, and the ring's dark sides only fog it.
  return glassRing(ui, d, aa, 1.0, p, uRingTop, uRingUpper, uRingSide, uRingBottom, 0.35);
}

bool near(vec2 p, vec2 hs, float reach) {
  return abs(p.x) < hs.x + reach && abs(p.y) < hs.y + reach;
}

void main() {
  vec2 sampledUV = vUv * uvScale + uvOffset;
  gUvDx = dFdx(sampledUV);
  gUvDy = dFdy(sampledUV);
  bool outside = sampledUV.x < 0.0 || sampledUV.x > 1.0 || sampledUV.y < 0.0 || sampledUV.y > 1.0;
  vec4 texColor = outside ? vec4(0.0) : textureGrad(map, sampledUV, gUvDx, gUvDy);

  // Encoded first, so the glass composites in the same space CSS blends in.
  gl_FragColor = vec4(texColor.rgb, texColor.a * opacity);
  #include <colorspace_fragment>
  vec4 color = gl_FragColor;

  if (uChrome.w > 0.001 || uExpand > 0.001) {
    // Top-left origin, like the layout. The shared geometry's V is already flipped so its top edge
    // is v = 0; flipping it again drew the play bar along the top, opposite the hit test.
    vec2 px = vUv * uSize;
    float aa = fwidth(px.x) * 0.75 + 1e-5;
    // How far past a control its cast can reach, so the blur runs only where glass can be.
    float reach = 24.0;

    float eh = ${f(EXPAND_BUTTON_SIZE / 2)};
    vec2 ec = vec2(uSize.x - ${f(CONTROL_BAR_INSET)} - eh, ${f(CONTROL_BAR_INSET)} + eh);
    vec2 ep = vec2(px.x - ec.x, ec.y - px.y);

    vec2 bh = vec2(uSize.x * 0.5 - ${f(CONTROL_BAR_INSET)}, ${f(CONTROL_BAR_HEIGHT / 2)});
    vec2 bc = vec2(uSize.x * 0.5, uSize.y - ${f(CONTROL_BAR_INSET)} - bh.y);
    vec2 bp = vec2(px.x - bc.x, bc.y - px.y);

    vec2 gh = vec2(24.0, 6.0);
    vec2 gc = vec2(uSize.x * 0.5, ${f(MESH_DRAG_STRIP_HEIGHT / 2)});
    vec2 gp = vec2(px.x - gc.x, gc.y - px.y);

    bool hasBar = uChrome.w > 0.001 && uChrome.x > 0.5 && uChrome.x < 1.5;
    bool hasGrip = uChrome.w > 0.001 && uChrome.x > 1.5;
    bool nearE = uExpand > 0.001 && near(ep, vec2(eh), reach);
    bool nearB = hasBar && near(bp, bh, reach);
    bool nearG = hasGrip && near(gp, gh, reach);

    if (nearE || nearB || nearG) {
      vec4 ui = vec4(0.0);

      if (nearG) {
        vec4 g = glassControl(px, gp, gh, aa);
        g = over(g, uInk, fillSDF(sdSegment(gp, vec2(-8.0, 0.0), vec2(8.0, 0.0), 0.75), aa) * 0.7);
        ui = overC(ui, g, uChrome.w);
      }

      if (nearB) {
        vec4 bar = glassControl(px, bp, bh, aa);
        float inBar = fillSDF(sdRoundedBox(bp, bh, uControlRadius), aa);

        // The play glyph, centred in the button's hit square.
        vec2 b = vec2(px.x - ${f(CONTROL_BAR_INSET + (CONTROL_BUTTON_SIZE + CONTROL_GAP) / 2)}, bc.y - px.y);
        float dg;
        if (uChrome.z > 0.5) {
          dg = min(sdRoundedBox(b - vec2(3.0, 0.0), vec2(1.3, 5.0), 1.3), sdRoundedBox(b + vec2(3.0, 0.0), vec2(1.3, 5.0), 1.3));
        } else {
          dg = max(-3.5 - b.x, (b.x - 5.5) * 0.4472 + abs(b.y) * 0.8944) - 0.4;
        }
        bar = over(bar, uInk, fillSDF(dg, aa) * inBar);

        // The track: the whole of it faint in the ink, the played part in the accent, as v2's slider.
        float tl = ${f(CONTROL_BAR_INSET + CONTROL_BUTTON_SIZE + CONTROL_GAP)};
        float tr = uSize.x - ${f(CONTROL_BAR_INSET + CONTROL_TRACK_END_PAD)};
        if (tr > tl) {
          vec2 tp = vec2(px.x - (tl + tr) * 0.5, bc.y - px.y);
          float dt = sdRoundedBox(tp, vec2((tr - tl) * 0.5, 2.0), 2.0);
          float onTrack = fillSDF(dt, aa) * inBar;
          bar = over(bar, uInk, onTrack * 0.18);
          float edge = mix(tl, tr, clamp(uChrome.y, 0.0, 1.0));
          bar = over(bar, uAccent, onTrack * (1.0 - smoothstep(edge - aa, edge + aa, px.x)));
        }
        ui = overC(ui, bar, uChrome.w);
      }

      if (nearE) {
        vec4 e = glassControl(px, ep, vec2(eh), aa);
        // Four corner brackets pointing outward, with round caps.
        vec2 m = abs(ep);
        float da = min(sdSegment(m, vec2(2.5, 5.0), vec2(5.0, 5.0), 0.75), sdSegment(m, vec2(5.0, 2.5), vec2(5.0, 5.0), 0.75));
        e = over(e, uInk, fillSDF(da, aa) * fillSDF(sdRoundedBox(ep, vec2(eh), uControlRadius), aa));
        ui = overC(ui, e, uExpand);
      }

      color = over(color, ui.rgb, ui.a);
    }
  }

  // The squircle corner, in the box's own world units. uSize is the entity's width and height,
  // so this is resolution-independent: the same curve at every zoom, antialiased against the
  // screen-space rate of change rather than against a guessed pixel size. It clips the controls
  // and their casts too, which is what keeps them inside the media.
  if (uCornerRadius > 0.0) {
    float d = roundedBoxSDF((vUv - 0.5) * uSize, uSize * 0.5, uCornerRadius);
    color.a *= 1.0 - smoothstep(-fwidth(d), fwidth(d), d);
  }

  // The quad writes depth (see the material), and a fragment that is not drawn writes none.
  // Without this discard a PNG's transparent background stamped the image's whole bounding
  // rectangle into the depth buffer, and anything behind it was clipped by an invisible box the
  // shape of the quad. nodes.tsx does the same thing for the same reason.
  if (color.a < 0.01) discard;
  gl_FragColor = color;
}`;

/**
 * Compute UV offset/scale for object-fit modes, writing directly into
 * the uniform Vector2s to avoid allocations in the render loop.
 */
export function applyObjectFitUV(
  uvOffset: THREE.Vector2,
  uvScale: THREE.Vector2,
  objectFit: 'fill' | 'cover' | 'contain',
  entityW: number,
  entityH: number,
  naturalW: number,
  naturalH: number,
): void {
  if (objectFit === 'fill' || naturalW <= 0 || naturalH <= 0) {
    uvOffset.set(0, 0);
    uvScale.set(1, 1);
    return;
  }

  const imageAR = naturalW / naturalH;
  const entityAR = entityW / entityH;

  if (objectFit === 'cover') {
    if (imageAR > entityAR) {
      // Image wider → crop sides
      const r = entityAR / imageAR;
      uvOffset.set((1 - r) / 2, 0);
      uvScale.set(r, 1);
    } else {
      // Image taller → crop top/bottom
      const r = imageAR / entityAR;
      uvOffset.set(0, (1 - r) / 2);
      uvScale.set(1, r);
    }
    return;
  }

  // contain
  if (imageAR > entityAR) {
    // Image wider → bars top/bottom
    const r = imageAR / entityAR;
    uvOffset.set(0, -(r - 1) / 2);
    uvScale.set(1, r);
  } else {
    // Image taller → bars left/right
    const r = entityAR / imageAR;
    uvOffset.set(-(r - 1) / 2, 0);
    uvScale.set(r, 1);
  }
}

/**
 * The material every media quad uses.
 *
 * One factory rather than three copies of the same uniform block, which is what the three
 * renderers had: a uniform added for one of them and forgotten in the others is a silent
 * difference between an image, a clip and a model that are supposed to be the same rectangle.
 *
 * `uSize` and `uCornerRadius` are written per frame by the caller, because both depend on the box
 * the user resized. The radius arrives pre-multiplied by CORNER_K — v2's compensation for a
 * squircle reading tighter than a circular arc at the same number. The glass is the renderer's
 * shared record, bound by reference.
 */
export function createMediaMaterial(glass: MediaGlass): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: null },
      opacity: { value: 1.0 },
      // A render target is already framed to its entity's box, so the mesh renderer leaves these
      // at the identity; the image and video renderers write them for object-fit.
      uvOffset: { value: new THREE.Vector2(0, 0) },
      uvScale: { value: new THREE.Vector2(1, 1) },
      uSize: { value: new THREE.Vector2(1, 1) },
      uCornerRadius: { value: 0 },
      // See the shader: kind, progress, playing, presence. All zero is a bare picture.
      uChrome: { value: new THREE.Vector4(0, 0, 0, 0) },
      uExpand: { value: 0 },
      ...glass,
    },
    vertexShader: MEDIA_VERTEX_SHADER,
    fragmentShader: MEDIA_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}

/**
 * Tell a media material what chrome to draw. See `uChrome` and `uExpand` in the shader.
 *
 * `presence` is how faded in the bar or grip is and `expand` how faded in the corner button is;
 * the renderers ease both under the pointer so controls arrive rather than blink.
 */
export function setMediaChrome(
  material: THREE.ShaderMaterial,
  kind: 0 | 1 | 2,
  progress: number,
  playing: boolean,
  presence: number,
  expand: number
): void {
  const v = material.uniforms.uChrome.value as THREE.Vector4;
  v.set(kind, progress, playing ? 1 : 0, presence);
  material.uniforms.uExpand.value = expand;
}

/**
 * Write the per-frame box uniforms.
 *
 * Mutates the existing Vector2 rather than assigning a new one: this runs once per visible media
 * entity per frame, and a fresh Vector2 there is the hot-path allocation this project forbids.
 */
export function setMediaBox(
  material: THREE.ShaderMaterial,
  width: number,
  height: number,
  borderRadius: number
): void {
  (material.uniforms.uSize.value as THREE.Vector2).set(width, height);
  material.uniforms.uCornerRadius.value = borderRadius * CORNER_K;
}
