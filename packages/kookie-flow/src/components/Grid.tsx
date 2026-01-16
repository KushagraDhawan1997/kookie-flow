import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GRID_COLORS, DEFAULT_GRID_SIZE } from '../core/constants';

export interface GridProps {
  size?: number;
  divisions?: number;
  color?: string;
  colorAccent?: string;
}

/**
 * Infinite grid rendered via shader.
 * Stays fixed relative to camera, giving illusion of infinite grid.
 */
export function Grid({
  size = DEFAULT_GRID_SIZE,
  color = GRID_COLORS.lines,
  colorAccent = GRID_COLORS.linesAccent,
}: GridProps) {
  const { viewport } = useThree();

  const gridMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uGridSize: { value: size },
        uColor: { value: new THREE.Color(color) },
        uColorAccent: { value: new THREE.Color(colorAccent) },
        uZoom: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uGridSize;
        uniform vec3 uColor;
        uniform vec3 uColorAccent;
        uniform float uZoom;
        varying vec2 vUv;

        void main() {
          vec2 coord = vUv * 1000.0; // Scale to world space
          vec2 grid = abs(fract(coord / uGridSize - 0.5) - 0.5) / fwidth(coord / uGridSize);
          float line = min(grid.x, grid.y);

          // Thicker lines every 5 units
          vec2 gridAccent = abs(fract(coord / (uGridSize * 5.0) - 0.5) - 0.5) / fwidth(coord / (uGridSize * 5.0));
          float lineAccent = min(gridAccent.x, gridAccent.y);

          float alpha = 1.0 - min(line, 1.0);
          float alphaAccent = 1.0 - min(lineAccent, 1.0);

          vec3 finalColor = mix(uColor, uColorAccent, alphaAccent);
          gl_FragColor = vec4(finalColor, max(alpha * 0.3, alphaAccent * 0.5));
        }
      `,
      transparent: true,
      depthWrite: false,
    });
  }, [size, color, colorAccent]);

  return (
    <mesh position={[0, 0, -1]} renderOrder={-1}>
      <planeGeometry args={[viewport.width * 2, viewport.height * 2]} />
      <primitive object={gridMaterial} attach="material" />
    </mesh>
  );
}
