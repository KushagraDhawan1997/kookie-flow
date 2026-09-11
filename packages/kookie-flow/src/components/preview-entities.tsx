/**
 * PreviewEntities — the band inside a node that shows what the node produced.
 *
 * A node names one of its output sockets (`entity.preview`) and this draws whatever value is
 * sitting on it: a picture, a video, or a model. The value comes from the evaluation engine, not
 * from entity data, which is the whole point — a node that generated an image shows it without
 * the app echoing the result back through props and re-rendering the tree to do it.
 *
 * THREE SOURCES, ONE QUAD. Every band is the same textured quad from utils/media-quad.ts, with
 * the same squircle mask and object-fit as a media entity; only where the texture comes from
 * differs. A picture goes through the image manager, a video through the video manager, and a
 * model is rendered into a target first, exactly as mesh entities are — this file reuses those
 * three utilities rather than reimplementing any of them.
 *
 * WHAT KEEPS IT CHEAP. The pass is dirty-driven like every other renderer here, and additionally
 * runs while a video is playing or a model is being redrawn. Bands whose source has not changed
 * upload nothing; a model's target is redrawn only when its box crosses a resolution bucket or
 * its scene finishes loading.
 */

import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { useResolvedStyle, useSocketLayout } from '../contexts';
import { THEME_COLORS } from '../core/theme-colors';
import { rgbToHex } from '../utils/color';
import { ImageTextureManager } from '../utils/image-loader';
import { VideoTextureManager } from '../utils/video-loader';
import { MeshSceneManager, frameCamera } from '../utils/mesh-loader';
import { getEntitySocketLayout } from '../utils/socket-layout-cache';
import { classifyPreviewValue, sameSource, type PreviewSource } from '../utils/preview-source';
import { entityDepth, DEPTH_LAYER } from '../utils/entity-depth';
import {
  sharedGeometry,
  createPlaceholderMaterial,
  createMediaMaterial,
  applyObjectFitUV,
  setMediaBox,
} from '../utils/media-quad';

const RENDER_ORDER_BG = 2;
const RENDER_ORDER_FG = 5;
const CULL_PADDING = 100;

/** Runs before r3f's own render, like the mesh renderer. Must stay negative. */
const PREVIEW_RENDER_PRIORITY = -1;

/**
 * How many model previews may hold a render target at once.
 *
 * Lower than the mesh entities' budget: a preview band is a detail of a node, and a board with
 * more than a few models in flight should spend its framebuffers on the entities whose whole
 * purpose is the model.
 */
const MAX_PREVIEW_TARGETS = 4;
const MIN_BUCKET = 128;
const MAX_BUCKET = 512;

/**
 * A band's corner is HALF the card's.
 *
 * The band sits inside the card with padding around it, and matching the card's radius exactly
 * makes the two curves fight — the inner one reads as too round for the space it is in. Half is
 * the ordinary answer for an inset surface and is what the design system does for nested panels.
 */
const BAND_RADIUS_SCALE = 0.5;

function bucketFor(screenPx: number): number {
  const target = Math.max(MIN_BUCKET, Math.min(MAX_BUCKET, screenPx));
  return Math.min(MAX_BUCKET, 2 ** Math.ceil(Math.log2(target)));
}

interface PreviewTarget {
  rt: THREE.WebGLRenderTarget;
  camera: THREE.PerspectiveCamera;
  bucket: number;
  dirty: boolean;
  renderedSrc: string | null;
  lastSeen: number;
}

/** What each band is currently holding on to, so it can be released when it stops. */
interface PreviewHold {
  source: PreviewSource;
  /** The socket value `source` was classified from, compared by identity. */
  raw: unknown;
  /** A texture this file made itself, from a bitmap handed straight over. */
  ownTexture: THREE.Texture | null;
}

