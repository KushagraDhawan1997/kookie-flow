import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { frameCamera } from './mesh-loader';
import { bucketFor } from '../components/mesh-entities';

/**
 * Two pure decisions sit under the mesh preview, and both are the kind that look right in one
 * configuration and fail in another — which is exactly what a test tier is for.
 *
 * FRAMING has to hold at every aspect ratio, because the box is one the user dragged. A camera
 * distance computed from the vertical field of view alone fits a portrait preview and lets a wide
 * model run off the sides of a landscape one.
 *
 * BUCKETING has to be stable under a continuous zoom, because a render target cannot change size
 * without reallocating its framebuffer.
 */

/** Whether a sphere at `center` with `radius` lies entirely inside the camera's frustum. */
function sphereIsVisible(camera: THREE.PerspectiveCamera, center: THREE.Vector3, radius: number) {
  camera.updateMatrixWorld(true);
  const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(m);
  return frustum.containsPoint(center) && frustum.intersectsSphere(new THREE.Sphere(center, radius));
}

describe('framing a camera on a model', () => {
  const CENTER = new THREE.Vector3(3, -2, 7);
  const DIR = new THREE.Vector3(0, 0.4, 1);

  it('fits the model at every aspect ratio a resized box can produce', () => {
    // The wide case is the one a vertical-FOV-only distance gets wrong.
    for (const aspect of [0.25, 0.5, 1, 2, 4]) {
      const cam = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
      frameCamera(cam, CENTER, 2, DIR);
      expect(sphereIsVisible(cam, CENTER, 2)).toBe(true);
    }
  });

  it('fits the model at every scale, so distance follows the file rather than a constant', () => {
    for (const radius of [0.01, 1, 100, 5000]) {
      const cam = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
      frameCamera(cam, CENTER, radius, DIR);
      expect(sphereIsVisible(cam, CENTER, radius)).toBe(true);
    }
  });

  it('looks at the model rather than at the origin', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    frameCamera(cam, CENTER, 2, DIR);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const toCenter = CENTER.clone().sub(cam.position).normalize();
    expect(forward.dot(toCenter)).toBeGreaterThan(0.999);
  });

  it('puts the near and far planes around the model, not around the world', () => {
    // A near plane at a fixed 0.1 with a far at 1000 throws away most of the depth buffer's
    // precision, and the preview z-fights.
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    frameCamera(cam, CENTER, 2, DIR);
    const distance = cam.position.distanceTo(CENTER);
    expect(cam.near).toBeGreaterThan(0);
    expect(cam.near).toBeLessThan(distance);
    expect(cam.far).toBeGreaterThan(distance);
  });

  it('survives a zero direction rather than putting the camera inside the model', () => {
    // `cameraPosition: { x: 0, y: 0, z: 0 }` is a plausible thing for a consumer to write.
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    frameCamera(cam, CENTER, 2, new THREE.Vector3(0, 0, 0));
    expect(cam.position.distanceTo(CENTER)).toBeGreaterThan(0);
    expect(sphereIsVisible(cam, CENTER, 2)).toBe(true);
  });

  it('does not require the caller to normalise the direction', () => {
    const near = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const far = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    frameCamera(near, CENTER, 2, new THREE.Vector3(0, 0, 1));
    frameCamera(far, CENTER, 2, new THREE.Vector3(0, 0, 900));
    // Same direction, wildly different lengths: the framing must be identical.
    expect(far.position.distanceTo(near.position)).toBeLessThan(1e-6);
  });
});

describe('render target resolution buckets', () => {
  it('never allocates below the floor or above the ceiling', () => {
    expect(bucketFor(1)).toBe(128);
    expect(bucketFor(0)).toBe(128);
    expect(bucketFor(100_000)).toBe(1024);
  });

  it('is a power of two, so a target lands on sizes a GPU likes', () => {
    for (const px of [130, 200, 400, 700, 900]) {
      const b = bucketFor(px);
      expect(Number.isInteger(Math.log2(b))).toBe(true);
    }
  });

  it('rounds UP, so a preview is never rendered below the size it is shown at', () => {
    expect(bucketFor(129)).toBe(256);
    expect(bucketFor(257)).toBe(512);
  });

  it('holds steady across a continuous zoom within one bucket', () => {
    // The reason for bucketing at all: setSize reallocates the framebuffer, and an exact fit would
    // do it on every frame of a pinch.
    const sizes = [260, 300, 380, 450, 511];
    const buckets = new Set(sizes.map(bucketFor));
    expect(buckets.size).toBe(1);
  });
});
