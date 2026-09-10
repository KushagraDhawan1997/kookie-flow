/**
 * MeshSceneManager — glTF/GLB models, cached by URL, framed and lit ready to render.
 *
 * WHAT A MESH ENTITY ACTUALLY IS. The same textured quad as an image and a video (media-quad.ts),
 * with the texture supplied by a render target instead of a decoder. The model lives in a small
 * scene of its own with its own perspective camera; that scene is rendered into a target, and the
 * target's texture is what the quad samples. `plans/technical-decisions.md` chose three.js over a
 * 2D renderer for exactly this — one WebGL context, so a preview costs a render pass rather than
 * a second canvas — and this is the file that spends it.
 *
 * THE COST, AND WHY IT IS NOT PER FRAME. A render target holding a STATIC model is correct until
 * something changes it: the model finishing loading, the entity being resized, the camera moving.
 * So a mesh preview is not redrawn every frame — it is redrawn when it is dirty, which for a board
 * of still previews is almost never. That is the whole reason this can scale where a naive
 * "render every preview every frame" cannot, and it is why `autoRotate` is opt-in: turning it on
 * for an entity opts that entity into per-frame work, and nothing else on the board pays.
 *
 * THE SCENE IS SHARED, THE CAMERA IS NOT. Two entities pointing at the same URL share one loaded
 * scene graph — a glTF can be tens of megabytes and rendering the same object from two cameras is
 * free, whereas cloning it is not. The camera, the render target and the dirty flag are per entity,
 * because they depend on the box the user resized. Rendering the same scene twice in one frame is
 * safe: `WebGLRenderer.render` does not mutate the graph.
 *
 * LIGHTS TRAVEL WITH THE SCENE. A glTF usually ships no lights, so a model loaded into an empty
 * scene renders black and reads as a failed load. Three are added at load: a hemisphere for ambient
 * fill and two directionals, which is enough to read form on an untextured mesh without pretending
 * to be a lighting rig.
 */

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type MeshLoadState = 'idle' | 'loading' | 'loaded' | 'error';

export interface MeshEntry {
  /** The loaded model, wrapped in a scene with lights. Null until the load lands. */
  scene: THREE.Scene | null;
  state: MeshLoadState;
  /** Centre and radius of the model, for framing a camera on it. Radius 0 until loaded. */
  center: THREE.Vector3;
  radius: number;
  refCount: number;
  /** Aborts nothing on its own — checked at each await point, since GLTFLoader takes no signal. */
  cancelled: boolean;
}

/**
 * Loaded once, on first use, and shared.
 *
 * A dynamic import so GLTFLoader and its dependencies stay out of the package entry: a consumer
 * with no mesh entities should not download a glTF parser. Held as a promise rather than a module
 * so that N entities appearing in the same frame produce ONE import, not N.
 */
let loaderPromise: Promise<THREE.Loader<GLTF>> | null = null;

function getLoader(): Promise<THREE.Loader<GLTF>> {
  if (!loaderPromise) {
    loaderPromise = import('three/examples/jsm/loaders/GLTFLoader.js').then(
      ({ GLTFLoader }) => new GLTFLoader()
    );
  }
  return loaderPromise;
}

/** The lighting every model gets, since glTF files rarely carry their own. */
function addLights(scene: THREE.Scene): void {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 2.0);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(2, 3, 4);
  scene.add(key);

  // Opposite and weaker, so the shadowed side reads as form rather than as a silhouette.
  const fill = new THREE.DirectionalLight(0xffffff, 1.0);
  fill.position.set(-3, -1, -2);
  scene.add(fill);
}

/**
 * Free every GPU resource a loaded model holds.
 *
 * `scene.clear()` unparents but frees nothing: geometries, materials and every texture a material
 * points at each hold a GPU handle that only `dispose()` releases. A single glTF can carry a dozen
 * 2K textures, so skipping this leaks tens of megabytes per model that leaves the board.
 */