export function PreviewEntities() {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const resolvedStyle = useResolvedStyle();
  const socketLayout = useSocketLayout();

  const [previewIds, setPreviewIds] = useState<string[]>(() =>
    store.getState().entities.filter((e) => e.preview).map((e) => e.id)
  );

  const fullDirtyRef = useRef(true);
  const topologyDirtyRef = useRef(true);
  /** Whether anything on screen is still moving: a video playing, or a model still arriving. */
  const animatingRef = useRef(false);

  const quadRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const refCallbacksRef = useRef<Map<string, (mesh: THREE.Mesh | null) => void>>(new Map());
  const materialRefs = useRef<Map<string, THREE.ShaderMaterial>>(new Map());
  const targetsRef = useRef<Map<string, PreviewTarget>>(new Map());
  const holdsRef = useRef<Map<string, PreviewHold>>(new Map());
  /** Reused across frames so deciding what may play allocates nothing. */
  const wantPlayingRef = useRef<Set<string>>(new Set());

  const previewIdsRef = useRef(previewIds);
  previewIdsRef.current = previewIds;
  const frameRef = useRef(0);

  const clearColorRef = useRef(new THREE.Color());
  const dirRef = useRef(new THREE.Vector3());

  const markFullDirty = useMemo(() => () => { fullDirtyRef.current = true; }, []);

  const imageManager = useMemo(() => new ImageTextureManager(markFullDirty), [markFullDirty]);
  const videoManager = useMemo(() => new VideoTextureManager(markFullDirty), [markFullDirty]);
  const sceneManager = useMemo(() => new MeshSceneManager(markFullDirty), [markFullDirty]);

  const placeholderColor = rgbToHex(tokens[THEME_COLORS.text.secondary]);
  const errorColor = rgbToHex(tokens[THEME_COLORS.edge.invalid]);
  const placeholderMat = useMemo(() => createPlaceholderMaterial(placeholderColor), [placeholderColor]);
  const errorMat = useMemo(() => createPlaceholderMaterial(errorColor), [errorColor]);

  useEffect(() => () => { placeholderMat.dispose(); }, [placeholderMat]);
  useEffect(() => () => { errorMat.dispose(); }, [errorMat]);
  useEffect(() => () => {
    imageManager.disposeAll();
    videoManager.disposeAll();
    sceneManager.disposeAll();
  }, [imageManager, videoManager, sceneManager]);

  // Render targets are framebuffers and own textures are textures; nothing reclaims either but this.
  useEffect(() => {
    const targets = targetsRef.current;
    const materials = materialRefs.current;
    const holds = holdsRef.current;
    return () => {
      targets.forEach((t) => t.rt.dispose());
      targets.clear();
      materials.forEach((m) => m.dispose());
      materials.clear();
      holds.forEach((h) => h.ownTexture?.dispose());
      holds.clear();
    };
  }, []);

  useEffect(() => {
    const unsubTopology = store.subscribe((s) => s.topologyVersion, () => {
      markFullDirty();
      topologyDirtyRef.current = true;
      const ids = store.getState().entities.filter((e) => e.preview).map((e) => e.id);
      setPreviewIds((prev) => {
        if (prev.length !== ids.length) return ids;
        for (let i = 0; i < ids.length; i++) if (prev[i] !== ids[i]) return ids;
        return prev;
      });
    });
    const unsubPositions = store.subscribe((s) => s.positionVersion, markFullDirty);
    const unsubEntities = store.subscribe((s) => s.entities, markFullDirty);
    const unsubViewport = store.subscribe((s) => s.viewport, markFullDirty);
    const unsubSelection = store.subscribe((s) => s.selectedEntityIds, markFullDirty);
    const unsubStack = store.subscribe((s) => s.stackVersion, markFullDirty);
    const unsubHidden = store.subscribe((s) => s.hiddenEntityIds, markFullDirty);
    // The values themselves. A band exists to show what a run produced, so the version the engine
    // bumps on every status and value change is the one that matters most here.
    const unsubEvaluation = store.subscribe((s) => s.evaluationVersion, markFullDirty);

    return () => {
      unsubTopology();
      unsubPositions();
      unsubEntities();
      unsubViewport();
      unsubSelection();
      unsubStack();
      unsubHidden();
      unsubEvaluation();
    };
  }, [store, markFullDirty]);

  function getRefCallback(id: string): (mesh: THREE.Mesh | null) => void {
    let cb = refCallbacksRef.current.get(id);
    if (!cb) {
      cb = (mesh: THREE.Mesh | null) => {
        if (mesh) {
          quadRefs.current.set(id, mesh);
          if (!materialRefs.current.has(id)) materialRefs.current.set(id, createMediaMaterial());
        } else {
          quadRefs.current.delete(id);
        }
      };
      refCallbacksRef.current.set(id, cb);
    }
    return cb;
  }

  /** Let go of whatever a band was holding: a manager's reference, or a texture made here. */
  function releaseHold(id: string): void {
    const hold = holdsRef.current.get(id);
    if (!hold) return;
    const { source } = hold;
    if (source.kind === 'image') imageManager.release(source.src);
    else if (source.kind === 'video') videoManager.release(source.src);
    else if (source.kind === 'mesh') sceneManager.release(source.src);
    hold.ownTexture?.dispose();
    holdsRef.current.delete(id);
  }

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
    targetsRef.current.get(coldestId)?.rt.dispose();
    targetsRef.current.delete(coldestId);
    const mat = materialRefs.current.get(coldestId);
    if (mat) mat.uniforms.map.value = null;
    return true;
  }

  useFrame(({ gl, size, viewport: glViewport }) => {
    const frame = ++frameRef.current;
    if (!fullDirtyRef.current && !animatingRef.current) return;

    const { entityMap, viewport, selectedEntityIds, hiddenEntityIds, stackOrder, getSocketValue } =
      store.getState();
    const ids = previewIdsRef.current;
    const wantPlaying = wantPlayingRef.current;
    wantPlaying.clear();
    let animating = false;

    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;
    const dpr = glViewport.dpr;

    let rendered = false;
    let prevAlpha = 0;
    let prevTarget: THREE.WebGLRenderTarget | null = null;

    for (let i = 0; i < ids.length; i++) {
      const entity = entityMap.get(ids[i]);
      const preview = entity?.preview;
      const quad = quadRefs.current.get(ids[i]);
      if (!entity || !preview || !quad) continue;

      if (hiddenEntityIds.has(entity.id)) {
        quad.visible = false;
        continue;
      }

      // The band, in world space: the body's padding on each side, at the row the layout gave it.
      const layout = getEntitySocketLayout(entity, socketLayout);
      const w = (entity.width ?? 0) - socketLayout.padding * 2;
      /**
       * The band takes the height the layout gave it, unless the entity was given an explicit
       * height smaller than its content — a resize, or a consumer that set one. Then the band
       * shrinks to what is left inside the card rather than hanging out of the bottom of it.
       */
      const available = entity.height === undefined
        ? layout.previewHeight
        : entity.height - socketLayout.padding - layout.previewY;
      const h = Math.min(layout.previewHeight, available);
      if (w <= 0 || h <= 0) {
        quad.visible = false;
        continue;
      }
      const x = entity.position.x + socketLayout.padding;
      const y = entity.position.y + layout.previewY;

      if (
        x + w < viewLeft - CULL_PADDING || x > viewRight + CULL_PADDING ||
        y + h < viewTop - CULL_PADDING || y > viewBottom + CULL_PADDING
      ) {
        quad.visible = false;
        continue;
      }

      quad.visible = true;
      quad.position.set(
        x + w / 2,
        -(y + h / 2),
        entityDepth(entity.id, stackOrder, selectedEntityIds, DEPTH_LAYER.widget)
      );
      quad.scale.set(w, h, 1);
      quad.renderOrder = selectedEntityIds.has(entity.id) ? RENDER_ORDER_FG : RENDER_ORDER_BG;

      // ---- what the socket is holding ----
      // Classified only when the value itself changed. This pass runs every frame a clip plays and
      // every frame of a pan, and classifying builds strings and an object each time.
      const raw = getSocketValue(entity.id, preview.socket);
      const hold = holdsRef.current.get(entity.id);
      const source = hold && hold.raw === raw ? hold.source : classifyPreviewValue(raw);
      if (hold) hold.raw = raw;
      if (!hold || !sameSource(hold.source, source)) {
        releaseHold(entity.id);
        let ownTexture: THREE.Texture | null = null;
        if (source.kind === 'image') imageManager.acquire(source.src);
        else if (source.kind === 'video') videoManager.acquire(source.src, true);
        else if (source.kind === 'mesh') sceneManager.acquire(source.src);
        else if (source.kind === 'bitmap') {
          ownTexture = new THREE.Texture(source.image);
          ownTexture.colorSpace = THREE.SRGBColorSpace;
          ownTexture.generateMipmaps = false;
          ownTexture.minFilter = THREE.LinearFilter;
          ownTexture.magFilter = THREE.LinearFilter;
          // The shared quad's UVs are flipped for ImageBitmap origin.
          ownTexture.flipY = false;
          ownTexture.needsUpdate = true;
        }
        holdsRef.current.set(entity.id, { source, ownTexture, raw });
      }

      const mat = materialRefs.current.get(entity.id);
      if (!mat) continue;
      const bandRadius = resolvedStyle.borderRadius * BAND_RADIUS_SCALE;
      const fit = preview.fit ?? 'cover';

      if (source.kind === 'none') {
        // An empty band is INVISIBLE, not a grey rectangle. A node whose run has not happened yet
        // should look like a node, and a placeholder block reads as a failure rather than as
        // "nothing here yet".
        quad.visible = false;
        continue;
      }

      if (source.kind === 'mesh') {
        const entry = sceneManager.getEntry(source.src);
        if (!entry?.scene) {
          if (entry?.state === 'error') {
            quad.material = errorMat;
          } else {
            quad.visible = false;
            animating = true;
          }
          continue;
        }
        const bucket = bucketFor(Math.max(w, h) * viewport.zoom * dpr);
        const aspect = w / h;
        const rtW = Math.max(1, Math.round(aspect >= 1 ? bucket : bucket * aspect));
        const rtH = Math.max(1, Math.round(aspect >= 1 ? bucket / aspect : bucket));

        let target = targetsRef.current.get(entity.id);
        if (!target) {
          // Every target is in use by something on screen: this one waits rather than taking one.
          if (targetsRef.current.size >= MAX_PREVIEW_TARGETS && !reclaimColdestTarget(entity.id, frame)) {
            quad.visible = false;
            continue;
          }
          const rt = new THREE.WebGLRenderTarget(rtW, rtH, { depthBuffer: true, stencilBuffer: false });
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
          };
          targetsRef.current.set(entity.id, target);
        }
        target.lastSeen = frame;
        if (target.bucket !== bucket || target.rt.width !== rtW || target.rt.height !== rtH) {
          target.rt.setSize(rtW, rtH);
          target.bucket = bucket;
          target.dirty = true;
        }
        if (target.camera.aspect !== aspect) {
          target.camera.aspect = aspect;
          target.dirty = true;
        }
        if (target.renderedSrc !== source.src) target.dirty = true;

        if (target.dirty) {
          if (!rendered) {
            prevAlpha = gl.getClearAlpha();
            gl.getClearColor(clearColorRef.current);
            prevTarget = gl.getRenderTarget();
          }
          dirRef.current.set(0, 0.4, 1);
          frameCamera(target.camera, entry.center, entry.radius, dirRef.current);
          gl.setRenderTarget(target.rt);
          gl.setClearColor(0x000000, 0);
          gl.clear(true, true, false);
          gl.render(entry.scene, target.camera);
          rendered = true;
          target.dirty = false;
          target.renderedSrc = source.src;
        }

        setMediaBox(mat, w, h, bandRadius);
        // A target is already framed to the band, so object-fit does not apply. Its rows are
        // bottom-up, as every framebuffer's are, while the shared quad's V runs top-down for image
        // uploads; sampled with V flipped back, or every model draws upside down.
        mat.uniforms.uvOffset.value.set(0, 1);
        mat.uniforms.uvScale.value.set(1, -1);
        if (mat.uniforms.map.value !== target.rt.texture) mat.uniforms.map.value = target.rt.texture;
        mat.uniforms.opacity.value = 1;
        quad.material = mat;
        continue;
      }

      // ---- a flat picture: still, moving, or handed straight over ----
      let texture: THREE.Texture | null = null;
      let naturalW = 0;
      let naturalH = 0;

      if (source.kind === 'image') {
        const entry = imageManager.getEntry(source.src);
        if (entry?.state === 'error') {
          quad.material = errorMat;
          continue;
        }
        texture = imageManager.getTexture(source.src, w * viewport.zoom * dpr);
        // Still arriving — including the frame it was acquired on, when there is no entry at all
        // yet. Without this the pass stops before the decode lands and the band stays empty until
        // something unrelated marks the store dirty.
        if (!texture) animating = true;
        naturalW = entry?.naturalWidth ?? 0;
        naturalH = entry?.naturalHeight ?? 0;
      } else if (source.kind === 'video') {
        const entry = videoManager.getEntry(source.src);
        if (entry?.state === 'error') {
          quad.material = errorMat;
          continue;
        }
        texture = videoManager.getTexture(source.src);
        if (!texture) animating = true;
        naturalW = entry?.naturalWidth ?? 0;
        naturalH = entry?.naturalHeight ?? 0;
        // A visible band wants to be playing; the manager decides how many actually may.
        wantPlaying.add(source.src);
        if (videoManager.isPlaying(source.src)) animating = true;
      } else if (source.kind === 'bitmap') {
        const hold2 = holdsRef.current.get(entity.id);
        texture = hold2?.ownTexture ?? null;
        const image = source.image;
        naturalW = 'width' in image ? Number(image.width) : 0;
        naturalH = 'height' in image ? Number(image.height) : 0;
      }

      if (!texture) {
        // Nothing to show yet. Same reasoning as an empty band: show the card, not a grey block.
        quad.visible = false;
        continue;
      }

      setMediaBox(mat, w, h, bandRadius);
      applyObjectFitUV(
        mat.uniforms.uvOffset.value,
        mat.uniforms.uvScale.value,
        fit,
        w, h, naturalW, naturalH
      );
      if (mat.uniforms.map.value !== texture) mat.uniforms.map.value = texture;
      mat.uniforms.opacity.value = 1;
      quad.material = mat;
    }

    if (rendered) {
      gl.setRenderTarget(prevTarget);
      gl.setClearColor(clearColorRef.current, prevAlpha);
    }

    videoManager.reconcilePlayback(wantPlaying);
    // Uploads are queued so a board of new pictures does not stall one frame decoding all of them.
    if (imageManager.processUploadQueue()) animating = true;
    animatingRef.current = animating;

    if (topologyDirtyRef.current) {
      for (const [id] of materialRefs.current) {
        if (quadRefs.current.has(id)) continue;
        materialRefs.current.get(id)?.dispose();
        materialRefs.current.delete(id);
        refCallbacksRef.current.delete(id);
        targetsRef.current.get(id)?.rt.dispose();
        targetsRef.current.delete(id);
        releaseHold(id);
      }
      topologyDirtyRef.current = false;
    }

    fullDirtyRef.current = false;
  }, PREVIEW_RENDER_PRIORITY);

  return (
    <group>
      {previewIds.map((id) => (
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
