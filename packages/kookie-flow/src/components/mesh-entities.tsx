/**
 * MeshEntities — 3D model previews, rendered into a target and shown on the same quad as an image.
 *
 * THE RENDER PASS. Each visible mesh entity owns a WebGLRenderTarget and a perspective camera. A
 * `useFrame` at priority -1 draws the model's scene into that target BEFORE react-three-fiber
 * draws the main scene; the target's texture is then what the entity's quad samples. Priority is
 * load-bearing and had to be negative rather than positive: r3f disables its own render as soon as
 * any subscriber has `priority > 0`, so a positive priority here would hand this file
 * responsibility for drawing the entire graph. Negative keeps r3f rendering and merely orders this
 * pass first — subscribers are sorted ascending.
 *
 * WHY NOT ONE SCENE. Putting a model straight into the main scene is the obvious alternative and
 * does not work: this camera is orthographic and looking at a plane, the model needs perspective,
 * and a preview has to be CLIPPED to the entity's rectangle. A render target gives all three, and
 * it also gives the preview a resolution of its own — the target is sized to what the entity
 * occupies on screen, so a thumbnail-sized preview renders at thumbnail cost.
 *
 * WHAT KEEPS THIS CHEAP. A still model in a still box produces the same pixels every frame, so the
 * target is redrawn only when something invalidates it: the model finishing loading, the box
 * changing size enough to cross a resolution bucket, the camera direction changing, or
 * `autoRotate` being on. A board of static previews therefore costs nothing per frame beyond the
 * quads themselves, and an entity that opts into rotation pays for itself alone.
 */

import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useResolvedStyle } from '../contexts';
import { THEME_COLORS } from '../core/theme-colors';
import { rgbToHex } from '../utils/color';
import { DEFAULT_MESH_WIDTH, DEFAULT_MESH_HEIGHT } from '../core/constants';
import { MeshSceneManager, frameCamera } from '../utils/mesh-loader';
import type { MeshEntityData, EntityChange } from '../types';
import { entityDepth } from '../utils/entity-depth';
import {
  sharedGeometry,
  createPlaceholderMaterial,
  createMediaMaterial,
  setMediaBox,
  setMediaChrome,
} from '../utils/media-quad';
import { isMeshDragStrip, orbitDirection } from '../utils/media-chrome';
import { getOrbit, hasOrbit, subscribeOrbit } from '../utils/media-runtime';

/** Same fade the video controls use; see video-entities.tsx. */
const CHROME_FADE_RATE = 12;

function easeStripPresence(
  presences: Map<string, number>,
  id: string,
  wanted: boolean,
  delta: number
): number {
  const target = wanted ? 1 : 0;
  const from = presences.get(id) ?? 0;
  const alpha = 1 - Math.exp(-Math.max(0, delta) * CHROME_FADE_RATE);
  const next = from + (target - from) * alpha;
  const settled = Math.abs(target - next) < 0.004 ? target : next;
  if (settled === 0) presences.delete(id);
  else presences.set(id, settled);
  return settled;
}

const RENDER_ORDER_BG = 1;
const RENDER_ORDER_FG = 4;
const CULL_PADDING = 100;

/**
 * Runs before r3f's own render. Must stay negative — see the file docblock.
 */
const MESH_RENDER_PRIORITY = -1;

/**
 * How many render targets may exist at once.
 *
 * Each is a full framebuffer with a colour attachment and a depth buffer: at the 1024 bucket that
 * is about 4 MB apiece before depth. Eight is a working board's worth; past that the
 * least-recently-visible target is reclaimed and its entity falls back to the placeholder until it
 * is looked at again.
 */
const MAX_MESH_TARGETS = 8;

/** Radians per second an auto-rotating preview turns, when the entity names no speed of its own. */
const DEFAULT_ROTATE_SPEED = 0.6;

/** Resolution buckets for a target, in device pixels along the longer edge. */
const MIN_BUCKET = 128;
const MAX_BUCKET = 1024;

/**
 * Round an on-screen size up to the next power of two.
 *
 * Bucketed rather than exact because a render target cannot be resized without reallocating its
 * framebuffer, and an exact fit would reallocate on every frame of a zoom. Powers of two mean a
 * continuous zoom crosses a boundary a handful of times instead of hundreds.
 */
