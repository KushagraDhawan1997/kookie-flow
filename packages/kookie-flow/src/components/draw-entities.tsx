/**
 * DrawEntities — ink on the canvas.
 *
 * One mesh per stroke, each a ribbon of triangles built from the entity's points. A stroke's
 * geometry changes only when its points do — which, after the gesture that made it, is never —
 * so a board of drawings costs a draw call each and no work at all per frame.
 *
 * Not instanced, unlike the nodes: every stroke has a different vertex count, which is the one
 * thing an InstancedMesh cannot vary. Strokes are also comparatively few — a person draws tens of
 * them, not thousands — so a mesh apiece is the honest trade.
 */

import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { THEME_COLORS } from '../core/theme-colors';
import { rgbToHex } from '../utils/color';
import { buildStrokeRibbon, strokeIndices } from '../utils/stroke-geometry';
import { entityDepth } from '../utils/entity-depth';
import type { DrawEntityData } from '../types';

const RENDER_ORDER = 3;
export const DEFAULT_STROKE_WIDTH = 3;

interface StrokeMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial;
  mesh: THREE.Mesh;
  /** The points array this geometry was built from — identity is the whole dirty check. */
  builtFrom: number[] | null;
  builtWidth: number;
}

export function DrawEntities() {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const groupRef = useRef<THREE.Group>(null);
  const strokesRef = useRef<Map<string, StrokeMesh>>(new Map());
  const dirtyRef = useRef(true);

  const defaultColor = rgbToHex(tokens[THEME_COLORS.text.primary]);

  const [drawIds, setDrawIds] = useState<string[]>(() =>
    store.getState().entities.filter((e) => e.type === 'draw').map((e) => e.id)
  );
  const drawIdsRef = useRef(drawIds);
  drawIdsRef.current = drawIds;

  useEffect(() => {
    const mark = () => { dirtyRef.current = true; };
    const unsubTopology = store.subscribe((s) => s.topologyVersion, () => {
      mark();
      const ids = store.getState().entities.filter((e) => e.type === 'draw').map((e) => e.id);
      setDrawIds((prev) => {
        if (prev.length !== ids.length) return ids;
        for (let i = 0; i < ids.length; i++) if (prev[i] !== ids[i]) return ids;
        return prev;
      });
    });
    const unsubPositions = store.subscribe((s) => s.positionVersion, mark);
    const unsubEntities = store.subscribe((s) => s.entities, mark);
    const unsubSelection = store.subscribe((s) => s.selectedEntityIds, mark);
    const unsubStack = store.subscribe((s) => s.stackVersion, mark);
    const unsubHidden = store.subscribe((s) => s.hiddenEntityIds, mark);
    return () => {
      unsubTopology();
      unsubPositions();
      unsubEntities();
      unsubSelection();
      unsubStack();
      unsubHidden();
    };
  }, [store]);

  // Geometries and materials are GPU objects; React unmounting the group does not free them.
  useEffect(() => {
    const strokes = strokesRef.current;
    return () => {
      strokes.forEach((s) => {
        s.geometry.dispose();
        s.material.dispose();
      });
      strokes.clear();
    };
  }, []);

  const scratch = useMemo<{ buffer: Float32Array<ArrayBuffer> }>(
    () => ({ buffer: new Float32Array(0) }),
    []
  );

  useFrame(() => {
    const group = groupRef.current;
    if (!group || !dirtyRef.current) return;
    dirtyRef.current = false;

    const { entityMap, selectedEntityIds, hiddenEntityIds, stackOrder } = store.getState();
    const strokes = strokesRef.current;
    const seen = new Set<string>();

    for (const id of drawIdsRef.current) {
      const entity = entityMap.get(id);
      if (!entity) continue;
      seen.add(id);
      const data = entity.data as DrawEntityData;
      const points = data.points ?? [];
      const width = data.strokeWidth ?? DEFAULT_STROKE_WIDTH;

      let stroke = strokes.get(id);
      if (!stroke) {
        const geometry = new THREE.BufferGeometry();
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(data.strokeColor ?? defaultColor),
          transparent: true,
          // Ink is drawn on the plane like everything else and tests against it, but writes no
          // depth: a ribbon's transparent joints would otherwise punch holes in what is behind.
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = RENDER_ORDER;
        group.add(mesh);
        stroke = { geometry, material, mesh, builtFrom: null, builtWidth: 0 };
        strokes.set(id, stroke);
      }

      if (stroke.builtFrom !== points || stroke.builtWidth !== width) {
        const { vertices, count } = buildStrokeRibbon(points, width, scratch.buffer);
        if (vertices !== scratch.buffer && vertices.length > scratch.buffer.length) {
          scratch.buffer = new Float32Array(vertices.length);
        }
        // Copied out of the scratch buffer: the attribute keeps its own memory, or the next
        // stroke built this frame would overwrite the last one's vertices.
        const owned = new Float32Array(count * 3);
        owned.set(vertices.subarray(0, count * 3));
        stroke.geometry.setAttribute('position', new THREE.BufferAttribute(owned, 3));
        stroke.geometry.setIndex(new THREE.BufferAttribute(strokeIndices(count), 1));
        stroke.geometry.computeBoundingSphere();
        stroke.builtFrom = points;
        stroke.builtWidth = width;
      }

      stroke.material.color.set(data.strokeColor ?? defaultColor);
      stroke.mesh.visible = !hiddenEntityIds.has(id);
      // The stroke's points are relative to the entity, so the mesh carries the position and the
      // Y flip that turns world coordinates into GL ones.
      stroke.mesh.position.set(
        entity.position.x,
        -entity.position.y,
        entityDepth(id, stackOrder, selectedEntityIds)
      );
      stroke.mesh.scale.set(1, -1, 1);
    }

    for (const [id, stroke] of strokes) {
      if (seen.has(id)) continue;
      group.remove(stroke.mesh);
      stroke.geometry.dispose();
      stroke.material.dispose();
      strokes.delete(id);
    }
  });

  return <group ref={groupRef} />;
}
