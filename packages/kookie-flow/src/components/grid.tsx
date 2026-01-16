import { useMemo, useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFlowStoreApi } from './context';
import { GRID_COLORS, DEFAULT_GRID_SIZE } from '../core/constants';

export interface GridProps {
  size?: number;
  color?: string;
  colorAccent?: string;
}

/**
 * High-performance infinite grid rendered via shader.
 * Key optimizations:
 * - Dirty flag to skip updates when viewport unchanged
 * - Simplified shader math for better Safari performance
 * - Reuses geometry and material
 */
export function Grid({
  size = DEFAULT_GRID_SIZE,
  color = GRID_COLORS.lines,
  colorAccent = GRID_COLORS.linesAccent,
}: GridProps) {
  const { camera } = useThree();
  const store = useFlowStoreApi();
  const meshRef = useRef<THREE.Mesh>(null);
  const dirtyRef = useRef(true);
  const lastViewportRef = useRef({ x: 0, y: 0, zoom: 1 });

  const gridMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uGridSize: { value: size },
        uColor: { value: new THREE.Color(color) },
        uColorAccent: { value: new THREE.Color(colorAccent) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vWorldPos;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xy;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      // Simplified fragment shader for better Safari performance
      fragmentShader: /* glsl */ `
        precision mediump float;

        uniform float uGridSize;
        uniform vec3 uColor;
        uniform vec3 uColorAccent;

        varying vec2 vWorldPos;

        void main() {
          vec2 coord = vec2(vWorldPos.x, -vWorldPos.y);

          // Grid lines - simplified calculation
          vec2 grid = abs(fract(coord / uGridSize - 0.5) - 0.5);
          vec2 gridWidth = fwidth(coord / uGridSize);
          vec2 lineAA = smoothstep(gridWidth * 0.5, gridWidth * 1.5, grid);
          float line = 1.0 - min(lineAA.x, lineAA.y);

          // Accent lines every 5 grid units
          vec2 gridAccent = abs(fract(coord / (uGridSize * 5.0) - 0.5) - 0.5);
          vec2 accentWidth = fwidth(coord / (uGridSize * 5.0));
          vec2 accentAA = smoothstep(accentWidth * 0.5, accentWidth * 1.5, gridAccent);
          float lineAccent = 1.0 - min(accentAA.x, accentAA.y);

          // Combine colors
          float alpha = max(line * 0.35, lineAccent * 0.55);

          if (alpha < 0.01) discard;

          vec3 finalColor = mix(uColor, uColorAccent, lineAccent);
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }, [size, color, colorAccent]);

  // Subscribe to viewport changes
  useEffect(() => {
    return store.subscribe(
      (state) => state.viewport,
      () => { dirtyRef.current = true; }
    );
  }, [store]);

  // Update grid position/scale in useFrame
  useFrame(() => {
    if (!meshRef.current || !(camera instanceof THREE.OrthographicCamera)) return;

    const { viewport } = store.getState();

    // Skip if viewport unchanged
    if (
      !dirtyRef.current &&
      viewport.x === lastViewportRef.current.x &&
      viewport.y === lastViewportRef.current.y &&
      viewport.zoom === lastViewportRef.current.zoom
    ) {
      return;
    }

    dirtyRef.current = false;
    lastViewportRef.current = { ...viewport };

    // Position grid at the center of what the camera sees
    const centerX = (camera.left + camera.right) / 2;
    const centerY = (camera.top + camera.bottom) / 2;
    const viewWidth = Math.abs(camera.right - camera.left);
    const viewHeight = Math.abs(camera.top - camera.bottom);

    // Make grid larger than view to prevent edges showing during pan
    meshRef.current.position.set(centerX, centerY, -1);
    meshRef.current.scale.set(viewWidth * 3, viewHeight * 3, 1);
  });

  return (
    <mesh ref={meshRef} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <primitive object={gridMaterial} attach="material" />
    </mesh>
  );
}
