/**
 * ImageEntities — Renders image entities as WebGL textured quads.
 * Phase 11: Image entity support.
 *
 * Each image entity is a separate mesh (different textures can't share InstancedMesh).
 * Positions update via refs in useFrame — zero React re-renders during pan/zoom/drag.
 * React state only changes when the set of image entity IDs changes.
 *
 * Performance:
 * - Frustum culling: invisible meshes skip draw calls via mesh.visible = false
 * - LOD: thumbnail texture when entity is small on screen, full res when zoomed in
 * - TextureManager: async loading, caching, ref-counted disposal
 * - Dirty flags: skip useFrame work when nothing changed
 * - Load-complete callback: no per-frame polling for texture readiness
 */

import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { THEME_COLORS } from '../core/theme-colors';
import { rgbToHex } from '../utils/color';
import { DEFAULT_IMAGE_WIDTH, DEFAULT_IMAGE_HEIGHT, MIN_IMAGE_HEIGHT } from '../core/constants';
import { ImageTextureManager } from '../utils/image-loader';
import type { ImageEntityData, EntityChange } from '../types';

const RENDER_ORDER_BG = 1;
const RENDER_ORDER_FG = 4;

// ---- Debug: colorize mip levels to visualize GPU LOD selection ----
// Set to true to replace mip levels with solid colors.
// Level 0 = original image, 1 = red, 2 = green, 3 = blue, 4 = yellow, etc.
const DEBUG_MIP_LEVELS = false;

const MIP_COLORS = [
  [255, 0, 0],     // Level 1: red
  [0, 255, 0],     // Level 2: green
  [0, 0, 255],     // Level 3: blue
  [255, 255, 0],   // Level 4: yellow
  [255, 0, 255],   // Level 5: magenta
  [0, 255, 255],   // Level 6: cyan
  [128, 64, 0],    // Level 7: brown
  [255, 128, 0],   // Level 8: orange
];

/** Replace auto-generated mip levels with solid colors for debugging. */
function colorizeMipLevels(
  gl: THREE.WebGLRenderer,
  texture: THREE.Texture
): void {
  const glCtx = gl.getContext() as WebGL2RenderingContext;
  const props = gl.properties.get(texture) as Record<string, unknown>;
  const glTex = props.__webglTexture as WebGLTexture | undefined;
  if (!glTex) return;

  glCtx.bindTexture(glCtx.TEXTURE_2D, glTex);

  const img = texture.image as { width: number; height: number };
  let w = img.width;
  let h = img.height;

  for (let level = 1; w > 1 || h > 1; level++) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    const c = MIP_COLORS[(level - 1) % MIP_COLORS.length];
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = c[0];
      data[i * 4 + 1] = c[1];
      data[i * 4 + 2] = c[2];
      data[i * 4 + 3] = 255;
    }
    glCtx.texSubImage2D(glCtx.TEXTURE_2D, level, 0, 0, w, h, glCtx.RGBA, glCtx.UNSIGNED_BYTE, data);
  }
}
// ---- End debug ----

/** Shared unit quad geometry — reused by all image meshes (never disposed) */
const sharedGeometry = (() => {
  const geo = new THREE.PlaneGeometry(1, 1);
  // Flip V coordinate so UV (0,0) = top-left (matches ImageBitmap origin).
  // This compensates for tex.flipY = false on our ImageBitmap textures.
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setY(i, 1 - uv.getY(i));
  }
  return geo;
})();

/** Placeholder material for images that haven't loaded yet */
function createPlaceholderMaterial(color: string): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
}

// ---- Object-fit: custom ShaderMaterial with per-entity UV offset/scale ----

const IMAGE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const IMAGE_FRAGMENT_SHADER = /* glsl */ `
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
  gl_FragColor = vec4(texColor.rgb, texColor.a * opacity);

  #include <colorspace_fragment>
}`;

/**
 * Compute UV offset/scale for object-fit modes, writing directly into
 * the uniform Vector2s to avoid allocations in the render loop.
 */