function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry?.dispose();
    const material = obj.material;
    const materials = Array.isArray(material) ? material : [material];
    for (const mat of materials) {
      if (!mat) continue;
      for (const value of Object.values(mat)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      mat.dispose();
    }
  });
  scene.clear();
}

export class MeshSceneManager {
  private cache = new Map<string, MeshEntry>();
  private onReady: (() => void) | undefined;

  constructor(onReady?: () => void) {
    this.onReady = onReady;
  }

  /** Get or start loading the model at `src`. Returns immediately; the scene arrives later. */
  acquire(src: string): MeshEntry {
    const existing = this.cache.get(src);
    if (existing) {
      existing.refCount++;
      return existing;
    }

    const entry: MeshEntry = {
      scene: null,
      state: 'loading',
      center: new THREE.Vector3(),
      radius: 0,
      refCount: 1,
      cancelled: false,
    };
    this.cache.set(src, entry);
    this.load(src, entry);
    return entry;
  }

  private async load(src: string, entry: MeshEntry): Promise<void> {
    try {
      const loader = await getLoader();
      if (entry.cancelled) return;

      const gltf = await loader.loadAsync(src);
      // Released while the file was in flight. Dropping it here rather than adding it to a scene
      // nobody will render is the difference between a cancelled load and a leaked one.
      if (entry.cancelled) {
        const orphan = new THREE.Scene();
        orphan.add(gltf.scene);
        disposeScene(orphan);
        return;
      }

      const scene = new THREE.Scene();
      addLights(scene);
      scene.add(gltf.scene);

      // Framing data, computed once. A bounding SPHERE rather than a box because the camera is
      // placed along an arbitrary direction — a box's extent depends on which way you look at it,
      // and a model would jump size as the camera angle changed.
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      entry.center.copy(sphere.center);
      // An empty or degenerate glTF gives radius 0, which would put the camera on top of the model
      // and divide by zero when framing it.
      entry.radius = sphere.radius > 0 ? sphere.radius : 1;

      entry.scene = scene;
      entry.state = 'loaded';
      this.onReady?.();
    } catch {
      // A 404, a parse failure, a CORS refusal. The entity shows its error material; there is
      // nothing here a retry would fix, and a rethrow would surface as an unhandled rejection.
      if (entry.cancelled) return;
      entry.state = 'error';
      this.onReady?.();
    }
  }

  release(src: string): void {
    const entry = this.cache.get(src);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount > 0) return;

    entry.cancelled = true;
    if (entry.scene) disposeScene(entry.scene);
    entry.scene = null;
    this.cache.delete(src);
  }

  getEntry(src: string): MeshEntry | undefined {
    return this.cache.get(src);
  }

  disposeAll(): void {
    for (const src of [...this.cache.keys()]) {
      const entry = this.cache.get(src);
      if (entry) entry.refCount = 1;
      this.release(src);
    }
  }
}

/**
 * Place a camera so the model fills its frame, and point it at the model's centre.
 *
 * `direction` is normalised here rather than by the caller, because it comes from entity data a
 * consumer wrote and a zero vector would leave the camera at the centre of the model looking at
 * itself. The distance accounts for BOTH the vertical and the horizontal field of view, so a wide
 * short box does not overflow the sides of a portrait preview — taking the larger of the two is
 * what makes the fit hold at every aspect ratio.
 */
export function frameCamera(
  camera: THREE.PerspectiveCamera,
  center: THREE.Vector3,
  radius: number,
  direction: THREE.Vector3,
  margin: number = 1.25
): void {
  const dir = direction.lengthSq() > 0 ? direction.clone().normalize() : new THREE.Vector3(0, 0, 1);

  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distance = (radius * margin) / Math.sin(Math.min(vFov, hFov) / 2);

  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(distance - radius * 2, distance * 0.01);
  camera.far = distance + radius * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}