export function bucketFor(screenPx: number): number {
  const target = Math.max(MIN_BUCKET, Math.min(MAX_BUCKET, screenPx));
  return Math.min(MAX_BUCKET, 2 ** Math.ceil(Math.log2(target)));
}

interface MeshTarget {
  rt: THREE.WebGLRenderTarget;
  camera: THREE.PerspectiveCamera;
  /** Longer-edge resolution the target is currently allocated at. */
  bucket: number;
  /** Whether the target's contents are stale and must be redrawn this frame. */
  dirty: boolean;
  /** Which src the target currently holds a picture of. */
  renderedSrc: string | null;
  /** Frame index this entity was last visible, for reclaiming the coldest target. */
  lastSeen: number;
  /** Accumulated auto-rotation, in radians. */
  angle: number;
  /** The turn the target's picture was taken at, so a new one is noticed. */
  yaw: number;
  pitch: number;
}

interface MeshEntitiesProps {
  onEntitiesChange?: (changes: EntityChange[]) => void;
}

export function MeshEntities({ onEntitiesChange }: MeshEntitiesProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  // A media entity is a surface, so it takes the theme's surface corner like a node body does.
  const resolvedStyle = useResolvedStyle();

  const [meshEntityIds, setMeshEntityIds] = useState<string[]>(() =>
    store.getState().entities.filter((e) => e.type === 'mesh').map((e) => e.id)
  );

  const fullDirtyRef = useRef(true);
  const topologyDirtyRef = useRef(true);

  const meshRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const refCallbacksRef = useRef<Map<string, (mesh: THREE.Mesh | null) => void>>(new Map());
  const materialRefs = useRef<Map<string, THREE.ShaderMaterial>>(new Map());
  const targetsRef = useRef<Map<string, MeshTarget>>(new Map());
  const loadedSrcRefs = useRef<Map<string, string>>(new Map());

  const meshEntityIdsRef = useRef(meshEntityIds);
  meshEntityIdsRef.current = meshEntityIds;
  const onEntitiesChangeRef = useRef(onEntitiesChange);
  onEntitiesChangeRef.current = onEntitiesChange;

  /** Monotonic frame counter, for LRU reclamation of render targets. */
  const frameRef = useRef(0);

  /**
   * Whether any visible entity is auto-rotating, and therefore whether this pass must run on a
   * frame the store published nothing on.
   *
   * Recomputed by the pass itself. That is not circular: the pass runs whenever the store is dirty,
   * which is exactly when the answer can change — an entity gaining or losing `autoRotate` is a
   * data change, and one leaving the viewport is a viewport change. So the flag is always brought
   * up to date on the frame the truth about it changes.
   */
  const hasRotatingRef = useRef(false);
  /** How faded in each model's drag strip is. Same easing the video controls use. */
  const chromePresenceRef = useRef<Map<string, number>>(new Map());
  const chromeFadingRef = useRef(false);

  /** Scratch vectors, reused so the render pass allocates nothing. */
  const dirRef = useRef(new THREE.Vector3());
  const clearColorRef = useRef(new THREE.Color());

  const sceneManager = useMemo(
    () => new MeshSceneManager(() => { fullDirtyRef.current = true; }),
    []
  );

  const placeholderColor = rgbToHex(tokens[THEME_COLORS.text.secondary]);
  const errorColor = rgbToHex(tokens[THEME_COLORS.edge.invalid]);
  const placeholderMat = useMemo(() => createPlaceholderMaterial(placeholderColor), [placeholderColor]);
  const errorMat = useMemo(() => createPlaceholderMaterial(errorColor), [errorColor]);

  useEffect(() => () => { placeholderMat.dispose(); }, [placeholderMat]);
  useEffect(() => () => { errorMat.dispose(); }, [errorMat]);

  useEffect(() => () => { sceneManager.disposeAll(); }, [sceneManager]);

  // Render targets are framebuffers, not just textures — nothing reclaims them but this.
  useEffect(() => {
    const targets = targetsRef.current;
    const materials = materialRefs.current;
    return () => {
      targets.forEach((t) => t.rt.dispose());
      targets.clear();
      materials.forEach((m) => m.dispose());
      materials.clear();
    };
  }, []);

  useEffect(() => {
    const markFullDirty = () => { fullDirtyRef.current = true; };

    const unsubTopology = store.subscribe((s) => s.topologyVersion, () => {
      markFullDirty();
      topologyDirtyRef.current = true;
      const ids = store.getState().entities.filter((e) => e.type === 'mesh').map((e) => e.id);
      setMeshEntityIds((prev) => {
        if (prev.length !== ids.length) return ids;
        for (let i = 0; i < ids.length; i++) {
          if (prev[i] !== ids[i]) return ids;
        }
        return prev;
      });
    });
    const unsubPositions = store.subscribe((s) => s.positionVersion, markFullDirty);
    let lastPosVersion = store.getState().positionVersion;
    const unsubEntities = store.subscribe((s) => s.entities, () => {
      const pv = store.getState().positionVersion;
      if (pv !== lastPosVersion) {
        lastPosVersion = pv;
        return;
      }
      markFullDirty();
    });
    const unsubViewport = store.subscribe((s) => s.viewport, markFullDirty);
    const unsubSelection = store.subscribe((s) => s.selectedEntityIds, markFullDirty);
    const unsubStack = store.subscribe((s) => s.stackVersion, markFullDirty);
    const unsubHidden = store.subscribe((s) => s.hiddenEntityIds, markFullDirty);
    const unsubHovered = store.subscribe((s) => s.hoveredEntityId, markFullDirty);
    // A drag that turns a model changes nothing in the store — by design, since it is sixty
    // writes a second. It says so here instead.
    const unsubOrbit = subscribeOrbit(store, markFullDirty);

    return () => {
      unsubTopology();
      unsubPositions();
      unsubEntities();
      unsubViewport();
      unsubSelection();
      unsubStack();
      unsubHidden();
      unsubHovered();
      unsubOrbit();
    };
  }, [store]);

  function getRefCallback(id: string): (mesh: THREE.Mesh | null) => void {
    let cb = refCallbacksRef.current.get(id);
    if (!cb) {
      cb = (mesh: THREE.Mesh | null) => {
        if (mesh) {
          meshRefs.current.set(id, mesh);
          if (!materialRefs.current.has(id)) {
            materialRefs.current.set(id, createMediaMaterial());
          }
        } else {
          meshRefs.current.delete(id);
        }
      };
      refCallbacksRef.current.set(id, cb);
    }
    return cb;
  }

  /**
   * Give back the render target of whichever entity has gone longest without being seen.
   *
   * Called only when the budget is full and a newly visible entity needs one, so the cost is paid
   * by the entity that just appeared rather than by every frame.
   */
  /**
   * Free the target least recently on screen. Never one on screen THIS frame: taking those rebuilt
   * every framebuffer on every pass, as each visible entity took the last one's, and left one of
   * them black. Returns whether anything was freed.
   */
  function reclaimColdestTarget(exceptId: string, frame: number): boolean {
    let coldestId: string | null = null;
    let coldest = Infinity;
    for (const [id, t] of targetsRef.current) {
      if (id === exceptId || t.lastSeen === frame) continue;
      if (t.lastSeen < coldest) {
        coldest = t.lastSeen;
        coldestId = id;
      }
    }
    if (!coldestId) return false;
    const target = targetsRef.current.get(coldestId);
    target?.rt.dispose();
    targetsRef.current.delete(coldestId);
    // Its quad is now pointing at a disposed framebuffer's texture.
    const mat = materialRefs.current.get(coldestId);
    if (mat) mat.uniforms.map.value = null;
    return true;
  }

  useFrame(({ gl, size, viewport: glViewport }, delta) => {
    const frame = ++frameRef.current;

    // Auto-rotating entities invalidate themselves, so the pass must run for them on frames the
    // store published nothing on.
    if (!fullDirtyRef.current && !hasRotatingRef.current && !chromeFadingRef.current) return;
    let rotating = false;
    let chromeFading = false;

    const { entityMap, viewport, selectedEntityIds, hiddenEntityIds, stackOrder, hoveredEntityId } =
      store.getState();
    const ids = meshEntityIdsRef.current;

    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;
    const dpr = glViewport.dpr;

    // The renderer's clear colour and target belong to the main canvas, and leaving a preview's
    // version of either behind would tint or misdirect the whole graph. Captured LAZILY, on the
    // first target actually redrawn: a board where nothing is dirty — which is the common case,
    // since a still model's target is drawn once — must not pay three renderer reads per frame.
    let rendered = false;
    let prevAlpha = 0;
    let prevTarget: THREE.WebGLRenderTarget | null = null;

    for (let i = 0; i < ids.length; i++) {
      const entity = entityMap.get(ids[i]);
      if (!entity) continue;
      const quad = meshRefs.current.get(entity.id);
      if (!quad) continue;

      const data = entity.data as MeshEntityData;
      const src = data.src;

      const prevSrc = loadedSrcRefs.current.get(entity.id);
      if (src && src !== prevSrc) {
        if (prevSrc) sceneManager.release(prevSrc);
        sceneManager.acquire(src);
        loadedSrcRefs.current.set(entity.id, src);
      } else if (!src && prevSrc) {
        sceneManager.release(prevSrc);
        loadedSrcRefs.current.delete(entity.id);
      }

      if (hiddenEntityIds.has(entity.id)) {
        quad.visible = false;
        continue;
      }

      const w = entity.width ?? DEFAULT_MESH_WIDTH;
      const h = entity.height ?? DEFAULT_MESH_HEIGHT;

      const entityRight = entity.position.x + w;
      const entityBottom = entity.position.y + h;
      if (
        entityRight < viewLeft - CULL_PADDING ||
        entity.position.x > viewRight + CULL_PADDING ||
        entityBottom < viewTop - CULL_PADDING ||
        entity.position.y > viewBottom + CULL_PADDING
      ) {
        quad.visible = false;
        continue;
      }

      quad.visible = true;
      const cx = entity.position.x + w / 2;
      const cy = -(entity.position.y + h / 2);
      quad.position.set(cx, cy, entityDepth(entity.id, stackOrder, selectedEntityIds));
      quad.scale.set(w, h, 1);
      quad.renderOrder = selectedEntityIds.has(entity.id) ? RENDER_ORDER_FG : RENDER_ORDER_BG;

      const entry = src ? sceneManager.getEntry(src) : undefined;
      if (!entry?.scene) {
        quad.material = entry?.state === 'error' ? errorMat : placeholderMat;
        continue;
      }

      // ---- The target ----
      const screenLong = Math.max(w, h) * viewport.zoom * dpr;
      const bucket = bucketFor(screenLong);
      const aspect = w / h;

      // The bucket sizes the LONGER edge; the shorter follows the box's aspect, so a wide preview
      // is not rendered into a square and squeezed.
      const rtW = Math.max(1, Math.round(aspect >= 1 ? bucket : bucket * aspect));
      const rtH = Math.max(1, Math.round(aspect >= 1 ? bucket / aspect : bucket));

      let target = targetsRef.current.get(entity.id);
      if (!target) {
        // Every target is in use by something on screen: this one waits rather than taking one.
        if (targetsRef.current.size >= MAX_MESH_TARGETS && !reclaimColdestTarget(entity.id, frame)) {
          quad.material = placeholderMat;
          continue;
        }
        const rt = new THREE.WebGLRenderTarget(rtW, rtH, {
          depthBuffer: true,
          stencilBuffer: false,
        });
        rt.texture.colorSpace = THREE.SRGBColorSpace;
        rt.texture.minFilter = THREE.LinearFilter;
        rt.texture.magFilter = THREE.LinearFilter;
        rt.texture.generateMipmaps = false;
        target = {
          rt,
          camera: new THREE.PerspectiveCamera(45, aspect, 0.1, 1000),
          bucket,
          dirty: true,
          renderedSrc: null,
          lastSeen: frame,
          angle: 0,
          yaw: 0,
          pitch: 0,
        };
        targetsRef.current.set(entity.id, target);
      }
      target.lastSeen = frame;

      // A bucket or aspect change means the framebuffer no longer matches the box.
      if (target.bucket !== bucket || target.rt.width !== rtW || target.rt.height !== rtH) {
        target.rt.setSize(rtW, rtH);
        target.bucket = bucket;
        target.dirty = true;
      }
      if (target.camera.aspect !== aspect) {
        target.camera.aspect = aspect;
        target.dirty = true;
      }
      if (target.renderedSrc !== src) {
        target.dirty = true;
      }
      // A turn is a camera change, and the target holds a picture taken from the old one.
      const orbit = getOrbit(store, entity.id);
      if (target.yaw !== orbit.yaw || target.pitch !== orbit.pitch) {
        target.yaw = orbit.yaw;
        target.pitch = orbit.pitch;
        target.dirty = true;
      }

      if (data.autoRotate) {
        target.angle += delta * (data.rotateSpeed ?? DEFAULT_ROTATE_SPEED);
        target.dirty = true;
        rotating = true;
      }

      if (target.dirty) {
        if (!rendered) {
          prevAlpha = gl.getClearAlpha();
          gl.getClearColor(clearColorRef.current);
          prevTarget = gl.getRenderTarget();
        }
        const cam = data.cameraPosition;
        // The configured direction is a DIRECTION, not a point: it is normalised and the distance
        // comes from the model's own radius, so a consumer picking an angle does not also have to
        // know how big the model is. A model that has been TURNED takes its direction from the
        // turn instead — the person's hand outranks the entity's stated view.
        if (hasOrbit(store, entity.id)) {
          const d = orbitDirection(getOrbit(store, entity.id));
          dirRef.current.set(d.x, d.y, d.z);
        } else {
          dirRef.current.set(cam?.x ?? 0, cam?.y ?? 0.4, cam?.z ?? 1);
        }
        if (target.angle !== 0) {
          const c = Math.cos(target.angle);
          const s = Math.sin(target.angle);
          const x = dirRef.current.x;
          const z = dirRef.current.z;
          dirRef.current.x = x * c - z * s;
          dirRef.current.z = x * s + z * c;
        }
        frameCamera(target.camera, entry.center, entry.radius, dirRef.current);

        gl.setRenderTarget(target.rt);
        // Transparent, so the model floats on the canvas rather than in a black rectangle. The
        // media shader discards fully transparent fragments, which is what keeps the entity's
        // depth write to the model's actual silhouette.
        gl.setClearColor(0x000000, 0);
        gl.clear(true, true, false);
        gl.render(entry.scene, target.camera);
        rendered = true;

        target.dirty = false;
        target.renderedSrc = src ?? null;
      }

      const mat = materialRefs.current.get(entity.id);
      if (mat) {
        setMediaBox(mat, w, h, resolvedStyle.borderRadius);
        // A framebuffer's rows are bottom-up, and the shared quad's V runs top-down for image
        // uploads. Sampled with V flipped back, or every model draws upside down. `flipY` cannot do
        // this: nothing is uploaded from an image into a render target.
        mat.uniforms.uvOffset.value.set(0, 1);
        mat.uniforms.uvScale.value.set(1, -1);
        /**
         * The strip that moves the entity, shown under the pointer.
         *
         * Only where the body is doing something else with a drag: with `orbit: false` the whole
         * body moves the entity as any other does, and a strip would be advertising a distinction
         * that no longer exists.
         */
        const wantsStrip =
          (data.orbit ?? true) && hoveredEntityId === entity.id && isMeshDragStrip(0, h);
        const presence = easeStripPresence(chromePresenceRef.current, entity.id, wantsStrip, delta);
        if (presence > 0.001) chromeFading = true;
        setMediaChrome(mat, presence > 0.001 ? 2 : 0, 0, false, presence);
        if (mat.uniforms.map.value !== target.rt.texture) {
          mat.uniforms.map.value = target.rt.texture;
        }
        mat.uniforms.opacity.value = 1;
        quad.material = mat;
      }
    }

    if (rendered) {
      gl.setRenderTarget(prevTarget);
      gl.setClearColor(clearColorRef.current, prevAlpha);
    }

    hasRotatingRef.current = rotating;
    chromeFadingRef.current = chromeFading;

    if (topologyDirtyRef.current) {
      for (const [id] of materialRefs.current) {
        if (meshRefs.current.has(id)) continue;
        materialRefs.current.get(id)?.dispose();
        materialRefs.current.delete(id);
        refCallbacksRef.current.delete(id);
        targetsRef.current.get(id)?.rt.dispose();
        targetsRef.current.delete(id);
        const src = loadedSrcRefs.current.get(id);
        if (src) {
          sceneManager.release(src);
          loadedSrcRefs.current.delete(id);
        }
      }
      topologyDirtyRef.current = false;
    }

    fullDirtyRef.current = false;
  }, MESH_RENDER_PRIORITY);

  return (
    <group>
      {meshEntityIds.map((id) => (
        <mesh
          key={id}
          ref={getRefCallback(id)}
          geometry={sharedGeometry}
          material={placeholderMat}
          frustumCulled={false}
          renderOrder={RENDER_ORDER_BG}
        />
      ))}
    </group>
  );
}
