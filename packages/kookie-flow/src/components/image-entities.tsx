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
import { DEFAULT_IMAGE_WIDTH, DEFAULT_IMAGE_HEIGHT } from '../core/constants';
import { ImageTextureManager } from '../utils/image-loader';
import type { ImageEntityData } from '../types';

const RENDER_ORDER_BG = 1;
const RENDER_ORDER_FG = 4;

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

export function ImageEntities() {
  const store = useFlowStoreApi();
  const tokens = useTheme();

  // Track which image entity IDs exist (React re-renders only when this set changes)
  const [imageEntityIds, setImageEntityIds] = useState<string[]>(() => {
    return store.getState().entities
      .filter((e) => e.type === 'image')
      .map((e) => e.id);
  });

  const dirtyRef = useRef(true);

  // Refs for each mesh, keyed by entity ID
  const meshRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  // Stable ref callbacks cached per entity ID (avoids new closure per render)
  const refCallbacksRef = useRef<Map<string, (mesh: THREE.Mesh | null) => void>>(new Map());
  // Material refs per entity (each has its own texture)
  const materialRefs = useRef<Map<string, THREE.MeshBasicMaterial>>(new Map());
  // Track which src each entity currently has loaded (for detecting src changes)
  const loadedSrcRefs = useRef<Map<string, string>>(new Map());

  // Texture manager — singleton for component lifetime.
  // onLoad callback marks dirty so textures appear as soon as they're ready.
  const texManager = useMemo(() => {
    return new ImageTextureManager(() => { dirtyRef.current = true; });
  }, []);

  // Placeholder color from theme (muted text color for subtle placeholder)
  const surfaceColor = rgbToHex(tokens[THEME_COLORS.text.secondary]);

  // Placeholder material (shared for unloaded images)
  const placeholderMat = useMemo(
    () => createPlaceholderMaterial(surfaceColor),
    [surfaceColor]
  );

  // Cleanup texture manager on unmount
  useEffect(() => {
    return () => {
      texManager.disposeAll();
      placeholderMat.dispose();
      materialRefs.current.forEach((m) => m.dispose());
      materialRefs.current.clear();
    };
  }, [texManager, placeholderMat]);

  // Subscribe to store: update imageEntityIds only when the set of image IDs changes
  useEffect(() => {
    const markDirty = () => { dirtyRef.current = true; };

    const unsubEntities = store.subscribe((s) => s.entities, (entities) => {
      markDirty();
      const ids = entities.filter((e) => e.type === 'image').map((e) => e.id);
      setImageEntityIds((prev) => {
        if (prev.length !== ids.length) return ids;
        for (let i = 0; i < ids.length; i++) {
          if (prev[i] !== ids[i]) return ids;
        }
        return prev;
      });
    });
    const unsubSelection = store.subscribe((s) => s.selectedEntityIds, markDirty);
    const unsubHidden = store.subscribe((s) => s.hiddenEntityIds, markDirty);

    return () => {
      unsubEntities();
      unsubSelection();
      unsubHidden();
    };
  }, [store]);

  // Get or create a stable ref callback for a given entity ID
  function getRefCallback(id: string): (mesh: THREE.Mesh | null) => void {
    let cb = refCallbacksRef.current.get(id);
    if (!cb) {
      cb = (mesh: THREE.Mesh | null) => {
        if (mesh) meshRefs.current.set(id, mesh);
        else meshRefs.current.delete(id);
      };
      refCallbacksRef.current.set(id, cb);
    }
    return cb;
  }

  // ---- useFrame: update positions, textures, visibility (no React re-render) ----
  useFrame(({ size }) => {
    if (!dirtyRef.current) return;

    const {
      entities,
      viewport,
      selectedEntityIds,
      hiddenEntityIds,
    } = store.getState();

    const invZoom = 1 / viewport.zoom;
    const viewLeft = -viewport.x * invZoom;
    const viewRight = (size.width - viewport.x) * invZoom;
    const viewTop = -viewport.y * invZoom;
    const viewBottom = (size.height - viewport.y) * invZoom;
    const cullPadding = 100;

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (entity.type !== 'image') continue;

      const mesh = meshRefs.current.get(entity.id);
      if (!mesh) continue;

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
      } else if (!src && prevSrc) {
        texManager.release(prevSrc);
        loadedSrcRefs.current.delete(entity.id);
      }

      // Pick the best LOD texture
      const screenWidth = w * viewport.zoom;
      const texture = src ? texManager.getTexture(src, screenWidth) : null;

      if (texture) {
        // Get or create material for this entity
        let mat = materialRefs.current.get(entity.id);
        if (!mat) {
          mat = new THREE.MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
          });
          materialRefs.current.set(entity.id, mat);
        }

        // Update texture if it changed
        if (mat.map !== texture) {
          mat.map = texture;
          mat.needsUpdate = true;
        }
        mat.opacity = 1;
        mesh.material = mat;
      } else {
        // Show placeholder
        mesh.material = placeholderMat;
      }

      mesh.renderOrder = selectedEntityIds.has(entity.id) ? RENDER_ORDER_FG : RENDER_ORDER_BG;
    }

    // Clean up materials and ref callbacks for removed entities
    for (const [id] of materialRefs.current) {
      if (!meshRefs.current.has(id)) {
        const mat = materialRefs.current.get(id);
        mat?.dispose();
        materialRefs.current.delete(id);
        refCallbacksRef.current.delete(id);
        const src = loadedSrcRefs.current.get(id);
        if (src) {
          texManager.release(src);
          loadedSrcRefs.current.delete(id);
        }
      }
    }

    dirtyRef.current = false;
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