function applyObjectFitUV(
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

interface ImageEntitiesProps {
  maxImageTextureSize?: number;
  onEntitiesChange?: (changes: EntityChange[]) => void;
}

export function ImageEntities({ maxImageTextureSize, onEntitiesChange }: ImageEntitiesProps) {
  const store = useFlowStoreApi();
  const tokens = useTheme();

  // Track which image entity IDs exist (React re-renders only when this set changes)
  const [imageEntityIds, setImageEntityIds] = useState<string[]>(() => {
    return store.getState().entities
      .filter((e) => e.type === 'image')
      .map((e) => e.id);
  });

  // Fine-grained dirty flags — avoid full useFrame work for lightweight changes.
  // fullDirtyRef: positions, culling, LOD, textures (viewport/entity/texture-load changes)
  // selectionDirtyRef: only renderOrder needs updating
  // hiddenDirtyRef: only visibility needs updating
  // topologyDirtyRef: entity add/remove — gates the cleanup loop
  const fullDirtyRef = useRef(true);
  const selectionDirtyRef = useRef(true);
  const hiddenDirtyRef = useRef(true);
  const topologyDirtyRef = useRef(true);

  // Refs for each mesh, keyed by entity ID
  const meshRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  // Stable ref callbacks cached per entity ID (avoids new closure per render)
  const refCallbacksRef = useRef<Map<string, (mesh: THREE.Mesh | null) => void>>(new Map());
  // Material refs per entity (ShaderMaterial with UV offset/scale for object-fit)
  const materialRefs = useRef<Map<string, THREE.ShaderMaterial>>(new Map());
  // Track which src each entity currently has loaded (for detecting src changes)
  const loadedSrcRefs = useRef<Map<string, string>>(new Map());
  // Debug: track textures pending mip colorization (need one frame for GPU upload)
  const pendingColorizeRef = useRef<Set<THREE.Texture>>(new Set());
  const colorizedRef = useRef<WeakSet<THREE.Texture>>(new WeakSet());

  // Auto aspect ratio: track which entities have been auto-sized, deferred store updates
  const autoSizedRef = useRef<Set<string>>(new Set());
  const pendingDimUpdatesRef = useRef<Map<string, { w: number; h: number }>>(new Map());
  const dimFlushScheduledRef = useRef(false);
  // Stable ref for onEntitiesChange to avoid stale closures in microtasks
  const onEntitiesChangeRef = useRef(onEntitiesChange);
  onEntitiesChangeRef.current = onEntitiesChange;

  // Texture manager — singleton for component lifetime.
  // onLoad callback marks dirty so textures appear as soon as they're ready.
  const texManager = useMemo(() => {
    return new ImageTextureManager(() => { fullDirtyRef.current = true; }, maxImageTextureSize);
  }, [maxImageTextureSize]);

  // Placeholder color from theme (muted text color for subtle placeholder)
  const surfaceColor = rgbToHex(tokens[THEME_COLORS.text.secondary]);
  const errorColor = rgbToHex(tokens[THEME_COLORS.edge.invalid]);

  // Placeholder material (shared for unloaded images)
  const placeholderMat = useMemo(
    () => createPlaceholderMaterial(surfaceColor),
    [surfaceColor]
  );

  // Error material (shared for failed image loads)
  const errorMat = useMemo(
    () => createPlaceholderMaterial(errorColor),
    [errorColor]
  );

  // Cleanup texture manager on unmount
  useEffect(() => {
    return () => {
      texManager.disposeAll();
      placeholderMat.dispose();
      errorMat.dispose();
      materialRefs.current.forEach((m) => m.dispose());
      materialRefs.current.clear();
    };
  }, [texManager, placeholderMat, errorMat]);

  // Subscribe to store changes with fine-grained dirty flags.
  // - topologyVersion: entity add/remove → rebuild image ID list + full update
  // - positionVersion: position/dimension changes → full update
  // - entities: data-only changes (src, objectFit) → full update (skips position-only)
  // - viewport: pan/zoom → full update
  // - selectedEntityIds: only renderOrder changes → lightweight pass
  // - hiddenEntityIds: only visibility changes → lightweight pass
  useEffect(() => {
    const markFullDirty = () => { fullDirtyRef.current = true; };

    const unsubTopology = store.subscribe((s) => s.topologyVersion, () => {
      markFullDirty();
      topologyDirtyRef.current = true;
      const { entities } = store.getState();
      const ids = entities.filter((e) => e.type === 'image').map((e) => e.id);
      setImageEntityIds((prev) => {
        if (prev.length !== ids.length) return ids;
        for (let i = 0; i < ids.length; i++) {
          if (prev[i] !== ids[i]) return ids;
        }
        return prev;
      });
    });
    // Position/dimension changes — fires on drag/resize but useFrame is now O(k) not O(n)
    const unsubPositions = store.subscribe((s) => s.positionVersion, markFullDirty);
    // Data changes (src, objectFit, etc.) — skip position-only updates already handled above
    let lastPosVersion = store.getState().positionVersion;
    const unsubEntities = store.subscribe((s) => s.entities, () => {
      const pv = store.getState().positionVersion;
      if (pv !== lastPosVersion) {
        // Position version also bumped → position-only update, already handled
        lastPosVersion = pv;
        return;
      }
      markFullDirty();
    });
    const unsubViewport = store.subscribe((s) => s.viewport, markFullDirty);
    const unsubSelection = store.subscribe((s) => s.selectedEntityIds, () => {
      selectionDirtyRef.current = true;
    });
    const unsubHidden = store.subscribe((s) => s.hiddenEntityIds, () => {
      hiddenDirtyRef.current = true;
    });

    return () => {
      unsubTopology();
      unsubPositions();
      unsubEntities();
      unsubViewport();
      unsubSelection();
      unsubHidden();
    };
  }, [store]);

  // Get or create a stable ref callback for a given entity ID.
  // Pre-creates the material at mount time so useFrame never allocates.
  function getRefCallback(id: string): (mesh: THREE.Mesh | null) => void {
    let cb = refCallbacksRef.current.get(id);
    if (!cb) {
      cb = (mesh: THREE.Mesh | null) => {
        if (mesh) {
          meshRefs.current.set(id, mesh);
          // Pre-create ShaderMaterial so useFrame only updates uniforms, never allocates
          if (!materialRefs.current.has(id)) {
            materialRefs.current.set(id, new THREE.ShaderMaterial({
              uniforms: {
                map: { value: null },
                opacity: { value: 1.0 },
                uvOffset: { value: new THREE.Vector2(0, 0) },
                uvScale: { value: new THREE.Vector2(1, 1) },
              },
              vertexShader: IMAGE_VERTEX_SHADER,
              fragmentShader: IMAGE_FRAGMENT_SHADER,
              transparent: true,
              depthWrite: false,
              depthTest: false,
              side: THREE.DoubleSide,
            }));
          }
        } else {
          meshRefs.current.delete(id);
        }
      };
      refCallbacksRef.current.set(id, cb);
    }
    return cb;
  }

  // ---- useFrame: update positions, textures, visibility (no React re-render) ----
  // Uses fine-grained dirty flags to skip work:
  // - fullDirtyRef: positions, culling, LOD, textures (viewport/entity/texture changes)
  // - selectionDirtyRef: only renderOrder (selection click)
  // - hiddenDirtyRef: only visibility (hide/show toggle)
  useFrame(({ size }) => {
    // Drain texture upload queue: 1-2 per frame to avoid GPU stalls.
    // Runs before dirty-flag check so queue drains even when nothing else changed.
    if (texManager.hasQueuedUploads) {
      texManager.processUploadQueue(2);
      fullDirtyRef.current = true;
    }

    const full = fullDirtyRef.current;
    const selDirty = selectionDirtyRef.current;
    const hidDirty = hiddenDirtyRef.current;

    if (!full && !selDirty && !hidDirty) return;

    const {
      entities,
      viewport,
      selectedEntityIds,
      hiddenEntityIds,
    } = store.getState();

    // Viewport bounds only needed for full update (frustum culling)
    let viewLeft = 0, viewRight = 0, viewTop = 0, viewBottom = 0;
    if (full) {
      const invZoom = 1 / viewport.zoom;
      viewLeft = -viewport.x * invZoom;
      viewRight = (size.width - viewport.x) * invZoom;
      viewTop = -viewport.y * invZoom;
      viewBottom = (size.height - viewport.y) * invZoom;
    }
    const cullPadding = 100;

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (entity.type !== 'image') continue;

      const mesh = meshRefs.current.get(entity.id);
      if (!mesh) continue;

      // Lightweight path: selection-only or hidden-only change
      if (!full) {
        if (hidDirty) {
          mesh.visible = !hiddenEntityIds.has(entity.id);
        }
        if (selDirty && mesh.visible) {
          mesh.renderOrder = selectedEntityIds.has(entity.id) ? RENDER_ORDER_FG : RENDER_ORDER_BG;
        }
        continue;
      }

      // Full path: positions, culling, LOD, textures, renderOrder, visibility

      // Hidden check
      if (hiddenEntityIds.has(entity.id)) {
        mesh.visible = false;
        continue;
      }

      const w = entity.width ?? DEFAULT_IMAGE_WIDTH;
      const h = entity.height ?? DEFAULT_IMAGE_HEIGHT;
      const data = entity.data as ImageEntityData;
      const src = data.src;

      // Frustum culling
      const entityRight = entity.position.x + w;
      const entityBottom = entity.position.y + h;
      if (
        entityRight < viewLeft - cullPadding ||
        entity.position.x > viewRight + cullPadding ||
        entityBottom < viewTop - cullPadding ||
        entity.position.y > viewBottom + cullPadding
      ) {
        mesh.visible = false;
        continue;
      }

      mesh.visible = true;

      // Position mesh center (world space, Y-down)
      const cx = entity.position.x + w / 2;
      const cy = -(entity.position.y + h / 2); // Negate Y for GL
      mesh.position.set(cx, cy, 0.05); // Slightly above base plane
      mesh.scale.set(w, h, 1);

      // Texture management — acquire/swap on src change
      const prevSrc = loadedSrcRefs.current.get(entity.id);
      if (src && src !== prevSrc) {
        // Release old texture ref
        if (prevSrc) texManager.release(prevSrc);
        texManager.acquire(src);
        loadedSrcRefs.current.set(entity.id, src);
        autoSizedRef.current.delete(entity.id); // re-auto-size for new image
      } else if (!src && prevSrc) {
        texManager.release(prevSrc);
        loadedSrcRefs.current.delete(entity.id);
      }

      // Pick the best LOD texture
      const screenWidth = w * viewport.zoom;
      const texture = src ? texManager.getTexture(src, screenWidth) : null;

      if (texture) {
        // ShaderMaterial pre-created in ref callback — update uniforms only
        const mat = materialRefs.current.get(entity.id);
        if (mat) {
          const u = mat.uniforms;
          if (u.map.value !== texture) {
            u.map.value = texture;
            // Debug: queue for mip colorization after GPU upload
            if (DEBUG_MIP_LEVELS && !colorizedRef.current.has(texture)) {
              pendingColorizeRef.current.add(texture);
            }
          }
          u.opacity.value = 1;

          // Object-fit UV transforms — mutates existing Vector2 uniforms in place
          const objectFit = data.objectFit ?? 'fill';
          const entry = texManager.getEntry(src!);
          applyObjectFitUV(
            u.uvOffset.value as THREE.Vector2,
            u.uvScale.value as THREE.Vector2,
            objectFit,
            w, h,
            entry?.naturalWidth ?? 0,
            entry?.naturalHeight ?? 0,
          );

          mesh.material = mat;
        }
      } else {
        // Show placeholder or error state
        const entry = src ? texManager.getEntry(src) : undefined;
        mesh.material = entry?.state === 'error' ? errorMat : placeholderMat;
      }

      mesh.renderOrder = selectedEntityIds.has(entity.id) ? RENDER_ORDER_FG : RENDER_ORDER_BG;

      // Auto aspect ratio: on first texture load, adjust height to match natural proportions
      if (texture && src && !autoSizedRef.current.has(entity.id)) {
        const entry = texManager.getEntry(src);
        if (entry && entry.naturalWidth > 0 && entry.naturalHeight > 0) {
          autoSizedRef.current.add(entity.id);
          const currentW = entity.width ?? DEFAULT_IMAGE_WIDTH;
          const naturalAR = entry.naturalHeight / entry.naturalWidth;
          const expectedH = Math.max(MIN_IMAGE_HEIGHT, Math.round(currentW * naturalAR));
          const currentH = entity.height ?? DEFAULT_IMAGE_HEIGHT;
          if (Math.abs(expectedH - currentH) > 0.5) {
            pendingDimUpdatesRef.current.set(entity.id, { w: currentW, h: expectedH });
          }
        }
      }
    }

    // Flush deferred dimension updates via microtask (avoids re-render inside useFrame)
    if (pendingDimUpdatesRef.current.size > 0 && !dimFlushScheduledRef.current) {
      dimFlushScheduledRef.current = true;
      queueMicrotask(() => {
        dimFlushScheduledRef.current = false;
        const pending = pendingDimUpdatesRef.current;
        if (pending.size === 0) return;
        const changes: EntityChange[] = [];
        for (const [id, { w, h }] of pending) {
          store.getState().updateEntityDimensions(id, w, h);
          changes.push({ type: 'dimensions', id, dimensions: { width: w, height: h } });
        }
        pending.clear();
        // Notify consumer so controlled-mode state stays in sync
        onEntitiesChangeRef.current?.(changes);
      });
    }

    // Clean up materials and ref callbacks for removed entities.
    // Only needed after topology changes (entity add/remove), not on every pan/zoom.
    if (topologyDirtyRef.current) {
      for (const [id] of materialRefs.current) {
        if (!meshRefs.current.has(id)) {
          const mat = materialRefs.current.get(id);
          mat?.dispose();
          materialRefs.current.delete(id);
          refCallbacksRef.current.delete(id);
          autoSizedRef.current.delete(id);
          const src = loadedSrcRefs.current.get(id);
          if (src) {
            texManager.release(src);
            loadedSrcRefs.current.delete(id);
          }
        }
      }
      topologyDirtyRef.current = false;
    }

    fullDirtyRef.current = false;
    selectionDirtyRef.current = false;
    hiddenDirtyRef.current = false;

    // Keep draining upload queue next frame if more items remain
    if (texManager.hasQueuedUploads) {
      fullDirtyRef.current = true;
    }
  });

  // Debug: colorize mip levels one frame after GPU upload
  useFrame(({ gl }) => {
    if (!DEBUG_MIP_LEVELS || pendingColorizeRef.current.size === 0) return;
    for (const texture of pendingColorizeRef.current) {
      // Force texture upload if initTexture is available (Three.js r152+)
      if ('initTexture' in gl) {
        (gl as unknown as { initTexture: (t: THREE.Texture) => void }).initTexture(texture);
      }
      const props = gl.properties.get(texture) as Record<string, unknown>;
      const glTex = props.__webglTexture as WebGLTexture | undefined;
      if (glTex) {
        colorizeMipLevels(gl, texture);
        colorizedRef.current.add(texture);
        pendingColorizeRef.current.delete(texture);
      }
    }
  });

  return (
    <group>
      {imageEntityIds.map((id) => (
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
