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
 */

import * as THREE from 'three';

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
