/**
 * The alignment guides, drawn.
 *
 * One instanced mesh for every line on the board, which in practice is two: a guide only exists
 * while something is being dragged past something else. Instanced anyway, because the alternative
 * is mounting and unmounting meshes during a drag, and a drag is the one gesture where nothing may
 * touch React.
 *
 * The lines are ONE SCREEN PIXEL wide at any zoom. A guide is a statement about alignment, not an
 * object in the world: a hairline that thickens as you zoom in would read as a thing that is
 * there rather than as a measurement of things that are.
 */

import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { useTheme } from '../contexts/ThemeContext';
import { THEME_COLORS } from '../core/theme-colors';

/** Above the nodes: a guide that a node could cover would be pointing at nothing. */
const RENDER_ORDER = 12;
/** How many guides can be drawn at once. Six each way is far more than a drag ever produces. */
const CAPACITY = 12;

export function HelperLines() {
  const store = useFlowStoreApi();
  const tokens = useTheme();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dirtyRef = useRef(true);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const color = tokens[THEME_COLORS.selectionBox.fill];
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color[0], color[1], color[2]),
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }),
    [color]
  );

  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => { material.dispose(); }, [material]);

  useEffect(() => {
    const mark = () => { dirtyRef.current = true; };
    const unsubLines = store.subscribe((s) => s.helperLinesVersion, mark);
    const unsubViewport = store.subscribe((s) => s.viewport, mark);
    return () => {
      unsubLines();
      unsubViewport();
    };
  }, [store]);

  const matrix = useMemo(() => new THREE.Matrix4(), []);

  useFrame(({ size }) => {
    const mesh = meshRef.current;
    if (!mesh || !dirtyRef.current) return;
    dirtyRef.current = false;

    const { helperLinesX, helperLinesY, viewport } = store.getState();
    if (helperLinesX.length === 0 && helperLinesY.length === 0) {
      mesh.count = 0;
      return;
    }

    // One screen pixel, expressed in the world units the mesh is scaled in.
    const thickness = 1 / viewport.zoom;
    const invZoom = thickness;
    const left = -viewport.x * invZoom;
    const right = (size.width - viewport.x) * invZoom;
    const top = -viewport.y * invZoom;
    const bottom = (size.height - viewport.y) * invZoom;

    let count = 0;
    for (const x of helperLinesX) {
      if (count >= CAPACITY) break;
      matrix.makeScale(thickness, bottom - top, 1);
      matrix.setPosition(x, -(top + bottom) / 2, 0);
      mesh.setMatrixAt(count++, matrix);
    }
    for (const y of helperLinesY) {
      if (count >= CAPACITY) break;
      matrix.makeScale(right - left, thickness, 1);
      matrix.setPosition((left + right) / 2, -y, 0);
      mesh.setMatrixAt(count++, matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, CAPACITY]}
      frustumCulled={false}
      renderOrder={RENDER_ORDER}
    />
  );
}
