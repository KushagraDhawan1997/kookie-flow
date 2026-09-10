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
 */

import * as THREE from 'three';
import { squircleBoxSDF, CORNER_K } from './corner-shader';

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

${squircleBoxSDF}

void main() {
  vec2 sampledUV = vUv * uvScale + uvOffset;

  // Discard pixels outside texture bounds (contain mode letterbox)
  if (sampledUV.x < 0.0 || sampledUV.x > 1.0 || sampledUV.y < 0.0 || sampledUV.y > 1.0) {
    discard;
  }

  vec4 texColor = texture2D(map, sampledUV);
  float a = texColor.a * opacity;

  // The quad writes depth (see the material), and a fragment that is not drawn writes none.
  // Without this discard a PNG's transparent background stamped the image's whole bounding
  // rectangle into the depth buffer, and anything behind it — a node body at a higher stack
  // index, another image — was clipped by an invisible box the shape of the quad. Every other
  // layer that shares this depth buffer already follows the convention; nodes.tsx does the same
  // thing for the same reason, and its shadow pass was split into its own mesh over it.
  if (a < 0.01) discard;

  // The squircle corner, in the box's own world units. uSize is the entity's width and height,
  // so this is resolution-independent: the same curve at every zoom, antialiased against the
  // screen-space rate of change rather than against a guessed pixel size.
  if (uCornerRadius > 0.0) {
    vec2 p = (vUv - 0.5) * uSize;
    vec2 b = uSize * 0.5;
    float d = roundedBoxSDF(p, b, uCornerRadius);
    a *= 1.0 - smoothstep(-fwidth(d), fwidth(d), d);
    if (a < 0.01) discard;
  }

  gl_FragColor = vec4(texColor.rgb, a);

  #include <colorspace_fragment>
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
 * squircle reading tighter than a circular arc at the same number.
 */
export function createMediaMaterial(): THREE.ShaderMaterial {
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
